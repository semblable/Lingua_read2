using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    public interface ISummarizationService
    {
        Task<string> SummarizeAsync(string text, string sourceLanguage, string targetLanguage, int maxSummaryWords = 200);
    }

    public class GeminiSummarizationService : ISummarizationService
    {
        // Timeout configuration - 5 minutes for long texts (matches OpenRouter services)
        private static readonly TimeSpan RequestTimeout = TimeSpan.FromMinutes(5);

        private readonly HttpClient _httpClient;
        private readonly string _baseUrl;
        private readonly string _primaryModel;
        private readonly string _fallbackModel;
        private readonly ILogger<GeminiSummarizationService> _logger;

        public GeminiSummarizationService(IConfiguration configuration, ILogger<GeminiSummarizationService> logger, IHttpClientFactory httpClientFactory)
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
        }

        public async Task<string> SummarizeAsync(string text, string sourceLanguage, string targetLanguage, int maxSummaryWords = 200)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for summarization");
                return string.Empty;
            }

            try
            {
                var prompt = SummarizationPrompt.Build(text, sourceLanguage, targetLanguage, maxSummaryWords);
                var requestPayload = new GeminiRequest
                {
                    Contents = new[]
                    {
                        new Content
                        {
                            Parts = new[] { new Part { Text = prompt } }
                        }
                    },
                    GenerationConfig = new GenerationConfig
                    {
                        Temperature = 0.3,
                        TopK = 32,
                        TopP = 1.0,
                        // Generous budget: Gemini 2.5/3 thinking models spend output tokens on
                        // internal reasoning before emitting visible text, so a tight cap can
                        // result in empty content parts.
                        MaxOutputTokens = Math.Max(8192, maxSummaryWords * 20),
                        ResponseMimeType = "text/plain"
                    }
                };

                var options = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                };

                var jsonPayload = JsonSerializer.Serialize(requestPayload, options);
                var modelsToTry = new List<string> { _primaryModel };
                if (!string.Equals(_fallbackModel, _primaryModel, StringComparison.OrdinalIgnoreCase))
                {
                    modelsToTry.Add(_fallbackModel);
                }

                HttpStatusCode? lastStatus = null;
                var extractionFailed = false;
                foreach (var model in modelsToTry)
                {
                    const int maxAttempts = 3;
                    for (var attempt = 1; attempt <= maxAttempts; attempt++)
                    {
                        var endpoint = $"{_baseUrl}/models/{model}:generateContent";
                        var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");
                        var response = await _httpClient.PostAsync(endpoint, content);
                        var responseContent = await response.Content.ReadAsStringAsync();

                        if (!response.IsSuccessStatusCode)
                        {
                            lastStatus = response.StatusCode;
                            var isRetryable = response.StatusCode == HttpStatusCode.ServiceUnavailable ||
                                              response.StatusCode == HttpStatusCode.TooManyRequests;

                            _logger.LogWarning("Gemini summarization error (model={Model}, attempt={Attempt}/{Max}): {StatusCode}. Response={Response}",
                                model, attempt, maxAttempts, response.StatusCode, responseContent);

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
                            geminiResponse.Candidates[0].Content?.Parts != null)
                        {
                            var summary = string.Join("", geminiResponse.Candidates[0].Content.Parts
                                .Where(part => !string.IsNullOrEmpty(part.Text))
                                .Select(part => part.Text));

                            if (!string.IsNullOrWhiteSpace(summary))
                            {
                                _logger.LogInformation("Summarization successful (model={Model}), length: {Length}", model, summary.Length);
                                return summary.Trim();
                            }
                        }

                        _logger.LogWarning("Could not extract summary from Gemini response (model={Model}). Response={Response}",
                            model, responseContent.Substring(0, Math.Min(1000, responseContent.Length)));
                        extractionFailed = true;
                        break;
                    }
                }

                if (extractionFailed && lastStatus == null)
                {
                    return "Summarization error: Could not extract result";
                }

                return $"Summarization error: {lastStatus}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during summarization");
                return $"Summarization error: {ex.Message}";
            }
        }
    }
}
