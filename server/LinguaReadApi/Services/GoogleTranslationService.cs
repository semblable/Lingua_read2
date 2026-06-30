using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Word-level translation backed by the Google Cloud Translation API (v2, the simple API-key
    /// flavor). Implements the shared <see cref="ITranslationService"/> contract so it is a
    /// drop-in alternative to DeepL for single-word and batch lookups.
    ///
    /// The API key is per-user (applied via <see cref="UseApiKey"/> by the word-translation
    /// factory), falling back to the server-level <c>Google:Translate:ApiKey</c> config.
    /// </summary>
    public class GoogleTranslationService : ITranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<GoogleTranslationService> _logger;
        private readonly string _endpoint;
        // Server-level key from config (env/appsettings); used as the fallback when a user has not
        // set their own. Null = none.
        private readonly string? _configApiKey;
        // Effective key for the current (scoped) request: a per-user value applied via UseApiKey
        // overrides config. Null = unconfigured (lookups return empty).
        private string? _apiKey;

        // Sentinel used elsewhere in appsettings.json for secrets supplied via dotenv; treat it as
        // "unset" so an unconfigured install does not send a bogus key.
        private const string UnsetSecretSentinel = "SET_IN_DOTENV";
        // Google v2 allows up to 128 segments per request; words are short, so chunk by count.
        private const int MaxItemsPerRequest = 100;

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true
        };

        public GoogleTranslationService(
            HttpClient httpClient,
            IConfiguration configuration,
            ILogger<GoogleTranslationService> logger)
        {
            _httpClient = httpClient;
            _logger = logger;
            _endpoint = (configuration["Google:Translate:Endpoint"] ?? "https://translation.googleapis.com").TrimEnd('/');
            _configApiKey = NormalizeSecret(configuration["Google:Translate:ApiKey"]);
            _apiKey = _configApiKey;
        }

        /// <summary>
        /// Applies a per-user API key for the current (scoped) request, overriding the server-level
        /// config. A null/blank/placeholder value falls back to the config key (which may itself be
        /// null = unconfigured).
        /// </summary>
        public void UseApiKey(string? key)
        {
            _apiKey = NormalizeSecret(key) ?? _configApiKey;
        }

        // Treats blank values and the dotenv sentinel as "unset".
        private static string? NormalizeSecret(string? value) =>
            string.IsNullOrWhiteSpace(value) || value == UnsetSecretSentinel ? null : value.Trim();

        public async Task<string> TranslateTextAsync(string text, string? sourceLang, string targetLang)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return string.Empty;
            }

            var batch = await TranslateBatchAsync(new List<string> { text }, targetLang, sourceLang);
            return batch.Values.FirstOrDefault() ?? string.Empty;
        }

        public async Task<Dictionary<string, string>> TranslateBatchAsync(List<string> words, string targetLang, string? sourceLang = null)
        {
            var translations = new Dictionary<string, string>();
            if (words == null || words.Count == 0)
            {
                return translations;
            }

            if (_apiKey == null)
            {
                // No per-user key and no server fallback: surface a clear error instead of
                // silently returning empty (which the reader can't tell apart from "no result").
                // The controller maps this to a 400 that points the user at Settings.
                _logger.LogWarning("Google Translate API key is not configured.");
                throw new TranslationProviderNotConfiguredException("Google Translate");
            }

            var to = targetLang.Trim().ToLowerInvariant();
            var from = string.IsNullOrWhiteSpace(sourceLang) ? null : sourceLang.Trim().ToLowerInvariant();

            var distinctWords = words.Where(w => !string.IsNullOrWhiteSpace(w)).Distinct().ToList();

            foreach (var chunk in Chunk(distinctWords, MaxItemsPerRequest))
            {
                try
                {
                    // Pass the key in the X-goog-api-key header rather than the URL query string.
                    // Google Cloud APIs accept either, but a query-string key gets written to
                    // HttpClient request logs (and any reverse-proxy access logs); a header does not.
                    var url = $"{_endpoint}/language/translate/v2";
                    var payload = new GoogleTranslateRequest
                    {
                        Q = chunk,
                        Target = to,
                        Source = from,
                        Format = "text"
                    };

                    using var request = new HttpRequestMessage(HttpMethod.Post, url)
                    {
                        Content = JsonContent.Create(payload)
                    };
                    request.Headers.TryAddWithoutValidation("X-goog-api-key", _apiKey);

                    using var response = await _httpClient.SendAsync(request);
                    if (!response.IsSuccessStatusCode)
                    {
                        var errorContent = await response.Content.ReadAsStringAsync();
                        _logger.LogError("Google Translate request failed with status {Status}: {Error}", response.StatusCode, errorContent);
                        continue;
                    }

                    var result = await response.Content.ReadFromJsonAsync<GoogleTranslateResponse>(JsonOptions);
                    var items = result?.Data?.Translations;
                    if (items == null || items.Count != chunk.Count)
                    {
                        _logger.LogWarning("Google Translate response count mismatch (expected {Expected}, got {Got}).", chunk.Count, items?.Count ?? 0);
                        continue;
                    }

                    // Google preserves input order, so zip the chunk with its results.
                    for (var i = 0; i < chunk.Count; i++)
                    {
                        translations[chunk[i]] = items[i].TranslatedText ?? string.Empty;
                    }
                }
                catch (Exception ex)
                {
                    // Degrade to "no translation" rather than surfacing a 500, matching DeepL.
                    _logger.LogError(ex, "Error occurred while calling the Google Translate API.");
                }
            }

            return translations;
        }

        private static IEnumerable<List<T>> Chunk<T>(List<T> source, int size)
        {
            for (var i = 0; i < source.Count; i += size)
            {
                yield return source.GetRange(i, Math.Min(size, source.Count - i));
            }
        }
    }

    // --- Google Cloud Translation v2 request/response shapes ---

    public class GoogleTranslateRequest
    {
        [JsonPropertyName("q")]
        public List<string> Q { get; set; } = new();

        [JsonPropertyName("target")]
        public string Target { get; set; } = string.Empty;

        // Omitted from the payload when null (auto-detect).
        [JsonPropertyName("source")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Source { get; set; }

        [JsonPropertyName("format")]
        public string Format { get; set; } = "text";
    }

    public class GoogleTranslateResponse
    {
        [JsonPropertyName("data")]
        public GoogleTranslateData? Data { get; set; }
    }

    public class GoogleTranslateData
    {
        [JsonPropertyName("translations")]
        public List<GoogleTranslation>? Translations { get; set; }
    }

    public class GoogleTranslation
    {
        [JsonPropertyName("translatedText")]
        public string? TranslatedText { get; set; }

        [JsonPropertyName("detectedSourceLanguage")]
        public string? DetectedSourceLanguage { get; set; }
    }
}
