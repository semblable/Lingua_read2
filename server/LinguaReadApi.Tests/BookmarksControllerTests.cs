using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

public class BookmarksControllerTests
{
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly Guid OtherUserId = Guid.NewGuid();
    private const int TextId = 10;
    private const int OtherUsersTextId = 20;

    [Fact]
    public async Task SetBookmark_AddsAndRemoves_AndGetReflectsIt()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);

        await controller.SetBookmark(TextId, 5, new SetBookmarkRequest { Bookmarked = true });
        await controller.SetBookmark(TextId, 2, new SetBookmarkRequest { Bookmarked = true });
        var afterAdd = Value(await controller.GetBookmarks(TextId));
        Assert.Equal(new[] { 2, 5 }, afterAdd.SentenceIndices);

        var afterRemove = Value(await controller.SetBookmark(TextId, 5, new SetBookmarkRequest { Bookmarked = false }));
        Assert.Equal(new[] { 2 }, afterRemove.SentenceIndices);
        Assert.Equal(2, afterRemove.LastSentenceIndex);

        // The removal is kept as a tombstone, not deleted.
        var tombstone = await context.TextBookmarks.AsNoTracking().SingleAsync(b => b.SentenceIndex == 5);
        Assert.False(tombstone.IsActive);
    }

    [Fact]
    public async Task LastSentenceIndex_IsTheNewestBookmark_AndFallsBackToTheNextNewest()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);
        var t0 = DateTime.UtcNow.AddMinutes(-10);

        await controller.SetBookmark(TextId, 9, new SetBookmarkRequest { Bookmarked = true, ClientUpdatedAt = t0 });
        await controller.SetBookmark(TextId, 1, new SetBookmarkRequest { Bookmarked = true, ClientUpdatedAt = t0.AddMinutes(1) });
        await controller.SetBookmark(TextId, 4, new SetBookmarkRequest { Bookmarked = true, ClientUpdatedAt = t0.AddMinutes(2) });
        Assert.Equal(4, Value(await controller.GetBookmarks(TextId)).LastSentenceIndex);

        var result = Value(await controller.SetBookmark(TextId, 4, new SetBookmarkRequest { Bookmarked = false, ClientUpdatedAt = t0.AddMinutes(3) }));

        // Next most recent, not the highest index.
        Assert.Equal(1, result.LastSentenceIndex);
    }

    [Fact]
    public async Task StaleRemove_IsIgnored_AfterANewerAdd()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);
        var now = DateTime.UtcNow;

        await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = true, ClientUpdatedAt = now.AddMinutes(-1) });
        // An offline removal from another device, made earlier, drains now.
        var result = Value(await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = false, ClientUpdatedAt = now.AddMinutes(-5) }));

        Assert.Equal(new[] { 3 }, result.SentenceIndices);
    }

    [Fact]
    public async Task StaleAdd_DoesNotResurrect_ANewerRemoval()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);
        var now = DateTime.UtcNow;

        await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = true, ClientUpdatedAt = now.AddMinutes(-10) });
        await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = false, ClientUpdatedAt = now.AddMinutes(-1) });
        var result = Value(await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = true, ClientUpdatedAt = now.AddMinutes(-5) }));

        Assert.Empty(result.SentenceIndices);
    }

    [Fact]
    public async Task RemoveProcessedBeforeItsOlderAdd_StillWins()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);
        var now = DateTime.UtcNow;

        // Bookmark then un-bookmark quickly; the two requests arrive out of order.
        await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = false, ClientUpdatedAt = now.AddSeconds(-1) });
        var result = Value(await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = true, ClientUpdatedAt = now.AddSeconds(-2) }));

        Assert.Empty(result.SentenceIndices);
    }

    [Fact]
    public async Task FutureClientTimestamp_IsClampedToServerNow()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);

        await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = true, ClientUpdatedAt = DateTime.UtcNow.AddDays(1) });
        // Without the clamp this removal would count as stale for a whole day.
        var result = Value(await controller.SetBookmark(TextId, 3, new SetBookmarkRequest { Bookmarked = false }));

        Assert.Empty(result.SentenceIndices);
    }

    [Fact]
    public async Task NegativeSentenceIndex_IsRejected()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);

        var result = await controller.SetBookmark(TextId, -1, new SetBookmarkRequest { Bookmarked = true });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task AnotherUsersText_IsNotFound_OnGetAndSet()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);

        Assert.IsType<NotFoundObjectResult>((await controller.GetBookmarks(OtherUsersTextId)).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.SetBookmark(OtherUsersTextId, 1, new SetBookmarkRequest { Bookmarked = true })).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.GetBookmarks(999)).Result);
        Assert.Empty(context.TextBookmarks);
    }

    [Fact]
    public async Task Import_SkipsForeignAndMissingTexts_AndKeepsTheLastBookmarkAnchor()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);

        var result = await controller.ImportBookmarks(new ImportBookmarksRequest
        {
            Texts =
            [
                new ImportedTextBookmarks { TextId = TextId, SentenceIndices = [8, 2, 5, -3], LastSentenceIndex = 2 },
                new ImportedTextBookmarks { TextId = OtherUsersTextId, SentenceIndices = [1] },
                new ImportedTextBookmarks { TextId = 999, SentenceIndices = [1] }
            ]
        });

        var summary = Assert.IsType<ImportBookmarksResult>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(3, summary.Imported);
        Assert.Equal(2, summary.SkippedTexts);

        var bookmarks = Value(await controller.GetBookmarks(TextId));
        Assert.Equal(new[] { 2, 5, 8 }, bookmarks.SentenceIndices);
        Assert.Equal(2, bookmarks.LastSentenceIndex);
        Assert.DoesNotContain(context.TextBookmarks, b => b.TextId == OtherUsersTextId);
    }

    [Fact]
    public async Task Import_NeverOverridesExistingRows_AndIsIdempotent()
    {
        await using var context = CreateContext();
        Seed(context);
        var controller = CreateController(context, UserId);

        await controller.SetBookmark(TextId, 4, new SetBookmarkRequest { Bookmarked = true });
        await controller.SetBookmark(TextId, 4, new SetBookmarkRequest { Bookmarked = false });

        var request = new ImportBookmarksRequest
        {
            Texts = [new ImportedTextBookmarks { TextId = TextId, SentenceIndices = [4, 6], LastSentenceIndex = 4 }]
        };
        await controller.ImportBookmarks(request);
        var second = await controller.ImportBookmarks(request);

        // Index 4 was removed after sync existed; the old local copy must not bring it back.
        Assert.Equal(new[] { 6 }, Value(await controller.GetBookmarks(TextId)).SentenceIndices);
        Assert.Equal(0, Assert.IsType<ImportBookmarksResult>(Assert.IsType<OkObjectResult>(second.Result).Value).Imported);
    }

    [Fact]
    public async Task DeletingAText_DeletesItsBookmarks()
    {
        // InMemory doesn't enforce FK cascades; shared-cache SQLite does.
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = $"Bookmarks{Guid.NewGuid():N}",
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared,
        }.ToString();
        await using var keepAlive = new SqliteConnection(connectionString);
        await keepAlive.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connectionString).Options;

        await using (var setup = new AppDbContext(options))
        {
            await setup.Database.EnsureCreatedAsync();
            Seed(setup);
            await CreateController(setup, UserId).SetBookmark(TextId, 1, new SetBookmarkRequest { Bookmarked = true });
        }

        await using (var delete = new AppDbContext(options))
        {
            await delete.Database.ExecuteSqlRawAsync("DELETE FROM \"Texts\" WHERE \"TextId\" = {0}", TextId);
        }

        await using var check = new AppDbContext(options);
        Assert.Empty(check.TextBookmarks);
    }

    private static TextBookmarksDto Value(ActionResult<TextBookmarksDto> result) =>
        Assert.IsType<TextBookmarksDto>(Assert.IsType<OkObjectResult>(result.Result).Value);

    private static void Seed(AppDbContext context)
    {
        context.Users.Add(new User { Id = UserId, UserName = "tester", Email = "tester@example.com" });
        context.Users.Add(new User { Id = OtherUserId, UserName = "other", Email = "other@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
        context.Texts.Add(new Text { TextId = TextId, UserId = UserId, LanguageId = 1, Title = "Mine", Content = "Uno. Dos." });
        context.Texts.Add(new Text { TextId = OtherUsersTextId, UserId = OtherUserId, LanguageId = 1, Title = "Theirs", Content = "Tres." });
        context.SaveChanges();
        context.ChangeTracker.Clear();
    }

    private static BookmarksController CreateController(AppDbContext context, Guid userId) =>
        new(context)
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

    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);
}
