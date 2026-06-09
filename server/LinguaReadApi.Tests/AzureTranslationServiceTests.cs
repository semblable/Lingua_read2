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
/// Behavioural tests for <see cref="AzureTranslationService"/> (Azure AI Translator v3.0):
/// credential resolution (per-user override + config fallback + dotenv sentinel), the
/// subscription key/region headers, request URL shape, input-order mapping, de-duplication,
/// chunking above the per-request cap, and the graceful "empty on error" contract it shares
/// with DeepL.
/// </summary>
public class AzureTranslationServiceTests
{
    [Fact]
    public async Task TranslateBatch_WithoutKey_ReturnsEmptyAndMakesNoRequest()
    {
        var handler = new RecordingHandler();
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient); // no config key, no UseCredentials

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Empty(result);
        Assert.Equal(0, handler.RequestCount);
    }

    [Fact]
    public async Task TranslateBatch_WithSentinelConfigKey_TreatsItAsUnset()
    {
        var handler = new RecordingHandler();
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "SET_IN_DOTENV");

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Empty(result);
        Assert.Equal(0, handler.RequestCount);
    }

    [Fact]
    public async Task TranslateBatch_MapsTranslationsByInputOrder()
    {
        var handler = new RecordingHandler(AzureResponse("bonjour", "monde"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(new List<string> { "hello", "world" }, "FR", "EN");

        Assert.Equal("bonjour", result["hello"]);
        Assert.Equal("monde", result["world"]);

        // Subscription key header is attached; target/source land in the query string (lowercased).
        Assert.Equal("config-key", handler.RequestHeaders[0]["Ocp-Apim-Subscription-Key"]);
        Assert.Contains("api-version=3.0", handler.RequestUris[0]);
        Assert.Contains("to=fr", handler.RequestUris[0]);
        Assert.Contains("from=en", handler.RequestUris[0]);
    }

    [Fact]
    public async Task TranslateBatch_OmitsFromParam_WhenSourceLangNull()
    {
        var handler = new RecordingHandler(AzureResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR", sourceLang: null);

        Assert.Contains("to=fr", handler.RequestUris[0]);
        Assert.DoesNotContain("from=", handler.RequestUris[0]);
    }

    [Fact]
    public async Task TranslateBatch_IncludesRegionHeader_WhenConfigured()
    {
        var handler = new RecordingHandler(AzureResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key", configRegion: "westeurope");

        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Equal("westeurope", handler.RequestHeaders[0]["Ocp-Apim-Subscription-Region"]);
    }

    [Fact]
    public async Task TranslateBatch_OmitsRegionHeader_WhenNotConfigured()
    {
        var handler = new RecordingHandler(AzureResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key"); // no region

        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.False(handler.RequestHeaders[0].ContainsKey("Ocp-Apim-Subscription-Region"));
    }

    [Fact]
    public async Task UseCredentials_PerUserKeyOverridesConfig()
    {
        var handler = new RecordingHandler(AzureResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key", configRegion: "configregion");

        service.UseCredentials("user-key", "userregion");
        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Equal("user-key", handler.RequestHeaders[0]["Ocp-Apim-Subscription-Key"]);
        Assert.Equal("userregion", handler.RequestHeaders[0]["Ocp-Apim-Subscription-Region"]);
    }

    [Fact]
    public async Task UseCredentials_BlankValuesFallBackToConfig()
    {
        var handler = new RecordingHandler(AzureResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key", configRegion: "configregion");

        service.UseCredentials("   ", null);
        await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Equal("config-key", handler.RequestHeaders[0]["Ocp-Apim-Subscription-Key"]);
        Assert.Equal("configregion", handler.RequestHeaders[0]["Ocp-Apim-Subscription-Region"]);
    }

    [Fact]
    public async Task TranslateBatch_DeduplicatesWordsBeforeSending()
    {
        var handler = new RecordingHandler(AzureResponse("a-fr", "b-fr"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(new List<string> { "a", "a", "b" }, "FR");

        // Only the two distinct words are sent (a duplicate "a" would otherwise break the
        // 1:1 count check against the response).
        Assert.Equal(2, CountOccurrences(handler.RequestBodies[0], "\"Text\""));
        Assert.Equal("a-fr", result["a"]);
        Assert.Equal("b-fr", result["b"]);
    }

    [Fact]
    public async Task TranslateBatch_ReturnsEmpty_OnErrorStatus()
    {
        var handler = new RecordingHandler(Json("{\"error\":{\"code\":401000}}", HttpStatusCode.Unauthorized));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(new List<string> { "hello" }, "FR");

        Assert.Empty(result);
        Assert.Equal(1, handler.RequestCount);
    }

    [Fact]
    public async Task TranslateBatch_SkipsChunk_OnResponseCountMismatch()
    {
        // Two words requested but only one translation returned -> whole chunk is dropped.
        var handler = new RecordingHandler(AzureResponse("only-one"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateBatchAsync(new List<string> { "hello", "world" }, "FR");

        Assert.Empty(result);
    }

    [Fact]
    public async Task TranslateBatch_ChunksRequestsAboveLimit()
    {
        // 150 distinct words -> two requests (100 + 50). Mismatched response sizes would be
        // skipped, so the 150 mapped entries also prove the chunk boundaries are 100/50.
        var words = Enumerable.Range(0, 150).Select(i => $"w{i}").ToList();
        var handler = new RecordingHandler(
            AzureResponse(Enumerable.Range(0, 100).Select(i => $"t{i}").ToArray()),
            AzureResponse(Enumerable.Range(100, 50).Select(i => $"t{i}").ToArray()));
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
        var handler = new RecordingHandler(AzureResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateTextAsync("hello", sourceLang: "EN", targetLang: "FR");

        Assert.Equal("bonjour", result);
    }

    [Fact]
    public async Task TranslateText_EmptyInput_ReturnsEmptyWithoutRequest()
    {
        var handler = new RecordingHandler();
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, configKey: "config-key");

        var result = await service.TranslateTextAsync("   ", sourceLang: null, targetLang: "FR");

        Assert.Equal(string.Empty, result);
        Assert.Equal(0, handler.RequestCount);
    }

    private static AzureTranslationService CreateService(
        HttpClient httpClient, string? configKey = null, string? configRegion = null, string? endpoint = null)
    {
        var dict = new Dictionary<string, string?>();
        if (endpoint != null) dict["Azure:Translator:Endpoint"] = endpoint;
        if (configKey != null) dict["Azure:Translator:Key"] = configKey;
        if (configRegion != null) dict["Azure:Translator:Region"] = configRegion;

        var config = new ConfigurationBuilder().AddInMemoryCollection(dict).Build();
        return new AzureTranslationService(httpClient, config, NullLogger<AzureTranslationService>.Instance);
    }

    // Builds an Azure v3.0 /translate response: a JSON array with one element per input word.
    private static HttpResponseMessage AzureResponse(params string[] translations)
    {
        var items = translations.Select(t => $"{{\"translations\":[{{\"text\":{Q(t)},\"to\":\"fr\"}}]}}");
        return Json("[" + string.Join(",", items) + "]");
    }

    private static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static string Q(string value) => JsonSerializer.Serialize(value);

    private static int CountOccurrences(string haystack, string needle) =>
        haystack.Split(needle).Length - 1;

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
                throw new InvalidOperationException("No queued HTTP response for Azure Translator test.");
            }

            return _responses.Dequeue();
        }

        private static IReadOnlyDictionary<string, string> SnapshotHeaders(HttpRequestHeaders headers) =>
            headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value), StringComparer.OrdinalIgnoreCase);
    }
}
