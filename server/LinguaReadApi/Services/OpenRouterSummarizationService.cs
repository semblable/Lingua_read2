using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    public class OpenRouterSummarizationService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<OpenRouterSummarizationService> _logger;
        private readonly AppDbContext _context;
        private const string BaseUrl = "https://openrouter.ai/api/v1/chat/completions";
        private static readonly TimeSpan RequestTimeout = TimeSpan.FromMinutes(5);

        public OpenRouterSummarizationService(
            ILogger<OpenRouterSummarizationService> logger,
            AppDbContext context,
            IHttpClientFactory httpClientFactory)
        {
            _httpClient = httpClientFactory.CreateClient();
            _httpClient.Timeout = RequestTimeout;
            _logger = logger;
            _context = context;
        }

        public async Task<string> SummarizeAsync(string text, string sourceLanguage, string targetLanguage, int maxSummaryWords, Guid userId)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for summarization");
                return string.Empty;
            }

            try
            {
                var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
                if (userSettings == null || string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
                {
                    _logger.LogWarning("OpenRouter API key not configured for user {UserId}", userId);
                    return "Summarization error: OpenRouter API key not configured";
                }

                var defaultPrompt = SummarizationPrompt.Build(text, sourceLanguage, targetLanguage, maxSummaryWords);
                var summarizationVars = new Dictionary<string, string?>
                {
                    ["text"] = text,
                    ["sourceLanguage"] = sourceLanguage,
                    ["targetLanguage"] = targetLanguage,
                    ["maxSummaryWords"] = maxSummaryWords.ToString(CultureInfo.InvariantCulture)
                };
                var prompt = OpenRouterTaskConfig.ResolvePromptOrDefault(
                    userSettings.CustomSummarizationPrompt,
                    defaultPrompt,
                    summarizationVars,
                    out var unknownSummarizationPlaceholders);
                if (unknownSummarizationPlaceholders.Count > 0)
                {
                    _logger.LogWarning("Custom summarization prompt contains unknown placeholders: {Placeholders}. Known: text, sourceLanguage, targetLanguage, maxSummaryWords.",
                        string.Join(", ", unknownSummarizationPlaceholders));
                }
                var model = OpenRouterTaskConfig.ResolveModel(userSettings, OpenRouterTask.Summarization);
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
                    // Generous budget: thinking-capable models (Gemini 2.5/3, DeepSeek R1, etc.)
                    // spend tokens on reasoning before visible output; a tight cap returns empty
                    // content with finishReason=length.
                    MaxTokens = Math.Max(8192, maxSummaryWords * 20),
                    TopP = 1.0,
                    Reasoning = Controllers.OpenRouterStoryReasoningHelper.BuildReasoningOptions(userSettings)
                };

                var options = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    WriteIndented = false
                };
                var jsonPayload = JsonSerializer.Serialize(requestPayload, options);

                const int maxAttempts = 3;
                HttpStatusCode? lastStatus = null;
                for (var attempt = 1; attempt <= maxAttempts; attempt++)
                {
                    var request = new HttpRequestMessage(HttpMethod.Post, BaseUrl);
                    request.Headers.Add("Authorization", $"Bearer {userSettings.OpenRouterApiKey}");
                    request.Headers.Add("HTTP-Referer", "https://lingua-read.app");
                    request.Headers.Add("X-Title", "Lingua-Read");
                    request.Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");

                    var response = await _httpClient.SendAsync(request);
                    var responseContent = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        lastStatus = response.StatusCode;
                        var is429 = response.StatusCode == HttpStatusCode.TooManyRequests;
                        var attemptsBudget = is429 ? 2 : maxAttempts;
                        var isRetryable = is429 || response.StatusCode == HttpStatusCode.ServiceUnavailable;

                        _logger.LogWarning("OpenRouter summarization error (attempt={Attempt}/{Max}): {StatusCode}. Response={Response}",
                            attempt, maxAttempts, response.StatusCode, responseContent);

                        if (isRetryable && attempt < attemptsBudget)
                        {
                            var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                            await Task.Delay(delayMs);
                            continue;
                        }

                        break;
                    }

                    var openRouterResponse = JsonSerializer.Deserialize<OpenRouterResponse>(responseContent, options);
                    if (openRouterResponse?.Error != null)
                    {
                        return $"Summarization error: {openRouterResponse.Error.Message}";
                    }

                    if (openRouterResponse?.Choices != null &&
                        openRouterResponse.Choices.Length > 0 &&
                        openRouterResponse.Choices[0].Message?.Content != null)
                    {
                        return openRouterResponse.Choices[0].Message!.Content.Trim();
                    }

                    _logger.LogWarning("Could not extract summary from OpenRouter response. Response={Response}",
                        responseContent.Substring(0, Math.Min(1000, responseContent.Length)));
                    return "Summarization error: Could not extract result";
                }

                return $"Summarization error: {lastStatus}";
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "OpenRouter summarization request timed out after {Timeout}s", RequestTimeout.TotalSeconds);
                return "Summarization error: Request timed out.";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during OpenRouter summarization");
                return $"Summarization error: {ex.Message}";
            }
        }
    }
}
