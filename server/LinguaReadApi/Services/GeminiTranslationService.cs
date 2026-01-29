using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    public interface ISentenceTranslationService
    {
        Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage);
    }

    public class GeminiTranslationService : ISentenceTranslationService
    {
        private readonly HttpClient _httpClient;
        private readonly string _apiKey;
        private readonly string _baseUrl;
        private readonly ILogger<GeminiTranslationService> _logger;
        private readonly ILanguageService _languageService; // Added LanguageService dependency

        public GeminiTranslationService(IConfiguration configuration, ILogger<GeminiTranslationService> logger, ILanguageService languageService) // Added languageService parameter
        {
            _httpClient = new HttpClient();
            _apiKey = configuration["Gemini:ApiKey"] ?? throw new ArgumentNullException("Gemini:ApiKey is missing in configuration");
            _baseUrl = configuration["Gemini:BaseUrl"] ?? "https://generativelanguage.googleapis.com/v1beta";
            _logger = logger;
            _languageService = languageService; // Store injected service
            
            _logger.LogInformation("GeminiTranslationService initialized");
            _logger.LogDebug($"Using base URL: {_baseUrl}");
        }

        public async Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage)
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

                _logger.LogInformation($"Translating text ({text.Length} chars) from {sourceLanguage} to {finalGeminiTargetCode}");

                // Prepare a prompt asking for paired, numbered original and translated sentences
                string prompt = $@"Translate the following text from {sourceLanguage} to {finalGeminiTargetCode}, sentence by sentence.
**Strict Instructions:**
1. For EACH sentence in the original text:
   - Output the original sentence wrapped EXACTLY like this: `<o s=""N"">Original Sentence</o>`
   - Immediately follow it with its translation wrapped EXACTLY like this: `<t s=""N"">Translated Sentence</t>`
   - Replace 'N' with the sentence number, starting from 1.
2. Maintain ALL original formatting and punctuation within the sentences inside the tags.
3. **CRITICAL:** Your response MUST contain ONLY the sequence of `<o s=""N"">...</o><t s=""N"">...</t>` pairs. Do NOT include ANY introductory text, concluding remarks, explanations, apologies, or any other text outside these specific tags.

Example Input Text:
Hello world. How are you?

Example Output:
<o s=""1"">Hello world.</o><t s=""1"">Bonjour le monde.</t><o s=""2"">How are you?</o><t s=""2"">Comment allez-vous?</t>

**Text to translate:**
{text}";
                _logger.LogDebug("Using paired sentence tag translation prompt."); // Log new prompt type

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
                        ResponseMimeType = "text/plain",
                        // Add ThinkingConfig with budget set to 0
                        ThinkingConfig = new ThinkingConfig
                        {
                            ThinkingBudget = 1024
                        }
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

                // Create the request
                var endpoint = $"{_baseUrl}/models/gemini-3-flash-preview:generateContent?key={_apiKey}";
                var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");
                
                // Send the request
                var response = await _httpClient.PostAsync(endpoint, content);
                var responseContent = await response.Content.ReadAsStringAsync();
                
                // Check if the request was successful
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogError($"Gemini API error: {response.StatusCode}, {responseContent}");
                    return $"Translation error: {response.StatusCode}";
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
                    _logger.LogInformation($"Translation successful, length: {translatedText?.Length ?? 0}");
                    return translatedText ?? string.Empty;
                }
                
                _logger.LogWarning("Could not extract translation from response");
                return "Translation failed: Could not extract result";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during translation");
                return $"Translation error: {ex.Message}";
            }
        }
    }
} 