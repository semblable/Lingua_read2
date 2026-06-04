using System.Globalization;
using System.Net;
using System.Text;
using LinguaReadApi.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Covers the Wiktionary word-translation provider: it flattens the English Wiktionary REST
/// definition response (keyed by language code, definitions carrying HTML) into a plain gloss
/// string, sends the mandatory User-Agent header, and degrades to empty on 404.
/// </summary>
public class WiktionaryTranslationServiceTests
{
    // Trimmed shape of GET /api/rest_v1/page/definition/chien — keyed by language code,
    // definitions contain HTML anchors that must be stripped.
    private const string ChienJson =
        "{\"fr\":[{\"partOfSpeech\":\"Noun\",\"language\":\"French\",\"definitions\":[" +
        "{\"definition\":\"<a rel=\\\"mw:WikiLink\\\" href=\\\"/wiki/dog\\\">dog</a>\"}]}]," +
        "\"ja\":[{\"partOfSpeech\":\"Noun\",\"language\":\"Japanese\",\"definitions\":[" +
        "{\"definition\":\"unrelated\"}]}]}";

    [Fact]
    public async Task TranslateText_StripsHtml_AndSendsUserAgent()
    {
        var handler = new StubHandler(_ => Ok(ChienJson));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient);

        var result = await service.TranslateTextAsync("chien", sourceLang: "fr", targetLang: "EN");

        Assert.Equal("dog", result);
        // Wikimedia REST rejects requests without a User-Agent — pin that it is always sent.
        Assert.All(handler.UserAgents, ua => Assert.False(string.IsNullOrWhiteSpace(ua)));
        Assert.NotEmpty(handler.UserAgents);
    }

    [Fact]
    public async Task TranslateText_PicksSourceLanguageEntry()
    {
        var handler = new StubHandler(_ => Ok(ChienJson));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient);

        // "fr-CA" should normalize to the "fr" bucket, not the Japanese one.
        var result = await service.TranslateTextAsync("chien", sourceLang: "fr-CA", targetLang: "EN");

        Assert.Equal("dog", result);
    }

    [Fact]
    public async Task TranslateText_NotFound_ReturnsEmpty()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient);

        var result = await service.TranslateTextAsync("zzzznotaword", sourceLang: "fr", targetLang: "EN");

        Assert.Equal(string.Empty, result);
    }

    [Fact]
    public async Task TranslateBatch_MapsEachWord()
    {
        var handler = new StubHandler(_ => Ok(ChienJson));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient);

        var result = await service.TranslateBatchAsync(new List<string> { "chien", "chat" }, "EN", "fr");

        Assert.Equal("dog", result["chien"]);
        Assert.Equal("dog", result["chat"]);
    }

    [Fact]
    public async Task TranslateText_RateLimited_Throws()
    {
        // Retry-After exceeds the bounded wait, so the service surfaces the limit immediately
        // rather than hanging or silently returning empty.
        var handler = new StubHandler(_ => RateLimited(retryAfterSeconds: 10));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient);

        await Assert.ThrowsAsync<WiktionaryRateLimitException>(
            () => service.TranslateTextAsync("chien", sourceLang: "fr", targetLang: "EN"));
    }

    [Fact]
    public async Task TranslateText_RateLimitedThenOk_RetriesAndSucceeds()
    {
        // First response is a short-Retry-After 429, second succeeds — one bounded retry.
        var calls = 0;
        var handler = new StubHandler(_ =>
        {
            calls++;
            return calls == 1 ? RateLimited(retryAfterSeconds: 0) : Ok(ChienJson);
        });
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient);

        var result = await service.TranslateTextAsync("chien", sourceLang: "fr", targetLang: "EN");

        Assert.Equal("dog", result);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task TranslateBatch_RateLimited_Throws()
    {
        var handler = new StubHandler(_ => RateLimited(retryAfterSeconds: 10));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient);

        await Assert.ThrowsAsync<WiktionaryRateLimitException>(
            () => service.TranslateBatchAsync(new List<string> { "chien", "chat" }, "EN", "fr"));
    }

    private static HttpResponseMessage Ok(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private static HttpResponseMessage RateLimited(int retryAfterSeconds)
    {
        var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
        response.Headers.Add("Retry-After", retryAfterSeconds.ToString(CultureInfo.InvariantCulture));
        return response;
    }

    private static WiktionaryTranslationService CreateService(HttpClient httpClient)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Wiktionary:BaseUrl"] = "https://en.wiktionary.org",
                ["Wiktionary:UserAgent"] = "LinguaRead-Test/1.0"
            })
            .Build();

        return new WiktionaryTranslationService(
            httpClient,
            config,
            NullLogger<WiktionaryTranslationService>.Instance);
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;
        public List<string?> UserAgents { get; } = new();

        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) => _responder = responder;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            UserAgents.Add(request.Headers.TryGetValues("User-Agent", out var values)
                ? string.Join(",", values)
                : null);
            return Task.FromResult(_responder(request));
        }
    }
}
