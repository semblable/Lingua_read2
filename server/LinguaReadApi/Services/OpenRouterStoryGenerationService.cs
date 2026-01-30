using System;
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

        public OpenRouterStoryGenerationService(
            ILogger<OpenRouterStoryGenerationService> logger,
            AppDbContext context)
        {
            _httpClient = new HttpClient();
            _logger = logger;
            _context = context;

            _logger.LogInformation("OpenRouterStoryGenerationService initialized");
        }

        public async Task<string> GenerateStoryAsync(string prompt, string language, string level, int maxLength, Guid userId)
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

                _logger.LogInformation("Generating story with OpenRouter model {Model}: '{Prompt}', language: {Language}, level: {Level}",
                    model, prompt, language, level);

                // Create story generation prompt (same as Gemini prompt)
                string fullPrompt = $"Write a {level} level story in {language} about: {prompt}\n\n" +
                                    $"Requirements:\n" +
                                    $"- Write approximately {maxLength} words\n" +
                                    $"- Use vocabulary and grammar appropriate for {level} level learners\n" +
                                    $"- Include diverse sentence structures\n" +
                                    $"- Use everyday vocabulary with occasional new words for learning\n" +
                                    $"- Return ONLY the story with no additional text or explanations";

                // Create OpenRouter request
                var requestPayload = new OpenRouterRequest
                {
                    Model = model,
                    Messages = new[]
                    {
                        new OpenRouterMessage
                        {
                            Role = "user",
                            Content = fullPrompt
                        }
                    },
                    Temperature = 0.7,
                    MaxTokens = 20000,
                    TopP = 0.95
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
                        var generatedStory = openRouterResponse.Choices[0].Message.Content;
                        _logger.LogInformation("Story generation successful using OpenRouter, length: {Length}", generatedStory?.Length ?? 0);
                        return generatedStory ?? string.Empty;
                    }

                    _logger.LogWarning("Could not extract story from OpenRouter response");
                    return "Story generation failed: Could not extract result";
                }

                return $"Story generation error: {lastStatus}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during OpenRouter story generation");
                return $"Story generation error: {ex.Message}";
            }
        }
    }
}
