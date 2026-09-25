using System;
using System.Collections.Generic;
using System.Linq;

namespace LinguaReadApi.Services.Ai
{
    /// <summary>How a provider lets a request turn model "thinking" on or off.</summary>
    public enum AiReasoningStyle
    {
        /// <summary>No reasoning parameters are sent; pick a reasoning model to get reasoning.</summary>
        None,
        /// <summary>OpenRouter's <c>reasoning: { enabled, effort }</c> object.</summary>
        OpenRouter,
        /// <summary>DeepSeek's <c>thinking: { type }</c> plus <c>reasoning_effort</c>. Thinking is on by default there.</summary>
        DeepSeek
    }

    /// <summary>
    /// A built-in AI provider that speaks the OpenAI chat-completions protocol. Adding a provider
    /// that follows the protocol is one entry in <see cref="AiProviderCatalog.Providers"/>; anything
    /// else OpenAI-compatible can be reached through the "custom" entry with its own base URL.
    /// </summary>
    public sealed record AiProviderDefinition(
        string Id,
        string DisplayName,
        // Base URL that "/chat/completions" and "/models" are appended to; null when the user supplies it.
        string? BaseUrl,
        // Used when the user leaves the model empty; null means the user must choose one.
        string? DefaultModel,
        string KeyPlaceholder,
        string? KeysUrl,
        string? ModelsUrl,
        AiReasoningStyle ReasoningStyle = AiReasoningStyle.None,
        // Custom endpoints (a local Ollama or LM Studio) often need no key.
        bool ApiKeyOptional = false)
    {
        public bool RequiresBaseUrl => BaseUrl == null;
    }

    public static class AiProviderCatalog
    {
        /// <summary>The server-configured Gemini services. Not an entry in <see cref="Providers"/>: it has no per-user config.</summary>
        public const string BuiltInGemini = "gemini";

        public const string OpenRouter = "openrouter";
        public const string DeepSeek = "deepseek";
        public const string Custom = "custom";

        public static readonly IReadOnlyList<AiProviderDefinition> Providers = new[]
        {
            new AiProviderDefinition(OpenRouter, "OpenRouter", "https://openrouter.ai/api/v1",
                DefaultModel: null, "sk-or-...", "https://openrouter.ai/keys", "https://openrouter.ai/models",
                AiReasoningStyle.OpenRouter),
            new AiProviderDefinition(DeepSeek, "DeepSeek", "https://api.deepseek.com",
                DefaultModel: "deepseek-flash", "sk-...", "https://platform.deepseek.com/api_keys",
                "https://api-docs.deepseek.com/quick_start/pricing", AiReasoningStyle.DeepSeek),
            new AiProviderDefinition("openai", "OpenAI", "https://api.openai.com/v1",
                DefaultModel: null, "sk-...", "https://platform.openai.com/api-keys",
                "https://platform.openai.com/docs/models"),
            new AiProviderDefinition("google", "Google Gemini (your own key)",
                "https://generativelanguage.googleapis.com/v1beta/openai",
                DefaultModel: null, "AIza...", "https://aistudio.google.com/apikey",
                "https://ai.google.dev/gemini-api/docs/models"),
            new AiProviderDefinition("mistral", "Mistral", "https://api.mistral.ai/v1",
                DefaultModel: null, "", "https://console.mistral.ai/api-keys",
                "https://docs.mistral.ai/getting-started/models/models_overview/"),
            new AiProviderDefinition("groq", "Groq", "https://api.groq.com/openai/v1",
                DefaultModel: null, "gsk_...", "https://console.groq.com/keys",
                "https://console.groq.com/docs/models"),
            new AiProviderDefinition(Custom, "Custom (OpenAI-compatible)", BaseUrl: null,
                DefaultModel: null, "(optional)", KeysUrl: null, ModelsUrl: null,
                ApiKeyOptional: true),
        };

        private static readonly Dictionary<string, AiProviderDefinition> ById =
            Providers.ToDictionary(p => p.Id, StringComparer.OrdinalIgnoreCase);

        public static AiProviderDefinition? Find(string? id) =>
            id != null && ById.TryGetValue(id.Trim(), out var definition) ? definition : null;

        /// <summary>Normalizes a provider id from a request: a catalog id or the built-in Gemini, else null.</summary>
        public static string? NormalizeSelection(string? id)
        {
            if (string.IsNullOrWhiteSpace(id)) return null;
            var trimmed = id.Trim().ToLowerInvariant();
            if (trimmed == BuiltInGemini) return BuiltInGemini;
            return Find(trimmed)?.Id;
        }

        /// <summary>Whether the selection routes AI tasks to one of the catalog providers rather than built-in Gemini.</summary>
        public static bool IsExternal(string? selection) => Find(selection) != null;

        /// <summary>
        /// Checks a user-supplied base URL for the custom provider and returns it without a trailing
        /// slash. Also accepts the full ".../chat/completions" endpoint people tend to paste.
        /// </summary>
        public static bool TryNormalizeBaseUrl(string? value, out string? normalized, out string? error)
        {
            normalized = null;
            error = null;
            if (string.IsNullOrWhiteSpace(value)) return true;

            var trimmed = value.Trim();
            if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                error = "The base URL must be an absolute http:// or https:// URL, e.g. http://localhost:11434/v1.";
                return false;
            }
            if (!string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            {
                error = "The base URL can't contain credentials, a query string or a fragment.";
                return false;
            }

            var result = uri.GetLeftPart(UriPartial.Path).TrimEnd('/');
            const string endpointSuffix = "/chat/completions";
            if (result.EndsWith(endpointSuffix, StringComparison.OrdinalIgnoreCase))
            {
                result = result[..^endpointSuffix.Length];
            }
            normalized = result;
            return true;
        }
    }
}
