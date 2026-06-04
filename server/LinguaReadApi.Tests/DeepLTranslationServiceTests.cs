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

    private static DeepLTranslationService CreateService(HttpClient httpClient, string apiKey)
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
            Mock.Of<ILanguageService>());
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
