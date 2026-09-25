using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services.Ai
{
    /// <summary>
    /// Everything a request to one of the user's catalog providers needs: where to send it, the key,
    /// the model per task, and the user's settings (prompts, reasoning). Only built through
    /// <see cref="TryCreate"/>, so it is always usable.
    /// </summary>
    public sealed class AiProviderConnection
    {
        private AiProviderConnection(AiProviderDefinition definition, UserAiProvider config, UserSettings settings, string baseUrl)
        {
            Definition = definition;
            Config = config;
            Settings = settings;
            BaseUrl = baseUrl;
        }

        public AiProviderDefinition Definition { get; }
        public UserAiProvider Config { get; }
        public UserSettings Settings { get; }
        public string BaseUrl { get; }

        public string? ApiKey => string.IsNullOrWhiteSpace(Config.ApiKey) ? null : Config.ApiKey.Trim();
        public string ChatCompletionsUrl => BaseUrl + "/chat/completions";
        public string ModelsUrl => BaseUrl + "/models";

        public string ModelFor(AiTask task) => AiTaskConfig.ResolveModel(Config, Definition, task)!;

        /// <summary>
        /// Builds a connection when the provider has what a request needs (a key, a model and, for
        /// the custom provider, a base URL). Otherwise returns null with a message saying what is missing.
        /// </summary>
        /// <param name="requireModel">False for requests that need no model, such as listing the models.</param>
        public static AiProviderConnection? TryCreate(
            AiProviderDefinition definition,
            UserAiProvider? config,
            UserSettings settings,
            out string? problem,
            bool requireModel = true)
        {
            config ??= new UserAiProvider { UserId = settings.UserId, Provider = definition.Id };

            if (!definition.ApiKeyOptional && string.IsNullOrWhiteSpace(config.ApiKey))
            {
                problem = $"{definition.DisplayName} API key not configured";
                return null;
            }

            var baseUrl = definition.BaseUrl ?? config.BaseUrl;
            if (string.IsNullOrWhiteSpace(baseUrl))
            {
                problem = $"{definition.DisplayName}: base URL not configured";
                return null;
            }

            if (requireModel && Enum.GetValues<AiTask>().Any(task => string.IsNullOrWhiteSpace(AiTaskConfig.ResolveModel(config, definition, task))))
            {
                problem = $"{definition.DisplayName}: no model selected";
                return null;
            }

            problem = null;
            return new AiProviderConnection(definition, config, settings, baseUrl.TrimEnd('/'));
        }
    }

    public static class AiProviderResolver
    {
        /// <summary>
        /// The user's selected catalog provider, or null when AI tasks should use the built-in Gemini
        /// services: Gemini is selected, or the selected provider is missing its key, model or URL.
        /// </summary>
        public static async Task<AiProviderConnection?> ResolveActiveAsync(AppDbContext context, Guid userId, CancellationToken ct = default)
        {
            var settings = await context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId, ct);
            if (settings == null) return null;

            var definition = AiProviderCatalog.Find(settings.AiProvider);
            if (definition == null) return null;

            var config = await FindConfigAsync(context, userId, definition.Id, ct);
            return AiProviderConnection.TryCreate(definition, config, settings, out _);
        }

        public static Task<UserAiProvider?> FindConfigAsync(AppDbContext context, Guid userId, string providerId, CancellationToken ct = default) =>
            context.UserAiProviders.FirstOrDefaultAsync(p => p.UserId == userId && p.Provider == providerId, ct);
    }
}
