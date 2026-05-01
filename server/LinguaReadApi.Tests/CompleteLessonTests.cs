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
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Data.Sqlite;
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
        Assert.Equal(1, langStats.TotalTextCompletions);

        var text = await context.Texts.SingleAsync(t => t.TextId == firstTextId);
        Assert.True(text.IsFinished);
        Assert.NotNull(text.LastCompletedAt);

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
        Assert.Equal(2, langStats.TotalTextCompletions);
        var book = await context.Books.SingleAsync();
        Assert.True(book.IsFinished);
    }

    [Fact]
    public async Task FinishBook_AfterCompletingAllLessons_DoesNotCreditBookWordsAgain()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var secondTextId = firstTextId + 1;

        var controller = CreateController(context, userId);
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = secondTextId });

        context.ChangeTracker.Clear();
        var result = await controller.FinishBook(bookId);

        var stats = Assert.IsType<BookStatsDto>(result.Value);
        Assert.True(stats.IsFinished);

        context.ChangeTracker.Clear();

        var language = await context.Languages.SingleAsync();
        Assert.Equal(4, language.WordsRead);

        var activities = await context.UserActivities.OrderBy(a => a.ActivityId).ToListAsync();
        Assert.Equal(2, activities.Count);
        Assert.All(activities, activity => Assert.Equal("TextCompleted", activity.ActivityType));
        Assert.Equal(4, activities.Sum(a => a.WordCount));

        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, langStats.TotalWordsRead);
        Assert.Equal(2, langStats.TotalTextsCompleted);
        Assert.Equal(2, langStats.TotalTextCompletions);
    }

    [Fact]
    public async Task FinishBook_CreditsOnlyUnfinishedLessonsAndMarksTextsFinished()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        var controller = CreateController(context, userId);
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        context.ChangeTracker.Clear();
        var result = await controller.FinishBook(bookId);

        var stats = Assert.IsType<BookStatsDto>(result.Value);
        Assert.True(stats.IsFinished);

        context.ChangeTracker.Clear();

        var language = await context.Languages.SingleAsync();
        Assert.Equal(4, language.WordsRead);

        var activities = await context.UserActivities.OrderBy(a => a.ActivityId).ToListAsync();
        Assert.Equal(2, activities.Count);
        Assert.Equal("TextCompleted", activities[0].ActivityType);
        Assert.Equal(3, activities[0].WordCount);
        Assert.Equal("BookFinished", activities[1].ActivityType);
        Assert.Equal(1, activities[1].WordCount);

        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, langStats.TotalWordsRead);
        Assert.Equal(2, langStats.TotalTextsCompleted);
        Assert.Equal(2, langStats.TotalTextCompletions);

        var texts = await context.Texts.OrderBy(t => t.TextId).ToListAsync();
        Assert.All(texts, text => Assert.True(text.IsFinished));
        Assert.All(texts, text => Assert.NotNull(text.LastCompletedAt));
    }

    [Fact]
    public async Task CompleteLesson_DoesNotPromoteWordStatuses()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

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
        Assert.Equal(3, reloadedHola.Status);
        Assert.Equal(5, reloadedMundo.Status);
    }

    [Fact]
    public async Task CompleteLesson_DoesNotPromoteWordsInBookLanguage()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        context.Languages.Add(new Language { LanguageId = 2, Name = "Portuguese", Code = "PT" });
        context.Words.AddRange(
            new Word { WordId = 12, UserId = userId, LanguageId = 2, Term = "hola", Status = 1 },
            new Word { WordId = 13, UserId = userId, LanguageId = 1, Term = "hola", Status = 3 });
        context.TextWords.Add(new TextWord { TextWordId = 120, TextId = firstTextId, WordId = 13 });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        context.ChangeTracker.Clear();
        var otherLanguageWord = await context.Words.SingleAsync(w => w.WordId == 12);
        var bookLanguageWord = await context.Words.SingleAsync(w => w.WordId == 13);
        Assert.Equal(1, otherLanguageWord.Status);
        Assert.Equal(3, bookLanguageWord.Status);
    }

    [Fact]
    public async Task CompleteLesson_RecomputesBookWordStats_FromCurrentStatuses()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        context.Words.AddRange(
            new Word { WordId = 30, UserId = userId, LanguageId = 1, Term = "hola", Status = 3 },
            new Word { WordId = 31, UserId = userId, LanguageId = 1, Term = "amigo", Status = 1 },
            new Word { WordId = 32, UserId = userId, LanguageId = 1, Term = "mundo", Status = 5 });
        context.TextWords.AddRange(
            new TextWord { TextWordId = 300, TextId = firstTextId, WordId = 30 },
            new TextWord { TextWordId = 301, TextId = firstTextId, WordId = 31 },
            new TextWord { TextWordId = 302, TextId = firstTextId, WordId = 32 });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var result = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        var stats = Assert.IsType<BookStatsDto>(result.Value);
        Assert.Equal(3, stats.TotalWords);
        Assert.Equal(1, stats.KnownWords); // mundo is mastered
        Assert.Equal(1, stats.LearningWords); // hola remains learning

        context.ChangeTracker.Clear();
        var book = await context.Books.SingleAsync();
        Assert.Equal(stats.TotalWords, book.TotalWords);
        Assert.Equal(stats.KnownWords, book.KnownWords);
        Assert.Equal(stats.LearningWords, book.LearningWords);
    }

    [Fact]
    public async Task CompleteLesson_DeduplicatesBookWordStats_AcrossRepeatedLinks()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        var secondTextId = firstTextId + 1;
        context.Words.Add(new Word { WordId = 40, UserId = userId, LanguageId = 1, Term = "hola", Status = 3 });
        context.TextWords.AddRange(
            new TextWord { TextWordId = 400, TextId = firstTextId, WordId = 40 },
            new TextWord { TextWordId = 401, TextId = firstTextId, WordId = 40 },
            new TextWord { TextWordId = 402, TextId = secondTextId, WordId = 40 });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var result = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        var stats = Assert.IsType<BookStatsDto>(result.Value);
        Assert.Equal(1, stats.TotalWords);
        Assert.Equal(0, stats.KnownWords);
        Assert.Equal(1, stats.LearningWords);
    }

    [Fact]
    public async Task CompleteLesson_DedupsImmediateRetry()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        var word = new Word { WordId = 20, UserId = userId, LanguageId = 1, Term = "hola", Status = 3 };
        context.Words.Add(word);
        context.TextWords.Add(new TextWord { TextWordId = 200, TextId = firstTextId, WordId = 20 });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        // Immediate second call — simulates a retry on a flaky connection / double-click.
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        context.ChangeTracker.Clear();

        // None of the counters should double.
        var language = await context.Languages.SingleAsync();
        Assert.Equal(3, language.WordsRead);
        Assert.Single(await context.UserActivities.ToListAsync());

        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(3, langStats.TotalWordsRead);
        Assert.Equal(1, langStats.TotalTextsCompleted);
        Assert.Equal(1, langStats.TotalTextCompletions);

        var reloadedWord = await context.Words.SingleAsync(w => w.WordId == 20);
        Assert.Equal(3, reloadedWord.Status);
    }

    [Fact]
    public async Task CompleteLesson_CountsReread_WhenPastRetryWindow()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        var controller = CreateController(context, userId);
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        // Push the last-completed timestamp well outside the retry window.
        var completedText = await context.Texts.SingleAsync(t => t.TextId == firstTextId);
        completedText.LastCompletedAt = DateTime.UtcNow.AddMinutes(-5);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        // Re-read.
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        context.ChangeTracker.Clear();
        var language = await context.Languages.SingleAsync();
        Assert.Equal(6, language.WordsRead); // 3 + 3, re-read credits word volume

        var activities = await context.UserActivities.ToListAsync();
        Assert.Equal(2, activities.Count); // re-read logs a new activity row (streak coverage)

        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(6, langStats.TotalWordsRead);
        Assert.Equal(1, langStats.TotalTextsCompleted);   // unique texts stays at 1
        Assert.Equal(2, langStats.TotalTextCompletions);  // completions (with repeats) = 2
    }

    [Fact]
    public async Task CompleteLesson_Dedups_WhenCallerContextHasStaleTrackedText()
    {
        var dbName = Guid.NewGuid().ToString();
        var root = new InMemoryDatabaseRoot();
        var options = CreateSharedInMemoryOptions(dbName, root);
        var userId = Guid.NewGuid();

        await using (var seedContext = new AppDbContext(options))
        {
            SeedBookWithTwoParts(seedContext, userId, out _, out _);
        }

        await using var staleContext = new AppDbContext(options);
        await using var freshContext = new AppDbContext(options);

        // Track the text before completion so this context has a stale copy (LastCompletedAt == null).
        var staleText = await staleContext.Texts.SingleAsync(t => t.TextId == 1);
        Assert.Null(staleText.LastCompletedAt);

        // Complete once with a different context.
        var freshController = CreateController(freshContext, userId);
        await freshController.CompleteLesson(1, new CompleteLessonDto { TextId = 1 });

        // Replay on the stale context should still dedup (controller clears tracker and re-reads).
        var staleController = CreateController(staleContext, userId);
        await staleController.CompleteLesson(1, new CompleteLessonDto { TextId = 1 });

        await using var verifyContext = new AppDbContext(options);
        Assert.Single(await verifyContext.UserActivities.ToListAsync());
        var langStats = await verifyContext.UserLanguageStatistics.SingleAsync();
        Assert.Equal(1, langStats.TotalTextCompletions);
        Assert.Equal(1, langStats.TotalTextsCompleted);
    }

    [Fact]
    public async Task CompleteLesson_DedupsConcurrentDuplicateRequests()
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = $"CompleteLessonConcurrency{Guid.NewGuid():N}",
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared
        }.ToString();

        await using var keepAliveConnection = new SqliteConnection(connectionString);
        await keepAliveConnection.OpenAsync();

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connectionString)
            .Options;

        var userId = Guid.NewGuid();
        await using (var setupContext = new AppDbContext(options))
        {
            await setupContext.Database.EnsureCreatedAsync();
            SeedBookWithTwoParts(setupContext, userId, out _, out _);
        }

        await using var context1 = new AppDbContext(options);
        await using var context2 = new AppDbContext(options);

        var controller1 = CreateController(context1, userId);
        var controller2 = CreateController(context2, userId);

        var task1 = controller1.CompleteLesson(1, new CompleteLessonDto { TextId = 1 });
        var task2 = controller2.CompleteLesson(1, new CompleteLessonDto { TextId = 1 });
        await Task.WhenAll(task1, task2);

        await using var verifyContext = new AppDbContext(options);
        Assert.Single(await verifyContext.UserActivities.ToListAsync());
        var langStats = await verifyContext.UserLanguageStatistics.SingleAsync();
        Assert.Equal(1, langStats.TotalTextCompletions);
        Assert.Equal(1, langStats.TotalTextsCompleted);
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

    [Fact]
    public async Task CompleteLesson_WhenHardcoverServiceConfigured_TriggersNonBlockingProgressSync()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var hardcoverService = new RecordingHardcoverService();

        var controller = CreateController(context, userId, hardcoverService);

        var result = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        Assert.IsType<BookStatsDto>(result.Value);
        Assert.Equal(1, hardcoverService.SyncCalls);
        Assert.Equal(userId, hardcoverService.LastUserId);
        Assert.Equal(bookId, hardcoverService.LastBookId);
        Assert.True(hardcoverService.LastRequireSyncEnabled);
    }

    [Fact]
    public async Task CompleteLesson_WhenHardcoverSyncFails_StillCompletesLesson()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var hardcoverService = new RecordingHardcoverService
        {
            ThrowOnSync = true
        };

        var controller = CreateController(context, userId, hardcoverService);

        var result = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        var stats = Assert.IsType<BookStatsDto>(result.Value);
        Assert.Equal(50.0, stats.CompletionPercentage);
        Assert.Equal(1, hardcoverService.SyncCalls);
        var text = await context.Texts.SingleAsync(t => t.TextId == firstTextId);
        Assert.True(text.IsFinished);
    }

    [Fact]
    public async Task FinishBook_WhenHardcoverServiceConfigured_TriggersProgressSync()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out _);
        var hardcoverService = new RecordingHardcoverService();

        var controller = CreateController(context, userId, hardcoverService);

        var result = await controller.FinishBook(bookId);

        Assert.IsType<BookStatsDto>(result.Value);
        Assert.Equal(1, hardcoverService.SyncCalls);
        Assert.Equal(bookId, hardcoverService.LastBookId);
        Assert.True(hardcoverService.LastRequireSyncEnabled);
    }

    // --- Helpers ---

    private static BooksController CreateController(AppDbContext context, Guid userId, IHardcoverService? hardcoverService = null)
    {
        return new BooksController(context, NullLogger<BooksController>.Instance, hardcoverService)
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

    private static DbContextOptions<AppDbContext> CreateSharedInMemoryOptions(string dbName, InMemoryDatabaseRoot root)
    {
        return new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(dbName, root)
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
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

    private sealed class RecordingHardcoverService : IHardcoverService
    {
        public int SyncCalls { get; private set; }
        public Guid LastUserId { get; private set; }
        public int LastBookId { get; private set; }
        public bool LastRequireSyncEnabled { get; private set; }
        public bool ThrowOnSync { get; init; }

        public Task<HardcoverConnectionResult> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HardcoverConnectionResult(true, true, true, 1, "reader", "ok"));

        public Task<HardcoverMatchResult> MatchBookAsync(Guid userId, int bookId, int? hardcoverBookId = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HardcoverMatchResult(false, null, [], "not used"));

        public Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HardcoverMetadataImportResult(false, [], [], "not used"));

        public Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, CancellationToken cancellationToken = default)
        {
            SyncCalls++;
            LastUserId = userId;
            LastBookId = bookId;
            LastRequireSyncEnabled = requireSyncEnabled;
            if (ThrowOnSync)
            {
                throw new InvalidOperationException("Hardcover unavailable");
            }

            return Task.FromResult(new HardcoverProgressSyncResult(bookId, true, false, 50, 2, 100, "synced"));
        }

        public Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HardcoverSyncAllResult([], "not used"));
    }
}
