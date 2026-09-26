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
