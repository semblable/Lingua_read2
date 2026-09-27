using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.News;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using static LinguaReadApi.Tests.NewsTestHarness;

namespace LinguaReadApi.Tests;

/// <summary>
/// Each new news article's lead photo: picked from the page, the feed or the article, downloaded
/// through the guarded fetcher, stored as epub_assets/{userId}/news/{textId}{ext}, shown above
/// the text through StructuredContent, and deleted with the text.
/// </summary>
public class NewsLeadPhotoTests
{
    private const string ArticleUrl = "https://news.example.com/artigo";
    private static readonly Uri PageUrl = new(ArticleUrl);

    // ---- what counts as a picture ----

    [Theory]
    [InlineData("FFD8FFE000104A464946", ".jpg")]
    [InlineData("89504E470D0A1A0A0000000D49484452", ".png")]
    [InlineData("474946383761", ".gif")]
    [InlineData("474946383961", ".gif")]
    [InlineData("52494646240000005745425056503820", ".webp")]
    [InlineData("0000001C66747970617669660000000061766966" + "6D6966316D696166", ".avif")] // brand avif
    [InlineData("00000020667479706D69663100000000" + "6D696631617669666D6961664D413142", ".avif")] // mif1, compatible with avif
    [InlineData("000000186674797068656963000000006D69663168656963", null)] // HEIC: same box, no avif brand
    [InlineData("524946462400000057415645666D7420", null)] // a WAV file is RIFF too
    [InlineData("3C737667786D6C6E733D", null)] // <svg: could carry script
    [InlineData("3C21444F43545950452068746D6C3E", null)] // an HTML error page
    [InlineData("", null)]
    public void ExtensionFor_GoesByTheBytes(string hex, string? expected)
    {
        Assert.Equal(expected, LeadImage.ExtensionFor(Convert.FromHexString(hex)));
    }

    [Fact]
    public void FromMetadata_TakesOgImageThenTwitterImage_DecodedAndResolved()
    {
        // RTP writes the &amp; between its og:image parameters; the address needs the plain &.
        var html = """
            <html><head>
            <meta property="og:image" content="/icm/images/18/1849?q=90&amp;rect=0,0,1920,1080&amp;auto=format" />
            <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg">
            <meta property="og:image:secure_url" content="/icm/images/18/1849?q=90&amp;rect=0,0,1920,1080&amp;auto=format" />
            <meta property="og:title" content="Not a picture">
            </head><body></body></html>
            """;

        var candidates = LeadImage.FromMetadata(html, PageUrl, featuredImage: null);

        Assert.Equal(
            ["https://news.example.com/icm/images/18/1849?q=90&rect=0,0,1920,1080&auto=format", "https://cdn.example.com/twitter.jpg"],
            candidates.Select(c => c.Url.AbsoluteUri));
    }

    [Fact]
    public void FromMetadata_PutsSmartReadersFeaturedImageFirst_DecodingItToo()
    {
        var html = """<html><head><meta property="og:image" content="https://cdn.example.com/og.jpg"></head></html>""";

        var candidates = LeadImage.FromMetadata(html, PageUrl, "https://cdn.example.com/featured.jpg?w=860&amp;q=90");

        Assert.Equal(
            ["https://cdn.example.com/featured.jpg?w=860&q=90", "https://cdn.example.com/og.jpg"],
            candidates.Select(c => c.Url.AbsoluteUri));
    }

    [Theory]
    [InlineData("Ministros em sessão plenária do Supremo", "Ministros em sessão plenária do Supremo")] // BBC
    [InlineData("Casey Revkin, sorrindo &amp; acenando", "Casey Revkin, sorrindo & acenando")]
    [InlineData("image name", null)] // RTP's stand-in
    [InlineData("Uma manchete sobre a crise", null)] // the headline again
    public void FromMetadata_CaptionsWithTheAltText_WhenItSaysSomething(string alt, string? expected)
    {
        var html = $"""
            <html><head><meta property="og:image" content="https://cdn.example.com/og.jpg">
            <meta property="og:image:alt" content="{alt}"></head></html>
            """;

        var candidates = LeadImage.FromMetadata(html, PageUrl, null, "Uma manchete sobre a crise");

        Assert.Equal(expected, Assert.Single(candidates).Caption);
    }

    [Fact]
    public void FirstInHtml_SkipsPicturesDeclaredTiny_AndTakesTheFiguresCaption()
    {
        var html = """
            <p><img src="/pixel.gif" width="1" height="1"></p>
            <figure><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/fotos/lead.jpg" alt="Texto alternativo da foto">
              <figcaption>Moradores protestam em frente à câmara municipal</figcaption></figure>
            <img src="/fotos/second.jpg">
            """;

        var candidate = LeadImage.FirstInHtml(html, PageUrl);

        Assert.Equal("https://news.example.com/fotos/lead.jpg", candidate!.Url.AbsoluteUri);
        Assert.Equal("Moradores protestam em frente à câmara municipal", candidate.Caption);
        Assert.Equal("Texto alternativo da foto", LeadImage.FirstInHtml("""<img src="/a.jpg" alt="Texto alternativo da foto">""", PageUrl)!.Caption);
        Assert.Null(LeadImage.FirstInHtml("<p>Sem fotos.</p>", PageUrl));
    }

    [Fact]
    public void Candidates_ThePagesChoice_ThenTheFeeds_ThenTheArticles_WithoutStandInsOrRepeats()
    {
        var article = new ExtractedArticle("Título", ["Um parágrafo."])
        {
            MetadataImages =
            [
                new(new Uri("https://cdn.example.com/noticias/images/antena1_default.png?w=860")),
                new(new Uri("https://cdn.example.com/og.jpg"), "Legenda da foto principal")
            ],
            FirstBodyImage = new(new Uri("https://cdn.example.com/body.jpg"))
        };
        var entry = new FeedEntry("key", PageUrl, "Título", null, null, new Uri("https://cdn.example.com/feed.jpg"));

        var candidates = LeadImage.Candidates(article, entry);

        Assert.Equal(
            ["https://cdn.example.com/og.jpg", "https://cdn.example.com/feed.jpg", "https://cdn.example.com/body.jpg"],
            candidates.Select(c => c.Url.AbsoluteUri));
        Assert.Equal("Legenda da foto principal", candidates[0].Caption);

        // The feed naming the page's picture again doesn't make it a second try.
        var same = LeadImage.Candidates(article, entry with { ImageUrl = new Uri("https://cdn.example.com/og.jpg") });
        Assert.Equal(2, same.Count);
    }

    [Theory]
    [InlineData("https://cdn.example.com/noticias/images/antena1_default.png?w=860", true)]
    [InlineData("https://cdn.example.com/static/logo.png", true)]
    [InlineData("https://cdn.example.com/img/site-logo-share.jpg", true)]
    [InlineData("https://cdn.example.com/img/placeholder.jpg", true)]
    [InlineData("https://cdn.example.com/2026/09/logotipo-da-empresa.jpg", false)]
    [InlineData("https://cdn.example.com/2026/09/defaults.jpg", false)]
    [InlineData("https://cdn.example.com/default/2026/foto.jpg", false)] // only the file name counts
    public void IsPlaceholder_SpotsStandInPictures(string url, bool expected)
    {
        Assert.Equal(expected, LeadImage.IsPlaceholder(new Uri(url)));
    }

    // ---- importing ----

    [Fact]
    public async Task Import_StoresTheLeadPhoto_AndShowsItAboveTheUnchangedText()
    {
        await using var h = await CreateAsync();
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", new Item("Com foto", ArticleUrl, h.Time.GetUtcNow())));
        h.Web.Serve(ArticleUrl, ArticlePage("Com foto", head: """
            <meta property="og:image" content="https://img.example.com/lead.jpg?w=860&amp;q=90">
            <meta property="og:image:alt" content="Moradores protestam em frente à câmara">
            """));
        var photo = Jpeg();
        // The header says nothing useful; the bytes decide.
        h.Web.ServeBytes("https://img.example.com/lead.jpg?w=860&q=90", photo, "application/octet-stream");
        var feedId = await h.AddFeedAsync();

        var result = await h.ImportAsync(feedId);

        Assert.Equal(1, result.Imported);
        await using var context = h.NewContext();
        var text = await context.Texts.SingleAsync();
        Assert.Equal(photo, await File.ReadAllBytesAsync(h.NewsImagePath(text.TextId)));

        // Content is what it would be without the photo: word linking and stats read it.
        Assert.Equal(ArticleExtractor.FromPage(ArticlePage("Com foto"), PageUrl, "Com foto").Content, text.Content);
        Assert.Equal(text.Content, Assert.Single(h.DrainLinkingQueue()).Content);

        // The EPUB import's block shape: camelCase, the photo first, then one block per paragraph.
        using var json = JsonDocument.Parse(text.StructuredContent!);
        var blocks = json.RootElement.EnumerateArray().ToList();
        Assert.Equal("image", blocks[0].GetProperty("type").GetString());
        Assert.Equal($"epub_assets/{UserId}/news/{text.TextId}.jpg", blocks[0].GetProperty("imageUrl").GetString());
        Assert.Equal("Moradores protestam em frente à câmara", blocks[0].GetProperty("caption").GetString());
        Assert.All(blocks.Skip(1), block => Assert.Equal("paragraph", block.GetProperty("type").GetString()));
        Assert.Equal(text.Content, string.Join("\n\n", blocks.Skip(1).Select(block => block.GetProperty("text").GetString())));

        // And it reads back the way GET /api/texts/{id} deserializes it.
        var read = JsonSerializer.Deserialize<List<ReaderContentBlock>>(text.StructuredContent!, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(ReaderContentBlockTypes.Image, read[0].Type);
        Assert.Equal(text.Content.Split("\n\n"), read.Skip(1).Select(block => block.Text));
    }

    [Fact]
    public async Task Import_FallsBackToTheFeedsPicture_WhenThePagesFails()
    {
        await using var h = await CreateAsync();
        var item = new Item("Sem og", ArticleUrl, h.Time.GetUtcNow(),
            MediaXml: """<media:content url="https://img.example.com/feed.jpg" medium="image"/>""");
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", item));
        h.Web.Serve(ArticleUrl, ArticlePage("Sem og", head: """<meta property="og:image" content="https://img.example.com/missing.jpg">"""));
        h.Web.ServeBytes("https://img.example.com/feed.jpg", Jpeg(), "image/jpeg");
        var feedId = await h.AddFeedAsync();

        await h.ImportAsync(feedId);

        await using var context = h.NewContext();
        var text = await context.Texts.SingleAsync();
        Assert.Equal(1, h.Web.RequestsTo("https://img.example.com/missing.jpg"));
        Assert.True(File.Exists(h.NewsImagePath(text.TextId)));
        Assert.Contains("\"caption\":null", text.StructuredContent);
    }

    [Fact]
    public async Task Import_FallsBackToTheArticlesFirstPicture()
    {
        await using var h = await CreateAsync();
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", new Item("Só no texto", ArticleUrl, h.Time.GetUtcNow())));
        h.Web.Serve(ArticleUrl, ArticlePage("Só no texto", lead: """
            <figure><img src="/fotos/lead.png"><figcaption>Moradores protestam em frente à câmara municipal</figcaption></figure>
            """));
        h.Web.ServeBytes("https://news.example.com/fotos/lead.png", [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. new byte[2048]], "image/png");
        var feedId = await h.AddFeedAsync();

        await h.ImportAsync(feedId);

        await using var context = h.NewContext();
        var text = await context.Texts.SingleAsync();
        Assert.True(File.Exists(h.NewsImagePath(text.TextId, ".png")));
        var image = JsonSerializer.Deserialize<List<ReaderContentBlock>>(text.StructuredContent!, new JsonSerializerOptions(JsonSerializerDefaults.Web))![0];
        Assert.Equal($"epub_assets/{UserId}/news/{text.TextId}.png", image.ImageUrl);
        Assert.Equal("Moradores protestam em frente à câmara municipal", image.Caption);
        // The caption is the photo's, not part of the text.
        Assert.DoesNotContain("Moradores protestam", text.Content);
    }

    [Fact]
    public async Task Import_TakesThePictureOfAFeedsFullText_WithoutFetchingThePage()
    {
        await using var h = await CreateAsync();
        var html = """<p><img src="https://img.example.com/wp.webp" width="1200" height="675"></p>""" + ArticleBody("Completo", 8);
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", new Item("Completo", ArticleUrl, h.Time.GetUtcNow(), ContentHtml: html)));
        h.Web.ServeBytes("https://img.example.com/wp.webp", [.. "RIFF"u8, 0x24, 0, 0, 0, .. "WEBPVP8 "u8, .. new byte[2048]], "image/webp");
        var feedId = await h.AddFeedAsync();

        await h.ImportAsync(feedId);

        await using var context = h.NewContext();
        var text = await context.Texts.SingleAsync();
        Assert.True(File.Exists(h.NewsImagePath(text.TextId, ".webp")));
        Assert.Equal(0, h.Web.RequestsTo(ArticleUrl));
    }

    [Fact]
    public async Task Import_KeepsTheArticleWithoutAPhoto_WhenNoPictureWillDo()
    {
        await using var h = await CreateAsync();
        var item = new Item("Nada serve", ArticleUrl, h.Time.GetUtcNow(),
            MediaXml: """<media:content url="https://img.example.com/huge.jpg" medium="image"/>""");
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", item));
        h.Web.Serve(ArticleUrl, ArticlePage("Nada serve",
            head: """<meta property="og:image" content="https://img.example.com/error-page.jpg">""",
            lead: """<img src="/pixel.gif">"""));
        // An HTML error page served as the picture, one over the size cap, and a tracking pixel.
        h.Web.Serve("https://img.example.com/error-page.jpg", "<html><body>Not found</body></html>", "image/jpeg");
        h.Web.ServeBytes("https://img.example.com/huge.jpg", Jpeg(LeadImage.MaxBytes + 1), "image/jpeg");
        h.Web.ServeBytes("https://news.example.com/pixel.gif", [.. "GIF89a"u8, .. new byte[37]], "image/gif");
        var feedId = await h.AddFeedAsync();

        var result = await h.ImportAsync(feedId);

        Assert.Equal(1, result.Imported);
        Assert.Equal(1, h.Web.RequestsTo("https://news.example.com/pixel.gif"));
        await using var context = h.NewContext();
        var text = await context.Texts.SingleAsync();
        Assert.Null(text.StructuredContent);
        Assert.StartsWith("Nada serve: parágrafo 1", text.Content);
        Assert.False(Directory.Exists(Path.Combine(h.WebRoot, "epub_assets")));
        Assert.Single(h.DrainLinkingQueue());
    }

    [Fact]
    public async Task Import_StillImportsTheArticle_WhenThePhotoCantBeWritten()
    {
        await using var h = await CreateAsync();
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", new Item("Disco cheio", ArticleUrl, h.Time.GetUtcNow())));
        h.Web.Serve(ArticleUrl, ArticlePage("Disco cheio", head: """<meta property="og:image" content="https://img.example.com/lead.jpg">"""));
        h.Web.ServeBytes("https://img.example.com/lead.jpg", Jpeg(), "image/jpeg");
        var feedId = await h.AddFeedAsync();
        // A file where the photo folder would go: creating the folder fails.
        var blocked = Path.Combine(h.WebRoot, "blocked");
        await File.WriteAllTextAsync(blocked, "not a folder");

        await using var context = h.NewContext();
        var importer = new NewsFeedImporter(context, h.Fetcher(), h.Channel, h.Locks, NullLogger<NewsFeedImporter>.Instance, h.Time) { WebRoot = blocked };
        var result = await importer.ImportAsync(feedId, CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(1, result.Imported);
        await using var check = h.NewContext();
        var text = await check.Texts.SingleAsync();
        Assert.Null(text.StructuredContent);
        Assert.Single(h.DrainLinkingQueue());
    }

    [Fact]
    public async Task Import_CancelledDuringThePhoto_LeavesTheArticleForTheNextCheck()
    {
        await using var h = await CreateAsync();
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", new Item("Interrompido", ArticleUrl, h.Time.GetUtcNow())));
        h.Web.Serve(ArticleUrl, ArticlePage("Interrompido", head: """<meta property="og:image" content="https://img.example.com/lead.jpg">"""));
        var feedId = await h.AddFeedAsync();
        // The feed's first import makes its folder, which saves. The check is then cancelled while
        // the photo downloads (an aborted "Fetch now", the app shutting down).
        using var cts = new CancellationTokenSource();
        h.Web.Throw("https://img.example.com/lead.jpg", new OperationCanceledException(cts.Token));
        var cancelOnPhoto = new CancellingWeb(h.Web, "https://img.example.com/lead.jpg", cts);

        await using (var context = h.NewContext())
        {
            var importer = new NewsFeedImporter(context, new NewsFetcher(new HttpClient(cancelOnPhoto)), h.Channel, h.Locks,
                NullLogger<NewsFeedImporter>.Instance, h.Time) { WebRoot = h.WebRoot };
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => importer.ImportAsync(feedId, cts.Token));
        }

        await using (var check = h.NewContext())
        {
            Assert.Empty(await check.Texts.ToListAsync());
            // Not marked imported without a text: it would be skipped for good and count toward the day's limit.
            Assert.False(await check.NewsFeedItems.AnyAsync(i => i.Imported));
        }

        h.Web.ServeBytes("https://img.example.com/lead.jpg", Jpeg(), "image/jpeg");
        var result = await h.ImportAsync(feedId);

        Assert.Equal(1, result.Imported);
        await using var after = h.NewContext();
        Assert.Equal("Interrompido", (await after.Texts.SingleAsync()).Title);
    }

    // Cancels the check's token when the given address is requested, then answers as the fake web would.
    private sealed class CancellingWeb(FakeWeb web, string url, CancellationTokenSource cts) : DelegatingHandler(web)
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri!.AbsoluteUri == url) cts.Cancel();
            return base.SendAsync(request, cancellationToken);
        }
    }

    // ---- deleting ----

    [Fact]
    public async Task DeleteText_DeletesTheArticlesPhoto()
    {
        await using var h = await CreateAsync();
        var textId = await AddArticleWithPhotoAsync(h, "Uma");
        var keptId = await AddArticleWithPhotoAsync(h, "Outra");

        await using var context = h.NewContext();
        var result = await CreateTextsController(h, context).DeleteText(textId);

        Assert.IsType<NoContentResult>(result);
        Assert.False(File.Exists(h.NewsImagePath(textId)));
        Assert.True(File.Exists(h.NewsImagePath(keptId)));
    }

    [Fact]
    public async Task DeleteItems_DeletesThePhotosOfTheTextsItDeletes_AndNoOneElses()
    {
        await using var h = await CreateAsync();
        var deletedId = await AddArticleWithPhotoAsync(h, "Apagada");
        var keptId = await AddArticleWithPhotoAsync(h, "Mantida");
        var othersId = await AddArticleWithPhotoAsync(h, "De outro", userId: OtherUserId);

        await using var context = h.NewContext();
        var controller = WithUser(new FoldersController(context, NullLogger<FoldersController>.Instance) { WebRoot = h.WebRoot }, UserId);
        var result = await controller.DeleteItems(textIds: $"{deletedId},{othersId}");

        Assert.IsType<NoContentResult>(result);
        Assert.False(File.Exists(h.NewsImagePath(deletedId)));
        Assert.True(File.Exists(h.NewsImagePath(keptId)));
        Assert.True(File.Exists(h.NewsImagePath(othersId, userId: OtherUserId)));
    }

    [Fact]
    public async Task DeleteUnopenedArticles_DeletesTheirPhotos()
    {
        await using var h = await CreateAsync();
        var feedId = await h.AddFeedAsync();
        var staleId = await AddArticleWithPhotoAsync(h, "Velha", feedId: feedId, createdAt: h.Now.AddDays(-15));
        var recentId = await AddArticleWithPhotoAsync(h, "Recente", feedId: feedId, createdAt: h.Now.AddDays(-2));

        await using var context = h.NewContext();
        Assert.Equal(1, await h.Importer(context).DeleteUnopenedArticlesAsync(UserId, 14, CancellationToken.None));

        Assert.False(File.Exists(h.NewsImagePath(staleId)));
        Assert.True(File.Exists(h.NewsImagePath(recentId)));
    }

    [Fact]
    public async Task ResetLanguageContent_DeletesThePhotosOfThatLanguagesArticles()
    {
        await using var h = await CreateAsync();
        var portugueseId = await AddArticleWithPhotoAsync(h, "Em português");
        var frenchId = await AddArticleWithPhotoAsync(h, "En français", languageId: FrenchId);
        var othersId = await AddArticleWithPhotoAsync(h, "De outro", userId: OtherUserId);

        await using var context = h.NewContext();
        var service = new LanguageService(context, new MemoryCache(new MemoryCacheOptions())) { WebRoot = h.WebRoot };
        Assert.True(await service.ResetLanguageContentAsync(PortugueseId, UserId));

        Assert.False(File.Exists(h.NewsImagePath(portugueseId)));
        Assert.True(File.Exists(h.NewsImagePath(frenchId)));
        Assert.True(File.Exists(h.NewsImagePath(othersId, userId: OtherUserId)));
    }

    // An imported article with its photo on disk, as the importer leaves it.
    private static async Task<int> AddArticleWithPhotoAsync(
        NewsTestHarness h, string title, Guid? userId = null, int languageId = PortugueseId, int? feedId = null, DateTime? createdAt = null)
    {
        await using var context = h.NewContext();
        var text = new Text
        {
            Title = title, Content = "Texto da notícia.", LanguageId = languageId, UserId = userId ?? UserId,
            CreatedAt = createdAt ?? h.Now, NewsFeedId = feedId
        };
        context.Texts.Add(text);
        await context.SaveChangesAsync();
        var path = h.NewsImagePath(text.TextId, userId: userId);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllBytesAsync(path, Jpeg());
        return text.TextId;
    }

    private static TextsController CreateTextsController(NewsTestHarness h, AppDbContext context)
    {
        var services = new ServiceCollection();
        services.AddSingleton(context);
        var stats = new StatsRecomputeService(services.BuildServiceProvider(), NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        var activity = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        return WithUser(new TextsController(context, NullLogger<TextsController>.Instance, activity, new WordLinkingChannel(), stats) { WebRoot = h.WebRoot }, UserId);
    }

    private static T WithUser<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "TestAuth"))
            }
        };
        return controller;
    }
}
