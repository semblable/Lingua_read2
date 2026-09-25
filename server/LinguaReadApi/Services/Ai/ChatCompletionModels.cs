using System;
using System.Net;
using System.Text.Json.Serialization;

namespace LinguaReadApi.Services.Ai
{
    // OpenAI chat-completions request body, the format every catalog provider accepts. Optional
    // fields are omitted when null: several providers reject parameters they don't know.

    public class ChatCompletionRequest
    {
        [JsonPropertyName("model")]
        public string Model { get; set; } = string.Empty;

        [JsonPropertyName("messages")]
        public ChatMessage[] Messages { get; set; } = Array.Empty<ChatMessage>();

        [JsonPropertyName("temperature")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public double? Temperature { get; set; }

        [JsonPropertyName("max_tokens")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public int? MaxTokens { get; set; }

        [JsonPropertyName("top_p")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public double? TopP { get; set; }

        // OpenRouter only.
        [JsonPropertyName("reasoning")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public OpenRouterReasoningOptions? Reasoning { get; set; }

        // DeepSeek only.
        [JsonPropertyName("thinking")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public DeepSeekThinkingOptions? Thinking { get; set; }

        // DeepSeek only.
        [JsonPropertyName("reasoning_effort")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? ReasoningEffort { get; set; }

        /// <summary>The request with only the fields every OpenAI-compatible server accepts.</summary>
        public ChatCompletionRequest WithoutOptionalParameters() => new()
        {
            Model = Model,
            Messages = Messages
        };
    }

    public class OpenRouterReasoningOptions
    {
        [JsonPropertyName("enabled")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? Enabled { get; set; }

        [JsonPropertyName("effort")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Effort { get; set; }
    }

    public class DeepSeekThinkingOptions
    {
        // "enabled" or "disabled".
        [JsonPropertyName("type")]
        public string Type { get; set; } = "enabled";
    }

    public class ChatMessage
    {
        [JsonPropertyName("role")]
        public string Role { get; set; } = "user"; // "system", "user", "assistant"

        [JsonPropertyName("content")]
        public string Content { get; set; } = string.Empty;
    }

    /// <summary>
    /// Outcome of one chat completion. <see cref="Error"/> is set on failure and is short enough to
    /// show to the user: the HTTP status name (e.g. "TooManyRequests"), or the provider's own message
    /// when it sent one with a successful status.
    /// </summary>
    public sealed record ChatCompletionResult(
        string? Content,
        string? Error,
        HttpStatusCode? StatusCode = null,
        string? FinishReason = null,
        // The provider's error message from a failed response, for logs and connection tests.
        string? ProviderMessage = null)
    {
        /// <summary>The error of a successful response that held no answer.</summary>
        public const string CouldNotExtract = "Could not extract result";

        public bool Success => Error == null;

        /// <summary>The provider answered, but not with anything usable (no choices or no content).</summary>
        public bool IsExtractionFailure => Error == CouldNotExtract;

        public static ChatCompletionResult Ok(string content, string? finishReason) => new(content, null, HttpStatusCode.OK, finishReason);
    }
}
