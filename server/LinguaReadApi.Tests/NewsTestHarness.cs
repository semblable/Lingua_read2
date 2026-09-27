using System.Net;
using System.Security;
using System.Text;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.News;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;

namespace LinguaReadApi.Tests;

/// <summary>
/// A SQLite database (real foreign keys: deleting a feed or folder must unset or cascade), a fake
/// web the importer fetches from, and a clock the tests move.
/// </summary>
internal sealed class NewsTestHarness : IAsyncDisposable
{
    public static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OtherUserId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public const int PortugueseId = 1;
    public const int FrenchId = 2;
    public const string FeedUrl = "https://news.example.com/rss";

    private readonly SqliteConnection _keepAlive;

    public DbContextOptions<AppDbContext> Options { get; }
    public FakeWeb Web { get; } = new();
    public WordLinkingChannel Channel { get; } = new();
    public NewsFeedLocks Locks { get; } = new();
    public FakeTimeProvider Time { get; } = new(new DateTimeOffset(2026, 9, 27, 12, 0, 0, TimeSpan.Zero));

    private NewsTestHarness(SqliteConnection keepAlive, DbContextOptions<AppDbContext> options)
    {
        _keepAlive = keepAlive;
        Options = options;
    }

    public static async Task<NewsTestHarness> CreateAsync()
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = "news-" + Guid.NewGuid().ToString("N"),
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared,
        }.ToString();
        var keepAlive = new SqliteConnection(connectionString);
        await keepAlive.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connectionString).Options;

        await using (var context = new AppDbContext(options))
        {
            await context.Database.EnsureCreatedAsync();
            context.Users.Add(new User { Id = UserId, UserName = "reader", Email = "reader@example.com" });
            context.Users.Add(new User { Id = OtherUserId, UserName = "other", Email = "other@example.com" });
            context.Languages.Add(new Language { LanguageId = PortugueseId, Name = "Portuguese", Code = "pt" });
            context.Languages.Add(new Language { LanguageId = FrenchId, Name = "French", Code = "fr" });
            context.UserSettings.Add(new UserSettings { UserId = UserId, NewsImportEnabled = true });
            context.UserSettings.Add(new UserSettings { UserId = OtherUserId, NewsImportEnabled = true });
            await context.SaveChangesAsync();
        }
        return new NewsTestHarness(keepAlive, options);
    }

    public DateTime Now => Time.GetUtcNow().UtcDateTime;

    public AppDbContext NewContext() => new(Options);

    public NewsFetcher Fetcher() => new(new HttpClient(Web));

    public NewsFeedImporter Importer(AppDbContext context) =>
        new(context, Fetcher(), Channel, Locks, NullLogger<NewsFeedImporter>.Instance, Time);

    public async Task<NewsImportResult> ImportAsync(int feedId)
    {
        await using var context = NewContext();
        return await Importer(context).ImportAsync(feedId, CancellationToken.None);
    }

    public async Task<int> AddFeedAsync(string url = FeedUrl, string title = "Notícias", Guid? userId = null, bool enabled = true, int languageId = PortugueseId)
    {
        await using var context = NewContext();
        var feed = new NewsFeed { UserId = userId ?? UserId, Url = url, Title = title, LanguageId = languageId, Enabled = enabled, CreatedAt = Now };
        context.NewsFeeds.Add(feed);
        await context.SaveChangesAsync();
        return feed.NewsFeedId;
    }

    public List<WordLinkingRequest> DrainLinkingQueue()
    {
        var requests = new List<WordLinkingRequest>();
        while (Channel.Reader.TryRead(out var request)) requests.Add(request);
        return requests;
    }

    public async ValueTask DisposeAsync()
    {
        await _keepAlive.DisposeAsync();
    }

    // ---- content ----

    public sealed record Item(string Title, string Link, DateTimeOffset Published, string? ContentHtml = null, string? Guid = null);

    public static string Rss(string title, params Item[] items)
    {
        var body = new StringBuilder();
        body.Append("""<?xml version="1.0" encoding="utf-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>""");
        body.Append($"<title>{SecurityElement.Escape(title)}</title><link>https://news.example.com/</link>");
        foreach (var item in items)
        {
            body.Append("<item>");
            body.Append($"<title>{SecurityElement.Escape(item.Title)}</title><link>{SecurityElement.Escape(item.Link)}</link>");
            if (item.Guid != null) body.Append($"<guid isPermaLink=\"false\">{SecurityElement.Escape(item.Guid)}</guid>");
            body.Append($"<pubDate>{item.Published:R}</pubDate>");
            if (item.ContentHtml != null) body.Append($"<content:encoded><![CDATA[{item.ContentHtml}]]></content:encoded>");
            body.Append("</item>");
        }
        body.Append("</channel></rss>");
        return body.ToString();
    }

    /// <summary>A news page whose article has <paramref name="paragraphs"/> paragraphs of about 20 words.</summary>
    public static string ArticlePage(string headline, int paragraphs = 8) =>
        $"""
        <!DOCTYPE html><html lang="pt"><head><title>{headline} | Jornal</title></head><body>
        <header><nav><a href="/">Início</a> <a href="/mundo">Mundo</a></nav></header>
        <main><article><h1>{headline}</h1>
        {ArticleBody(headline, paragraphs)}
        </article></main>
        <footer><p>Todos os direitos reservados.</p></footer>
        </body></html>
        """;

    public static string ArticleBody(string headline, int paragraphs) =>
        string.Concat(Enumerable.Range(1, paragraphs).Select(i =>
            $"<p>{headline}: parágrafo {i} da reportagem, com frases completas sobre o assunto e palavras suficientes para contar como texto.</p>"));
}

/// <summary>Serves registered URLs; anything else is a 404. Records every request.</summary>
internal sealed class FakeWeb : HttpMessageHandler
{
    private readonly Dictionary<string, Func<HttpResponseMessage>> _routes = new();

    public List<string> Requests { get; } = new();

    public void Serve(string url, string body, string mediaType = "text/html") =>
        _routes[url] = () => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, mediaType)
        };

    public void ServeFeed(string url, string xml) => Serve(url, xml, "application/rss+xml");

    public void Fail(string url, HttpStatusCode status) =>
        _routes[url] = () => new HttpResponseMessage(status);

    public int RequestsTo(string url) => Requests.Count(r => r == url);

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var url = request.RequestUri!.AbsoluteUri;
        Requests.Add(url);
        var response = _routes.TryGetValue(url, out var respond) ? respond() : new HttpResponseMessage(HttpStatusCode.NotFound);
        response.RequestMessage = request;
        return Task.FromResult(response);
    }
}
