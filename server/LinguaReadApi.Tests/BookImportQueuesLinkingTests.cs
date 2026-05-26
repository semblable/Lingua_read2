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

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            // InMemory is non-transactional; suppress the warning so BeginTransactionAsync() is a no-op instead of throwing.
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        return new AppDbContext(options);
    }

    private static void SeedUserAndLanguage(AppDbContext context, Guid userId)
    {
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
        context.SaveChanges();
        context.ChangeTracker.Clear();
    }
}
