using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services
{
    public class OpenRouterStoryGenerationService
    {
        private readonly HttpClient _httpClient;
        private readonly ILogger<OpenRouterStoryGenerationService> _logger;
        private readonly AppDbContext _context;
        private const string BaseUrl = "https://openrouter.ai/api/v1/chat/completions";
        
        // Timeout configuration - 5 minutes for story generation
        private static readonly TimeSpan RequestTimeout = TimeSpan.FromMinutes(5);
        
        // Approximate tokens per character (conservative estimate)
        private const double TokensPerChar = 0.4;
        
        // Model context limits (output tokens, conservative for story generation)
        private static readonly Dictionary<string, int> ModelOutputLimits = new()
        {
            // Free models - output limits
            { "google/gemini-2.5-flash-preview-05-20:free", 65535 },
            { "meta-llama/llama-3.3-8b-instruct:free", 8192 },
            { "qwen/qwen3-4b:free", 4096 },
            { "mistralai/mistral-small-3.1-24b-instruct:free", 8192 },
            { "deepseek/deepseek-r1:free", 8192 },
            // Paid models
            { "anthropic/claude-3.5-sonnet", 8192 },
            { "openai/gpt-4o", 16384 },
            { "google/gemini-pro-1.5", 65535 },
        };
        
        // Default output limit for unknown models
        private const int DefaultOutputLimit = 4096;
        private static readonly HashSet<string> SupportedReasoningEfforts = new(StringComparer.OrdinalIgnoreCase)
        {
            "xhigh", "high", "medium", "low", "minimal", "none"
        };

        public OpenRouterStoryGenerationService(
            ILogger<OpenRouterStoryGenerationService> logger,
            AppDbContext context)
        {
            _httpClient = new HttpClient { Timeout = RequestTimeout };
            _logger = logger;
            _context = context;

            _logger.LogInformation("OpenRouterStoryGenerationService initialized with {Timeout}s timeout", RequestTimeout.TotalSeconds);
        }

        public async Task<string> GenerateStoryAsync(string prompt, int maxOutputTokens, Guid userId)
        {
            if (string.IsNullOrWhiteSpace(prompt))
            {
                _logger.LogWarning("Empty prompt provided for story generation");
                return string.Empty;
            }

            try
            {
                // Get user settings for API key and model
                var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
                if (userSettings == null || string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
                {
                    _logger.LogWarning("OpenRouter API key not configured for user {UserId}", userId);
                    return "Story generation error: OpenRouter API key not configured";
                }

                var apiKey = userSettings.OpenRouterApiKey;
                var model = userSettings.OpenRouterModel;
                var reasoningOptions = BuildReasoningOptions(userSettings);

                // Cap output tokens to model limit if needed
                var outputLimit = GetModelOutputLimit(model);
                var effectiveMaxTokens = Math.Min(maxOutputTokens, outputLimit);

                if (maxOutputTokens > outputLimit)
                {
                    _logger.LogWarning("Requested maxOutputTokens ({Requested}) exceeds model limit ({Limit}). Capping.",
                        maxOutputTokens, outputLimit);
                }

                _logger.LogInformation("Generating story with OpenRouter model {Model}, prompt length: {Length} chars, maxTokens: {MaxTokens}",
                    model, prompt.Length, effectiveMaxTokens);

                // Create OpenRouter request — prompt is pre-built by the caller
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
                    Temperature = 0.7,
                    MaxTokens = effectiveMaxTokens,
                    TopP = 0.95,
                    Reasoning = reasoningOptions
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

                        _logger.LogWarning("OpenRouter API error (attempt={Attempt}/{Max}): {StatusCode}. Response={Response}",
                            attempt, maxAttempts, response.StatusCode, responseContent);

                        if (isRetryable && attempt < maxAttempts)
                        {
                            var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                            await Task.Delay(delayMs);
                            continue;
                        }

                        return $"Story generation error: {response.StatusCode}";
                    }

                    _logger.LogDebug("OpenRouter API response: {Response}", responseContent.Substring(0, Math.Min(500, responseContent.Length)));

                    var openRouterResponse = JsonSerializer.Deserialize<OpenRouterResponse>(responseContent, options);

                    if (openRouterResponse?.Error != null)
                    {
                        _logger.LogWarning("OpenRouter API returned error: {Error}", openRouterResponse.Error.Message);
                        return $"Story generation error: {openRouterResponse.Error.Message}";
                    }

                    if (openRouterResponse?.Choices != null &&
                        openRouterResponse.Choices.Length > 0 &&
                        openRouterResponse.Choices[0].Message != null)
                    {
                        var content = openRouterResponse.Choices[0].Message!.Content;
                        if (!string.IsNullOrEmpty(content))
                        {
                            _logger.LogInformation("Story generation successful using OpenRouter, length: {Length}", content.Length);
                            return content;
                        }

                        _logger.LogWarning("OpenRouter returned empty content. FinishReason={FinishReason}, Response={Response}",
                            openRouterResponse.Choices[0].FinishReason, responseContent.Substring(0, Math.Min(1000, responseContent.Length)));
                        return "Story generation failed: Model returned empty response. Try a different model or shorter story length.";
                    }

                    _logger.LogWarning("Could not extract story from OpenRouter response structure. Response={Response}",
                        responseContent.Substring(0, Math.Min(1000, responseContent.Length)));
                    return "Story generation failed: Could not extract result. Check logs for details.";
                }

                return $"Story generation error: {lastStatus}";
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException || ex.CancellationToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "OpenRouter request timed out after {Timeout}s", RequestTimeout.TotalSeconds);
                return $"Story generation error: Request timed out.";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during OpenRouter story generation");
                return $"Story generation error: {ex.Message}";
            }
        }
        
        private int GetModelOutputLimit(string model)
        {
            if (ModelOutputLimits.TryGetValue(model, out var limit))
            {
                return limit;
            }
            _logger.LogDebug("Unknown model '{Model}', using default output limit", model);
            return DefaultOutputLimit;
        }

        private static OpenRouterReasoningOptions? BuildReasoningOptions(Models.UserSettings userSettings)
        {
            return Controllers.OpenRouterStoryReasoningHelper.BuildReasoningOptions(userSettings);
        }
    }
}
