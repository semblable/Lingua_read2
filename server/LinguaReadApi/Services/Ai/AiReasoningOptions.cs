using System;
using System.Collections.Generic;
using LinguaReadApi.Models;

namespace LinguaReadApi.Services.Ai
{
    /// <summary>
    /// Puts the user's reasoning settings on a request in the form its provider understands.
    /// Translation, explanation and selection requests use the translation pair
    /// (OpenRouterReasoningEnabled/Effort); stories and summaries use the story pair.
    /// </summary>
    public static class AiReasoningOptions
    {
        public static readonly IReadOnlySet<string> SupportedEfforts = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "xhigh", "high", "medium", "low", "minimal", "none"
        };

        public static void ApplyForTranslation(ChatCompletionRequest request, AiReasoningStyle style, UserSettings settings) =>
            Apply(request, style, settings.OpenRouterReasoningEnabled, settings.OpenRouterReasoningEffort,
                // OpenRouter translations have always left reasoning to the model's default when off.
                sendOpenRouterNoneWhenOff: false);

        public static void ApplyForStory(ChatCompletionRequest request, AiReasoningStyle style, UserSettings settings) =>
            Apply(request, style, settings.OpenRouterStoryReasoningEnabled, settings.OpenRouterStoryReasoningEffort,
                // Reasoning tokens count against the output limit and can use up a story's whole
                // budget, so "off" turns it off explicitly rather than leaving it to the model.
                sendOpenRouterNoneWhenOff: true);

        private static void Apply(ChatCompletionRequest request, AiReasoningStyle style, bool enabled, string? effortSetting, bool sendOpenRouterNoneWhenOff)
        {
            var effort = NormalizeEffort(effortSetting);
            switch (style)
            {
                case AiReasoningStyle.OpenRouter:
                    if (enabled)
                    {
                        request.Reasoning = new OpenRouterReasoningOptions { Enabled = true, Effort = effort };
                    }
                    else if (sendOpenRouterNoneWhenOff)
                    {
                        request.Reasoning = new OpenRouterReasoningOptions { Effort = "none" };
                    }
                    break;

                case AiReasoningStyle.DeepSeek:
                    // DeepSeek thinks by default, which makes a one-line translation slow and
                    // costly, so "off" is always sent.
                    if (!enabled || effort == "none")
                    {
                        request.Thinking = new DeepSeekThinkingOptions { Type = "disabled" };
                    }
                    else
                    {
                        request.Thinking = new DeepSeekThinkingOptions { Type = "enabled" };
                        request.ReasoningEffort = effort switch
                        {
                            "xhigh" => "max",
                            "low" or "minimal" => "low",
                            _ => "high"
                        };
                    }
                    break;
            }
        }

        private static string NormalizeEffort(string? effort)
        {
            var normalized = (effort ?? string.Empty).Trim().ToLowerInvariant();
            return SupportedEfforts.Contains(normalized) ? normalized : "medium";
        }
    }
}
