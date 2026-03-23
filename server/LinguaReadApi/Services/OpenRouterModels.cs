using System.Text.Json.Serialization;

namespace LinguaReadApi.Services
{
    // OpenRouter API request/response models following OpenAI chat completions format

    public class OpenRouterRequest
    {
        [JsonPropertyName("model")]
        public string Model { get; set; } = string.Empty;

        [JsonPropertyName("messages")]
        public OpenRouterMessage[] Messages { get; set; } = Array.Empty<OpenRouterMessage>();

        [JsonPropertyName("temperature")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public double? Temperature { get; set; }

        [JsonPropertyName("max_tokens")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public int? MaxTokens { get; set; }

        [JsonPropertyName("top_p")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public double? TopP { get; set; }

        [JsonPropertyName("reasoning")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public OpenRouterReasoningOptions? Reasoning { get; set; }
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

    public class OpenRouterMessage
    {
        [JsonPropertyName("role")]
        public string Role { get; set; } = "user"; // "system", "user", "assistant"

        [JsonPropertyName("content")]
        public string Content { get; set; } = string.Empty;
    }

    public class OpenRouterResponse
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }

        [JsonPropertyName("choices")]
        public OpenRouterChoice[] Choices { get; set; } = Array.Empty<OpenRouterChoice>();

        [JsonPropertyName("error")]
        public OpenRouterError? Error { get; set; }
    }

    public class OpenRouterChoice
    {
        [JsonPropertyName("index")]
        public int Index { get; set; }

        [JsonPropertyName("message")]
        public OpenRouterMessage? Message { get; set; }

        [JsonPropertyName("finish_reason")]
        public string? FinishReason { get; set; }
    }

    public class OpenRouterError
    {
        [JsonPropertyName("message")]
        public string? Message { get; set; }

        [JsonPropertyName("code")]
        public int? Code { get; set; }
    }
}
