using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Ai;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class OpenAiCompatibleChatClientTests
{
    private static readonly Guid UserId = Guid.NewGuid();

    [Fact]
    public async Task PostsToTheProvidersChatEndpoint_WithBearerKey_AndReturnsContent()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("Olá")));
        var client = CreateClient(handler);

        var result = await client.CompleteAsync(Connection("deepseek", key: "sk-ds"), Request(), "test");

        Assert.True(result.Success);
        Assert.Equal("Olá", result.Content);
        Assert.Equal("stop", result.FinishReason);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://api.deepseek.com/chat/completions", request.Uri.ToString());
        Assert.Equal("Bearer sk-ds", request.Authorization);
        Assert.False(request.Headers.ContainsKey("HTTP-Referer"));
        using var body = JsonDocument.Parse(request.Body);
        Assert.Equal("deepseek-flash", body.RootElement.GetProperty("model").GetString());
        Assert.Equal("user", body.RootElement.GetProperty("messages")[0].GetProperty("role").GetString());
    }

    [Fact]
    public async Task OpenRouter_GetsItsAttributionHeaders()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("ok")));

        await CreateClient(handler).CompleteAsync(Connection("openrouter", model: "a/b"), Request("a/b"), "test");

        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://openrouter.ai/api/v1/chat/completions", request.Uri.ToString());
        Assert.Equal("https://lingua-read.app", request.Headers["HTTP-Referer"]);
        Assert.Equal("Lingua-Read", request.Headers["X-Title"]);
    }

    [Fact]
    public async Task CustomProvider_UsesItsBaseUrl_AndSendsNoAuthorizationWithoutAKey()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("ok")));

        await CreateClient(handler).CompleteAsync(
            Connection("custom", key: null, model: "llama3", baseUrl: "http://localhost:11434/v1"), Request("llama3"), "test");

        var request = Assert.Single(handler.Requests);
        Assert.Equal("http://localhost:11434/v1/chat/completions", request.Uri.ToString());
        Assert.Null(request.Authorization);
    }

    [Fact]
    public async Task OmitsNullOptionalParameters()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("ok")));

        await CreateClient(handler).CompleteAsync(Connection("openai", model: "gpt"), new ChatCompletionRequest
        {
            Model = "gpt",
            Messages = new[] { new ChatMessage { Content = "hi" } }
        }, "test");

        var body = handler.Requests[0].Body;
        Assert.DoesNotContain("temperature", body);
        Assert.DoesNotContain("max_tokens", body);
        Assert.DoesNotContain("reasoning", body);
        Assert.DoesNotContain("thinking", body);
    }

    [Fact]
    public async Task On400_RetriesOnceWithOnlyModelAndMessages()
    {
        var handler = new ScriptedHandler(
            Json(HttpStatusCode.BadRequest, """{"error":{"message":"Unsupported parameter: 'max_tokens'","code":"unsupported_parameter"}}"""),
            Json(HttpStatusCode.OK, Completion("ok")));
        var request = Request("gpt");
        request.Temperature = 0.3;
        request.MaxTokens = 65535;
        request.TopP = 1.0;
        request.Thinking = new DeepSeekThinkingOptions { Type = "disabled" };

        var result = await CreateClient(handler).CompleteAsync(Connection("openai", model: "gpt"), request, "test");

        Assert.True(result.Success);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Contains("max_tokens", handler.Requests[0].Body);
        using var retried = JsonDocument.Parse(handler.Requests[1].Body);
        Assert.Equal(new[] { "model", "messages" }, retried.RootElement.EnumerateObject().Select(p => p.Name));
    }

    [Fact]
    public async Task On400_WithoutOptionalParameters_FailsWithoutRetrying()
    {
        var handler = new ScriptedHandler(
            Json(HttpStatusCode.BadRequest, """{"error":{"message":"Model Not Exist"}}"""));

        var result = await CreateClient(handler).CompleteAsync(Connection("deepseek"), new ChatCompletionRequest
        {
            Model = "nope",
            Messages = new[] { new ChatMessage { Content = "hi" } }
        }, "test");

        Assert.False(result.Success);
        Assert.Equal("BadRequest (Model Not Exist)", result.Error);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task On400_AfterTheStrippedRetry_ReturnsTheSecondError()
    {
        var handler = new ScriptedHandler(
            Json(HttpStatusCode.BadRequest, """{"error":{"message":"first"}}"""),
            Json(HttpStatusCode.BadRequest, """{"error":{"message":"Model Not Exist"}}"""));

        var result = await CreateClient(handler).CompleteAsync(Connection("deepseek"), Request(), "test");

        Assert.Equal("BadRequest (Model Not Exist)", result.Error);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task On429_RetriesOnce_ThenReportsTooManyRequests()
    {
        var handler = new ScriptedHandler(
            Json(HttpStatusCode.TooManyRequests, """{"error":{"message":"rate-limited upstream"}}"""),
            Json(HttpStatusCode.TooManyRequests, """{"error":{"message":"rate-limited upstream"}}"""),
            Json(HttpStatusCode.OK, Completion("never reached")));
        var client = CreateClient(handler);
        var delays = new List<TimeSpan>();
        client.Delay = (delay, _) => { delays.Add(delay); return Task.CompletedTask; };

        var result = await client.CompleteAsync(Connection("openrouter", model: "a/b"), Request("a/b"), "test");

        Assert.False(result.Success);
        Assert.Equal(HttpStatusCode.TooManyRequests, result.StatusCode);
        // The controllers map this to a 429 by looking for the status name.
        Assert.StartsWith("TooManyRequests", result.Error);
        Assert.Contains("rate-limited upstream", result.Error);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(new[] { TimeSpan.FromSeconds(1) }, delays);
    }

    [Fact]
    public async Task On503_RetriesUpToThreeAttempts()
    {
        var handler = new ScriptedHandler(
            Json(HttpStatusCode.ServiceUnavailable, "{}"),
            Json(HttpStatusCode.ServiceUnavailable, "{}"),
            Json(HttpStatusCode.OK, Completion("third time")));
        var client = CreateClient(handler);
        client.Delay = (_, _) => Task.CompletedTask;

        var result = await client.CompleteAsync(Connection("groq", model: "llama"), Request("llama"), "test");

        Assert.Equal("third time", result.Content);
        Assert.Equal(3, handler.Requests.Count);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, """{"error":{"message":"Authentication Fails","type":"authentication_error"}}""", "Unauthorized (Authentication Fails)")]
    [InlineData(HttpStatusCode.PaymentRequired, """{"error":{"message":"Insufficient Balance"}}""", "PaymentRequired (Insufficient Balance)")]
    [InlineData(HttpStatusCode.Forbidden, """{"error":"plain string error"}""", "Forbidden (plain string error)")]
    [InlineData(HttpStatusCode.NotFound, """[{"error":{"code":404,"message":"models/x is not found"}}]""", "NotFound (models/x is not found)")]
    [InlineData(HttpStatusCode.InternalServerError, "<html>oops</html>", "InternalServerError")]
    public async Task NonRetryableErrors_IncludeTheProvidersMessage(HttpStatusCode status, string body, string expected)
    {
        var handler = new ScriptedHandler(Json(status, body));

        var result = await CreateClient(handler).CompleteAsync(Connection("deepseek"), new ChatCompletionRequest
        {
            Model = "deepseek-flash",
            Messages = new[] { new ChatMessage { Content = "hi" } }
        }, "test");

        Assert.Equal(expected, result.Error);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task ErrorObjectWithA200_IsAFailure_AndStringErrorCodesDontBreakParsing()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK,
            """{"error":{"message":"Provider returned error","code":"upstream_error"}}"""));

        var result = await CreateClient(handler).CompleteAsync(Connection("openrouter", model: "a/b"), Request("a/b"), "test");

        Assert.False(result.Success);
        Assert.Equal("Provider returned error", result.Error);
        Assert.False(result.IsExtractionFailure);
    }

    [Theory]
    [InlineData("""{"choices":[]}""")]
    [InlineData("""{"choices":[{"message":{"role":"assistant","content":null},"finish_reason":"length"}]}""")]
    [InlineData("""{"id":"x"}""")]
    [InlineData("not json")]
    public async Task ResponsesWithoutAnAnswer_AreExtractionFailures(string body)
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, body));

        var result = await CreateClient(handler).CompleteAsync(Connection("deepseek"), Request(), "test");

        Assert.True(result.IsExtractionFailure);
    }

    [Fact]
    public async Task ContentParts_AreJoined_SkippingThinkingParts()
    {
        // Mistral's reasoning models answer with a list of parts.
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, """
            {"choices":[{"message":{"role":"assistant","content":[
              {"type":"thinking","thinking":[{"type":"text","text":"hmm"}]},
              {"type":"text","text":"Bon"},{"type":"text","text":"jour"}
            ]},"finish_reason":"stop"}]}
            """));

        var result = await CreateClient(handler).CompleteAsync(Connection("mistral", model: "magistral"), Request("magistral"), "test");

        Assert.Equal("Bonjour", result.Content);
    }

    [Fact]
    public async Task ALeadingThinkBlock_IsRemoved()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("<think>\nLet me translate.\n</think>\n\nHello <think>kept</think>")));

        var result = await CreateClient(handler).CompleteAsync(Connection("custom", key: null, model: "qwen3", baseUrl: "http://localhost:1234/v1"), Request("qwen3"), "test");

        Assert.Equal("Hello <think>kept</think>", result.Content);
    }

    [Fact]
    public async Task ReasoningContentIsNotTheAnswer()
    {
        // DeepSeek returns its thinking separately; only content is the answer.
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK,
            """{"choices":[{"message":{"role":"assistant","reasoning_content":"thinking...","content":"Answer"},"finish_reason":"stop"}]}"""));

        var result = await CreateClient(handler).CompleteAsync(Connection("deepseek"), Request(), "test");

        Assert.Equal("Answer", result.Content);
    }

    [Fact]
    public async Task ATimeout_IsReportedAsAnError()
    {
        var handler = new ScriptedHandler(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });

        var result = await CreateClient(handler).CompleteAsync(Connection("deepseek"), Request(), "test", TimeSpan.FromMilliseconds(50));

        Assert.Equal("Request timed out.", result.Error);
    }

    [Fact]
    public async Task ListModels_ReadsTheOpenAiShape_Sorted_AndStripsGeminiPrefix()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK,
            """{"object":"list","data":[{"id":"models/gemini-flash-latest"},{"id":"b-model"},{"id":"A-model"},{"id":"b-model"},{"object":"model"}]}"""));

        var (models, error) = await CreateClient(handler).ListModelsAsync(Connection("google", model: "x"));

        Assert.Null(error);
        Assert.Equal(new[] { "A-model", "b-model", "gemini-flash-latest" }, models);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("https://generativelanguage.googleapis.com/v1beta/openai/models", request.Uri.ToString());
    }

    [Fact]
    public async Task ListModels_AcceptsABareArray_AndReportsErrors()
    {
        var ok = new ScriptedHandler(Json(HttpStatusCode.OK, """[{"id":"llama3"}]"""));
        var (models, _) = await CreateClient(ok).ListModelsAsync(Connection("custom", key: null, model: "x", baseUrl: "http://localhost:11434/v1"));
        Assert.Equal(new[] { "llama3" }, models);

        var unauthorized = new ScriptedHandler(Json(HttpStatusCode.Unauthorized, """{"error":{"message":"bad key"}}"""));
        var (none, error) = await CreateClient(unauthorized).ListModelsAsync(Connection("openai", model: "x"));
        Assert.Empty(none);
        Assert.Equal("Unauthorized (bad key)", error);
    }

    // --- helpers ---

    internal static AiProviderConnection Connection(string provider, string? key = "sk-test", string? model = null, string? baseUrl = null, UserSettings? settings = null)
    {
        var definition = AiProviderCatalog.Find(provider)!;
        var connection = AiProviderConnection.TryCreate(
            definition,
            new UserAiProvider { UserId = UserId, Provider = definition.Id, ApiKey = key, Model = model, BaseUrl = baseUrl },
            settings ?? new UserSettings { UserId = UserId },
            out var problem);
        Assert.True(connection != null, problem);
        return connection!;
    }

    private static ChatCompletionRequest Request(string model = "deepseek-flash") => new()
    {
        Model = model,
        Messages = new[] { new ChatMessage { Role = "user", Content = "Translate: Olá" } },
        Temperature = 0.3,
        MaxTokens = 1024
    };

    internal static string Completion(string content) => JsonSerializer.Serialize(new
    {
        id = "chatcmpl-1",
        choices = new[] { new { index = 0, message = new { role = "assistant", content }, finish_reason = "stop" } }
    });

    internal static Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Json(HttpStatusCode status, string body) =>
        (_, _) => Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });

    internal static OpenAiCompatibleChatClient CreateClient(ScriptedHandler handler) =>
        new(new SingleClientFactory(handler), NullLogger<OpenAiCompatibleChatClient>.Instance);

    internal sealed record RecordedRequest(HttpMethod Method, Uri Uri, string? Authorization, Dictionary<string, string> Headers, string Body);

    internal sealed class ScriptedHandler(params Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>[] script) : HttpMessageHandler
    {
        private int _next;
        public List<RecordedRequest> Requests { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content == null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            Requests.Add(new RecordedRequest(
                request.Method,
                request.RequestUri!,
                request.Headers.Authorization?.ToString(),
                request.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value)),
                body));
            if (_next >= script.Length) throw new InvalidOperationException($"Unexpected request #{_next + 1} to {request.RequestUri}");
            return await script[_next++](request, cancellationToken);
        }
    }

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
