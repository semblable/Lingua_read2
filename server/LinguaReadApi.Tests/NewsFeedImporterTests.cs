using System.Net;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.News;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;
using static LinguaReadApi.Tests.NewsTestHarness;

namespace LinguaReadApi.Tests;

public class NewsFeedImporterTests
{
    // Five long articles, newest first by date though listed out of order.
    private static Item[] FiveArticles(NewsTestHarness h) =>
    [
        new("Três", "https://news.example.com/3", h.Time.GetUtcNow().AddHours(-3)),
        new("Um", "https://news.example.com/1", h.Time.GetUtcNow().AddHours(-1)),
        new("Cinco", "https://news.example.com/5", h.Time.GetUtcNow().AddHours(-5)),
        new("Dois", "https://news.example.com/2", h.Time.GetUtcNow().AddHours(-2)),
        new("Quatro", "https://news.example.com/4", h.Time.GetUtcNow().AddHours(-4)),
    ];

    private static void ServeAll(NewsTestHarness h, Item[] items)
    {
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", items));
        foreach (var item in items)
        {
            h.Web.Serve(item.Link, ArticlePage(item.Title));
        }
    }

    [Fact]
    public async Task Import_TakesTheNewestArticlesUpToTheDailyLimit_IntoTheFeedsFolder()
    {
        await using var h = await CreateAsync();
        ServeAll(h, FiveArticles(h));
        var feedId = await h.AddFeedAsync();

        var result = await h.ImportAsync(feedId);

        Assert.True(result.Success);
        Assert.Equal(3, result.Imported);
        Assert.Equal("Imported 3 articles.", result.Message);

        await using var context = h.NewContext();
        var texts = await context.Texts.OrderBy(t => t.SortOrder).ToListAsync();
        Assert.Equal(["Um", "Dois", "Três"], texts.Select(t => t.Title));
        Assert.All(texts, t =>
        {
            Assert.Equal(feedId, t.NewsFeedId);
            Assert.Equal(PortugueseId, t.LanguageId);
            Assert.Equal(UserId, t.UserId);
            Assert.Equal("processing", t.WordLinkingStatus);
            Assert.Null(t.LastAccessedAt);
            Assert.StartsWith(t.Title + ": parágrafo 1 da reportagem", t.Content);
            Assert.DoesNotContain("direitos reservados", t.Content);
        });
        Assert.Equal("https://news.example.com/1", texts[0].SourceUrl);

        // News › Notícias, in Portuguese; the feed remembers it.
        var folder = await context.Folders.Include(f => f.ParentFolder).SingleAsync(f => f.FolderId == texts[0].FolderId);
        Assert.Equal("Notícias", folder.Name);
        Assert.Equal(PortugueseId, folder.LanguageId);
        Assert.Equal(NewsFeedImporter.RootFolderName, folder.ParentFolder!.Name);
        Assert.Null(folder.ParentFolder.ParentFolderId);
        Assert.All(texts, t => Assert.Equal(folder.FolderId, t.FolderId));
        Assert.Equal(folder.FolderId, (await context.NewsFeeds.SingleAsync()).FolderId);

        // Queued for word linking like a pasted text.
        Assert.Equal(texts.Select(t => t.TextId).Order(), h.DrainLinkingQueue().Select(r => r.TextId).Order());

        // Only the imported entries are remembered; the older two can still come later.
        Assert.Equal(3, await context.NewsFeedItems.CountAsync(i => i.Imported));
        Assert.Equal(3, await context.NewsFeedItems.CountAsync());
        Assert.Equal(0, h.Web.RequestsTo("https://news.example.com/4"));

        var feed = await context.NewsFeeds.SingleAsync();
        Assert.Equal(h.Now, feed.LastCheckedAt);
        Assert.Equal(h.Now, feed.LastSuccessAt);
        Assert.Null(feed.LastError);
    }

    [Fact]
    public async Task Import_KeepsToTheDailyLimitAcrossChecks_AndResumesADayLater()
    {
        await using var h = await CreateAsync();
        ServeAll(h, FiveArticles(h));
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId);
        var requestsAfterFirst = h.Web.Requests.Count;

        h.Time.Advance(TimeSpan.FromHours(3));
        var second = await h.ImportAsync(feedId);

        Assert.True(second.Success);
        Assert.Equal(0, second.Imported);
        Assert.Contains("daily limit", second.Message);
        // Only the feed itself was fetched.
        Assert.Equal(requestsAfterFirst + 1, h.Web.Requests.Count);

        h.Time.Advance(TimeSpan.FromHours(21));
        var third = await h.ImportAsync(feedId);

        Assert.Equal(2, third.Imported);
        await using var context = h.NewContext();
        Assert.Equal(["Quatro", "Cinco", "Um", "Dois", "Três"],
            await context.Texts.OrderBy(t => t.SortOrder).Select(t => t.Title).ToListAsync());
    }

    [Fact]
    public async Task Import_UsesTheUsersDailyNumber()
    {
        await using var h = await CreateAsync();
        ServeAll(h, FiveArticles(h));
        await using (var context = h.NewContext())
        {
            (await context.UserSettings.SingleAsync(s => s.UserId == UserId)).NewsArticlesPerFeedPerDay = 1;
            await context.SaveChangesAsync();
        }
        var feedId = await h.AddFeedAsync();

        var result = await h.ImportAsync(feedId);

        Assert.Equal(1, result.Imported);
        Assert.Equal("Imported 1 article.", result.Message);
    }

    [Fact]
    public async Task Import_SkipsShortAndUnreachableArticles_AndDoesNotRetryThem()
    {
        await using var h = await CreateAsync();
        var now = h.Time.GetUtcNow();
        Item[] items =
        [
            new("Curta", "https://news.example.com/short", now.AddHours(-1)),
            new("Sumiu", "https://news.example.com/gone", now.AddHours(-2)),
            new("Vídeo", "https://news.example.com/video.mp4", now.AddHours(-3)),
            new("Longa", "https://news.example.com/long", now.AddHours(-4)),
        ];
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", items));
        h.Web.Serve("https://news.example.com/short", ArticlePage("Curta", paragraphs: 2));
        h.Web.Fail("https://news.example.com/gone", HttpStatusCode.NotFound);
        h.Web.Serve("https://news.example.com/video.mp4", "binary", "video/mp4");
        h.Web.Serve("https://news.example.com/long", ArticlePage("Longa"));
        var feedId = await h.AddFeedAsync();

        var first = await h.ImportAsync(feedId);

        Assert.Equal(1, first.Imported);
        Assert.Equal(3, first.Skipped);
        Assert.Equal("Imported 1 article. Skipped 3 that were too short or couldn't be read.", first.Message);

        h.Time.Advance(TimeSpan.FromHours(3));
        var second = await h.ImportAsync(feedId);

        Assert.Equal("No new articles.", second.Message);
        Assert.Equal(1, h.Web.RequestsTo("https://news.example.com/short"));
        Assert.Equal(1, h.Web.RequestsTo("https://news.example.com/gone"));
    }

    [Fact]
    public async Task Import_DoesNotBringBackADeletedArticle()
    {
        await using var h = await CreateAsync();
        var items = FiveArticles(h).Take(1).ToArray();
        ServeAll(h, items);
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId);
        await using (var context = h.NewContext())
        {
            context.Texts.Remove(await context.Texts.SingleAsync());
            await context.SaveChangesAsync();
        }

        h.Time.Advance(TimeSpan.FromDays(2));
        var result = await h.ImportAsync(feedId);

        Assert.Equal(0, result.Imported);
        await using var check = h.NewContext();
        Assert.Empty(await check.Texts.ToListAsync());
    }

    [Fact]
    public async Task Import_UsesFullTextFromTheFeedWithoutFetchingThePage()
    {
        await using var h = await CreateAsync();
        var item = new Item("Completo", "https://news.example.com/full", h.Time.GetUtcNow(), ContentHtml: ArticleBody("Completo", 8));
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", item));
        var feedId = await h.AddFeedAsync();

        var result = await h.ImportAsync(feedId);

        Assert.Equal(1, result.Imported);
        Assert.Equal(0, h.Web.RequestsTo("https://news.example.com/full"));
    }

    [Fact]
    public async Task Import_FetchesThePageWhenTheFeedOnlyHasATeaser()
    {
        await using var h = await CreateAsync();
        var item = new Item("Teaser", "https://news.example.com/teaser", h.Time.GetUtcNow(), ContentHtml: "<p>Só um resumo curto.</p>");
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", item));
        h.Web.Serve(item.Link, ArticlePage("Teaser"));
        var feedId = await h.AddFeedAsync();

        var result = await h.ImportAsync(feedId);

        Assert.Equal(1, result.Imported);
        Assert.Equal(1, h.Web.RequestsTo(item.Link));
    }

    [Fact]
    public async Task Import_RecordsAFailedCheck()
    {
        await using var h = await CreateAsync();
        h.Web.Fail(FeedUrl, HttpStatusCode.InternalServerError);
        var feedId = await h.AddFeedAsync();

        var result = await h.ImportAsync(feedId);

        Assert.False(result.Success);
        Assert.Equal("news.example.com answered 500 Internal Server Error.", result.Message);
        await using var context = h.NewContext();
        var feed = await context.NewsFeeds.SingleAsync();
        Assert.Equal(result.Message, feed.LastError);
        Assert.Equal(1, feed.ConsecutiveFailures);
        Assert.Equal(h.Now, feed.LastCheckedAt);
        Assert.Null(feed.LastSuccessAt);

        // A page that isn't a feed any more is a failure too; a success clears both.
        h.Web.Serve(FeedUrl, "<html><body>Moved</body></html>");
        Assert.False((await h.ImportAsync(feedId)).Success);
        h.Web.ServeFeed(FeedUrl, Rss("Notícias"));
        Assert.True((await h.ImportAsync(feedId)).Success);
        await using var after = h.NewContext();
        feed = await after.NewsFeeds.SingleAsync();
        Assert.Null(feed.LastError);
        Assert.Equal(0, feed.ConsecutiveFailures);
    }

    [Fact]
    public async Task Import_RecreatesTheFolderWhenTheUserDeletedIt_UnderTheSameNewsFolder()
    {
        await using var h = await CreateAsync();
        var items = FiveArticles(h);
        ServeAll(h, items);
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId);
        int rootId;
        await using (var context = h.NewContext())
        {
            var folder = await context.Folders.SingleAsync(f => f.ParentFolderId != null);
            rootId = folder.ParentFolderId!.Value;
            // The Library moves a deleted folder's texts to the root first.
            foreach (var text in await context.Texts.ToListAsync()) text.FolderId = null;
            context.Folders.Remove(folder);
            await context.SaveChangesAsync();
            Assert.Null((await context.NewsFeeds.AsNoTracking().SingleAsync()).FolderId);
        }

        h.Time.Advance(TimeSpan.FromDays(1));
        var result = await h.ImportAsync(feedId);

        Assert.Equal(2, result.Imported);
        await using var check = h.NewContext();
        var recreated = await check.Folders.SingleAsync(f => f.ParentFolderId != null);
        Assert.Equal(rootId, recreated.ParentFolderId);
        Assert.Equal(recreated.FolderId, (await check.NewsFeeds.SingleAsync()).FolderId);
        Assert.Equal(1, await check.Folders.CountAsync(f => f.Name == NewsFeedImporter.RootFolderName));
    }

    [Fact]
    public async Task Import_ForgetsEntriesAMonthAfterTheyLeftTheFeed()
    {
        await using var h = await CreateAsync();
        var items = FiveArticles(h).Take(1).ToArray();
        ServeAll(h, items);
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId);

        // Still listed after 40 days: kept. Gone from the feed for 31 days: forgotten.
        h.Time.Advance(TimeSpan.FromDays(40));
        await h.ImportAsync(feedId);
        await using (var context = h.NewContext())
        {
            Assert.Equal(1, await context.NewsFeedItems.CountAsync());
        }
        h.Web.ServeFeed(FeedUrl, Rss("Notícias"));
        h.Time.Advance(TimeSpan.FromDays(31));
        await h.ImportAsync(feedId);

        await using var check = h.NewContext();
        Assert.Equal(0, await check.NewsFeedItems.CountAsync());
    }

    [Fact]
    public async Task Import_ReturnsAtOnce_WhenTheFeedIsAlreadyBeingChecked()
    {
        await using var h = await CreateAsync();
        ServeAll(h, FiveArticles(h));
        var feedId = await h.AddFeedAsync();
        await h.Locks.For(feedId).WaitAsync();

        var result = await h.ImportAsync(feedId);

        Assert.False(result.Success);
        Assert.Contains("being checked right now", result.Message);
        Assert.Empty(h.Web.Requests);

        h.Locks.For(feedId).Release();
        Assert.Equal(3, (await h.ImportAsync(feedId)).Imported);
    }

    [Fact]
    public async Task DeleteUnopenedArticles_RemovesOnlyOldUnopenedImports()
    {
        await using var h = await CreateAsync();
        var feedId = await h.AddFeedAsync();
        var old = h.Now.AddDays(-15);
        await using (var context = h.NewContext())
        {
            Text Make(string title, DateTime created, int? feed = null, DateTime? opened = null, bool finished = false, Guid? user = null) => new()
            {
                Title = title, Content = "Texto.", LanguageId = PortugueseId, UserId = user ?? UserId,
                CreatedAt = created, NewsFeedId = feed, LastAccessedAt = opened, IsFinished = finished
            };
            context.Texts.AddRange(
                Make("old unopened", old, feedId),
                Make("old opened", old, feedId, opened: h.Now.AddDays(-14)),
                Make("old finished", old, feedId, finished: true),
                Make("recent unopened", h.Now.AddDays(-13), feedId),
                Make("old pasted text", old));
            await context.SaveChangesAsync();
        }

        await using var cleanup = h.NewContext();
        var deleted = await h.Importer(cleanup).DeleteUnopenedArticlesAsync(UserId, 14, CancellationToken.None);

        Assert.Equal(1, deleted);
        await using var check = h.NewContext();
        Assert.Equal(["old finished", "old opened", "old pasted text", "recent unopened"],
            await check.Texts.OrderBy(t => t.Title).Select(t => t.Title).ToListAsync());
        Assert.Equal(0, await h.Importer(check).DeleteUnopenedArticlesAsync(UserId, 0, CancellationToken.None));
    }

    [Theory]
    [InlineData(null, 0, true)]
    [InlineData(119, 0, false)]
    [InlineData(120, 0, true)]
    [InlineData(239, 1, false)]  // one failure: wait twice as long
    [InlineData(240, 1, true)]
    [InlineData(1439, 9, false)] // many failures: capped at a day
    [InlineData(1440, 9, true)]
    public void IsDue_SpacesChecksAndBacksOffAfterFailures(int? minutesSinceCheck, int failures, bool expected)
    {
        var now = new DateTime(2026, 9, 27, 12, 0, 0, DateTimeKind.Utc);
        var feed = new NewsFeed
        {
            LastCheckedAt = minutesSinceCheck == null ? null : now.AddMinutes(-minutesSinceCheck.Value),
            ConsecutiveFailures = failures
        };

        Assert.Equal(expected, NewsFeedImporter.IsDue(feed, now, TimeSpan.FromMinutes(120)));
    }

    [Fact]
    public async Task BackgroundPass_ChecksEnabledFeedsOfUsersWithImportOn_AndCleansUp()
    {
        await using var h = await CreateAsync();
        var items = FiveArticles(h).Take(1).ToArray();
        ServeAll(h, items);
        h.Web.ServeFeed("https://news.example.com/paused", Rss("Paused"));
        h.Web.ServeFeed("https://other.example.com/rss", Rss("Other"));
        h.Web.ServeFeed("https://news.example.com/recent", Rss("Recent"));
        await h.AddFeedAsync();
        await h.AddFeedAsync("https://news.example.com/paused", "Paused", enabled: false);
        await h.AddFeedAsync("https://other.example.com/rss", "Other", userId: OtherUserId);
        var recentId = await h.AddFeedAsync("https://news.example.com/recent", "Recent");
        await using (var context = h.NewContext())
        {
            (await context.UserSettings.SingleAsync(s => s.UserId == OtherUserId)).NewsImportEnabled = false;
            (await context.NewsFeeds.SingleAsync(f => f.NewsFeedId == recentId)).LastCheckedAt = h.Now.AddMinutes(-30);
            context.Texts.Add(new Text
            {
                Title = "stale", Content = "Texto.", LanguageId = PortugueseId, UserId = UserId,
                CreatedAt = h.Now.AddDays(-20), NewsFeedId = recentId
            });
            await context.SaveChangesAsync();
        }

        await CreateService(h).RunOnceAsync(CancellationToken.None);

        Assert.Equal(1, h.Web.RequestsTo(FeedUrl));
        Assert.Equal(0, h.Web.RequestsTo("https://news.example.com/paused"));
        Assert.Equal(0, h.Web.RequestsTo("https://other.example.com/rss"));
        Assert.Equal(0, h.Web.RequestsTo("https://news.example.com/recent"));
        await using var check = h.NewContext();
        Assert.Equal([items[0].Title], await check.Texts.Select(t => t.Title).ToListAsync());
    }

    [Fact]
    public async Task BackgroundPass_GoesOnAfterAFeedFailsUnexpectedly_AndBacksOffThatFeed()
    {
        await using var h = await CreateAsync();
        var items = FiveArticles(h).Take(1).ToArray();
        ServeAll(h, items);
        h.Web.Throw("https://news.example.com/broken", new InvalidOperationException("boom"));
        var brokenId = await h.AddFeedAsync("https://news.example.com/broken", "Broken");
        var goodId = await h.AddFeedAsync();
        await using (var context = h.NewContext())
        {
            // Both due; the broken feed first in the pass.
            (await context.NewsFeeds.SingleAsync(f => f.NewsFeedId == brokenId)).LastCheckedAt = h.Now.AddHours(-5);
            (await context.NewsFeeds.SingleAsync(f => f.NewsFeedId == goodId)).LastCheckedAt = h.Now.AddHours(-3);
            await context.SaveChangesAsync();
        }

        await CreateService(h).RunOnceAsync(CancellationToken.None);

        await using var check = h.NewContext();
        Assert.Equal([items[0].Title], await check.Texts.Select(t => t.Title).ToListAsync());
        var broken = await check.NewsFeeds.SingleAsync(f => f.NewsFeedId == brokenId);
        Assert.Equal(h.Now, broken.LastCheckedAt);
        Assert.Equal(1, broken.ConsecutiveFailures);
        Assert.NotNull(broken.LastError);

        // Backed off: not due again after the usual two hours.
        h.Time.Advance(TimeSpan.FromHours(2.5));
        await CreateService(h).RunOnceAsync(CancellationToken.None);
        Assert.Equal(1, h.Web.RequestsTo("https://news.example.com/broken"));
    }

    private static NewsFeedBackgroundService CreateService(NewsTestHarness h)
    {
        var services = new ServiceCollection();
        services.AddSingleton<ILoggerFactory>(NullLoggerFactory.Instance);
        services.AddSingleton(typeof(ILogger<>), typeof(NullLogger<>));
        services.AddScoped(_ => h.NewContext());
        services.AddSingleton(h.Channel);
        services.AddSingleton(h.Locks);
        services.AddScoped(_ => h.Fetcher());
        services.AddSingleton<TimeProvider>(h.Time);
        services.AddScoped<NewsFeedImporter>();
        var provider = services.BuildServiceProvider();
        return new NewsFeedBackgroundService(
            provider.GetRequiredService<IServiceScopeFactory>(),
            new StaticOptionsMonitor(new NewsFeedOptions()),
            NullLogger<NewsFeedBackgroundService>.Instance,
            h.Time);
    }

    private sealed class StaticOptionsMonitor(NewsFeedOptions value) : IOptionsMonitor<NewsFeedOptions>
    {
        public NewsFeedOptions CurrentValue => value;
        public NewsFeedOptions Get(string? name) => value;
        public IDisposable? OnChange(Action<NewsFeedOptions, string?> listener) => null;
    }
}
