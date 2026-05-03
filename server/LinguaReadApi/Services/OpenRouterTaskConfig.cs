using System.Collections.Generic;
using LinguaReadApi.Models;

namespace LinguaReadApi.Services
{
    public enum OpenRouterTask
    {
        Translation,
        Explanation,
        Story,
        Summarization
    }

    public static class OpenRouterTaskConfig
    {
        public static string ResolveModel(UserSettings settings, OpenRouterTask task)
        {
            string? perTask = task switch
            {
                OpenRouterTask.Translation => settings.OpenRouterTranslationModel,
                OpenRouterTask.Explanation => settings.OpenRouterExplanationModel,
                OpenRouterTask.Story => settings.OpenRouterStoryModel,
                OpenRouterTask.Summarization => settings.OpenRouterSummarizationModel,
                _ => null
            };

            return string.IsNullOrWhiteSpace(perTask)
                ? settings.OpenRouterModel
                : perTask.Trim();
        }

        public static string ResolvePromptOrDefault(
            string? customTemplate,
            string defaultPrompt,
            IReadOnlyDictionary<string, string?> vars)
        {
            return ResolvePromptOrDefault(customTemplate, defaultPrompt, vars, out _);
        }

        public static string ResolvePromptOrDefault(
            string? customTemplate,
            string defaultPrompt,
            IReadOnlyDictionary<string, string?> vars,
            out IReadOnlyList<string> unknownPlaceholders)
        {
            if (string.IsNullOrWhiteSpace(customTemplate))
            {
                unknownPlaceholders = System.Array.Empty<string>();
                return defaultPrompt;
            }

            return PromptTemplateRenderer.Render(customTemplate, vars, out unknownPlaceholders);
        }
    }
}
