using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// DeleteItems is what the Library grid calls, i.e. the usual way books and texts are deleted, and
/// it had no test coverage at all. These cover the row-level behaviour and the queries that collect
/// media paths for disk cleanup; the file removal itself is covered by BookAssetStorageTests.
/// </summary>
public class FoldersControllerDeleteItemsTests
{
    [Fact]
    public async Task DeleteItems_RemovesOwnedBooksAndTexts()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var controller = CreateController(context, userId);

        var result = await controller.DeleteItems(textIds: "10", bookIds: "1");

        Assert.IsType<NoContentResult>(result);
        context.ChangeTracker.Clear();

        Assert.Null(await context.Books.FirstOrDefaultAsync(b => b.BookId == 1));
        Assert.Null(await context.Texts.FirstOrDefaultAsync(t => t.TextId == 10));
    }

    [Fact]
    public async Task DeleteItems_IgnoresItemsOwnedByAnotherUser()
    {
        await using var context = CreateContext();
        var ownerId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        Seed(context, ownerId);
        context.Users.Add(new User { Id = otherId, UserName = "other", Email = "other@example.com" });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, otherId);

        var result = await controller.DeleteItems(textIds: "10", bookIds: "1");

        Assert.IsType<NoContentResult>(result);
        context.ChangeTracker.Clear();

        Assert.NotNull(await context.Books.FirstOrDefaultAsync(b => b.BookId == 1));
        Assert.NotNull(await context.Texts.FirstOrDefaultAsync(t => t.TextId == 10));
    }

    [Fact]
    public async Task DeleteItems_HandlesAudioLessonsBelongingToADeletedBook()
    {
        // Exercises the query that gathers a book's lesson audio paths before the rows go away.
        // A book lesson is reachable both directly and through its book, so the collection must not
        // trip over the duplicate either.
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var controller = CreateController(context, userId);

        var result = await controller.DeleteItems(textIds: "11", bookIds: "1");

        Assert.IsType<NoContentResult>(result);
        context.ChangeTracker.Clear();

        Assert.Empty(await context.Books.ToListAsync());
        Assert.Null(await context.Texts.FirstOrDefaultAsync(t => t.TextId == 11));
    }

    [Fact]
    public async Task DeleteItems_MovesFolderChildrenToTheParent()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var controller = CreateController(context, userId);

        // Folder 200 is a child of 100 and holds text 12; deleting 100 reparents both to null.
        var result = await controller.DeleteItems(folderIds: "100");

        Assert.IsType<NoContentResult>(result);
        context.ChangeTracker.Clear();

        Assert.Null(await context.Folders.FirstOrDefaultAsync(f => f.FolderId == 100));

        var childFolder = await context.Folders.SingleAsync(f => f.FolderId == 200);
        Assert.Null(childFolder.ParentFolderId);
    }

    [Fact]
    public async Task DeleteItems_IsANoOp_WhenNoIdsAreSupplied()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var controller = CreateController(context, userId);

        var result = await controller.DeleteItems();

        Assert.IsType<NoContentResult>(result);
        context.ChangeTracker.Clear();

        Assert.Single(await context.Books.ToListAsync());
        Assert.Equal(3, await context.Texts.CountAsync());
    }

    [Fact]
    public void BookAudioPathQuery_TranslatesToPostgres()
    {
        // The tests above run on the in-memory provider, which happily evaluates anything. This
        // one forces the real Npgsql translation of the collection query DeleteItems added
        // (Contains over a nullable BookId) — ToQueryString() compiles the query without ever
        // opening a connection, so an untranslatable shape fails here instead of in production.
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=translation-check;Username=none;Password=none")
            .Options;

        using var context = new AppDbContext(options);
        var userId = Guid.NewGuid();
        var bookIdsToDelete = new List<int> { 1, 2 };

        var sql = context.Texts
            .Where(t => t.BookId != null && bookIdsToDelete.Contains(t.BookId.Value)
                     && t.UserId == userId && t.IsAudioLesson && t.AudioFilePath != null)
            .Select(t => t.AudioFilePath!)
            .ToQueryString();

        Assert.Contains("SELECT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("BookId", sql, StringComparison.OrdinalIgnoreCase);
    }

    // --- Helpers ---

    private static void Seed(AppDbContext context, Guid userId)
    {
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
        context.Folders.Add(new Folder { FolderId = 100, UserId = userId, Name = "Parent" });
        context.Folders.Add(new Folder { FolderId = 200, UserId = userId, Name = "Child", ParentFolderId = 100 });
        context.Books.Add(new Book { BookId = 1, UserId = userId, LanguageId = 1, Title = "Book" });

        // Standalone audio lesson.
        context.Texts.Add(new Text
        {
            TextId = 10,
            UserId = userId,
            LanguageId = 1,
            Title = "Standalone lesson",
            Content = "hola",
            IsAudioLesson = true,
            AudioFilePath = $"audio_lessons/{userId}/standalone.mp3"
        });
        // Audio lesson that belongs to the book.
        context.Texts.Add(new Text
        {
            TextId = 11,
            UserId = userId,
            LanguageId = 1,
            BookId = 1,
            Title = "Book lesson",
            Content = "hola",
            IsAudioLesson = true,
            AudioFilePath = $"audio_lessons/{userId}/book-lesson.mp3"
        });
        // Plain text inside the child folder, to check folder reparenting.
        context.Texts.Add(new Text
        {
            TextId = 12,
            UserId = userId,
            LanguageId = 1,
            FolderId = 200,
            Title = "Foldered",
            Content = "hola"
        });

        context.SaveChanges();
        context.ChangeTracker.Clear();
    }

    private static FoldersController CreateController(AppDbContext context, Guid userId)
    {
        return new FoldersController(context, NullLogger<FoldersController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                    ], "TestAuth"))
                }
            }
        };
    }

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new AppDbContext(options);
    }
}
