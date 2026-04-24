using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.InMemory.Infrastructure.Internal;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class CompleteLessonTests
{
    [Fact]
    public async Task CompleteLesson_UpdatesAllCountersAndMarksPartFinished()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        var controller = CreateController(context, userId);
        var result = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        var stats = Assert.IsType<BookStatsDto>(result.Value);
        Assert.False(stats.IsFinished);
        Assert.Equal(50.0, stats.CompletionPercentage);

        context.ChangeTracker.Clear();

        var language = await context.Languages.SingleAsync();
        Assert.Equal(3, language.WordsRead); // "hola amigo mundo" = 3 tokens

        var activity = await context.UserActivities.SingleAsync();
        Assert.Equal("TextCompleted", activity.ActivityType);
        Assert.Equal(3, activity.WordCount);

        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(3, langStats.TotalWordsRead);
        Assert.Equal(1, langStats.TotalTextsCompleted);

        var text = await context.Texts.SingleAsync(t => t.TextId == firstTextId);
        Assert.True(text.IsFinished);

        var book = await context.Books.SingleAsync();
        Assert.False(book.IsFinished);
        Assert.Equal(firstTextId, book.LastReadTextId);
    }

    [Fact]
    public async Task CompleteLesson_MarksBookFinished_OnLastPart()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var secondTextId = firstTextId + 1;

        var controller = CreateController(context, userId);
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        var second = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = secondTextId });

        var stats = Assert.IsType<BookStatsDto>(second.Value);
        Assert.True(stats.IsFinished);
        Assert.Equal(100.0, stats.CompletionPercentage);

        context.ChangeTracker.Clear();
        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(2, langStats.TotalTextsCompleted);
        var book = await context.Books.SingleAsync();
        Assert.True(book.IsFinished);
    }

    [Fact]
    public async Task CompleteLesson_PromotesKnownWords_ButCapsAtFive()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        // Link two of the three tokens to user-owned words so the promotion path runs.
        var wordHola = new Word { WordId = 10, UserId = userId, LanguageId = 1, Term = "hola", Status = 3 };
        var wordMundo = new Word { WordId = 11, UserId = userId, LanguageId = 1, Term = "mundo", Status = 5 };
        context.Words.AddRange(wordHola, wordMundo);
        context.TextWords.AddRange(
            new TextWord { TextWordId = 100, TextId = firstTextId, WordId = 10 },
            new TextWord { TextWordId = 101, TextId = firstTextId, WordId = 11 });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        context.ChangeTracker.Clear();
        var reloadedHola = await context.Words.SingleAsync(w => w.WordId == 10);
        var reloadedMundo = await context.Words.SingleAsync(w => w.WordId == 11);
        Assert.Equal(4, reloadedHola.Status); // 3 -> 4
        Assert.Equal(5, reloadedMundo.Status); // already mastered, no change
    }

    [Fact]
    public async Task CompleteLesson_ReturnsNotFound_ForOtherUsersBook()
    {
        await using var context = CreateContext();
        var ownerId = Guid.NewGuid();
        var intruderId = Guid.NewGuid();
        SeedBookWithTwoParts(context, ownerId, out var bookId, out var firstTextId);
        context.Users.Add(new User { Id = intruderId, UserName = "intruder", Email = "x@y.z" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, intruderId);
        var result = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task CompleteLesson_ReturnsNotFound_WhenTextBelongsToDifferentBook()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var _);

        // Create a second book + text that doesn't belong to the first book.
        var foreignBook = new Book { BookId = bookId + 1, UserId = userId, LanguageId = 1, Title = "Other" };
        var foreignText = new Text
        {
            TextId = 999,
            BookId = foreignBook.BookId,
            UserId = userId,
            LanguageId = 1,
            Title = "Foreign",
            Content = "hola",
            PartNumber = 1
        };
        context.Books.Add(foreignBook);
        context.Texts.Add(foreignText);
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var result = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = foreignText.TextId });

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    // --- Helpers ---

    private static BooksController CreateController(AppDbContext context, Guid userId)
    {
        return new BooksController(context, NullLogger<BooksController>.Instance)
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

    private static void SeedBookWithTwoParts(AppDbContext context, Guid userId, out int bookId, out int firstTextId)
    {
        bookId = 1;
        firstTextId = 1;
        var secondTextId = 2;

        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES", WordsRead = 0 });
        context.Books.Add(new Book
        {
            BookId = bookId,
            UserId = userId,
            LanguageId = 1,
            Title = "Test Book"
        });
        context.Texts.AddRange(
            new Text
            {
                TextId = firstTextId,
                BookId = bookId,
                UserId = userId,
                LanguageId = 1,
                Title = "Part 1",
                Content = "hola amigo mundo",
                PartNumber = 1
            },
            new Text
            {
                TextId = secondTextId,
                BookId = bookId,
                UserId = userId,
                LanguageId = 1,
                Title = "Part 2",
                Content = "adios",
                PartNumber = 2
            });
        context.SaveChanges();
    }
}
