using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services
{
    public class OpenRouterTranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<OpenRouterTranslationService> _logger;
        private readonly ILanguageService _languageService;
        private readonly AppDbContext _context;
        private const string BaseUrl = "https://openrouter.ai/api/v1/chat/completions";

        public OpenRouterTranslationService(
            ILogger<OpenRouterTranslationService> logger,
            ILanguageService languageService,
            AppDbContext context)
        {
            _httpClient = new HttpClient();
            _logger = logger;
            _languageService = languageService;
            _context = context;

            _logger.LogInformation("OpenRouterTranslationService initialized");
        }

        public async Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage, Guid userId)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for translation");
                return string.Empty;
            }

            try
            {
                // Get user settings for API key and model
                var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
                if (userSettings == null || string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
                {
                    _logger.LogWarning("OpenRouter API key not configured for user {UserId}", userId);
                    return "Translation error: OpenRouter API key not configured";
                }

                var apiKey = userSettings.OpenRouterApiKey;
                var model = userSettings.OpenRouterModel;

                // --- Determine the final target language code ---
                string finalTargetCode = targetLanguage;
                if (!string.IsNullOrEmpty(sourceLanguage))
                {
                    var allLanguages = await _languageService.GetAllLanguagesAsync();
                    var sourceLanguageConfig = allLanguages.FirstOrDefault(l => l.Code.Equals(sourceLanguage, StringComparison.OrdinalIgnoreCase));

                    if (sourceLanguageConfig != null && !string.IsNullOrEmpty(sourceLanguageConfig.GeminiTargetCode))
                    {
                        finalTargetCode = sourceLanguageConfig.GeminiTargetCode;
                        _logger.LogInformation("Using configured target code '{ConfiguredCode}' for source '{SourceCode}'", finalTargetCode, sourceLanguage);
                    }
                }

                _logger.LogInformation("Translating text ({Length} chars) from {Source} to {Target} using OpenRouter model {Model}",
                    text.Length, sourceLanguage, finalTargetCode, model);

                // Create the translation prompt (same as Gemini prompt)
                string prompt = $@"Translate the following text from {sourceLanguage} to {finalTargetCode}, sentence by sentence.
**Strict Instructions:**
1. For EACH sentence in the original text:
   - Output the original sentence wrapped EXACTLY like this: `<o s=""N"">Original Sentence</o>`
   - Immediately follow it with its translation wrapped EXACTLY like this: `<t s=""N"">Translated Sentence</t>`
   - Replace 'N' with the sentence number, starting from 1.
2. Maintain ALL original formatting and punctuation within the sentences inside the tags.
3. **CRITICAL:** Your response MUST contain ONLY the sequence of `<o s=""N"">...</o><t s=""N"">...</t>` pairs. Do NOT include ANY introductory text, concluding remarks, explanations, apologies, code fences, or markdown.
4. Do NOT escape `<` or `>` and do NOT wrap output in any container tags.
5. If the input has only one sentence, still output exactly one `<o>` + `<t>` pair.

Example Input Text:
Hello world. How are you?

Example Output:
<o s=""1"">Hello world.</o><t s=""1"">Bonjour le monde.</t><o s=""2"">How are you?</o><t s=""2"">Comment allez-vous?</t>

**Text to translate:**
{text}";

                // Create OpenRouter request
                var requestPayload = new OpenRouterRequest
                {
                    Model = model,
                    Messages = new[]
                    {
                        new OpenRouterMessage
                        {
                            Role = "user",
                            Content = prompt
                        }
                    },
                    Temperature = 0.3,
                    MaxTokens = 65535,
                    TopP = 1.0
                };

                var options = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                };

                string jsonPayload = JsonSerializer.Serialize(requestPayload, options);
                _logger.LogDebug("OpenRouter request payload: {Payload}", jsonPayload.Substring(0, Math.Min(500, jsonPayload.Length)));

                // Send request with retries
                const int maxAttempts = 3;
                HttpStatusCode? lastStatus = null;

                for (int attempt = 1; attempt <= maxAttempts; attempt++)
                {
                    var request = new HttpRequestMessage(HttpMethod.Post, BaseUrl);
                    request.Headers.Add("Authorization", $"Bearer {apiKey}");
                    request.Headers.Add("HTTP-Referer", "https://lingua-read.app");
                    request.Headers.Add("X-Title", "Lingua-Read");
                    request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                    var response = await _httpClient.SendAsync(request);
                    var responseContent = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        lastStatus = response.StatusCode;
                        var isRetryable = response.StatusCode == HttpStatusCode.ServiceUnavailable ||
                                          response.StatusCode == HttpStatusCode.TooManyRequests;

                        _logger.LogWarning("OpenRouter API error (attempt={Attempt}/{Max}): {StatusCode}. Retryable={Retryable}. Response={Response}",
                            attempt, maxAttempts, response.StatusCode, isRetryable, responseContent);

                        if (isRetryable && attempt < maxAttempts)
                        {
                            var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                            await Task.Delay(delayMs);
                            continue;
                        }

                        return $"Translation error: {response.StatusCode}";
                    }

                    _logger.LogDebug("OpenRouter API response: {Response}", responseContent.Substring(0, Math.Min(500, responseContent.Length)));

                    var openRouterResponse = JsonSerializer.Deserialize<OpenRouterResponse>(responseContent, options);

                    if (openRouterResponse?.Error != null)
                    {
                        _logger.LogWarning("OpenRouter API returned error: {Error}", openRouterResponse.Error.Message);
                        return $"Translation error: {openRouterResponse.Error.Message}";
                    }

                    if (openRouterResponse?.Choices != null &&
                        openRouterResponse.Choices.Length > 0 &&
                        openRouterResponse.Choices[0].Message != null)
                    {
                        var translatedText = openRouterResponse.Choices[0].Message.Content;
                        _logger.LogInformation("Translation successful using OpenRouter, length: {Length}", translatedText?.Length ?? 0);
                        return translatedText ?? string.Empty;
                    }

                    _logger.LogWarning("Could not extract translation from OpenRouter response");
                    return "Translation failed: Could not extract result";
                }

                return $"Translation error: {lastStatus}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during OpenRouter translation");
                return $"Translation error: {ex.Message}";
            }
        }
    }
}
