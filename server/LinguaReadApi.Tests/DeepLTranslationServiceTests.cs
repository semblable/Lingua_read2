using System.Net;
using System.Text;
using LinguaReadApi.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Covers the Fix A change: the DeepL Authorization header is attached
/// per-request (on the <see cref="HttpRequestMessage"/>) instead of once on
/// <c>HttpClient.DefaultRequestHeaders</c> in the constructor. The latter is
/// fragile — it throws "header already exists" / leaks the key the moment the
/// client is reused (typed/singleton). These tests pin the new behaviour:
/// every outgoing request carries the header, across repeated calls on the
/// same instance, and the happy-path translation mapping is unchanged.
/// </summary>
public class DeepLTranslationServiceTests
{
    private const string SingleTranslationJson =
        "{\"translations\":[{\"text\":\"bonjour\",\"detected_source_language\":\"EN\"}]}";

    [Fact]
    public async Task TranslateBatch_AttachesAuthorizationHeader_OnEveryRequest()
    {
        var handler = new CapturingHandler(SingleTranslationJson);
        // One HttpClient reused across calls — exactly the scenario the old
        // DefaultRequestHeaders approach could not survive.
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, apiKey: "test-key");

        var first = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");
        var second = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        // Happy path still maps input -> output.
        Assert.Equal("bonjour", first["hello"]);
        Assert.Equal("bonjour", second["hello"]);

        // Both requests carried the per-request Authorization header.
        Assert.Equal(2, handler.AuthorizationHeaders.Count);
        Assert.All(handler.AuthorizationHeaders, h => Assert.Equal("DeepL-Auth-Key test-key", h));
    }

    [Fact]
    public async Task TranslateText_PostsToConfiguredUrl_WithAuthorization()
    {
        var handler = new CapturingHandler(SingleTranslationJson);
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, apiKey: "abc123");

        var result = await service.TranslateTextAsync("hello", sourceLang: null, targetLang: "FR");

        Assert.Equal("bonjour", result);
        Assert.Single(handler.AuthorizationHeaders);
        Assert.Equal("DeepL-Auth-Key abc123", handler.AuthorizationHeaders[0]);
        Assert.Equal("https://api-free.deepl.com/v2/translate", handler.LastRequestUri);
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.BadGateway)]
    public async Task TranslateBatch_RetriesTransientStatus_ThenSucceeds(HttpStatusCode transient)
    {
        var handler = new ScriptedHandler(Status(transient), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Equal("T:hello", result["hello"]);
        Assert.Equal(2, handler.Requests.Count);
        Assert.All(handler.Requests, r => Assert.Equal("DeepL-Auth-Key test-key", r.Authorization));
    }

    [Fact]
    public async Task TranslateBatch_GivesUpAfterThreeAttempts_ReturnsEmpty()
    {
        var handler = new ScriptedHandler(
            Status(HttpStatusCode.ServiceUnavailable), Status(HttpStatusCode.ServiceUnavailable),
            Status(HttpStatusCode.ServiceUnavailable), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Empty(result);
        Assert.Equal(3, handler.Requests.Count);
    }

    [Theory]
    [InlineData((HttpStatusCode)456)] // DeepL: quota exhausted — its docs say never to retry.
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task TranslateBatch_DoesNotRetryClientErrors(HttpStatusCode status)
    {
        var handler = new ScriptedHandler(Status(status), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Empty(result);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task TranslateBatch_DoesNotRetry_WhenRetryAfterIsTooLong()
    {
        var tooLong = Status(HttpStatusCode.TooManyRequests, retryAfter: TimeSpan.FromSeconds(60));
        var handler = new ScriptedHandler(tooLong, Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Empty(result);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task TranslateBatch_RetriesTransportFailure()
    {
        var handler = new ScriptedHandler((_, _) => throw new HttpRequestException("connection reset"), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Equal("T:hello", result["hello"]);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task TranslateBatch_TimesOutPerAttempt_AndDoesNotRetryTheTimeout()
    {
        var hang = new Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            throw new InvalidOperationException("unreachable");
        });
        var handler = new ScriptedHandler(hang, Echo());
        var service = CreateFastService(handler);
        service.RequestTimeout = TimeSpan.FromMilliseconds(100);

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");
        var single = await service.TranslateTextAsync("hello", sourceLang: null, targetLang: "FR");

        Assert.Empty(result);
        Assert.Equal("T:hello", single); // the next call goes through normally
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task TranslateBatch_ChunksLargeBatches_AndKeepsWordToTranslationMapping()
    {
        var words = Enumerable.Range(1, 120).Select(i => $"w{i}").ToList();
        var handler = new ScriptedHandler(Echo(), Echo(), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(words, "FR", sourceLang: null);

        Assert.Equal(new[] { 50, 50, 20 }, handler.Requests.Select(r => r.Texts.Count));
        Assert.Equal(words, handler.Requests.SelectMany(r => r.Texts));
        Assert.Equal(120, result.Count);
        Assert.All(words, w => Assert.Equal("T:" + w, result[w]));
        Assert.All(handler.Requests, r => Assert.Equal("FR", r.TargetLang));
    }

    [Fact]
    public async Task TranslateBatch_FailedChunk_OnlyLosesItsOwnWords()
    {
        var words = Enumerable.Range(1, 60).Select(i => $"w{i}").ToList();
        var mismatch = new Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>((_, _) =>
            Task.FromResult(Json("{\"translations\":[{\"text\":\"only one\"}]}")));
        var handler = new ScriptedHandler(mismatch, Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(10, result.Count);
        Assert.All(words.Skip(50), w => Assert.Equal("T:" + w, result[w]));
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge)]
    public async Task TranslateBatch_ChunkRejectedForItsContent_StillSendsTheRest(HttpStatusCode status)
    {
        var words = Enumerable.Range(1, 60).Select(i => $"w{i}").ToList();
        var handler = new ScriptedHandler(Status(status), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(10, result.Count);
        Assert.All(words.Skip(50), w => Assert.Equal("T:" + w, result[w]));
    }

    [Fact]
    public async Task TranslateBatch_UnreadableResponse_StillSendsTheRest()
    {
        var words = Enumerable.Range(1, 60).Select(i => $"w{i}").ToList();
        var notJson = new Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>((_, _) =>
            Task.FromResult(Json("<html>502 from a proxy</html>")));
        var handler = new ScriptedHandler(notJson, Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(10, result.Count);
    }

    [Theory]
    // Not retried: one request for the failing chunk.
    [InlineData((HttpStatusCode)456, 2)]
    [InlineData(HttpStatusCode.Unauthorized, 2)]
    [InlineData(HttpStatusCode.Forbidden, 2)]
    // Retried: the batch only ends once all three attempts have failed.
    [InlineData(HttpStatusCode.TooManyRequests, 4)]
    [InlineData(HttpStatusCode.InternalServerError, 4)]
    [InlineData(HttpStatusCode.ServiceUnavailable, 4)]
    [InlineData(HttpStatusCode.GatewayTimeout, 4)]
    public async Task TranslateBatch_FailureThatWouldHitEveryChunk_EndsTheBatch(HttpStatusCode status, int expectedRequests)
    {
        var words = Enumerable.Range(1, 120).Select(i => $"w{i}").ToList();
        var handler = new ScriptedHandler(Echo(), Status(status), Status(status), Status(status), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(expectedRequests, handler.Requests.Count);
        Assert.DoesNotContain(handler.Requests, r => r.Texts.Contains("w101"));
        // What the first chunk got back is kept.
        Assert.Equal(50, result.Count);
        Assert.All(words.Take(50), w => Assert.Equal("T:" + w, result[w]));
    }

    [Fact]
    public async Task TranslateBatch_RateLimitedWithLongRetryAfter_EndsTheBatch()
    {
        // Returned on the first attempt without retrying (Retry-After over the 5 s cap), and the next
        // chunk would be told the same.
        var words = Enumerable.Range(1, 120).Select(i => $"w{i}").ToList();
        var tooLong = Status(HttpStatusCode.TooManyRequests, retryAfter: TimeSpan.FromSeconds(60));
        var handler = new ScriptedHandler(Echo(), tooLong, Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(50, result.Count);
    }

    [Fact]
    public async Task TranslateBatch_FailureTheRetryRecovers_DoesNotEndTheBatch()
    {
        var words = Enumerable.Range(1, 120).Select(i => $"w{i}").ToList();
        var handler = new ScriptedHandler(Echo(), Status(HttpStatusCode.ServiceUnavailable), Echo(), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(4, handler.Requests.Count);
        Assert.Equal(120, result.Count);
    }

    [Fact]
    public async Task TranslateBatch_Timeout_EndsTheBatch()
    {
        // Chunks go out one after another, so a DeepL that hangs would otherwise cost the reader
        // one full timeout per remaining chunk.
        var hang = new Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            throw new InvalidOperationException("unreachable");
        });
        var words = Enumerable.Range(1, 120).Select(i => $"w{i}").ToList();
        var handler = new ScriptedHandler(Echo(), hang, Echo());
        var service = CreateFastService(handler);
        service.RequestTimeout = TimeSpan.FromMilliseconds(100);

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(50, result.Count);
    }

    [Fact]
    public async Task TranslateBatch_StillUnreachableAfterRetries_EndsTheBatch()
    {
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> reset =
            (_, _) => throw new HttpRequestException("connection reset");
        var words = Enumerable.Range(1, 120).Select(i => $"w{i}").ToList();
        var handler = new ScriptedHandler(Echo(), reset, reset, reset, Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(4, handler.Requests.Count);
        Assert.Equal(50, result.Count);
    }

    [Fact]
    public async Task TranslateBatch_SendsEachDistinctNonBlankWordOnce()
    {
        var handler = new ScriptedHandler(Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(new List<string> { "hola", "amigo", "hola", " ", "", "Hola" }, "FR");

        Assert.Equal(new[] { "hola", "amigo", "Hola" }, Assert.Single(handler.Requests).Texts);
        Assert.Equal(new[] { "Hola", "amigo", "hola" }, result.Keys.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task TranslateBatch_DuplicatesDoNotCostAnExtraRequest()
    {
        // 50 distinct words, each sent twice by the caller: one full chunk, not two.
        var distinct = Enumerable.Range(1, 50).Select(i => $"w{i}").ToList();
        var handler = new ScriptedHandler(Echo(), Echo());
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(distinct.Concat(distinct).ToList(), "FR");

        Assert.Equal(distinct, Assert.Single(handler.Requests).Texts);
        Assert.Equal(50, result.Count);
    }

    [Fact]
    public async Task TranslateBatch_OnlyBlankWords_SendsNothing()
    {
        var handler = new ScriptedHandler();
        var service = CreateFastService(handler);

        var result = await service.TranslateBatchAsync(new List<string> { " ", "", "\t" }, "FR");
        var single = await service.TranslateTextAsync("  ", sourceLang: null, targetLang: "FR");

        Assert.Empty(result);
        Assert.Equal(string.Empty, single);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task TranslateBatch_SendsSourceLang_AndConfiguredTargetCode()
    {
        var languageService = new Mock<ILanguageService>();
        languageService.Setup(s => s.GetAllLanguagesAsync())
            .ReturnsAsync(new List<LinguaReadApi.Models.Language> { new() { LanguageId = 1, Name = "Portuguese", Code = "pt", DeepLTargetCode = "EN-GB" } });
        var handler = new ScriptedHandler(Echo());
        var service = CreateFastService(handler, languageService.Object);

        var result = await service.TranslateBatchAsync(new List<string> { "olá" }, "EN", sourceLang: "pt");

        Assert.Equal("T:olá", result["olá"]);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("EN-GB", request.TargetLang);
        Assert.Equal("pt", request.SourceLang);
    }

    private static DeepLTranslationService CreateFastService(HttpMessageHandler handler, ILanguageService? languageService = null)
    {
        var service = CreateService(new HttpClient(handler, disposeHandler: false), "test-key", languageService);
        service.RetryBaseDelay = TimeSpan.Zero;
        return service;
    }

    private static Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Status(HttpStatusCode status, TimeSpan? retryAfter = null) =>
        (_, _) =>
        {
            var response = new HttpResponseMessage(status) { Content = new StringContent("{\"message\":\"nope\"}") };
            if (retryAfter.HasValue) response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(retryAfter.Value);
            return Task.FromResult(response);
        };

    // Answers with "T:<text>" for every posted text, in order.
    private static Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Echo() =>
        async (request, _) =>
        {
            var texts = ParseForm(await request.Content!.ReadAsStringAsync()).Where(p => p.Key == "text").Select(p => p.Value);
            var body = System.Text.Json.JsonSerializer.Serialize(new { translations = texts.Select(t => new { text = "T:" + t }) });
            return Json(body);
        };

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private static List<KeyValuePair<string, string>> ParseForm(string form) =>
        form.Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(pair => pair.Split('=', 2))
            .Select(kv => new KeyValuePair<string, string>(
                Uri.UnescapeDataString(kv[0].Replace('+', ' ')),
                Uri.UnescapeDataString(kv.Length > 1 ? kv[1].Replace('+', ' ') : "")))
            .ToList();

    private sealed record SentRequest(string? Authorization, List<string> Texts, string? TargetLang, string? SourceLang);

    private sealed class ScriptedHandler(params Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>[] script) : HttpMessageHandler
    {
        public List<SentRequest> Requests { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var form = ParseForm(await request.Content!.ReadAsStringAsync(cancellationToken));
            Requests.Add(new SentRequest(
                request.Headers.TryGetValues("Authorization", out var values) ? string.Join(",", values) : null,
                form.Where(p => p.Key == "text").Select(p => p.Value).ToList(),
                form.FirstOrDefault(p => p.Key == "target_lang").Value,
                form.FirstOrDefault(p => p.Key == "source_lang").Value));
            var step = script[Requests.Count - 1];
            return await step(request, cancellationToken);
        }
    }

    private static DeepLTranslationService CreateService(HttpClient httpClient, string apiKey, ILanguageService? languageService = null)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["DeepL:ApiKey"] = apiKey,
                ["DeepL:TranslateUrl"] = "https://api-free.deepl.com/v2/translate"
            })
            .Build();

        return new DeepLTranslationService(
            httpClient,
            config,
            NullLogger<DeepLTranslationService>.Instance,
            languageService ?? Mock.Of<ILanguageService>());
    }

    private sealed class CapturingHandler : HttpMessageHandler
    {
        private readonly string _responseJson;
        public List<string?> AuthorizationHeaders { get; } = new();
        public string? LastRequestUri { get; private set; }

        public CapturingHandler(string responseJson) => _responseJson = responseJson;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastRequestUri = request.RequestUri?.ToString();
            AuthorizationHeaders.Add(
                request.Headers.TryGetValues("Authorization", out var values)
                    ? string.Join(",", values)
                    : null);

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(_responseJson, Encoding.UTF8, "application/json")
            });
        }
    }
}
