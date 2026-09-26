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
/// The Library grid's organising endpoints: reorder, move, folder create/rename and search.
/// DeleteItems has its own file.
/// </summary>
public class FoldersControllerLibraryTests
{
    private const int RootBook = 1;
    private const int FolderBook = 2;
    private const int RootText = 10;
    private const int FolderText = 11;
    private const int BookPart = 12;
    private const int FolderA = 100;
    private const int FolderB = 101;
    private const int ChildOfA = 200;

    [Fact]
    public async Task ReorderItems_UpdatesItemsInTheRequestedFolder()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);
        var controller = CreateController(context, userId);

        var result = await controller.ReorderItems(new ReorderItemsDto
        {
            FolderId = null,
            Items =
            {
                new ReorderItemDto { Id = FolderB, Type = "folder", SortOrder = 0 },
                new ReorderItemDto { Id = FolderA, Type = "folder", SortOrder = 1 },
                new ReorderItemDto { Id = RootBook, Type = "book", SortOrder = 5 },
                new ReorderItemDto { Id = RootText, Type = "text", SortOrder = 7 }
            }
        });

        Assert.IsType<NoContentResult>(result);
        context.ChangeTracker.Clear();
        Assert.Equal(0, (await context.Folders.FindAsync(FolderB))!.SortOrder);
        Assert.Equal(1, (await context.Folders.FindAsync(FolderA))!.SortOrder);
        Assert.Equal(5, (await context.Books.FindAsync(RootBook))!.SortOrder);
        Assert.Equal(7, (await context.Texts.FindAsync(RootText))!.SortOrder);
    }

    [Fact]
    public async Task ReorderItems_IgnoresItemsThatAreNotInTheRequestedFolder()
    {
        // A reorder sent while the grid still showed another folder (or a stale tab) must not
        // rewrite the order of items that live somewhere else.
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);
        var controller = CreateController(context, userId);

        var result = await controller.ReorderItems(new ReorderItemsDto
        {
            FolderId = null,
            Items =
            {
                new ReorderItemDto { Id = ChildOfA, Type = "folder", SortOrder = 9 },
                new ReorderItemDto { Id = FolderBook, Type = "book", SortOrder = 9 },
                new ReorderItemDto { Id = FolderText, Type = "text", SortOrder = 9 },
                new ReorderItemDto { Id = BookPart, Type = "text", SortOrder = 9 }
            }
        });

        Assert.IsType<NoContentResult>(result);
        context.ChangeTracker.Clear();
        Assert.Equal(3, (await context.Folders.FindAsync(ChildOfA))!.SortOrder);
        Assert.Equal(3, (await context.Books.FindAsync(FolderBook))!.SortOrder);
        Assert.Equal(3, (await context.Texts.FindAsync(FolderText))!.SortOrder);
        Assert.Equal(3, (await context.Texts.FindAsync(BookPart))!.SortOrder);
    }

    [Fact]
    public async Task ReorderItems_IgnoresAnotherUsersItems()
    {
        await using var context = CreateContext();
        var ownerId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        Seed(context, ownerId);
        var controller = CreateController(context, otherId);

        await controller.ReorderItems(new ReorderItemsDto
        {
            FolderId = null,
            Items = { new ReorderItemDto { Id = RootBook, Type = "book", SortOrder = 42 } }
        });

        context.ChangeTracker.Clear();
        Assert.Equal(3, (await context.Books.FindAsync(RootBook))!.SortOrder);
    }

    [Fact]
    public async Task SearchLibrary_MatchesTitlesAndAuthors_CaseInsensitively()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);
        var controller = CreateController(context, userId);

        var byAuthor = (await controller.SearchLibrary("AUTORA")).Value!;
        Assert.Equal(new[] { RootBook }, byAuthor.Books.Select(b => b.BookId));
        Assert.Equal("Ana Autora", byAuthor.Books[0].Author);

        var byTitle = (await controller.SearchLibrary("foldered")).Value!;
        Assert.Equal(new[] { FolderBook }, byTitle.Books.Select(b => b.BookId));
        Assert.Equal(new[] { FolderText }, byTitle.Texts.Select(t => t.TextId));
        Assert.Equal("Alpha", byTitle.Books[0].FolderPath);
        Assert.Equal(FolderA, byTitle.Texts[0].FolderId);
    }

    [Fact]
    public async Task SearchLibrary_SkipsBookPartsSrsStoriesAndOtherUsers()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        Seed(context, userId);
        context.Texts.Add(new Text { TextId = 30, UserId = userId, LanguageId = 1, Title = "Root story", Content = "x", Tag = "srs-story" });
        context.Texts.Add(new Text { TextId = 31, UserId = otherId, LanguageId = 1, Title = "Root other", Content = "x" });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var result = (await CreateController(context, userId).SearchLibrary("root")).Value!;

        Assert.Equal(new[] { RootBook }, result.Books.Select(b => b.BookId));
        Assert.Equal(new[] { RootText }, result.Texts.Select(t => t.TextId));
        Assert.Equal(string.Empty, result.Texts[0].FolderPath);
    }

    [Fact]
    public async Task SearchLibrary_GivesAFolderTheParentsPath()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var result = (await CreateController(context, userId).SearchLibrary("chi")).Value!;

        var folder = Assert.Single(result.Folders);
        Assert.Equal(ChildOfA, folder.FolderId);
        Assert.Equal(FolderA, folder.ParentFolderId);
        Assert.Equal("Alpha", folder.FolderPath);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" o ")]
    public async Task SearchLibrary_IgnoresQueriesShorterThanTwoCharacters(string? query)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var result = (await CreateController(context, userId).SearchLibrary(query)).Value!;

        Assert.Empty(result.Folders);
        Assert.Empty(result.Books);
        Assert.Empty(result.Texts);
    }

    [Fact]
    public async Task GetLibraryContents_IncludesAuthorAndReadingDates()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);
        var lastOpened = new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc);
        var text = await context.Texts.FindAsync(RootText);
        text!.LastAccessedAt = lastOpened;
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var contents = (await CreateController(context, userId).GetLibraryContents()).Value!;

        var book = Assert.Single(contents.Books);
        Assert.Equal("Ana Autora", book.Author);
        Assert.NotEqual(default, book.CreatedAt);
        Assert.Equal(lastOpened, Assert.Single(contents.Texts).LastAccessedAt);
    }

    [Fact]
    public async Task GetLibraryContents_BuildsTheBreadcrumbChain()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var contents = (await CreateController(context, userId).GetLibraryContents(ChildOfA)).Value!;

        Assert.Equal(new[] { "Alpha", "Child" }, contents.Breadcrumbs.Select(b => b.Name));
    }

    // ---- helpers ----

    internal static void Seed(AppDbContext context, Guid userId)
    {
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });

        // Root: folders A and B, one book, one text. Folder A: child folder, one book, one text.
        context.Folders.Add(new Folder { FolderId = FolderA, UserId = userId, Name = "Alpha", SortOrder = 3 });
        context.Folders.Add(new Folder { FolderId = FolderB, UserId = userId, Name = "Beta", SortOrder = 3 });
        context.Folders.Add(new Folder { FolderId = ChildOfA, UserId = userId, Name = "Child", ParentFolderId = FolderA, SortOrder = 3 });

        context.Books.Add(new Book { BookId = RootBook, UserId = userId, LanguageId = 1, Title = "Root book", Author = "Ana Autora", SortOrder = 3 });
        context.Books.Add(new Book { BookId = FolderBook, UserId = userId, LanguageId = 1, Title = "Foldered book", FolderId = FolderA, SortOrder = 3 });

        context.Texts.Add(new Text { TextId = RootText, UserId = userId, LanguageId = 1, Title = "Root text", Content = "hola", SortOrder = 3 });
        context.Texts.Add(new Text { TextId = FolderText, UserId = userId, LanguageId = 1, Title = "Foldered text", Content = "hola", FolderId = FolderA, SortOrder = 3 });
        // A book part sits at the root (FolderId null) but is not a Library item.
        context.Texts.Add(new Text { TextId = BookPart, UserId = userId, LanguageId = 1, BookId = FolderBook, Title = "Root book part", Content = "hola", SortOrder = 3 });

        context.SaveChanges();
        context.ChangeTracker.Clear();
    }

    internal static FoldersController CreateController(AppDbContext context, Guid userId)
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

    internal static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new AppDbContext(options);
    }
}
