using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace LinguaReadApi.Services.News
{
    /// <summary>A downloaded feed or page: its bytes, declared charset and final address.</summary>
    public sealed record FetchedDocument(byte[] Body, string? MediaType, string? Charset, Uri FinalUrl)
    {
        /// <summary>
        /// The body as text: the charset from the Content-Type header, else a byte-order mark or a
        /// &lt;meta charset&gt; near the top, else UTF-8.
        /// </summary>
        public string DecodeText()
        {
            var encoding = NewsFetcher.EncodingFor(Charset)
                ?? (HasUtf8Bom(Body) ? Encoding.UTF8 : null)
                ?? NewsFetcher.EncodingFor(SniffMetaCharset(Body))
                ?? Encoding.UTF8;
            var text = encoding.GetString(Body);
            return text.Length > 0 && text[0] == '\uFEFF' ? text[1..] : text;
        }

        private static bool HasUtf8Bom(byte[] body) =>
            body.Length >= 3 && body[0] == 0xEF && body[1] == 0xBB && body[2] == 0xBF;

        private static readonly Regex MetaCharset = new(
            @"<meta[^>]+charset\s*=\s*[""']?\s*([A-Za-z0-9_\-:.]+)",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        private static string? SniffMetaCharset(byte[] body)
        {
            var head = Encoding.ASCII.GetString(body, 0, Math.Min(body.Length, 4096));
            var match = MetaCharset.Match(head);
            return match.Success ? match.Groups[1].Value : null;
        }
    }

    /// <summary>Why a feed or page couldn't be downloaded, worded for the user.</summary>
    public sealed class NewsFetchException : Exception
    {
        public NewsFetchException(string message, Exception? inner = null) : base(message, inner) { }
    }

    /// <summary>
    /// Downloads feeds and article pages for the news import. Registered as a typed HttpClient on
    /// <see cref="PublicAddressGuard.CreateHandler"/>, so it only reaches public addresses.
    /// </summary>
    public sealed class NewsFetcher
    {
        // Some sites refuse requests without a browser-like User-Agent.
        public const string UserAgent = "Mozilla/5.0 (compatible; LinguaRead/1.0; +https://github.com/semblable/Lingua_read2)";
        public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);
        public const int MaxBytes = 5 * 1024 * 1024;

        static NewsFetcher()
        {
            // windows-1252, iso-8859-15 and the like, which older Portuguese/French sites still use.
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        }

        private readonly HttpClient _http;

        public NewsFetcher(HttpClient http)
        {
            _http = http;
        }

        public static void ConfigureClient(HttpClient client)
        {
            client.Timeout = Timeout;
            client.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
            client.DefaultRequestHeaders.Accept.ParseAdd("application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5");
            client.DefaultRequestHeaders.AcceptLanguage.ParseAdd("*");
        }

        /// <summary>Downloads <paramref name="url"/>; throws <see cref="NewsFetchException"/> on any failure.</summary>
        public async Task<FetchedDocument> GetAsync(Uri url, CancellationToken cancellationToken)
        {
            if (!IsWebUrl(url))
            {
                throw new NewsFetchException("Only http:// and https:// addresses can be used.");
            }

            try
            {
                using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                if (!response.IsSuccessStatusCode)
                {
                    throw new NewsFetchException($"{url.Host} answered {(int)response.StatusCode} {response.ReasonPhrase}.".Replace(" .", "."));
                }
                if (response.Content.Headers.ContentLength > MaxBytes)
                {
                    throw new NewsFetchException($"{url.Host} sent more than {MaxBytes / (1024 * 1024)} MB.");
                }

                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var buffer = new MemoryStream();
                var chunk = new byte[81920];
                int read;
                while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
                {
                    if (buffer.Length + read > MaxBytes)
                    {
                        throw new NewsFetchException($"{url.Host} sent more than {MaxBytes / (1024 * 1024)} MB.");
                    }
                    buffer.Write(chunk, 0, read);
                }

                var contentType = response.Content.Headers.ContentType;
                return new FetchedDocument(
                    buffer.ToArray(),
                    contentType?.MediaType,
                    contentType?.CharSet?.Trim('"', '\''),
                    response.RequestMessage?.RequestUri ?? url);
            }
            catch (NewsFetchException)
            {
                throw;
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new NewsFetchException($"{url.Host} took too long to answer.");
            }
            catch (HttpRequestException ex)
            {
                // The innermost error says what went wrong: the guard's refusal (already worded for
                // the user) or a socket error ("No such host is known"), which gets the host added.
                var reason = ex.GetBaseException().Message;
                throw new NewsFetchException(
                    reason.Contains(url.Host, StringComparison.OrdinalIgnoreCase) ? reason : $"Couldn't reach {url.Host}: {reason}",
                    ex);
            }
        }

        public static bool IsWebUrl(Uri? url) =>
            url is { IsAbsoluteUri: true } && (url.Scheme == Uri.UriSchemeHttp || url.Scheme == Uri.UriSchemeHttps);

        internal static Encoding? EncodingFor(string? charset)
        {
            if (string.IsNullOrWhiteSpace(charset)) return null;
            try
            {
                return Encoding.GetEncoding(charset.Trim());
            }
            catch (ArgumentException)
            {
                return null;
            }
        }
    }
}
