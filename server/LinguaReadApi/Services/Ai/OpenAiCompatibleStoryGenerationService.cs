using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services.Ai
{
    public class OpenAiCompatibleStoryGenerationService
    {
        private readonly OpenAiCompatibleChatClient _chatClient;
        private readonly ILogger<OpenAiCompatibleStoryGenerationService> _logger;

        // Model context limits (output tokens, conservative for story generation)
        private static readonly Dictionary<string, int> ModelOutputLimits = new()
        {
            // Free models - output limits
            { "google/gemini-2.5-flash-preview-05-20:free", 65535 },
            { "meta-llama/llama-3.3-8b-instruct:free", 8192 },
            { "qwen/qwen3-4b:free", 4096 },
            { "mistralai/mistral-small-3.1-24b-instruct:free", 8192 },
            { "mistralai/mistral-small-2603", 16384 },
            { "deepseek/deepseek-r1:free", 8192 },
            // Paid models
            { "anthropic/claude-3.5-sonnet", 8192 },
            { "openai/gpt-4o", 16384 },
            { "google/gemini-pro-1.5", 65535 },
        };

        // Default output limit for unknown models (generous to avoid truncation)
        private const int DefaultOutputLimit = 16384;

        public OpenAiCompatibleStoryGenerationService(
            OpenAiCompatibleChatClient chatClient,
            ILogger<OpenAiCompatibleStoryGenerationService> logger)
        {
            _chatClient = chatClient;
            _logger = logger;
        }

        public async Task<string> GenerateStoryAsync(string prompt, int maxOutputTokens, AiProviderConnection connection)
        {
            if (string.IsNullOrWhiteSpace(prompt))
            {
                _logger.LogWarning("Empty prompt provided for story generation");
                return string.Empty;
            }

            try
            {
                var model = connection.ModelFor(AiTask.Story);

                // Cap output tokens to model limit if needed
                var outputLimit = GetModelOutputLimit(model);
                var effectiveMaxTokens = Math.Min(maxOutputTokens, outputLimit);

                if (maxOutputTokens > outputLimit)
                {
                    _logger.LogWarning("Requested maxOutputTokens ({Requested}) exceeds model limit ({Limit}). Capping.",
                        maxOutputTokens, outputLimit);
                }

                _logger.LogInformation("Generating story with {Provider} model {Model}, prompt length: {Length} chars, maxTokens: {MaxTokens}",
                    connection.Definition.DisplayName, model, prompt.Length, effectiveMaxTokens);

                // The prompt is pre-built by the caller
                var request = new ChatCompletionRequest
                {
                    Model = model,
                    Messages = new[] { new ChatMessage { Role = "user", Content = prompt } },
                    Temperature = 0.7,
                    MaxTokens = effectiveMaxTokens,
                    TopP = 0.95
                };
                AiReasoningOptions.ApplyForStory(request, connection.Definition.ReasoningStyle, connection.Settings);

                var result = await _chatClient.CompleteAsync(connection, request, "story generation");
                if (result.IsExtractionFailure)
                {
                    return "Story generation failed: Could not extract result. Check logs for details.";
                }
                if (!result.Success)
                {
                    return $"Story generation error: {result.Error}";
                }
                if (string.IsNullOrEmpty(result.Content))
                {
                    _logger.LogWarning("{Provider} returned empty story content. FinishReason={FinishReason}", connection.Definition.DisplayName, result.FinishReason);
                    return "Story generation failed: Model returned empty response. Try a different model or shorter story length.";
                }

                _logger.LogInformation("Story generation successful using {Provider}, length: {Length}", connection.Definition.DisplayName, result.Content.Length);
                return result.Content;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during {Provider} story generation", connection.Definition.DisplayName);
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
    }
}
