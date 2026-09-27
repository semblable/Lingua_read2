using System.Net;
using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Services.News;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;
using static LinguaReadApi.Tests.NewsTestHarness;

namespace LinguaReadApi.Tests;

/// <summary>
/// Choosing articles: the feed's entries with what the import made of each, and importing the ones
/// the user picked, whatever the daily limit.
/// </summary>
public class NewsFeedBrowseTests
{
    // Newest first: a teaser too short to import, then five long articles.
    private static Item[] Articles(NewsTestHarness h) =>
    [
        new("Curto", "https://news.example.com/curto", h.Time.GetUtcNow().AddMinutes(-30), Description: "Só um parágrafo."),
        new("Um", "https://news.example.com/1", h.Time.GetUtcNow().AddHours(-1)),
        new("Dois", "https://news.example.com/2", h.Time.GetUtcNow().AddHours(-2)),
        new("Três", "https://news.example.com/3", h.Time.GetUtcNow().AddHours(-3)),
        new("Quatro", "https://news.example.com/4", h.Time.GetUtcNow().AddHours(-4)),
        new("Cinco", "https://news.example.com/5", h.Time.GetUtcNow().AddHours(-5)),
    ];

    private static void Serve(NewsTestHarness h, Item[] items)
    {
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", items));
        foreach (var item in items)
        {
            h.Web.Serve(item.Link, ArticlePage(item.Title, paragraphs: item.Title == "Curto" ? 2 : 8));
        }
    }

    private static string Key(string link) => NewsFeedImporter.HashKey(link);

    private static async Task<IReadOnlyList<NewsFeedEntryInfo>> BrowseAsync(NewsTestHarness h, int feedId)
    {
        await using var context = h.NewContext();
        return await h.Importer(context).BrowseAsync(feedId, CancellationToken.None);
    }

    private static async Task<NewsImportResult> ImportSelectedAsync(NewsTestHarness h, int feedId, params string[] links)
    {
        await using var context = h.NewContext();
        return await h.Importer(context).ImportSelectedAsync(feedId, links.Select(Key).ToList(), CancellationToken.None);
    }

    [Fact]
    public async Task Browse_ListsTheEntriesNewestFirst_WithWhatTheImportMadeOfEach()
    {
        await using var h = await CreateAsync();
        Serve(h, Articles(h));
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId); // skips Curto, imports Um, Dois, Três (the daily 3)
        DateTime? checkedAt;
        int items;
        await using (var context = h.NewContext())
        {
            checkedAt = (await context.NewsFeeds.SingleAsync()).LastCheckedAt;
            items = await context.NewsFeedItems.CountAsync();
        }
        h.Time.Advance(TimeSpan.FromMinutes(5));

        var entries = await BrowseAsync(h, feedId);

        Assert.Equal(["Curto", "Um", "Dois", "Três", "Quatro", "Cinco"], entries.Select(e => e.Title));
        Assert.Equal(
            [NewsEntryStatus.Skipped, NewsEntryStatus.Imported, NewsEntryStatus.Imported, NewsEntryStatus.Imported, NewsEntryStatus.New, NewsEntryStatus.New],
            entries.Select(e => e.Status));
        Assert.Equal(Key("https://news.example.com/4"), entries[4].Key);
        Assert.Equal("https://news.example.com/4", entries[4].Link);
        Assert.Equal("Só um parágrafo.", entries[0].Summary);
        Assert.Equal(h.Time.GetUtcNow().AddHours(-1).AddMinutes(-5), entries[1].PublishedAt!.Value, TimeSpan.FromSeconds(1));

        // Imported entries point at their article.
        await using (var context = h.NewContext())
        {
            var textIds = await context.Texts.ToDictionaryAsync(t => t.Title, t => t.TextId);
            Assert.Equal(textIds["Um"], entries[1].TextId);
            Assert.Equal(textIds["Três"], entries[3].TextId);
            Assert.Null(entries[0].TextId);
            Assert.Null(entries[4].TextId);

            // Browsing changes nothing: no entries recorded, the check schedule untouched.
            Assert.Equal(items, await context.NewsFeedItems.CountAsync());
            Assert.Equal(checkedAt, (await context.NewsFeeds.SingleAsync()).LastCheckedAt);
        }
    }

    [Fact]
    public async Task Browse_AnImportedArticleTheUserDeleted_HasNoTextAnyMore()
    {
        await using var h = await CreateAsync();
        Serve(h, Articles(h));
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId);
        await using (var context = h.NewContext())
        {
            context.Texts.Remove(await context.Texts.SingleAsync(t => t.Title == "Um"));
            await context.SaveChangesAsync();
        }

        var um = (await BrowseAsync(h, feedId)).Single(e => e.Title == "Um");

        Assert.Equal(NewsEntryStatus.Imported, um.Status);
        Assert.Null(um.TextId);
    }

    [Fact]
    public async Task Browse_ThrowsWhenTheFeedCantBeLoaded()
    {
        await using var h = await CreateAsync();
        h.Web.Fail(FeedUrl, HttpStatusCode.ServiceUnavailable);
        var feedId = await h.AddFeedAsync();

        var ex = await Assert.ThrowsAsync<NewsFetchException>(() => BrowseAsync(h, feedId));

        Assert.Contains("503", ex.Message);
    }

    [Fact]
    public async Task ImportSelected_ImportsThePicksPastTheDailyLimit_AndRetriesASkippedOne()
    {
        await using var h = await CreateAsync();
        var articles = Articles(h);
        Serve(h, articles);
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId); // the daily 3 are used up; Curto was skipped
        h.DrainLinkingQueue();
        // Curto's page now has the whole article.
        h.Web.Serve("https://news.example.com/curto", ArticlePage("Curto"));
        h.Time.Advance(TimeSpan.FromMinutes(10));

        var result = await ImportSelectedAsync(h, feedId,
            "https://news.example.com/5", "https://news.example.com/curto", "https://news.example.com/4",
            "https://news.example.com/1", "https://news.example.com/gone");

        Assert.True(result.Success);
        Assert.Equal(3, result.Imported);
        Assert.Equal("Imported 3 articles. 1 is no longer in the feed.", result.Message);
        var outcomes = result.Entries!.ToDictionary(e => e.Key);
        Assert.Equal(NewsEntryStatus.Imported, outcomes[Key("https://news.example.com/curto")].Status);
        Assert.Equal(NewsEntryStatus.AlreadyImported, outcomes[Key("https://news.example.com/1")].Status);
        Assert.Equal(NewsEntryStatus.NotInFeed, outcomes[Key("https://news.example.com/gone")].Status);

        await using var context = h.NewContext();
        var texts = await context.Texts.OrderBy(t => t.SortOrder).ToListAsync();
        // The picks go on top of the folder, newest first, above the earlier imports.
        Assert.Equal(["Curto", "Quatro", "Cinco", "Um", "Dois", "Três"], texts.Select(t => t.Title));
        Assert.Single(texts, t => t.Title == "Um"); // not imported twice
        Assert.All(texts, t => Assert.Equal(texts[0].FolderId, t.FolderId));
        Assert.Equal(texts.Single(t => t.Title == "Quatro").TextId, outcomes[Key("https://news.example.com/4")].TextId);
        Assert.Equal(3, h.DrainLinkingQueue().Count);

        // Every pick is now an imported entry (Curto's skipped one was updated, not duplicated),
        // and all count toward the last 24 hours.
        Assert.Equal(6, await context.NewsFeedItems.CountAsync());
        Assert.Equal(6, await context.NewsFeedItems.CountAsync(i => i.Imported));
        var curto = await context.NewsFeedItems.SingleAsync(i => i.ItemKey == Key("https://news.example.com/curto"));
        Assert.Equal(h.Now, curto.FirstSeenAt);
    }

    [Fact]
    public async Task ImportSelected_ReportsAnArticleThatIsStillTooShort()
    {
        await using var h = await CreateAsync();
        Serve(h, Articles(h));
        var feedId = await h.AddFeedAsync();

        var result = await ImportSelectedAsync(h, feedId, "https://news.example.com/curto");

        Assert.True(result.Success);
        Assert.Equal(0, result.Imported);
        Assert.Equal("Nothing imported. Skipped 1 that was too short or couldn't be read.", result.Message);
        Assert.Equal(NewsEntryStatus.Skipped, Assert.Single(result.Entries!).Status);
        await using var context = h.NewContext();
        Assert.Empty(await context.Texts.ToListAsync());
        Assert.False((await context.NewsFeedItems.SingleAsync()).Imported);
    }

    [Fact]
    public async Task ImportSelected_OnlyAlreadyImportedPicks_SaysSo()
    {
        await using var h = await CreateAsync();
        Serve(h, Articles(h));
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId);

        var result = await ImportSelectedAsync(h, feedId, "https://news.example.com/1");

        Assert.Equal(0, result.Imported);
        Assert.Equal("Those articles are already imported.", result.Message);
    }

    [Fact]
    public async Task ImportSelected_StoresTheLeadPhotoAndShowsItOnTheCard()
    {
        await using var h = await CreateAsync();
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", new Item("Com foto", "https://news.example.com/foto", h.Time.GetUtcNow())));
        h.Web.Serve("https://news.example.com/foto", ArticlePage("Com foto", head: """<meta property="og:image" content="https://img.example.com/lead.png">"""));
        h.Web.ServeBytes("https://img.example.com/lead.png", [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, .. new byte[2048]], "image/png");
        var feedId = await h.AddFeedAsync();

        await ImportSelectedAsync(h, feedId, "https://news.example.com/foto");

        await using var context = h.NewContext();
        var text = await context.Texts.SingleAsync();
        Assert.Equal($"epub_assets/{UserId}/news/{text.TextId}.png", text.ImagePath);
        Assert.Contains(text.ImagePath!, text.StructuredContent);
        Assert.True(File.Exists(h.NewsImagePath(text.TextId, ".png")));
    }

    [Fact]
    public async Task ImportSelected_ReturnsAtOnce_WhenTheFeedIsBeingChecked()
    {
        await using var h = await CreateAsync();
        Serve(h, Articles(h));
        var feedId = await h.AddFeedAsync();
        await h.Locks.For(feedId).WaitAsync();

        var result = await ImportSelectedAsync(h, feedId, "https://news.example.com/4");

        Assert.False(result.Success);
        Assert.Contains("being checked right now", result.Message);
        Assert.Empty(h.Web.Requests);
        h.Locks.For(feedId).Release();
    }

    [Fact]
    public async Task ImportSelected_AFeedThatFails_LeavesTheFeedsCheckStatusAlone()
    {
        await using var h = await CreateAsync();
        h.Web.Fail(FeedUrl, HttpStatusCode.NotFound);
        var feedId = await h.AddFeedAsync();

        var result = await ImportSelectedAsync(h, feedId, "https://news.example.com/4");

        Assert.False(result.Success);
        Assert.Contains("404", result.Message);
        await using var context = h.NewContext();
        var feed = await context.NewsFeeds.SingleAsync();
        Assert.Null(feed.LastError);
        Assert.Null(feed.LastCheckedAt);
        Assert.Equal(0, feed.ConsecutiveFailures);
    }

    // ---- an article listed twice ----

    // BBC News Brasil lists some articles twice, the guids differing only in their fragment.
    private static Item[] ListedTwice(NewsTestHarness h) =>
    [
        new("Duas vezes", "https://news.example.com/a", h.Time.GetUtcNow().AddMinutes(-10), Guid: "https://news.example.com/a#2"),
        new("Outro", "https://news.example.com/b", h.Time.GetUtcNow().AddMinutes(-20)),
        new("Duas vezes", "https://news.example.com/a", h.Time.GetUtcNow().AddMinutes(-30), Guid: "https://news.example.com/a#5"),
    ];

    [Fact]
    public async Task AnArticleListedTwice_IsListedAndImportedOnce()
    {
        await using var h = await CreateAsync();
        Serve(h, ListedTwice(h));
        var feedId = await h.AddFeedAsync();

        Assert.Equal(["Duas vezes", "Outro"], (await BrowseAsync(h, feedId)).Select(e => e.Title));
        var result = await h.ImportAsync(feedId);

        Assert.Equal(2, result.Imported);
        await using var context = h.NewContext();
        Assert.Equal(["Duas vezes", "Outro"], await context.Texts.OrderBy(t => t.SortOrder).Select(t => t.Title).ToListAsync());
        Assert.Equal(1, h.Web.RequestsTo("https://news.example.com/a"));

        // A day later, with room again, it doesn't come back either.
        h.Time.Advance(TimeSpan.FromDays(1.1));
        Assert.Equal(0, (await h.ImportAsync(feedId)).Imported);
    }

    [Theory]
    [InlineData("https://www.bbc.com/portuguese/articles/ck5ywwz0ld77o#2", "https://www.bbc.com/portuguese/articles/ck5ywwz0ld77o")]
    [InlineData("https://news.example.com/a", "https://news.example.com/a")]
    [InlineData("tag:example.com,2026:post#12", "tag:example.com,2026:post#12")] // not a web address
    [InlineData("urn:uuid:1234#x", "urn:uuid:1234#x")]
    [InlineData("#only-a-fragment", "#only-a-fragment")]
    public void EntryIdentity_DropsTheFragmentOfAWebAddressOnly(string key, string expected)
    {
        Assert.Equal(expected, NewsFeedImporter.EntryIdentity(key));
    }

    // ---- the endpoints ----

    private static NewsFeedsController CreateController(NewsTestHarness h, AppDbContext context, Guid userId) =>
        new(context, h.Importer(context), h.Time)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "TestAuth"))
                }
            }
        };

    private static string? Message(IActionResult result) =>
        ((ObjectResult)result).Value?.GetType().GetProperty("message")?.GetValue(((ObjectResult)result).Value) as string;

    [Fact]
    public async Task Endpoints_ListEntriesAndImportPicks()
    {
        await using var h = await CreateAsync();
        Serve(h, Articles(h));
        var feedId = await h.AddFeedAsync();
        await using var context = h.NewContext();
        var controller = CreateController(h, context, UserId);

        var listed = (await controller.GetEntries(feedId, CancellationToken.None)).Value!;
        Assert.Equal("Notícias", listed.Feed.Title);
        Assert.Equal(6, listed.Entries.Count);
        Assert.All(listed.Entries, e => Assert.Equal(NewsEntryStatus.New, e.Status));

        var picked = listed.Entries.Where(e => e.Title is "Dois" or "Quatro").Select(e => e.Key).ToList();
        var imported = (await controller.ImportEntries(feedId, new ImportNewsEntriesDto { Keys = picked }, CancellationToken.None)).Value!;

        Assert.True(imported.Success);
        Assert.Equal(2, imported.Imported);
        Assert.Equal(2, imported.Feed.ArticleCount);
        Assert.Equal(2, imported.Feed.ImportedLast24Hours);
        Assert.All(imported.Entries!, e => Assert.NotNull(e.TextId));
    }

    [Fact]
    public async Task Endpoints_ExplainAFeedThatCantBeLoaded_AndRefuseBadPicks()
    {
        await using var h = await CreateAsync();
        h.Web.Fail(FeedUrl, HttpStatusCode.ServiceUnavailable);
        var feedId = await h.AddFeedAsync();
        await using var context = h.NewContext();
        var controller = CreateController(h, context, UserId);

        var listed = await controller.GetEntries(feedId, CancellationToken.None);
        Assert.Contains("503", Message(Assert.IsType<BadRequestObjectResult>(listed.Result)));

        var none = await controller.ImportEntries(feedId, new ImportNewsEntriesDto { Keys = [" "] }, CancellationToken.None);
        Assert.Equal("Choose the articles to import.", Message(Assert.IsType<BadRequestObjectResult>(none.Result)));

        var tooMany = Enumerable.Range(0, NewsFeedImporter.MaxSelectedEntries + 1).Select(i => Key($"https://news.example.com/{i}")).ToList();
        var many = await controller.ImportEntries(feedId, new ImportNewsEntriesDto { Keys = tooMany }, CancellationToken.None);
        Assert.Equal("Import up to 20 articles at a time.", Message(Assert.IsType<BadRequestObjectResult>(many.Result)));
        // Only the feed itself was fetched: refused picks fetch nothing.
        Assert.All(h.Web.Requests, r => Assert.Equal(FeedUrl, r));
    }

    [Fact]
    public async Task Endpoints_AnotherUsersFeed_IsNotFound()
    {
        await using var h = await CreateAsync();
        Serve(h, Articles(h));
        var feedId = await h.AddFeedAsync(userId: OtherUserId);
        await using var context = h.NewContext();
        var controller = CreateController(h, context, UserId);

        Assert.IsType<NotFoundObjectResult>((await controller.GetEntries(feedId, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.ImportEntries(
            feedId, new ImportNewsEntriesDto { Keys = [Key("https://news.example.com/1")] }, CancellationToken.None)).Result);
        Assert.Empty(h.Web.Requests);
    }
}
