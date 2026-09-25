using System.Collections.Generic;
using LinguaReadApi.Models;

namespace LinguaReadApi.Services.Ai
{
    public enum AiTask
    {
        Translation,
        Explanation,
        Story,
        Summarization
    }

    public static class AiTaskConfig
    {
        /// <summary>
        /// The model for a task: the provider's per-task override, else its model, else the catalog
        /// default. Null when none is set and the provider has no default.
        /// </summary>
        public static string? ResolveModel(UserAiProvider config, AiProviderDefinition definition, AiTask task)
        {
            string? perTask = task switch
            {
                AiTask.Translation => config.TranslationModel,
                AiTask.Explanation => config.ExplanationModel,
                AiTask.Story => config.StoryModel,
                AiTask.Summarization => config.SummarizationModel,
                _ => null
            };

            if (!string.IsNullOrWhiteSpace(perTask)) return perTask.Trim();
            if (!string.IsNullOrWhiteSpace(config.Model)) return config.Model.Trim();
            return definition.DefaultModel;
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
