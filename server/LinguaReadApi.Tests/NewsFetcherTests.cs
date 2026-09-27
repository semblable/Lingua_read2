using System.Net;
using System.Text;
using LinguaReadApi.Services.News;
using Xunit;

namespace LinguaReadApi.Tests;

public class NewsFetcherTests
{
    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("2.29.26.36", true)]
    [InlineData("172.15.255.255", true)]
    [InlineData("172.32.0.1", true)]
    [InlineData("100.63.255.255", true)]
    [InlineData("2a00:1450:4001:80b::200e", true)]
    [InlineData("::ffff:8.8.8.8", true)]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.17.0.2", false)]      // Docker's default bridge: the database container
    [InlineData("192.168.1.10", false)]
    [InlineData("169.254.169.254", false)] // cloud metadata
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("255.255.255.255", false)]
    [InlineData("::1", false)]
    [InlineData("::", false)]
    [InlineData("fe80::1", false)]
    [InlineData("fd12:3456::1", false)]
    [InlineData("::ffff:127.0.0.1", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("2002:0a00:0001::1", false)] // 6to4 wrapping 10.0.0.1
    [InlineData("64:ff9b::7f00:1", false)]   // NAT64 wrapping 127.0.0.1
    [InlineData("2001:db8::1", false)]
    public void IsPublic_AllowsOnlyPublicAddresses(string address, bool expected)
    {
        Assert.Equal(expected, PublicAddressGuard.IsPublic(IPAddress.Parse(address)));
    }

    [Theory]
    [InlineData("http://127.0.0.1:5432/")]
    [InlineData("http://localhost/rss")]
    [InlineData("http://[::1]/")]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    public async Task GuardedClient_RefusesPrivateAddresses(string url)
    {
        var fetcher = new NewsFetcher(new HttpClient(PublicAddressGuard.CreateHandler()));

        var ex = await Assert.ThrowsAsync<NewsFetchException>(() => fetcher.GetAsync(new Uri(url), CancellationToken.None));

        Assert.Contains("is not a public internet address", ex.Message);
    }

    [Theory]
    [InlineData("ftp://example.com/feed")]
    [InlineData("file:///etc/passwd")]
    public async Task GetAsync_RefusesOtherSchemes(string url)
    {
        var fetcher = new NewsFetcher(new HttpClient(new StubHandler(_ => throw new InvalidOperationException("no request expected"))));

        await Assert.ThrowsAsync<NewsFetchException>(() => fetcher.GetAsync(new Uri(url), CancellationToken.None));
    }

    [Fact]
    public async Task GetAsync_ReportsHttpErrorsForTheUser()
    {
        var fetcher = new NewsFetcher(new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound))));

        var ex = await Assert.ThrowsAsync<NewsFetchException>(() =>
            fetcher.GetAsync(new Uri("https://news.example.com/rss"), CancellationToken.None));

        Assert.Equal("news.example.com answered 404 Not Found.", ex.Message);
    }

    [Fact]
    public async Task GetAsync_RefusesOversizedBodies()
    {
        var body = new byte[NewsFetcher.MaxBytes + 1];
        // No Content-Length, so the limit has to hold while reading.
        var fetcher = new NewsFetcher(new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new MemoryStream(body))
        })));

        var ex = await Assert.ThrowsAsync<NewsFetchException>(() =>
            fetcher.GetAsync(new Uri("https://news.example.com/big"), CancellationToken.None));

        Assert.Contains("more than 5 MB", ex.Message);
    }

    [Fact]
    public async Task GetAsync_GivesUpOnABodyThatStallsAfterTheHeaders()
    {
        var fetcher = new NewsFetcher(
            new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(new BodyStream(stall: true)) })),
            TimeSpan.FromMilliseconds(200));

        var ex = await Assert.ThrowsAsync<NewsFetchException>(() =>
            fetcher.GetAsync(new Uri("https://news.example.com/slow"), CancellationToken.None));

        Assert.Equal("news.example.com took too long to answer.", ex.Message);
    }

    [Fact]
    public async Task GetAsync_ReportsABodyCutOffMidway()
    {
        var fetcher = new NewsFetcher(new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new BodyStream(stall: false))
        })));

        var ex = await Assert.ThrowsAsync<NewsFetchException>(() =>
            fetcher.GetAsync(new Uri("https://news.example.com/cut"), CancellationToken.None));

        Assert.StartsWith("Couldn't read the answer from news.example.com", ex.Message);
    }

    [Fact]
    public void DecodeText_UsesTheHeaderCharsetThenTheMetaTagThenUtf8()
    {
        var latin1Page = Encoding.Latin1.GetBytes("<html><head><meta charset=\"iso-8859-1\"></head><body>Manhã</body></html>");
        var windows1252 = Encoding.Latin1.GetBytes("Coração");
        var utf8 = Encoding.UTF8.GetBytes("Coração");
        var url = new Uri("https://news.example.com/");

        Assert.Contains("Manhã", new FetchedDocument(latin1Page, "text/html", null, url).DecodeText());
        Assert.Equal("Coração", new FetchedDocument(windows1252, "text/html", "windows-1252", url).DecodeText());
        Assert.Equal("Coração", new FetchedDocument(utf8, "text/html", null, url).DecodeText());
        Assert.Equal("Coração", new FetchedDocument([0xEF, 0xBB, 0xBF, .. utf8], "text/html", null, url).DecodeText());
    }

    // A response body that sends a few bytes and then either never sends more or breaks off.
    private sealed class BodyStream(bool stall) : Stream
    {
        private bool _sentStart;

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (!_sentStart)
            {
                _sentStart = true;
                buffer.Span[0] = (byte)'<';
                return 1;
            }
            if (!stall) throw new IOException("The response ended prematurely.");
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return 0;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    internal sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = respond(request);
            response.RequestMessage ??= request;
            return Task.FromResult(response);
        }
    }
}
