using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using LinguaReadApi.Models; // Assuming a model for DeepL response exists or will be created
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Linq; // Added for Where/Select

namespace LinguaReadApi.Services
{
    public interface ITranslationService
    {
        Task<string> TranslateTextAsync(string text, string? sourceLang, string targetLang); // Mark sourceLang as nullable
        Task<Dictionary<string, string>> TranslateBatchAsync(List<string> words, string targetLang, string? sourceLang = null); // Mark sourceLang as nullable
    }

    public class DeepLTranslationService : ITranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly IConfiguration _configuration;
        private readonly ILogger<DeepLTranslationService> _logger;
        private readonly ILanguageService _languageService; // Added LanguageService dependency
        private readonly string _apiKey;
        private readonly string _apiUrl;

        private const int MaxTextsPerRequest = 50;
        private const int MaxAttempts = 3;
        private static readonly TimeSpan MaxRetryAfter = TimeSpan.FromSeconds(5);

        // Per attempt. Well below the default HttpClient's 100 s, which used to be the only limit.
        internal TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(15);
        internal TimeSpan RetryBaseDelay { get; set; } = TimeSpan.FromSeconds(1);

        public DeepLTranslationService(HttpClient httpClient, IConfiguration configuration, ILogger<DeepLTranslationService> logger, ILanguageService languageService) // Added languageService parameter
        {
            _httpClient = httpClient;
            _configuration = configuration;
            _logger = logger;
            _languageService = languageService; // Store injected service

            // Read API key and throw if missing
            _apiKey = _configuration["DeepL:ApiKey"] ?? throw new InvalidOperationException("DeepL API Key (DeepL:ApiKey) is not configured. Check .env (DeepL__ApiKey) or appsettings.json.");
            // Use a specific config key for the translate endpoint to avoid conflicts. Default to free API translate endpoint.
            _apiUrl = _configuration["DeepL:TranslateUrl"] ?? "https://api-free.deepl.com/v2/translate";

            // The check below is now redundant because of the null-coalescing throw above,
            // but it doesn't hurt to leave it commented for future reference.
            // if (string.IsNullOrEmpty(_apiKey))
            // {
            //     _logger.LogError("DeepL API Key is not configured.");
            //     throw new InvalidOperationException("DeepL API Key is missing in configuration.");
            // }

            // The Authorization header is attached per-request in TranslateBatchAsync
            // (see SendAsync below) rather than on DefaultRequestHeaders, so this service
            // stays correct under any HttpClient lifetime (transient, typed, or singleton).
        }

        public async Task<Dictionary<string, string>> TranslateBatchAsync(List<string> words, string targetLang, string? sourceLang = null) // Mark sourceLang as nullable
        {
            var translations = new Dictionary<string, string>();
            // Same input cleanup as the Azure and Google providers: duplicates and blanks only spend
            // DeepL quota, and duplicates can push a batch into an extra request.
            var distinctWords = words?.Where(w => !string.IsNullOrWhiteSpace(w)).Distinct().ToList();
            if (distinctWords == null || distinctWords.Count == 0)
            {
                return translations;
            }

            try
            {
                // --- Determine the final target language code ---
                string finalDeepLTargetCode = targetLang; // Default to the requested target language

                if (!string.IsNullOrEmpty(sourceLang))
                {
                    // Fetch all languages and find the one matching the source code
                    var allLanguages = await _languageService.GetAllLanguagesAsync();
                    var sourceLanguageConfig = allLanguages.FirstOrDefault(l => l.Code.Equals(sourceLang, StringComparison.OrdinalIgnoreCase));

                    if (sourceLanguageConfig != null && !string.IsNullOrEmpty(sourceLanguageConfig.DeepLTargetCode))
                    {
                        finalDeepLTargetCode = sourceLanguageConfig.DeepLTargetCode;
                        _logger.LogInformation("Using configured DeepL target code '{ConfiguredCode}' for source '{SourceCode}' instead of requested '{RequestedCode}'.", finalDeepLTargetCode, sourceLang, targetLang);
                    }
                }
                // --- End determining target code ---

                // The reader sends every unknown word of a text at once. Chunk the request, as the
                // Azure and Google providers do: DeepL caps the request size, and a chunk DeepL
                // rejects then only loses its own words. A failure that would hit every chunk
                // (timeout, rate limit, quota, key, DeepL down) ends the batch instead: the chunks
                // run one after another, so each would add its own wait for the reader.
                var chunks = distinctWords.Chunk(MaxTextsPerRequest).ToList();
                for (var i = 0; i < chunks.Count; i++)
                {
                    if (!await TranslateChunkAsync(chunks[i], finalDeepLTargetCode, sourceLang, translations))
                    {
                        if (i < chunks.Count - 1)
                        {
                            _logger.LogWarning("Skipping the remaining {Remaining} DeepL request(s) of this batch.", chunks.Count - 1 - i);
                        }
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while calling DeepL API.");
                // Consider throwing or returning partial results/error indication
            }

            return translations;
        }

        // Returns whether the rest of the batch is worth sending: false when this chunk failed in a way
        // the next one would too.
        private async Task<bool> TranslateChunkAsync(string[] words, string targetCode, string? sourceLang, Dictionary<string, string> translations)
        {
            try
            {
                using var response = await SendWithRetryAsync(() => BuildRequest(words, targetCode, sourceLang));
                if (response == null)
                {
                    return false; // Timed out; already logged.
                }

                if (response.IsSuccessStatusCode)
                {
                    // Need DeepLResponse model defined appropriately
                    var responseContent = await response.Content.ReadFromJsonAsync<DeepLResponse>();
                    if (responseContent?.translations != null && responseContent.translations.Length == words.Length)
                    {
                        for (int i = 0; i < words.Length; i++)
                        {
                            string originalWord = words[i] ?? string.Empty;
                            string translatedWord = responseContent.translations[i].text ?? string.Empty;

                            // Add raw strings to the dictionary (no sanitization)
                            translations[originalWord] = translatedWord;
                        }
                        _logger.LogInformation("Successfully received {Count} translations from DeepL.", words.Length);
                    }
                    else
                    {
                        _logger.LogWarning("DeepL response format mismatch or missing translations. Response: {Response}", await response.Content.ReadAsStringAsync());
                    }
                }
                else
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError("DeepL API request failed with status {Status}: {Error}", response.StatusCode, errorContent);
                    return !FailsEveryRequest(response.StatusCode);
                }
            }
            catch (HttpRequestException ex)
            {
                // Still unreachable after the retries.
                _logger.LogError(ex, "Error occurred while calling DeepL API.");
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while calling DeepL API.");
            }

            return true;
        }

        private HttpRequestMessage BuildRequest(string[] words, string targetCode, string? sourceLang)
        {
            // DeepL Free API expects form data (application/x-www-form-urlencoded).
            var formData = new List<KeyValuePair<string, string>>();
            foreach (var word in words)
            {
                formData.Add(new KeyValuePair<string, string>("text", word));
            }
            formData.Add(new KeyValuePair<string, string>("target_lang", targetCode));

            if (!string.IsNullOrEmpty(sourceLang))
            {
                // Keep sending the original source language code if provided
                formData.Add(new KeyValuePair<string, string>("source_lang", sourceLang));
            }

            // HttpClient sets the Content-Type header from FormUrlEncodedContent.
            var request = new HttpRequestMessage(HttpMethod.Post, _apiUrl) { Content = new FormUrlEncodedContent(formData) };
            request.Headers.TryAddWithoutValidation("Authorization", $"DeepL-Auth-Key {_apiKey}");
            return request;
        }

        // Retries rate limiting (429) and transient server/transport errors with backoff, as DeepL
        // recommends. Never retries 456 (quota exhausted) or other client errors, and never a timeout:
        // the reader is waiting, and a retry would multiply that wait. Returns null on timeout.
        private async Task<HttpResponseMessage?> SendWithRetryAsync(Func<HttpRequestMessage> buildRequest)
        {
            for (var attempt = 1; ; attempt++)
            {
                using var request = buildRequest();
                using var timeout = new CancellationTokenSource(RequestTimeout);
                HttpResponseMessage response;
                try
                {
                    response = await _httpClient.SendAsync(request, timeout.Token);
                }
                catch (OperationCanceledException) when (timeout.IsCancellationRequested)
                {
                    _logger.LogWarning("DeepL request timed out after {Timeout}.", RequestTimeout);
                    return null;
                }
                catch (HttpRequestException ex) when (attempt < MaxAttempts)
                {
                    var delay = BackoffDelay(attempt);
                    _logger.LogWarning(ex, "DeepL request failed (attempt {Attempt}/{Max}); retrying in {Delay}.", attempt, MaxAttempts, delay);
                    await Task.Delay(delay);
                    continue;
                }

                if (attempt < MaxAttempts && IsRetryableStatus(response.StatusCode))
                {
                    var delay = response.Headers.RetryAfter switch
                    {
                        { Delta: { } delta } => delta,
                        { Date: { } date } => date - DateTimeOffset.UtcNow,
                        _ => BackoffDelay(attempt)
                    };
                    if (delay <= MaxRetryAfter)
                    {
                        if (delay < TimeSpan.Zero) delay = TimeSpan.Zero;
                        _logger.LogWarning("DeepL returned {Status} (attempt {Attempt}/{Max}); retrying in {Delay}.", response.StatusCode, attempt, MaxAttempts, delay);
                        response.Dispose();
                        await Task.Delay(delay);
                        continue;
                    }
                }

                return response;
            }
        }

        private TimeSpan BackoffDelay(int attempt) => RetryBaseDelay * Math.Pow(2, attempt - 1);

        private static bool IsRetryableStatus(HttpStatusCode status) =>
            status is HttpStatusCode.TooManyRequests
                or HttpStatusCode.InternalServerError
                or HttpStatusCode.BadGateway
                or HttpStatusCode.ServiceUnavailable
                or HttpStatusCode.GatewayTimeout;

        // Failures about the account or the service rather than the chunk's content: a bad key (401/403),
        // still rate limited after the retries (429), quota exhausted (456), or DeepL still failing (5xx).
        // Anything else (400, 413, ...) is specific to the texts sent, so the next chunk may still work.
        private static bool FailsEveryRequest(HttpStatusCode status) =>
            status is HttpStatusCode.Unauthorized
                or HttpStatusCode.Forbidden
                or HttpStatusCode.TooManyRequests
                or (HttpStatusCode)456
            || (int)status >= 500;

        // Implementation for single text translation
        public async Task<string> TranslateTextAsync(string text, string? sourceLang, string targetLang) // Mark sourceLang as nullable
        {
            if (string.IsNullOrEmpty(text))
            {
                return string.Empty;
            }

            // Call batch translation for the single word
            var batchResult = await TranslateBatchAsync(new List<string> { text }, targetLang, sourceLang);
    
            // Since we sent only one word, the result dictionary should contain at most one entry.
            // We rely on DeepL returning translations in the same order as the input.
            // Let's get the first value from the dictionary if it exists.
            var firstTranslation = batchResult.Values.FirstOrDefault();
    
            if (firstTranslation != null)
            {
                return firstTranslation;
            }
            
            // Log if no translation was found (either API failed or returned empty)
            _logger.LogWarning($"Could not get translation for '{text}' from batch response (Count: {batchResult.Count}).");
            return string.Empty; // Return empty if no translation found
        }
    }

    // Placeholder for DeepL's response structure - adjust based on actual API
    // Ensure PropertyNamingPolicy is handled if needed during deserialization, or use [JsonPropertyName]
    public class DeepLResponse
    {
        public DeepLTranslation[] translations { get; set; } = Array.Empty<DeepLTranslation>(); // Initialize
    }

    public class DeepLTranslation
    {
        public string detected_source_language { get; set; } = string.Empty; // Initialize
        public string text { get; set; } = string.Empty; // Initialize
    }
}