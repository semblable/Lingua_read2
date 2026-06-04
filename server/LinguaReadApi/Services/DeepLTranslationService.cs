using System;
using System.Collections.Generic;
using System.Net.Http;
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
            if (words == null || words.Count == 0)
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

                 // DeepL Free API expects form data (application/x-www-form-urlencoded).
                 // Create the key-value pairs for the form data.
                var formData = new List<KeyValuePair<string, string>>();
                foreach (var word in words)
                {
                    formData.Add(new KeyValuePair<string, string>("text", word));
                }
                // Use the determined final target code
                formData.Add(new KeyValuePair<string, string>("target_lang", finalDeepLTargetCode));

                if (!string.IsNullOrEmpty(sourceLang))
                {
                    // Keep sending the original source language code if provided
                    formData.Add(new KeyValuePair<string, string>("source_lang", sourceLang));
                }

                // Create FormUrlEncodedContent. HttpClient sets the Content-Type header.
                var requestContent = new FormUrlEncodedContent(formData);


                // Removed previous detailed debug logging

                using var request = new HttpRequestMessage(HttpMethod.Post, _apiUrl) { Content = requestContent };
                request.Headers.TryAddWithoutValidation("Authorization", $"DeepL-Auth-Key {_apiKey}");
                var response = await _httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    // Need DeepLResponse model defined appropriately
                    var responseContent = await response.Content.ReadFromJsonAsync<DeepLResponse>(); 
                    if (responseContent?.translations != null && responseContent.translations.Length == words.Count)
                    {
                        for (int i = 0; i < words.Count; i++)
                        {
                            string originalWord = words[i] ?? string.Empty;
                            string translatedWord = responseContent.translations[i].text ?? string.Empty;

                            // Add raw strings to the dictionary (no sanitization)
                            translations[originalWord] = translatedWord;
                        }
                        _logger.LogInformation($"Successfully received {translations.Count} translations from DeepL.");
                    }
                    else
                    {
                         _logger.LogWarning("DeepL response format mismatch or missing translations. Response: {Response}", await response.Content.ReadAsStringAsync());
                    }
                }
                else
                {
                    var errorContent = await response.Content.ReadAsStringAsync();
                    _logger.LogError($"DeepL API request failed with status {response.StatusCode}: {errorContent}");
                    // Consider throwing a specific exception or handling differently
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error occurred while calling DeepL API.");
                // Consider throwing or returning partial results/error indication
            }

            return translations;
        }

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