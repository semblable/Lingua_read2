using System.Security.Claims;
using System.Text;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// "Add Content" from inside a Library folder files the new book or text in that folder, and the
/// reader/book pages learn the folder so "Back to Library" returns there.
/// </summary>
public class LibraryFolderAssignmentTests
{
    private const int OwnFolder = 100;
    private const int OtherUsersFolder = 900;

    [Fact]
    public async Task CreateBook_FilesTheBookInTheGivenFolder()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var result = await CreateBooksController(context, userId).CreateBook(BookDto(OwnFolder));

        Assert.IsType<CreatedAtActionResult>(result.Result);
        context.ChangeTracker.Clear();
        Assert.Equal(OwnFolder, (await context.Books.SingleAsync()).FolderId);
    }

    [Fact]
    public async Task CreateBook_WithoutAFolder_StaysAtTheRoot()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        await CreateBooksController(context, userId).CreateBook(BookDto(null));

        context.ChangeTracker.Clear();
        Assert.Null((await context.Books.SingleAsync()).FolderId);
    }

    [Fact]
    public async Task CreateBook_RejectsAnotherUsersFolder()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var result = await CreateBooksController(context, userId).CreateBook(BookDto(OtherUsersFolder));

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await context.Books.ToListAsync());
    }

    [Fact]
    public async Task UploadBook_FilesTheBookInTheGivenFolder_AndRejectsAnotherUsersFolder()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);
        var controller = CreateBooksController(context, userId);

        var rejected = await controller.UploadBook(UploadDto(OtherUsersFolder));
        Assert.IsType<BadRequestObjectResult>(rejected.Result);
        Assert.Empty(await context.Books.ToListAsync());

        var created = await controller.UploadBook(UploadDto(OwnFolder));
        Assert.IsType<CreatedAtActionResult>(created.Result);
        context.ChangeTracker.Clear();
        Assert.Equal(OwnFolder, (await context.Books.SingleAsync()).FolderId);
    }

    [Fact]
    public async Task CreateText_FilesTheTextInTheGivenFolder()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var result = await CreateTextsController(context, userId).CreateText(new CreateTextDto
        {
            Title = "Foldered",
            Content = "Hola mundo.",
            LanguageId = 1,
            FolderId = OwnFolder
        });

        Assert.IsType<CreatedAtActionResult>(result.Result);
        context.ChangeTracker.Clear();
        Assert.Equal(OwnFolder, (await context.Texts.SingleAsync()).FolderId);
    }

    [Fact]
    public async Task CreateText_RejectsAnotherUsersFolder()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);

        var result = await CreateTextsController(context, userId).CreateText(new CreateTextDto
        {
            Title = "Sneaky",
            Content = "Hola mundo.",
            LanguageId = 1,
            FolderId = OtherUsersFolder
        });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(await context.Texts.ToListAsync());
    }

    [Fact]
    public async Task GetBook_AndGetText_ReturnTheFolder()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        Seed(context, userId);
        context.Books.Add(new Book { BookId = 5, UserId = userId, LanguageId = 1, Title = "Book", FolderId = OwnFolder });
        context.Texts.Add(new Text { TextId = 50, UserId = userId, LanguageId = 1, Title = "Text", Content = "hola", FolderId = OwnFolder });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var book = await CreateBooksController(context, userId).GetBook(5);
        var text = await CreateTextsController(context, userId).GetText(50);

        Assert.Equal(OwnFolder, book.Value!.FolderId);
        Assert.Equal(OwnFolder, text.Value!.FolderId);
    }

    // ---- helpers ----

    private static void Seed(AppDbContext context, Guid userId)
    {
        var otherId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Users.Add(new User { Id = otherId, UserName = "other", Email = "other@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.Folders.Add(new Folder { FolderId = OwnFolder, UserId = userId, Name = "Mine" });
        context.Folders.Add(new Folder { FolderId = OtherUsersFolder, UserId = otherId, Name = "Theirs" });
        context.SaveChanges();
        context.ChangeTracker.Clear();
    }

    private static CreateBookDto BookDto(int? folderId) => new()
    {
        Title = "Libro",
        Description = "",
        LanguageId = 1,
        Content = "Primer parrafo.\n\nSegundo parrafo.",
        SplitMethod = "paragraph",
        FolderId = folderId
    };

    private static UploadBookDto UploadDto(int? folderId)
    {
        var bytes = Encoding.UTF8.GetBytes("Primer parrafo del libro.\n\nSegundo parrafo del libro.");
        var file = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "File", "libro.txt")
        {
            Headers = new HeaderDictionary(),
            ContentType = "text/plain"
        };
        return new UploadBookDto { LanguageId = 1, File = file, SplitMethod = "paragraph", FolderId = folderId };
    }

    private static BooksController CreateBooksController(AppDbContext context, Guid userId) =>
        WithUser(new BooksController(context, NullLogger<BooksController>.Instance, new ChapterDetectionService(), hardcoverService: null, wordLinkingChannel: null), userId);

    private static TextsController CreateTextsController(AppDbContext context, Guid userId)
    {
        var services = new ServiceCollection();
        services.AddSingleton(context);
        var stats = new StatsRecomputeService(services.BuildServiceProvider(), NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        var activity = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        return WithUser(new TextsController(context, NullLogger<TextsController>.Instance, activity, new WordLinkingChannel(), stats), userId);
    }

    private static T WithUser<T>(T controller, Guid userId) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                ], "TestAuth"))
            }
        };
        return controller;
    }

    private static AppDbContext CreateContext() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString())
        // InMemory is non-transactional; the book import's BeginTransactionAsync() becomes a no-op.
        .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
        .Options);
}
