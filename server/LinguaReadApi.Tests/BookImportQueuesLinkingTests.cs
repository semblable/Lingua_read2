using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.InMemory.Infrastructure.Internal;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Regression coverage for the gap that left newly-imported books
/// stuck at "% new" = nothing until the next app restart: BooksController
/// was saving Text rows but never queueing them on WordLinkingChannel,
/// so background linking only ran on startup via WordLinkingMigrationService.
/// </summary>
public class BookImportQueuesLinkingTests
{
    [Fact]
    public async Task CreateBook_QueuesAllPartsForBackgroundLinking_AndMarksThemProcessing()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);

        var channel = new WordLinkingChannel();
        var controller = CreateController(context, userId, channel);

        // Three short paragraphs → three parts under the default split.
        var dto = new CreateBookDto
        {
            Title = "Test",
            Description = "",
            LanguageId = 1,
            Content = "Primer parrafo de prueba.\n\nSegundo parrafo distinto.\n\nTercer parrafo final.",
            SplitMethod = "paragraph",
            MaxSegmentSize = 3000
        };

        var result = await controller.CreateBook(dto);
        Assert.IsType<CreatedAtActionResult>(result.Result);

        // Drain the channel; every saved Text should have its TextId
        // present in a queued WordLinkingRequest, with content matching
        // what was persisted.
        var queued = new List<WordLinkingRequest>();
        while (channel.Reader.TryRead(out var req))
        {
            queued.Add(req);
        }

        var savedTexts = await context.Texts.AsNoTracking().OrderBy(t => t.PartNumber).ToListAsync();
        Assert.NotEmpty(savedTexts);
        Assert.Equal(savedTexts.Count, queued.Count);
        Assert.All(savedTexts, t => Assert.Equal("processing", t.WordLinkingStatus));

        var queuedIds = queued.Select(r => r.TextId).ToHashSet();
        Assert.All(savedTexts, t => Assert.Contains(t.TextId, queuedIds));
    }

    [Fact]
    public async Task CreateBook_SavesProcessingBeforeAnyRequestIsReadable()
    {
        // Staging book 29 (317 parts) ended with parts 1-216 stuck at
        // "processing": the import wrote every request and only then saved
        // the status, putting back parts the worker had already marked
        // "completed" on its own context. The save that persists
        // "processing" has to happen while the channel is still empty.
        var options = CreateOptions();
        await using var context = new AppDbContext(options);
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);

        var channel = new WordLinkingChannel();
        var controller = CreateController(context, userId, channel);

        var queuedWhenProcessingSaved = new List<int>();
        context.SavingChanges += (_, _) =>
        {
            var savesProcessing = context.ChangeTracker.Entries<Text>().Any(e =>
                e.State == EntityState.Modified &&
                e.Property(t => t.WordLinkingStatus).IsModified &&
                e.Entity.WordLinkingStatus == "processing");
            if (savesProcessing) queuedWhenProcessingSaved.Add(channel.Reader.Count);
        };

        const int partCount = 5;
        var result = await controller.CreateBook(ManyPartsBook(partCount));
        Assert.IsType<CreatedAtActionResult>(result.Result);

        Assert.Equal(0, Assert.Single(queuedWhenProcessingSaved));

        // What the worker sees: every readable request's text is already
        // persisted as "processing".
        await using var workerContext = new AppDbContext(options);
        var seen = 0;
        while (channel.Reader.TryRead(out var request))
        {
            var text = await workerContext.Texts.AsNoTracking().SingleAsync(t => t.TextId == request.TextId);
            Assert.Equal("processing", text.WordLinkingStatus);
            seen++;
        }
        Assert.Equal(partCount, seen);
    }

    [Fact]
    public async Task CreateBook_WithManyParts_ReturnsWithoutWaitingForTheWorker()
    {
        // Nothing reads the channel here. With the old bound of 100 the
        // import blocked on part 101 until the worker caught up, holding
        // the HTTP request open while most of the book was linked.
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);

        var channel = new WordLinkingChannel();
        var controller = CreateController(context, userId, channel);

        const int partCount = 250;
        var result = await controller.CreateBook(ManyPartsBook(partCount)).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal(partCount, channel.Reader.Count);
    }

    [Fact]
    public async Task CreateBook_WithoutChannel_StillSucceeds_AndDoesNotMarkTextsProcessing()
    {
        // Channel is optional (constructor param defaults to null) — when
        // absent, the book just won't auto-link, but creation must not throw.
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);

        var controller = CreateController(context, userId, channel: null);

        var dto = new CreateBookDto
        {
            Title = "Test",
            Description = "",
            LanguageId = 1,
            Content = "Algo de contenido.",
            SplitMethod = "paragraph",
            MaxSegmentSize = 3000
        };

        var result = await controller.CreateBook(dto);
        Assert.IsType<CreatedAtActionResult>(result.Result);

        var savedTexts = await context.Texts.AsNoTracking().ToListAsync();
        Assert.NotEmpty(savedTexts);
        Assert.All(savedTexts, t => Assert.Null(t.WordLinkingStatus));
    }

    // --- Helpers ---

    private static BooksController CreateController(AppDbContext context, Guid userId, WordLinkingChannel? channel)
    {
        return new BooksController(context, NullLogger<BooksController>.Instance, new ChapterDetectionService(), hardcoverService: null, wordLinkingChannel: channel)
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

    private static AppDbContext CreateContext() => new(CreateOptions());

    private static DbContextOptions<AppDbContext> CreateOptions()
    {
        return new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            // InMemory is non-transactional; suppress the warning so BeginTransactionAsync() is a no-op instead of throwing.
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
    }

    // Paragraphs longer than MaxSegmentSize → one part per paragraph.
    private static CreateBookDto ManyPartsBook(int partCount) => new()
    {
        Title = "Many parts",
        Description = "",
        LanguageId = 1,
        Content = string.Join("\n\n", Enumerable.Range(1, partCount).Select(i => $"Parrafo numero {i} del libro.")),
        SplitMethod = "paragraph",
        MaxSegmentSize = 10
    };

    private static void SeedUserAndLanguage(AppDbContext context, Guid userId)
    {
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
        context.SaveChanges();
        context.ChangeTracker.Clear();
    }
}
