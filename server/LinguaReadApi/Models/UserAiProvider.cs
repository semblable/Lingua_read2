using System;
using System.ComponentModel.DataAnnotations;

namespace LinguaReadApi.Models
{
    /// <summary>
    /// A user's settings for one AI provider from <see cref="Services.Ai.AiProviderCatalog"/>, keyed by
    /// (UserId, Provider). Every provider keeps its own key and models, so switching the active
    /// provider (<see cref="UserSettings.AiProvider"/>) and back loses nothing.
    /// </summary>
    public class UserAiProvider
    {
        public Guid UserId { get; set; }

        // A catalog id: "openrouter", "deepseek", "custom", ...
        [StringLength(32)]
        public string Provider { get; set; } = string.Empty;

        // Encrypted at rest → stored as unbounded text; input length is capped on the DTO.
        public string? ApiKey { get; set; }

        // Only the "custom" provider has one; catalog providers use their built-in URL.
        [StringLength(500)]
        public string? BaseUrl { get; set; }

        // Null = the catalog's default model for the provider, if it has one.
        [StringLength(200)]
        public string? Model { get; set; }

        // Per-task model overrides. Null = fall back to Model.
        [StringLength(200)]
        public string? TranslationModel { get; set; }

        [StringLength(200)]
        public string? ExplanationModel { get; set; }

        [StringLength(200)]
        public string? StoryModel { get; set; }

        [StringLength(200)]
        public string? SummarizationModel { get; set; }

        public virtual User User { get; set; } = null!;
    }
}
