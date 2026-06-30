using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using LinguaReadApi.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Behavioural tests for <see cref="GoogleTranslationService"/> (Google Cloud Translation v2):
/// credential resolution (per-user override + config fallback + dotenv sentinel), passing the
/// API key in the <c>X-goog-api-key</c> header rather than the URL query string (so it cannot
/// leak into request/proxy logs), request payload shape (text format, optional source),
/// input-order mapping, de-duplication, chunking, and the graceful "empty on error" contract.
/// </summary>
public class GoogleTranslationServiceTests
{
    [Fact]
    public async Task TranslateBatch_WithoutKey_ThrowsNotConfiguredAndMakesNoRequest()
    {
        var handler = new RecordingHandler();
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient); // no config key, no UseApiKey

        await Assert.ThrowsAsync<TranslationProviderNotConfiguredException>(
            () => service.TranslateBatchAsync(new List<string> { "hello" }, "FR"));
        Assert.Equal(0, handler.RequestCount);
    }

    [Fact]
    public async Task TranslateBatch_WithSentinelConfigKey_TreatsItAsUnset()
    {
        var handler = new RecordingHandler();
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "SET_IN_DOTENV");

        await Assert.ThrowsAsync<TranslationProviderNotConfiguredException>(
            () => service.TranslateBatchAsync(new List<string> { "hello" }, "FR"));
        Assert.Equal(0, handler.RequestCount);
    }

    [Fact]
    public async Task TranslateBatch_MapsTranslationsByInputOrder()
    {
        var handler = new RecordingHandler(GoogleResponse("bonjour", "monde"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(new List<string> { "hello", "world" }, "FR", "EN");

        Assert.Equal("bonjour", result["hello"]);
        Assert.Equal("monde", result["world"]);
    }

    [Fact]
    public async Task TranslateBatch_SendsApiKeyInHeaderNotQueryString()
    {
        var handler = new RecordingHandler(GoogleResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "secret-key");

        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Equal("secret-key", handler.RequestHeaders[0]["X-goog-api-key"]);
        // The key must never appear in the URL (would otherwise leak into access logs).
        Assert.DoesNotContain("key=", handler.RequestUris[0]);
        Assert.DoesNotContain("secret-key", handler.RequestUris[0]);
    }

    [Fact]
    public async Task TranslateBatch_RequestsTextFormat_AndIncludesSource_WhenProvided()
    {
        var handler = new RecordingHandler(GoogleResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR", "EN");

        var body = handler.RequestBodies[0];
        Assert.Contains("\"format\":\"text\"", body);
        Assert.Contains("\"target\":\"fr\"", body);
        Assert.Contains("\"source\":\"en\"", body);
    }

    [Fact]
    public async Task TranslateBatch_OmitsSourceFromPayload_WhenSourceLangNull()
    {
        var handler = new RecordingHandler(GoogleResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR", sourceLang: null);

        // Source is omitted (auto-detect) rather than sent as null/empty.
        Assert.DoesNotContain("\"source\"", handler.RequestBodies[0]);
    }

    [Fact]
    public async Task UseApiKey_PerUserKeyOverridesConfig()
    {
        var handler = new RecordingHandler(GoogleResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        service.UseApiKey("user-key");
        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Equal("user-key", handler.RequestHeaders[0]["X-goog-api-key"]);
    }

    [Fact]
    public async Task UseApiKey_BlankFallsBackToConfig()
    {
        var handler = new RecordingHandler(GoogleResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        service.UseApiKey("   ");
        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Equal("config-key", handler.RequestHeaders[0]["X-goog-api-key"]);
    }

    [Fact]
    public async Task TranslateBatch_DeduplicatesWordsBeforeSending()
    {
        // Response has two items; if the duplicate "a" were sent the 3-vs-2 count check would
        // drop the chunk, so a populated result proves de-duplication happened first.
        var handler = new RecordingHandler(GoogleResponse("a-fr", "b-fr"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(new List<string> { "a", "a", "b" }, "FR");

        Assert.Equal("a-fr", result["a"]);
        Assert.Equal("b-fr", result["b"]);
        Assert.Equal(2, result.Count);
    }

    [Fact]
    public async Task TranslateBatch_ReturnsEmpty_OnErrorStatus()
    {
        var handler = new RecordingHandler(Json("{\"error\":{\"code\":403}}", HttpStatusCode.Forbidden));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Empty(result);
        Assert.Equal(1, handler.RequestCount);
    }

    [Fact]
    public async Task TranslateBatch_SkipsChunk_OnResponseCountMismatch()
    {
        var handler = new RecordingHandler(GoogleResponse("only-one"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(new List<string> { "hello", "world" }, "FR");

        Assert.Empty(result);
    }

    [Fact]
    public async Task TranslateBatch_ChunksRequestsAboveLimit()
    {
        var words = Enumerable.Range(0, 150).Select(i => $"w{i}").ToList();
        var handler = new RecordingHandler(
            GoogleResponse(Enumerable.Range(0, 100).Select(i => $"t{i}").ToArray()),
            GoogleResponse(Enumerable.Range(100, 50).Select(i => $"t{i}").ToArray()));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(words, "FR");

        Assert.Equal(2, handler.RequestCount);
        Assert.Equal(150, result.Count);
        Assert.Equal("t0", result["w0"]);
        Assert.Equal("t149", result["w149"]);
    }

    [Fact]
    public async Task TranslateText_ReturnsFirstTranslation()
    {
        var handler = new RecordingHandler(GoogleResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateTextAsync("hello", sourceLang: "EN", targetLang: "FR");

        Assert.Equal("bonjour", result);
    }

    private static GoogleTranslationService CreateService(
        HttpClient httpClient, string? configKey = null, string? endpoint = null)
    {
        var dict = new Dictionary<string, string?>();
        if (endpoint != null) dict["Google:Translate:Endpoint"] = endpoint;
        if (configKey != null) dict["Google:Translate:ApiKey"] = configKey;

        var config = new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
        return new GoogleTranslationService(httpClient, config, NullLogger<GoogleTranslationService>.Instance);
    }

    // Builds a Google v2 response: data.translations with one entry per input word, in order.
    private static HttpResponseMessage GoogleResponse(params string[] translations)
    {
        var items = translations.Select(t => $"{{\"translatedText\":{Q(t)},\"detectedSourceLanguage\":\"en\"}}");
        return Json("{\"data\":{\"translations\":[" + string.Join(",", items) + "]}}");
    }

    private static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static string Q(string value) => JsonSerializer.Serialize(value);

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses;

        public RecordingHandler(params HttpResponseMessage[] responses) =>
            _responses = new Queue<HttpResponseMessage>(responses);

        public List<string?> RequestUris { get; } = new();
        public List<string> RequestBodies { get; } = new();
        public List<IReadOnlyDictionary<string, string>> RequestHeaders { get; } = new();
        public int RequestCount => RequestUris.Count;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUris.Add(request.RequestUri?.ToString());
            RequestHeaders.Add(SnapshotHeaders(request.Headers));
            RequestBodies.Add(request.Content == null
                ? string.Empty
                : await request.Content.ReadAsStringAsync(cancellationToken));

            if (_responses.Count == 0)
            {
                throw new InvalidOperationException("No queued HTTP response for Google Translate test.");
            }

            return _responses.Dequeue();
        }

        private static IReadOnlyDictionary<string, string> SnapshotHeaders(HttpRequestHeaders headers) =>
            headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value), StringComparer.OrdinalIgnoreCase);
    }
}
