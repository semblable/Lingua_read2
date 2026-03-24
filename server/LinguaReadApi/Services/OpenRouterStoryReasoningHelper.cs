using System;
using System.Collections.Generic;

namespace LinguaReadApi.Controllers
{
    /// <summary>
    /// Helper for building OpenRouter reasoning options from user settings for story generation.
    /// </summary>
    public static class OpenRouterStoryReasoningHelper
    {
        private static readonly HashSet<string> SupportedEfforts = new(StringComparer.OrdinalIgnoreCase)
        {
            "xhigh", "high", "medium", "low", "minimal", "none"
        };

        public static Services.OpenRouterReasoningOptions? BuildReasoningOptions(Models.UserSettings userSettings)
        {
            if (!userSettings.OpenRouterStoryReasoningEnabled)
                return null;

            var effort = (userSettings.OpenRouterStoryReasoningEffort ?? string.Empty).Trim().ToLowerInvariant();
            if (!SupportedEfforts.Contains(effort))
                effort = "medium";

            return new Services.OpenRouterReasoningOptions
            {
                Enabled = true,
                Effort = effort
            };
        }
    }
}
