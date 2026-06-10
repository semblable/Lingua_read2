using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    public interface IStoryGenerationService
    {
        Task<string> GenerateStoryAsync(string prompt, int maxOutputTokens = 20000);
    }

    public class GeminiStoryGenerationService : IStoryGenerationService
    {
        // Timeout configuration - 5 minutes for long generations (matches OpenRouter services)
        private static readonly TimeSpan RequestTimeout = TimeSpan.FromMinutes(5);

        private readonly HttpClient _httpClient;
        private readonly string _baseUrl;
        private readonly string _primaryModel;
        private readonly string _fallbackModel;
        private readonly ILogger<GeminiStoryGenerationService> _logger;

        public GeminiStoryGenerationService(IConfiguration configuration, ILogger<GeminiStoryGenerationService> logger, IHttpClientFactory httpClientFactory)
        {
            var apiKey = configuration["Gemini:ApiKey"] ?? throw new ArgumentNullException("Gemini:ApiKey is missing in configuration");
            _httpClient = httpClientFactory.CreateClient();
            _httpClient.Timeout = RequestTimeout;
            // Authenticate via header instead of ?key= in the URL so the key can't leak
            // into proxy logs or HttpRequestException messages (which include the URI).
            _httpClient.DefaultRequestHeaders.Add("x-goog-api-key", apiKey);
            _baseUrl = configuration["Gemini:BaseUrl"] ?? "https://generativelanguage.googleapis.com/v1beta";
            _primaryModel = configuration["Gemini:Model"] ?? "gemini-3-flash-preview";
            _fallbackModel = configuration["Gemini:FallbackModel"] ?? "gemini-2.5-flash";
            _logger = logger;

            _logger.LogInformation("GeminiStoryGenerationService initialized");
            _logger.LogDebug("Using base URL: {BaseUrl}", _baseUrl);
        }

        public async Task<string> GenerateStoryAsync(string prompt, int maxOutputTokens = 20000)
        {
            if (string.IsNullOrWhiteSpace(prompt))
            {
                _logger.LogWarning("Empty prompt provided for story generation");
                return string.Empty;
            }

            try
            {
                _logger.LogInformation("Generating story with Gemini, prompt length: {Length} chars, maxOutputTokens: {MaxTokens}",
                    prompt.Length, maxOutputTokens);

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
                        Temperature = 0.7,
                        TopK = 40,
                        TopP = 0.95,
                        MaxOutputTokens = maxOutputTokens,
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
                // Log size only — the payload contains the user's full prompt.
                _logger.LogDebug("Request payload: {PayloadChars} chars", jsonPayload.Length);

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
                        var endpoint = $"{_baseUrl}/models/{model}:generateContent";
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

                        // Log size only — the response contains the generated story.
                        _logger.LogDebug("Gemini API response: {ResponseChars} chars", responseContent.Length);

                        // Parse the response to extract the generated story
                        var geminiResponse = JsonSerializer.Deserialize<GeminiResponse>(responseContent, options);

                        if (geminiResponse?.Candidates != null &&
                            geminiResponse.Candidates.Length > 0 &&
                            geminiResponse.Candidates[0].Content?.Parts != null)
                        {
                            // Concatenate text from all parts
                            var generatedStory = string.Join("", geminiResponse.Candidates[0].Content.Parts
                                .Where(part => !string.IsNullOrEmpty(part.Text))
                                .Select(part => part.Text));

                            if (!string.IsNullOrEmpty(generatedStory))
                            {
                                _logger.LogInformation("Story generation successful (model={Model}), length: {Length}", model, generatedStory.Length);
                                return generatedStory;
                            }
                        }

                        _logger.LogWarning("Could not extract story from Gemini response structure (model={Model}). Response={Response}",
                            model, responseContent.Substring(0, Math.Min(1000, responseContent.Length)));
                        return "Story generation failed: Could not extract result. Check logs for details.";
                    }
                }

                return $"Story generation error: {lastStatus}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during story generation");
                return $"Story generation error: {ex.Message}";
            }
        }
    }
} 