using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    public interface ISentenceTranslationService
    {
        Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage);
    Task<string> TranslateFullTextAsync(string text, string sourceLanguage, string targetLanguage);
    Task<string> ExplainSentenceAsync(string text, string sourceLanguage, string targetLanguage);
    }

    public class GeminiTranslationService : ISentenceTranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly string _baseUrl;
        private readonly string _primaryModel;
        private readonly string _fallbackModel;
        private readonly ILogger<GeminiTranslationService> _logger;
        private readonly ILanguageService _languageService; // Added LanguageService dependency

        public GeminiTranslationService(IConfiguration configuration, ILogger<GeminiTranslationService> logger, ILanguageService languageService) // Added languageService parameter
        {
            _httpClient = new HttpClient();
            _apiKey = configuration["Gemini:ApiKey"] ?? throw new ArgumentNullException("Gemini:ApiKey is missing in configuration");
            _baseUrl = configuration["Gemini:BaseUrl"] ?? "https://generativelanguage.googleapis.com/v1beta";
            _primaryModel = configuration["Gemini:Model"] ?? "gemini-3-flash-preview";
            _fallbackModel = configuration["Gemini:FallbackModel"] ?? "gemini-2.5-flash";
            _logger = logger;
            _languageService = languageService; // Store injected service
            
            _logger.LogInformation("GeminiTranslationService initialized");
            _logger.LogDebug($"Using base URL: {_baseUrl}");
        }

        public Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return TranslateAsync(text, sourceLanguage, targetLanguage, includeSentenceTags: false);
        }

        public Task<string> TranslateFullTextAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return TranslateAsync(text, sourceLanguage, targetLanguage, includeSentenceTags: true);
        }

        public Task<string> ExplainSentenceAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return ExplainAsync(text, sourceLanguage, targetLanguage);
        }

        private async Task<string> TranslateAsync(string text, string sourceLanguage, string targetLanguage, bool includeSentenceTags)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for translation");
                return string.Empty;
            }

            try
            {
                // --- Determine the final target language code ---
                string finalGeminiTargetCode = targetLanguage; // Default to the requested target language

                if (!string.IsNullOrEmpty(sourceLanguage))
                {
                    // Fetch all languages and find the one matching the source code
                    var allLanguages = await _languageService.GetAllLanguagesAsync();
                    var sourceLanguageConfig = allLanguages.FirstOrDefault(l => l.Code.Equals(sourceLanguage, StringComparison.OrdinalIgnoreCase));

                    if (sourceLanguageConfig != null && !string.IsNullOrEmpty(sourceLanguageConfig.GeminiTargetCode))
                    {
                        finalGeminiTargetCode = sourceLanguageConfig.GeminiTargetCode;
                        _logger.LogInformation("Using configured Gemini target code '{ConfiguredCode}' for source '{SourceCode}' instead of requested '{RequestedCode}'.", finalGeminiTargetCode, sourceLanguage, targetLanguage);
                    }
                }
                // --- End determining target code ---

                _logger.LogInformation("Translating text ({Length} chars) from {SourceLanguage} to {TargetLanguage}. TaggedOutput={TaggedOutput}",
                    text.Length, sourceLanguage, finalGeminiTargetCode, includeSentenceTags);

                string prompt = includeSentenceTags
                    ? $@"Translate the following text from {sourceLanguage} to {finalGeminiTargetCode}, sentence by sentence.
**Strict Instructions:**
1. For EACH sentence in the original text:
   - Output the original sentence wrapped EXACTLY like this: `<o s=""N"">Original Sentence</o>`
   - Immediately follow it with its translation wrapped EXACTLY like this: `<t s=""N"">Translated Sentence</t>`
   - Replace 'N' with the sentence number, starting from 1.
2. Maintain ALL original formatting and punctuation within the sentences inside the tags.
3. **CRITICAL:** Your response MUST contain ONLY the sequence of `<o s=""N"">...</o><t s=""N"">...</t>` pairs. Do NOT include ANY introductory text, concluding remarks, explanations, apologies, code fences, or markdown.
4. Do NOT escape `<` or `>` and do NOT wrap output in any container tags.
5. If the input has only one sentence, still output exactly one `<o>` + `<t>` pair.
6. **Natural, idiomatic translation:** Convey meaning and tone in {finalGeminiTargetCode}, not word-for-word glosses. For idioms, metaphors, and fixed expressions, use the natural equivalent in the target language. Avoid literal calques that sound wrong or shift meaning (e.g. Portuguese ""ganhar o mundo"" in culture/media contexts suggests global breakthrough or worldwide impact—prefer natural English such as ""take the world by storm"", ""make waves internationally"", or ""break through globally""; do not use ""conquer the world"" unless the source clearly implies conquest).

Example Input Text:
Hello world. How are you?

Example Output:
<o s=""1"">Hello world.</o><t s=""1"">Bonjour le monde.</t><o s=""2"">How are you?</o><t s=""2"">Comment allez-vous?</t>

**Text to translate:**
{text}"
                    : $@"Translate the following sentence or short passage from {sourceLanguage} to {finalGeminiTargetCode}.
**Strict Instructions:**
1. Return ONLY the translated text in {finalGeminiTargetCode}.
2. Do NOT include the original text.
3. Do NOT use XML/HTML tags such as `<o>` or `<t>`.
4. Do NOT add explanations, notes, quotes, code fences, or markdown.
5. Preserve meaning, tone, and punctuation naturally in the target language.
6. Translate idiomatically, not word-for-word. Avoid literal calques that sound unnatural or shift meaning.

Text:
{text}";
                _logger.LogDebug("Using {PromptType} translation prompt.", includeSentenceTags ? "paired-tag" : "plain-sentence");

                // Create request payload according to Gemini API specs
                var requestPayload = new GeminiRequest
                {
                    Contents = new[]
                    {
                        new Content
                        {
                            Parts = new[]
                            {
                                new Part { Text = prompt }
                            }
                        }
                    },
                    GenerationConfig = new GenerationConfig
                    {
                        Temperature = 0.3,
                        TopK = 32,
                        TopP = 1.0,
                        MaxOutputTokens = 65535,
                        ResponseMimeType = "text/plain"
                    }
                };

                // Serialize with proper casing
                var options = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                };
                
                string jsonPayload = JsonSerializer.Serialize(requestPayload, options);
                _logger.LogDebug($"Request payload: {jsonPayload}");

                var modelsToTry = new List<string> { _primaryModel };
                if (!string.Equals(_fallbackModel, _primaryModel, StringComparison.OrdinalIgnoreCase))
                {
                    modelsToTry.Add(_fallbackModel);
                }

                HttpStatusCode? lastStatus = null;
                foreach (var model in modelsToTry)
                {
                    const int maxAttempts = 3;
                    for (int attempt = 1; attempt <= maxAttempts; attempt++)
                    {
                        // Create the request
                        var endpoint = $"{_baseUrl}/models/{model}:generateContent?key={_apiKey}";
                        var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                        // Send the request
                        var response = await _httpClient.PostAsync(endpoint, content);
                        var responseContent = await response.Content.ReadAsStringAsync();

                        // Check if the request was successful
                        if (!response.IsSuccessStatusCode)
                        {
                            lastStatus = response.StatusCode;
                            var isRetryable = response.StatusCode == HttpStatusCode.ServiceUnavailable ||
                                              response.StatusCode == HttpStatusCode.TooManyRequests;

                            _logger.LogWarning("Gemini API error (model={Model}, attempt={Attempt}/{Max}): {StatusCode}. Retryable={Retryable}. Response={Response}",
                                model, attempt, maxAttempts, response.StatusCode, isRetryable, responseContent);

                            if (isRetryable && attempt < maxAttempts)
                            {
                                var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                                await Task.Delay(delayMs);
                                continue;
                            }

                            break; // Try next model (if any)
                        }

                        _logger.LogDebug($"Gemini API response: {responseContent}");

                        // Parse using proper models
                        var geminiResponse = JsonSerializer.Deserialize<GeminiResponse>(responseContent, options);

                        if (geminiResponse?.Candidates != null &&
                            geminiResponse.Candidates.Length > 0 &&
                            geminiResponse.Candidates[0].Content?.Parts != null &&
                            geminiResponse.Candidates[0].Content.Parts.Length > 0)
                        {
                            var translatedText = geminiResponse.Candidates[0].Content.Parts[0].Text;
                            _logger.LogInformation("Translation successful (model={Model}), length: {Length}", model, translatedText?.Length ?? 0);
                            return translatedText ?? string.Empty;
                        }

                        _logger.LogWarning("Could not extract translation from response (model={Model}).", model);
                        return "Translation failed: Could not extract result";
                    }
                }

                return $"Translation error: {lastStatus}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during translation");
                return $"Translation error: {ex.Message}";
            }
        }

        private async Task<string> ExplainAsync(string text, string sourceLanguage, string targetLanguage)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for sentence explanation");
                return string.Empty;
            }

            try
            {
                string explanationLanguage = targetLanguage;

                if (!string.IsNullOrEmpty(sourceLanguage))
                {
                    var allLanguages = await _languageService.GetAllLanguagesAsync();
                    var sourceLanguageConfig = allLanguages.FirstOrDefault(l => l.Code.Equals(sourceLanguage, StringComparison.OrdinalIgnoreCase));

                    if (sourceLanguageConfig != null && !string.IsNullOrEmpty(sourceLanguageConfig.GeminiTargetCode))
                    {
                        explanationLanguage = sourceLanguageConfig.GeminiTargetCode;
                    }
                }

                string prompt = SentenceExplanationPrompt.Build(text, sourceLanguage, explanationLanguage);

                var requestPayload = new GeminiRequest
                {
                    Contents = new[]
                    {
                        new Content
                        {
                            Parts = new[]
                            {
                                new Part { Text = prompt }
                            }
                        }
                    },
                    GenerationConfig = new GenerationConfig
                    {
                        Temperature = 0.3,
                        TopK = 32,
                        TopP = 1.0,
                        MaxOutputTokens = 65535,
                        ResponseMimeType = "text/plain"
                    }
                };

                var options = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                };

                string jsonPayload = JsonSerializer.Serialize(requestPayload, options);
                var modelsToTry = new List<string> { _primaryModel };
                if (!string.Equals(_fallbackModel, _primaryModel, StringComparison.OrdinalIgnoreCase))
                {
                    modelsToTry.Add(_fallbackModel);
                }

                HttpStatusCode? lastStatus = null;
                foreach (var model in modelsToTry)
                {
                    const int maxAttempts = 3;
                    for (int attempt = 1; attempt <= maxAttempts; attempt++)
                    {
                        var endpoint = $"{_baseUrl}/models/{model}:generateContent?key={_apiKey}";
                        var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");
                        var response = await _httpClient.PostAsync(endpoint, content);
                        var responseContent = await response.Content.ReadAsStringAsync();

                        if (!response.IsSuccessStatusCode)
                        {
                            lastStatus = response.StatusCode;
                            var isRetryable = response.StatusCode == HttpStatusCode.ServiceUnavailable ||
                                              response.StatusCode == HttpStatusCode.TooManyRequests;

                            _logger.LogWarning("Gemini explanation API error (model={Model}, attempt={Attempt}/{Max}): {StatusCode}. Retryable={Retryable}. Response={Response}",
                                model, attempt, maxAttempts, response.StatusCode, isRetryable, responseContent);

                            if (isRetryable && attempt < maxAttempts)
                            {
                                var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                                await Task.Delay(delayMs);
                                continue;
                            }

                            break;
                        }

                        var geminiResponse = JsonSerializer.Deserialize<GeminiResponse>(responseContent, options);
                        if (geminiResponse?.Candidates != null &&
                            geminiResponse.Candidates.Length > 0 &&
                            geminiResponse.Candidates[0].Content?.Parts != null &&
                            geminiResponse.Candidates[0].Content.Parts.Length > 0)
                        {
                            return geminiResponse.Candidates[0].Content.Parts[0].Text ?? string.Empty;
                        }

                        return "Explanation failed: Could not extract result";
                    }
                }

                return $"Explanation error: {lastStatus}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during sentence explanation");
                return $"Explanation error: {ex.Message}";
            }
        }
    }
} 