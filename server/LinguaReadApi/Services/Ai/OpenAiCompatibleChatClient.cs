using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services.Ai
{
    /// <summary>
    /// Sends chat completions to any provider in <see cref="AiProviderCatalog"/>. The one place that
    /// knows the protocol's rough edges: retries, provider-specific headers, error bodies that come
    /// with a 200, content returned as parts, reasoning text in the content, and servers that reject
    /// optional parameters.
    /// </summary>
    public class OpenAiCompatibleChatClient
    {
        public static readonly TimeSpan DefaultTimeout = TimeSpan.FromMinutes(5);

        private const int MaxAttempts = 3;
        // A provider's per-minute cap doesn't clear in a second or two, and extra retries only
        // multiply 429s the user never sees, so a 429 is retried once.
        private const int MaxAttemptsOn429 = 2;

        private static readonly JsonSerializerOptions SerializerOptions = new() { WriteIndented = false };

        // A leading <think>...</think> block: how local reasoning models (Ollama, LM Studio) return
        // their reasoning when the server doesn't split it out.
        private static readonly Regex LeadingThinkBlock = new(@"^\s*<think>.*?</think>\s*", RegexOptions.Singleline | RegexOptions.Compiled);

        private readonly HttpClient _httpClient;
        private readonly ILogger<OpenAiCompatibleChatClient> _logger;

        public OpenAiCompatibleChatClient(IHttpClientFactory httpClientFactory, ILogger<OpenAiCompatibleChatClient> logger)
        {
            _httpClient = httpClientFactory.CreateClient();
            // Each attempt gets its own timeout (see SendOnceAsync).
            _httpClient.Timeout = Timeout.InfiniteTimeSpan;
            _logger = logger;
        }

        /// <summary>Waits between retries. Replaced in tests.</summary>
        internal Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;

        /// <param name="operation">What the request is for, e.g. "translation"; used in log messages.</param>
        /// <param name="timeout">Per attempt; defaults to <see cref="DefaultTimeout"/>.</param>
        public async Task<ChatCompletionResult> CompleteAsync(
            AiProviderConnection connection,
            ChatCompletionRequest request,
            string operation,
            TimeSpan? timeout = null,
            CancellationToken ct = default)
        {
            var provider = connection.Definition.DisplayName;
            var payload = request;
            var strippedOptionalParameters = false;
            ChatCompletionResult? lastFailure = null;

            for (var attempt = 1; attempt <= MaxAttempts; attempt++)
            {
                HttpResponseMessage response;
                string body;
                try
                {
                    (response, body) = await SendOnceAsync(connection, payload, timeout ?? DefaultTimeout, ct);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    _logger.LogError("{Provider} {Operation} request timed out after {Timeout}s (model {Model})",
                        provider, operation, (timeout ?? DefaultTimeout).TotalSeconds, payload.Model);
                    return new ChatCompletionResult(null, "Request timed out.");
                }

                using (response)
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        var status = response.StatusCode;
                        var providerMessage = TryReadErrorMessage(body);
                        lastFailure = new ChatCompletionResult(null, FormatError(status, providerMessage), status, ProviderMessage: providerMessage);

                        // Servers differ in which optional parameters they accept (max_tokens limits,
                        // temperature on reasoning models, reasoning switches), and a rejected one is
                        // a 400. One retry with just the model and the messages gets past all of them.
                        if (status == HttpStatusCode.BadRequest && !strippedOptionalParameters && HasOptionalParameters(payload))
                        {
                            _logger.LogWarning("{Provider} rejected the {Operation} request (model {Model}): {Message}. Retrying without optional parameters.",
                                provider, operation, payload.Model, providerMessage ?? Truncate(body, 500));
                            payload = payload.WithoutOptionalParameters();
                            strippedOptionalParameters = true;
                            attempt--; // doesn't count as a retry
                            continue;
                        }

                        var is429 = status == HttpStatusCode.TooManyRequests;
                        var retryable = is429 || status == HttpStatusCode.ServiceUnavailable;
                        var budget = is429 ? MaxAttemptsOn429 : MaxAttempts;

                        _logger.LogWarning("{Provider} {Operation} error (attempt={Attempt}/{Max}, model {Model}): {StatusCode}. Retryable={Retryable}. Response={Response}",
                            provider, operation, attempt, budget, payload.Model, status, retryable, Truncate(body, 1000));

                        if (retryable && attempt < budget)
                        {
                            await Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)), ct);
                            continue;
                        }

                        return lastFailure;
                    }

                    return ParseSuccess(body, provider, operation, payload.Model);
                }
            }

            return lastFailure ?? new ChatCompletionResult(null, "Request failed.");
        }

        private async Task<(HttpResponseMessage Response, string Body)> SendOnceAsync(
            AiProviderConnection connection, ChatCompletionRequest payload, TimeSpan timeout, CancellationToken ct)
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(timeout);

            using var request = new HttpRequestMessage(HttpMethod.Post, connection.ChatCompletionsUrl)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload, SerializerOptions), Encoding.UTF8, "application/json")
            };
            AddHeaders(request, connection);

            var response = await _httpClient.SendAsync(request, timeoutCts.Token);
            try
            {
                var body = await response.Content.ReadAsStringAsync(timeoutCts.Token);
                return (response, body);
            }
            catch
            {
                response.Dispose();
                throw;
            }
        }

        /// <summary>Lists the model ids the provider offers (GET {base}/models).</summary>
        public async Task<(IReadOnlyList<string> Models, string? Error)> ListModelsAsync(AiProviderConnection connection, CancellationToken ct = default)
        {
            try
            {
                using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeoutCts.CancelAfter(TimeSpan.FromSeconds(30));
                using var request = new HttpRequestMessage(HttpMethod.Get, connection.ModelsUrl);
                AddHeaders(request, connection);

                using var response = await _httpClient.SendAsync(request, timeoutCts.Token);
                var body = await response.Content.ReadAsStringAsync(timeoutCts.Token);
                if (!response.IsSuccessStatusCode)
                {
                    return (Array.Empty<string>(), FormatError(response.StatusCode, TryReadErrorMessage(body)));
                }

                using var doc = JsonDocument.Parse(body);
                // OpenAI shape: { "data": [ { "id": ... } ] }; a few servers return a bare array.
                var items = doc.RootElement.ValueKind == JsonValueKind.Array
                    ? doc.RootElement
                    : doc.RootElement.TryGetProperty("data", out var data) ? data : default;
                if (items.ValueKind != JsonValueKind.Array)
                {
                    return (Array.Empty<string>(), "The provider's model list has an unexpected format.");
                }

                var ids = items.EnumerateArray()
                    .Select(item => item.ValueKind == JsonValueKind.Object && item.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String
                        ? id.GetString()
                        : null)
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    // Gemini's OpenAI endpoint lists "models/gemini-..." but its chat endpoint wants the bare name.
                    .Select(id => id!.StartsWith("models/", StringComparison.Ordinal) ? id["models/".Length..] : id)
                    .Distinct(StringComparer.Ordinal)
                    .Order(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                return (ids, null);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                return (Array.Empty<string>(), "Request timed out.");
            }
            catch (Exception ex) when (ex is HttpRequestException or JsonException)
            {
                _logger.LogWarning(ex, "Listing {Provider} models failed", connection.Definition.DisplayName);
                return (Array.Empty<string>(), ex.Message);
            }
        }

        private static void AddHeaders(HttpRequestMessage request, AiProviderConnection connection)
        {
            if (connection.ApiKey is { } apiKey)
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            }
            if (connection.Definition.Id == AiProviderCatalog.OpenRouter)
            {
                // OpenRouter's app attribution headers.
                request.Headers.Add("HTTP-Referer", "https://lingua-read.app");
                request.Headers.Add("X-Title", "Lingua-Read");
            }
        }

        private ChatCompletionResult ParseSuccess(string body, string provider, string operation, string model)
        {
            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(body);
            }
            catch (JsonException)
            {
                _logger.LogWarning("{Provider} {Operation} response is not JSON (model {Model}): {Response}", provider, operation, model, Truncate(body, 1000));
                return new ChatCompletionResult(null, ChatCompletionResult.CouldNotExtract);
            }

            using (doc)
            {
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object)
                {
                    return new ChatCompletionResult(null, ChatCompletionResult.CouldNotExtract);
                }

                // OpenRouter reports some upstream failures as an error object with a 200.
                if (root.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.Object)
                {
                    var errorMessage = ReadString(error, "message") ?? "Unknown error";
                    _logger.LogWarning("{Provider} {Operation} returned an error (model {Model}): {Error}", provider, operation, model, errorMessage);
                    return new ChatCompletionResult(null, errorMessage, HttpStatusCode.OK, ProviderMessage: errorMessage);
                }

                if (!root.TryGetProperty("choices", out var choices) || choices.ValueKind != JsonValueKind.Array || choices.GetArrayLength() == 0)
                {
                    _logger.LogWarning("{Provider} {Operation} response has no choices (model {Model}): {Response}", provider, operation, model, Truncate(body, 1000));
                    return new ChatCompletionResult(null, ChatCompletionResult.CouldNotExtract);
                }

                var choice = choices[0];
                var finishReason = ReadString(choice, "finish_reason");
                string? content = null;
                if (choice.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.Object &&
                    message.TryGetProperty("content", out var contentElement))
                {
                    content = ReadContent(contentElement);
                }

                if (content == null)
                {
                    _logger.LogWarning("{Provider} {Operation} response has no content (model {Model}). FinishReason={FinishReason}, Response={Response}",
                        provider, operation, model, finishReason, Truncate(body, 1000));
                    return new ChatCompletionResult(null, ChatCompletionResult.CouldNotExtract, HttpStatusCode.OK, finishReason);
                }

                content = LeadingThinkBlock.Replace(content, string.Empty, 1);
                return ChatCompletionResult.Ok(content, finishReason);
            }
        }

        // Content is a string, or (Mistral's reasoning models) an array of parts where only "text"
        // parts are the answer.
        private static string? ReadContent(JsonElement content)
        {
            switch (content.ValueKind)
            {
                case JsonValueKind.String:
                    return content.GetString();
                case JsonValueKind.Array:
                    var text = new StringBuilder();
                    var any = false;
                    foreach (var part in content.EnumerateArray())
                    {
                        if (part.ValueKind == JsonValueKind.String)
                        {
                            text.Append(part.GetString());
                            any = true;
                        }
                        else if (part.ValueKind == JsonValueKind.Object &&
                                 (ReadString(part, "type") ?? "text") == "text" &&
                                 ReadString(part, "text") is { } partText)
                        {
                            text.Append(partText);
                            any = true;
                        }
                    }
                    return any ? text.ToString() : null;
                default:
                    return null;
            }
        }

        private static bool HasOptionalParameters(ChatCompletionRequest request) =>
            request.Temperature != null || request.MaxTokens != null || request.TopP != null ||
            request.Reasoning != null || request.Thinking != null || request.ReasoningEffort != null;

        private static string FormatError(HttpStatusCode status, string? providerMessage) =>
            string.IsNullOrWhiteSpace(providerMessage) ? status.ToString() : $"{status} ({Truncate(providerMessage, 300)})";

        // { "error": { "message": ... } } (OpenAI and most others), { "error": "..." }, or { "message": ... }.
        private static string? TryReadErrorMessage(string body)
        {
            if (string.IsNullOrWhiteSpace(body)) return null;
            try
            {
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Array && root.GetArrayLength() > 0) root = root[0]; // Gemini wraps errors in an array
                if (root.ValueKind != JsonValueKind.Object) return null;
                if (root.TryGetProperty("error", out var error))
                {
                    if (error.ValueKind == JsonValueKind.String) return error.GetString();
                    if (error.ValueKind == JsonValueKind.Object) return ReadString(error, "message");
                }
                return ReadString(root, "message") ?? ReadString(root, "detail");
            }
            catch (JsonException)
            {
                return null;
            }
        }

        private static string? ReadString(JsonElement element, string property) =>
            element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

        private static string Truncate(string value, int max) =>
            value.Length <= max ? value : value[..max] + "…";
    }
}
