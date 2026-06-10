using System.Net;
using System.Net.Http.Headers;
using System.Text;
using LinguaReadApi.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Pins the Gemini request shape: the API key travels in the x-goog-api-key header and never
/// in the URL (a ?key= query string leaks into proxy logs and HttpRequestException messages).
/// </summary>
public class GeminiTranslationServiceTests
{
    [Fact]
    public async Task Translate_SendsApiKeyHeader_AndOmitsKeyFromUrl()
    {
        var handler = new RecordingHandler(GeminiResponse("bonjour"));
        using var httpClient = new HttpClient(handler, disposeHandler: false);
        var service = CreateService(httpClient, apiKey: "test-gemini-key");

        // Empty sourceLanguage skips the language-service lookup.
        var result = await service.TranslateSentenceAsync("hello", "", "fr");

        Assert.Equal("bonjour", result);
        Assert.Equal(1, handler.RequestCount);
        Assert.Equal("test-gemini-key", handler.RequestHeaders[0]["x-goog-api-key"]);
        Assert.DoesNotContain("key=", handler.RequestUris[0]);
        Assert.Contains(":generateContent", handler.RequestUris[0]);
    }

    private static GeminiTranslationService CreateService(HttpClient httpClient, string apiKey)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Gemini:ApiKey"] = apiKey })
            .Build();
        return new GeminiTranslationService(
            config,
            NullLogger<GeminiTranslationService>.Instance,
            Mock.Of<ILanguageService>(),
            new SingleClientFactory(httpClient));
    }

    private static HttpResponseMessage GeminiResponse(string text) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(
                $"{{\"candidates\":[{{\"content\":{{\"parts\":[{{\"text\":\"{text}\"}}]}}}}]}}",
                Encoding.UTF8,
                "application/json")
        };

    private sealed class SingleClientFactory : IHttpClientFactory
    {
        private readonly HttpClient _client;
        public SingleClientFactory(HttpClient client) => _client = client;
        public HttpClient CreateClient(string name) => _client;
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses;

        public RecordingHandler(params HttpResponseMessage[] responses) =>
            _responses = new Queue<HttpResponseMessage>(responses);

        public List<string?> RequestUris { get; } = new();
        public List<IReadOnlyDictionary<string, string>> RequestHeaders { get; } = new();
        public int RequestCount => RequestUris.Count;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestUris.Add(request.RequestUri?.ToString());
            RequestHeaders.Add(SnapshotHeaders(request.Headers));

            if (_responses.Count == 0)
            {
                throw new InvalidOperationException("No queued HTTP response for Gemini test.");
            }

            return Task.FromResult(_responses.Dequeue());
        }

        private static IReadOnlyDictionary<string, string> SnapshotHeaders(HttpRequestHeaders headers) =>
            headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value), StringComparer.OrdinalIgnoreCase);
    }
}
