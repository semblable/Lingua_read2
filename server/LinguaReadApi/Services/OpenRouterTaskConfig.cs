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
            if (string.IsNullOrWhiteSpace(customTemplate))
            {
                return defaultPrompt;
            }

            return PromptTemplateRenderer.Render(customTemplate, vars);
        }
    }
}
