using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;
using static LinguaReadApi.Tests.NewsTestHarness;

namespace LinguaReadApi.Tests;

public class NewsFeedsControllerTests
{
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
    public async Task Add_StoresTheFeedWithItsTitle()
    {
        await using var h = await CreateAsync();
        h.Web.ServeFeed(FeedUrl, Rss("BBC News Brasil"));
        await using var context = h.NewContext();

        var result = await CreateController(h, context, UserId)
            .AddFeed(new AddNewsFeedDto { Url = " " + FeedUrl + " ", LanguageId = PortugueseId }, CancellationToken.None);

        var dto = Assert.IsType<NewsFeedDto>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(FeedUrl, dto.Url);
        Assert.Equal("BBC News Brasil", dto.Title);
        Assert.Equal("Portuguese", dto.LanguageName);
        Assert.True(dto.Enabled);
        Assert.Null(dto.LastCheckedAt);
        var stored = await h.NewContext().NewsFeeds.SingleAsync();
        Assert.Equal(UserId, stored.UserId);
    }

    [Fact]
    public async Task Add_FollowsTheFeedAWebPageLinksTo_AndAddsTheSchemeWhenMissing()
    {
        await using var h = await CreateAsync();
        h.Web.Serve("https://news.example.com/portugues", """
            <html><head><link rel="alternate" type="application/rss+xml" href="/rss"></head><body>Home</body></html>
            """);
        h.Web.ServeFeed(FeedUrl, Rss("Notícias"));
        await using var context = h.NewContext();

        var result = await CreateController(h, context, UserId)
            .AddFeed(new AddNewsFeedDto { Url = "news.example.com/portugues", LanguageId = PortugueseId }, CancellationToken.None);

        var dto = Assert.IsType<NewsFeedDto>(Assert.IsType<CreatedAtActionResult>(result.Result).Value);
        Assert.Equal(FeedUrl, dto.Url);
    }

    [Theory]
    [InlineData("", "Enter the feed's web address")]
    [InlineData("ftp://news.example.com/rss", "Enter the feed's web address")]
    [InlineData("https://user:pass@news.example.com/rss", "Enter the feed's web address")]
    [InlineData("https://news.example.com/home", "isn't an RSS or Atom feed")]
    [InlineData("https://news.example.com/missing", "answered 404")]
    public async Task Add_ExplainsWhyAnAddressCantBeUsed(string url, string expected)
    {
        await using var h = await CreateAsync();
        h.Web.Serve("https://news.example.com/home", "<html><body>No feed here</body></html>");
        await using var context = h.NewContext();

        var result = await CreateController(h, context, UserId)
            .AddFeed(new AddNewsFeedDto { Url = url, LanguageId = PortugueseId }, CancellationToken.None);

        Assert.Contains(expected, Message(Assert.IsType<BadRequestObjectResult>(result.Result)));
        Assert.Empty(await h.NewContext().NewsFeeds.ToListAsync());
    }

    [Fact]
    public async Task Add_RequiresALanguage_AndRefusesDuplicatesAndTooManyFeeds()
    {
        await using var h = await CreateAsync();
        h.Web.ServeFeed(FeedUrl, Rss("Notícias"));
        await using var context = h.NewContext();
        var controller = CreateController(h, context, UserId);

        var noLanguage = await controller.AddFeed(new AddNewsFeedDto { Url = FeedUrl, LanguageId = 99 }, CancellationToken.None);
        Assert.Contains("language", Message(Assert.IsType<BadRequestObjectResult>(noLanguage.Result)));

        await h.AddFeedAsync();
        var duplicate = await controller.AddFeed(new AddNewsFeedDto { Url = FeedUrl, LanguageId = PortugueseId }, CancellationToken.None);
        Assert.Equal("You already follow this feed.", Message(Assert.IsType<ConflictObjectResult>(duplicate.Result)));

        // The same address followed by another user is fine.
        var other = await CreateController(h, h.NewContext(), OtherUserId)
            .AddFeed(new AddNewsFeedDto { Url = FeedUrl, LanguageId = PortugueseId }, CancellationToken.None);
        Assert.IsType<CreatedAtActionResult>(other.Result);

        for (var i = 1; i < NewsFeedsController.MaxFeedsPerUser; i++)
        {
            await h.AddFeedAsync($"https://news.example.com/feed{i}");
        }
        h.Web.ServeFeed("https://news.example.com/one-more", Rss("One more"));
        var tooMany = await controller.AddFeed(new AddNewsFeedDto { Url = "https://news.example.com/one-more", LanguageId = PortugueseId }, CancellationToken.None);
        Assert.Contains("up to 30 feeds", Message(Assert.IsType<BadRequestObjectResult>(tooMany.Result)));
    }

    [Fact]
    public async Task GetFeeds_ListsOnlyTheUsersFeeds_WithTheirCounts()
    {
        await using var h = await CreateAsync();
        var item = new Item("Notícia", "https://news.example.com/1", h.Time.GetUtcNow());
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", item));
        h.Web.Serve(item.Link, ArticlePage(item.Title));
        var feedId = await h.AddFeedAsync();
        h.Time.Advance(TimeSpan.FromMinutes(1));
        await h.AddFeedAsync("https://news.example.com/second", "Second");
        await h.AddFeedAsync("https://other.example.com/rss", "Other", userId: OtherUserId);
        await h.ImportAsync(feedId);

        var feeds = (await CreateController(h, h.NewContext(), UserId).GetFeeds()).Value!;

        Assert.Equal(["Notícias", "Second"], feeds.Select(f => f.Title));
        Assert.Equal(1, feeds[0].ImportedLast24Hours);
        Assert.Equal(1, feeds[0].ArticleCount);
        Assert.NotNull(feeds[0].FolderId);
        Assert.Equal(0, feeds[1].ArticleCount);

        // A day later the daily count is back to zero; the article is still there.
        h.Time.Advance(TimeSpan.FromDays(1));
        var later = (await CreateController(h, h.NewContext(), UserId).GetFeeds()).Value!;
        Assert.Equal(0, later[0].ImportedLast24Hours);
        Assert.Equal(1, later[0].ArticleCount);
    }

    [Fact]
    public async Task Fetch_ImportsNowAndReturnsTheResult()
    {
        await using var h = await CreateAsync();
        var item = new Item("Notícia", "https://news.example.com/1", h.Time.GetUtcNow());
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", item));
        h.Web.Serve(item.Link, ArticlePage(item.Title));
        var feedId = await h.AddFeedAsync();

        var result = (await CreateController(h, h.NewContext(), UserId).FetchFeed(feedId, CancellationToken.None)).Value!;

        Assert.True(result.Success);
        Assert.Equal(1, result.Imported);
        Assert.Equal("Imported 1 article.", result.Message);
        Assert.Equal(1, result.Feed.ArticleCount);
        Assert.Equal(h.Now, result.Feed.LastSuccessAt);
    }

    [Fact]
    public async Task Update_PausesAndChangesLanguage_MovingTheFolderWithIt()
    {
        await using var h = await CreateAsync();
        var item = new Item("Notícia", "https://news.example.com/1", h.Time.GetUtcNow());
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", item));
        h.Web.Serve(item.Link, ArticlePage(item.Title));
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId);

        var result = await CreateController(h, h.NewContext(), UserId)
            .UpdateFeed(feedId, new UpdateNewsFeedDto { Enabled = false, LanguageId = FrenchId });

        Assert.False(result.Value!.Enabled);
        Assert.Equal("French", result.Value.LanguageName);
        await using var check = h.NewContext();
        Assert.Equal(FrenchId, (await check.Folders.SingleAsync(f => f.FolderId == result.Value.FolderId)).LanguageId);

        var badLanguage = await CreateController(h, h.NewContext(), UserId)
            .UpdateFeed(feedId, new UpdateNewsFeedDto { LanguageId = 99 });
        Assert.IsType<BadRequestObjectResult>(badLanguage.Result);
    }

    [Fact]
    public async Task Delete_KeepsTheArticlesAsOrdinaryTexts()
    {
        await using var h = await CreateAsync();
        var item = new Item("Notícia", "https://news.example.com/1", h.Time.GetUtcNow());
        h.Web.ServeFeed(FeedUrl, Rss("Notícias", item));
        h.Web.Serve(item.Link, ArticlePage(item.Title));
        var feedId = await h.AddFeedAsync();
        await h.ImportAsync(feedId);

        var result = await CreateController(h, h.NewContext(), UserId).DeleteFeed(feedId);

        Assert.IsType<NoContentResult>(result);
        await using var check = h.NewContext();
        Assert.Empty(await check.NewsFeeds.ToListAsync());
        Assert.Empty(await check.NewsFeedItems.ToListAsync());
        var text = await check.Texts.SingleAsync();
        Assert.Null(text.NewsFeedId);
        Assert.NotNull(text.FolderId);
    }

    [Fact]
    public async Task AnotherUsersFeed_IsNotFound()
    {
        await using var h = await CreateAsync();
        var feedId = await h.AddFeedAsync(userId: OtherUserId);
        var controller = CreateController(h, h.NewContext(), UserId);

        Assert.IsType<NotFoundObjectResult>((await controller.UpdateFeed(feedId, new UpdateNewsFeedDto { Enabled = false })).Result);
        Assert.IsType<NotFoundObjectResult>(await controller.DeleteFeed(feedId));
        Assert.IsType<NotFoundObjectResult>((await controller.FetchFeed(feedId, CancellationToken.None)).Result);
        Assert.Empty((await controller.GetFeeds()).Value!);
        Assert.Empty(h.Web.Requests);
        Assert.True((await h.NewContext().NewsFeeds.SingleAsync()).Enabled);
    }
}
