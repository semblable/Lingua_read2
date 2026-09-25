using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services.Ai
{
    public class OpenAiCompatibleSummarizationService
    {
        private readonly OpenAiCompatibleChatClient _chatClient;
        private readonly ILogger<OpenAiCompatibleSummarizationService> _logger;

        public OpenAiCompatibleSummarizationService(
            OpenAiCompatibleChatClient chatClient,
            ILogger<OpenAiCompatibleSummarizationService> logger)
        {
            _chatClient = chatClient;
            _logger = logger;
        }

        public async Task<string> SummarizeAsync(string text, string sourceLanguage, string targetLanguage, int maxSummaryWords, AiProviderConnection connection)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogWarning("Empty text provided for summarization");
                return string.Empty;
            }

            try
            {
                var defaultPrompt = SummarizationPrompt.Build(text, sourceLanguage, targetLanguage, maxSummaryWords);
                var summarizationVars = new Dictionary<string, string?>
                {
                    ["text"] = text,
                    ["sourceLanguage"] = sourceLanguage,
                    ["targetLanguage"] = targetLanguage,
                    ["maxSummaryWords"] = maxSummaryWords.ToString(CultureInfo.InvariantCulture)
                };
                var prompt = AiTaskConfig.ResolvePromptOrDefault(
                    connection.Settings.CustomSummarizationPrompt,
                    defaultPrompt,
                    summarizationVars,
                    out var unknownSummarizationPlaceholders);
                if (unknownSummarizationPlaceholders.Count > 0)
                {
                    _logger.LogWarning("Custom summarization prompt contains unknown placeholders: {Placeholders}. Known: text, sourceLanguage, targetLanguage, maxSummaryWords.",
                        string.Join(", ", unknownSummarizationPlaceholders));
                }

                var request = new ChatCompletionRequest
                {
                    Model = connection.ModelFor(AiTask.Summarization),
                    Messages = new[] { new ChatMessage { Role = "user", Content = prompt } },
                    Temperature = 0.3,
                    // Generous budget: thinking-capable models (Gemini 2.5/3, DeepSeek R1, etc.)
                    // spend tokens on reasoning before visible output; a tight cap returns empty
                    // content with finishReason=length.
                    MaxTokens = Math.Max(8192, maxSummaryWords * 20),
                    TopP = 1.0
                };
                AiReasoningOptions.ApplyForStory(request, connection.Definition.ReasoningStyle, connection.Settings);

                var result = await _chatClient.CompleteAsync(connection, request, "summarization");
                return result.Success
                    ? result.Content!.Trim()
                    : $"Summarization error: {result.Error}";
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during {Provider} summarization", connection.Definition.DisplayName);
                return $"Summarization error: {ex.Message}";
            }
        }
    }
}
