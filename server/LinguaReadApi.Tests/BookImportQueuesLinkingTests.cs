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
    public async Task CreateBook_LargerThanChannel_PersistsProcessingBeforeEnqueue_AndKeepsWorkerCompletions()
    {
        // Staging book 29 (317 parts) ended with parts 1-216 stuck at
        // "processing": the import set the status in memory, wrote every
        // request, and saved only after the loop. The channel is bounded,
        // so the writes past its capacity waited on the worker, which
        // meanwhile marked the early parts "completed" on its own context;
        // the final save put them back. With capacity + 2 parts the worker
        // is guaranteed to take the first request before the import can
        // finish enqueueing, so the old ordering fails every run.
        var partCount = MeasureChannelCapacity() + 2;

        var options = CreateOptions();
        await using var context = new AppDbContext(options);
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);

        var channel = new WordLinkingChannel();
        var controller = CreateController(context, userId, channel);

        // Stand-in for WordLinkingBackgroundService: record the status a
        // separate context sees once each request is readable, then mark
        // the text "completed" the way the worker does. It never throws,
        // so a failure can't leave the import blocked on a full channel.
        var statusesSeenByWorker = new List<string?>();
        var worker = Task.Run(async () =>
        {
            for (var i = 0; i < partCount; i++)
            {
                var request = await channel.Reader.ReadAsync();
                await using var workerContext = new AppDbContext(options);
                var text = await workerContext.Texts.FindAsync(request.TextId);
                statusesSeenByWorker.Add(text?.WordLinkingStatus);
                if (text == null) continue;
                text.WordLinkingStatus = "completed";
                await workerContext.SaveChangesAsync();
            }
        });

        var dto = new CreateBookDto
        {
            Title = "Large",
            Description = "",
            LanguageId = 1,
            Content = string.Join("\n\n", Enumerable.Range(1, partCount).Select(i => $"Parrafo numero {i} del libro.")),
            SplitMethod = "paragraph",
            MaxSegmentSize = 10 // shorter than any paragraph → one part each
        };

        var result = await controller.CreateBook(dto).WaitAsync(TimeSpan.FromSeconds(30));
        Assert.IsType<CreatedAtActionResult>(result.Result);
        await worker.WaitAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(partCount, statusesSeenByWorker.Count);
        Assert.All(statusesSeenByWorker, s => Assert.Equal("processing", s));

        await using var verifyContext = new AppDbContext(options);
        var savedStatuses = await verifyContext.Texts.AsNoTracking().Select(t => t.WordLinkingStatus).ToListAsync();
        Assert.Equal(partCount, savedStatuses.Count);
        Assert.All(savedStatuses, s => Assert.Equal("completed", s));
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

    // Probed rather than hard-coded so the regression test above keeps
    // outrunning the channel if its capacity changes. Capped in case it
    // ever becomes unbounded.
    private static int MeasureChannelCapacity()
    {
        var probe = new WordLinkingChannel();
        var capacity = 0;
        while (capacity < 1000 && probe.Writer.TryWrite(new WordLinkingRequest(0, "", 0, Guid.Empty)))
        {
            capacity++;
        }
        return capacity;
    }

    private static void SeedUserAndLanguage(AppDbContext context, Guid userId)
    {
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
        context.SaveChanges();
        context.ChangeTracker.Clear();
    }
}
