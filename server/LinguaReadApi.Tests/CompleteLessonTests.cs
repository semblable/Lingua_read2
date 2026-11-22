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
    public async Task Completion_PreservesSharedLanguageCounter_AndOtherLearnersStatistics()
    {
        await using var context = CreateContext();
        var user = Guid.NewGuid();
        SeedBookWithTwoParts(context, user, out var book, out var text);
        (await context.Languages.SingleAsync()).WordsRead = 777;
        var other = Guid.NewGuid();
        context.Users.Add(new User { Id = other, UserName = "another learner" });
        context.UserLanguageStatistics.Add(new UserLanguageStatistics { UserId = other, LanguageId = 1, TotalWordsRead = 999 });
        await context.SaveChangesAsync();
        await CreateController(context, user).CompleteLesson(book, new CompleteLessonDto { TextId = text });
        context.ChangeTracker.Clear();
        Assert.Equal(777, (await context.Languages.SingleAsync()).WordsRead);
        Assert.Equal(999, (await context.UserLanguageStatistics.SingleAsync(s => s.UserId == other)).TotalWordsRead);
        Assert.Equal(3, (await context.UserLanguageStatistics.SingleAsync(s => s.UserId == user)).TotalWordsRead);
    }
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
        Assert.Equal(0, language.WordsRead); // Activity belongs to the user, not the shared language.

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
        var result = await controller.FinishBook(bookId, new FinishBookRequest());

        Assert.IsType<NoContentResult>(result);

        context.ChangeTracker.Clear();

        var language = await context.Languages.SingleAsync();
        // Finishing must not change language word counts beyond what completion already credited.
        Assert.Equal(0, language.WordsRead); // Activity belongs to the user, not the shared language.

        var activities = await context.UserActivities.OrderBy(a => a.ActivityId).ToListAsync();
        Assert.Equal(2, activities.Count);
        Assert.All(activities, activity => Assert.Equal("TextCompleted", activity.ActivityType));
        Assert.DoesNotContain(activities, a => a.ActivityType == "BookFinished");
        Assert.Equal(4, activities.Sum(a => a.WordCount));

        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, langStats.TotalWordsRead);
        Assert.Equal(2, langStats.TotalTextsCompleted);
        Assert.Equal(2, langStats.TotalTextCompletions);

        var book = await context.Books.SingleAsync();
        Assert.True(book.IsFinished);
    }

    [Fact]
    public async Task FinishBook_DoesNotCreditUnfinishedLessons_ButMarksThemFinished()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        var controller = CreateController(context, userId);
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        context.ChangeTracker.Clear();
        var result = await controller.FinishBook(bookId, new FinishBookRequest());

        Assert.IsType<NoContentResult>(result);

        context.ChangeTracker.Clear();

        var language = await context.Languages.SingleAsync();
        // Only the one completed lesson contributed (3 words). Finishing must NOT add the unread part's words.
        Assert.Equal(0, language.WordsRead); // Activity belongs to the user, not the shared language.

        var activities = await context.UserActivities.OrderBy(a => a.ActivityId).ToListAsync();
        Assert.Single(activities);
        Assert.Equal("TextCompleted", activities[0].ActivityType);
        Assert.Equal(3, activities[0].WordCount);
        Assert.DoesNotContain(activities, a => a.ActivityType == "BookFinished");

        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(3, langStats.TotalWordsRead);
        Assert.Equal(1, langStats.TotalTextsCompleted);
        Assert.Equal(1, langStats.TotalTextCompletions);

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
    public async Task CompleteLesson_AggregatesBookStats_FromTextWordOccurrenceCounts()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        var secondTextId = firstTextId + 1;
        // "hola" occurs twice in the first part and once in the second.
        // Book running-word totals must sum the OccurrenceCounts (=3),
        // not collapse to the single distinct word.
        context.Words.Add(new Word { WordId = 40, UserId = userId, LanguageId = 1, Term = "hola", Status = 3 });
        context.TextWords.AddRange(
            new TextWord { TextWordId = 400, TextId = firstTextId, WordId = 40, OccurrenceCount = 2 },
            new TextWord { TextWordId = 402, TextId = secondTextId, WordId = 40, OccurrenceCount = 1 });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var result = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });

        var stats = Assert.IsType<BookStatsDto>(result.Value);
        Assert.Equal(3, stats.TotalWords);
        Assert.Equal(0, stats.KnownWords);
        Assert.Equal(3, stats.LearningWords);
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
        Assert.Equal(0, language.WordsRead); // Activity belongs to the user, not the shared language.
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
        Assert.Equal(0, language.WordsRead); // Activity belongs to the user, not the shared language.

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

        var result = await controller.FinishBook(bookId, new FinishBookRequest());

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(1, hardcoverService.SyncCalls);
        Assert.Equal(bookId, hardcoverService.LastBookId);
        Assert.True(hardcoverService.LastRequireSyncEnabled);
        Assert.Null(hardcoverService.LastRating);
    }

    [Fact]
    public async Task FinishBook_WithRating_PersistsItBeforeTriggeringSync()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out _);
        var hardcoverService = new RecordingHardcoverService();

        var controller = CreateController(context, userId, hardcoverService);

        var result = await controller.FinishBook(bookId, new FinishBookRequest { Rating = 4.5m });

        Assert.IsType<NoContentResult>(result);
        Assert.Equal(1, hardcoverService.SyncCalls);
        Assert.Null(hardcoverService.LastRating);
        var stored = await context.Books.AsNoTracking().SingleAsync(b => b.BookId == bookId);
        Assert.Equal(4.5m, stored.HardcoverPendingRating);
        Assert.NotNull(stored.HardcoverPendingRatingId);

        await controller.FinishBook(bookId, new FinishBookRequest());
        stored = await context.Books.AsNoTracking().SingleAsync(b => b.BookId == bookId);
        Assert.Equal(4.5m, stored.HardcoverPendingRating);
    }

    [Fact]
    public async Task FinishBook_WithOutOfRangeRating_ReturnsBadRequest()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out _);

        var controller = CreateController(context, userId);

        var tooLow = await controller.FinishBook(bookId, new FinishBookRequest { Rating = 0.0m });
        var tooHigh = await controller.FinishBook(bookId, new FinishBookRequest { Rating = 5.5m });

        Assert.IsType<BadRequestObjectResult>(tooLow);
        Assert.IsType<BadRequestObjectResult>(tooHigh);
    }

    [Fact]
    public async Task CompleteLesson_AndFinishBook_EnqueueOntoHardcoverSyncChannelWhenConfigured()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);

        var hardcoverService = new RecordingHardcoverService();
        var channel = new HardcoverSyncChannel();

        var controller = CreateController(context, userId, hardcoverService, channel);

        var lessonResult = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        Assert.IsType<BookStatsDto>(lessonResult.Value);

        var finishResult = await controller.FinishBook(bookId, new FinishBookRequest { Rating = 4.0m });
        Assert.IsType<NoContentResult>(finishResult);

        Assert.Equal(0, hardcoverService.SyncCalls);
        Assert.True(channel.Reader.TryRead(out var req));
        Assert.Equal(userId, req!.UserId);
        Assert.Equal(bookId, req.BookId);
        Assert.False(channel.Reader.TryRead(out _));
        Assert.Equal(4.0m, (await context.Books.AsNoTracking().SingleAsync()).HardcoverPendingRating);
    }

    [Fact]
    public async Task CompleteLesson_DedupedRetry_OnlyEnqueuesOntoHardcoverSyncChannelOnce()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var secondTextId = firstTextId + 1;
        var channel = new HardcoverSyncChannel();
        var controller = CreateController(context, userId, hardcoverSyncChannel: channel);

        // 1. Retry within 10s window
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        Assert.True(channel.Reader.TryRead(out var firstEnqueue));
        Assert.Equal(bookId, firstEnqueue!.BookId);

        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        Assert.False(channel.Reader.TryRead(out _));

        // 2. Retry with identical ClientEventId
        const string clientEventId = "event-12345678";
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = secondTextId, ClientEventId = clientEventId });
        Assert.True(channel.Reader.TryRead(out var secondEnqueue));
        Assert.Equal(bookId, secondEnqueue!.BookId);

        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = secondTextId, ClientEventId = clientEventId });
        Assert.False(channel.Reader.TryRead(out _));
    }

    [Fact]
    public async Task FinishBook_WithInvalidRatingOrNonExistentBook_DoesNotEnqueueOntoHardcoverSyncChannel()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out _);
        var channel = new HardcoverSyncChannel();
        var controller = CreateController(context, userId, hardcoverSyncChannel: channel);

        var badRating = await controller.FinishBook(bookId, new FinishBookRequest { Rating = 6.0m });
        Assert.IsType<BadRequestObjectResult>(badRating);
        Assert.False(channel.Reader.TryRead(out _));

        var notFound = await controller.FinishBook(bookId + 999, new FinishBookRequest { Rating = 4.0m });
        Assert.IsType<NotFoundObjectResult>(notFound);
        Assert.False(channel.Reader.TryRead(out _));
    }

    [Fact]
    public async Task GetBook_ReturnsIsFinishedTrue_AfterFinishBook()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out _);
        var controller = CreateController(context, userId);

        var before = await controller.GetBook(bookId);
        Assert.False(Assert.IsType<BookDetailDto>(before.Value).IsFinished);

        var finish = await controller.FinishBook(bookId, new FinishBookRequest());
        Assert.IsType<NoContentResult>(finish);

        context.ChangeTracker.Clear();
        var after = await controller.GetBook(bookId);
        var detail = Assert.IsType<BookDetailDto>(after.Value);
        Assert.True(detail.IsFinished);
        Assert.All(detail.Parts, p => Assert.True(p.IsFinished));
    }

    // --- Helpers ---

    [Fact]
    public async Task UndoBookFinish_RestoresTheSectionsAndKeepsEarnedCredit()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var controller = CreateController(context, userId);
        Assert.IsType<BookStatsDto>((await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId })).Value);
        var previousLastRead = (await context.Books.AsNoTracking().SingleAsync()).LastReadAt;
        var previousCompletion = (await context.Texts.AsNoTracking().SingleAsync(t => t.TextId == firstTextId)).LastCompletedAt;

        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, new FinishBookRequest { Rating = 4.5m }));
        var finishedAt = (await controller.GetBook(bookId)).Value!.UndoFinishAt;
        Assert.NotNull(finishedAt);
        Assert.IsType<NoContentResult>(await controller.UndoBookFinish(bookId, new() { FinishedAt = finishedAt.Value }));

        var book = await context.Books.AsNoTracking().SingleAsync();
        var sections = await context.Texts.AsNoTracking().OrderBy(t => t.PartNumber).ToListAsync();
        Assert.False(book.IsFinished);
        Assert.Equal(firstTextId, book.LastReadTextId);
        Assert.Equal(previousLastRead, book.LastReadAt);
        Assert.Null(book.HardcoverPendingRating);
        Assert.Null(book.FinishUndoJson);
        Assert.True(sections[0].IsFinished);
        Assert.Equal(previousCompletion, sections[0].LastCompletedAt);
        Assert.False(sections[1].IsFinished);
        Assert.Null(sections[1].LastCompletedAt);
        Assert.Equal(1, await context.LessonStudyEvents.CountAsync());
        Assert.Equal(3, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
    }

    [Fact]
    public async Task UndoBookFinish_DoesNotUndoANewerFinishFromAStaleDialogOrRetry()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out _);
        var controller = CreateController(context, userId);
        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, new FinishBookRequest { Rating = 4m }));
        var firstFinish = (await controller.GetBook(bookId)).Value!.UndoFinishAt!.Value;
        var undo = new UndoBookFinishRequest { FinishedAt = firstFinish };
        Assert.IsType<NoContentResult>(await controller.UndoBookFinish(bookId, undo));
        Assert.IsType<NoContentResult>(await controller.UndoBookFinish(bookId, undo));

        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, new FinishBookRequest { Rating = 5m }));
        Assert.IsType<ConflictObjectResult>(await controller.UndoBookFinish(bookId, undo));

        var book = await context.Books.AsNoTracking().SingleAsync();
        Assert.True(book.IsFinished);
        Assert.Equal(5m, book.HardcoverPendingRating);
        Assert.Equal(2, await context.Texts.CountAsync(text => text.IsFinished));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("TextCompleted", false)]
    [InlineData("BookFinished", false)]
    [InlineData(null, true)]
    public async Task UndoBookFinish_RecognizesOnlyLegacyFinishesWithSufficientEvidence(string? activityType, bool predatesStudyHistory)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var book = await context.Books.SingleAsync();
        var sections = await context.Texts.OrderBy(t => t.PartNumber).ToListAsync();
        var finishedAt = predatesStudyHistory ? new DateTime(2026, 4, 29, 17, 0, 0, DateTimeKind.Utc)
            : DateTime.UtcNow.AddMinutes(-10);
        book.LastReadAt = finishedAt;
        book.IsFinished = true;
        sections[0].IsFinished = true;
        sections[0].LastCompletedAt = finishedAt.AddHours(-1);
        sections[1].IsFinished = true;
        sections[1].LastCompletedAt = finishedAt;
        if (activityType != null)
        {
            context.UserActivities.Add(new UserActivity
            {
                UserId = userId, LanguageId = 1, ActivityType = activityType, Timestamp = finishedAt
            });
        }
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        var canUndo = activityType == null && !predatesStudyHistory;
        Assert.Equal(canUndo ? finishedAt : (DateTime?)null, (await controller.GetBook(bookId)).Value!.UndoFinishAt);
        var result = await controller.UndoBookFinish(bookId, new() { FinishedAt = finishedAt });

        if (canUndo)
            Assert.IsType<NoContentResult>(result);
        else
            Assert.IsType<ConflictObjectResult>(result);

        var saved = await context.Texts.AsNoTracking().OrderBy(t => t.PartNumber).ToListAsync();
        Assert.True(saved[0].IsFinished);
        Assert.Equal(!canUndo, saved[1].IsFinished);
    }

    [Fact]
    public async Task StartBookReread_ResetsCurrentProgressAndCountsNewPassesWithoutDuplicatingUniqueCredit()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        await using var context = new AppDbContext(options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var controller = CreateController(context, userId);
        var secondTextId = await context.Texts.Where(t => t.PartNumber == 2).Select(t => t.TextId).SingleAsync();
        Assert.IsType<BookStatsDto>((await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId })).Value);
        Assert.True((await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = secondTextId })).Value!.IsFinished);

        var startedAt = Assert.IsType<DateTime>(Assert.IsType<OkObjectResult>((await controller.StartBookReread(bookId)).Result).Value);
        var startedAgain = Assert.IsType<OkObjectResult>((await controller.StartBookReread(bookId)).Result);
        Assert.Equal(startedAt, Assert.IsType<DateTime>(startedAgain.Value));
        var book = (await controller.GetBook(bookId)).Value!;
        Assert.False(book.IsFinished);
        Assert.Null(book.LastReadTextId);
        Assert.All(book.Parts, part => Assert.False(part.IsFinished));
        Assert.Equal(0, Assert.Single((await controller.GetBooks()).Value!).FinishedPartCount);
        Assert.Equal(2, await context.Texts.CountAsync(text => text.IsFinished));

        await controller.UpdateLastRead(bookId, new UpdateLastReadDto
        {
            TextId = secondTextId, ClientUpdatedAt = startedAt.AddMinutes(-1)
        });
        Assert.Null((await controller.GetBook(bookId)).Value!.LastReadTextId);

        // Finishing immediately on a new pass is independent of the previous pass's retry window.
        var firstAgain = await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        Assert.Equal(50.0, firstAgain.Value!.CompletionPercentage);
        Assert.False(firstAgain.Value.IsFinished);
        Assert.Equal(1, Assert.Single((await controller.GetBooks()).Value!).FinishedPartCount);

        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, null));
        var finishedAt = (await controller.GetBook(bookId)).Value!.UndoFinishAt!.Value;
        Assert.IsType<NoContentResult>(await controller.UndoBookFinish(bookId, new() { FinishedAt = finishedAt }));
        var reopened = (await controller.GetBook(bookId)).Value!;
        Assert.False(reopened.IsFinished);
        Assert.True(reopened.Parts[0].IsFinished);
        Assert.False(reopened.Parts[1].IsFinished);
        Assert.Equal(2, await context.Texts.CountAsync(text => text.IsFinished));

        Assert.True((await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = secondTextId })).Value!.IsFinished);
        var statistics = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(2, statistics.TotalTextsCompleted);
        Assert.Equal(4, statistics.TotalTextCompletions);
        Assert.Equal(8, statistics.TotalWordsRead);
    }

    [Fact]
    public async Task Reread_ResetsSentenceCursorAndRejectsOlderOfflinePositions()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var controller = CreateController(context, userId);
        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, null));
        var oldCursorAt = DateTime.UtcNow.AddHours(-1);
        context.UserSentenceProgresses.Add(new UserSentenceProgress
        {
            UserId = userId,
            TextId = firstTextId,
            LastSegmentIndex = 6,
            UpdatedAt = oldCursorAt,
            CreditedSegmentIndicesJson = "[6]",
            CreditedWordCount = 2
        });
        await context.SaveChangesAsync();
        Assert.IsType<OkObjectResult>((await controller.StartBookReread(bookId)).Result);
        var activity = new UserActivityController(context, null!, NullLogger<UserActivityController>.Instance)
        {
            ControllerContext = controller.ControllerContext
        };

        var initial = Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>((await activity.GetSentenceProgress(firstTextId)).Result).Value);
        Assert.Null(initial.LastSegmentIndex);
        Assert.NotNull(initial.CursorResetAt);
        Assert.Equal([6], initial.CreditedSegmentIndices);
        Assert.Equal(2, initial.CreditedWordCount);

        var olderReplay = await activity.LogSentenceRead(new UserActivityController.LogSentenceReadRequest
        {
            TextId = firstTextId, CurrentSegmentIndex = 7, ClientUpdatedAt = oldCursorAt.AddMinutes(10)
        });
        Assert.Null(Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>(olderReplay.Result).Value).LastSegmentIndex);

        var rereading = await activity.LogSentenceRead(new UserActivityController.LogSentenceReadRequest
        {
            TextId = firstTextId, CurrentSegmentIndex = 1
        });
        Assert.Equal(1, Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>(rereading.Result).Value).LastSegmentIndex);
    }

    [Fact]
    public async Task ManualFinish_ClearedWhenRemainingSectionsAreLaterCompletedViaCompleteLesson_OrWhenNoSectionsWereRemaining()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var secondTextId = firstTextId + 1;
        var controller = CreateController(context, userId);

        // Complete Part 1, then manually finish without a rating (stamping Part 2).
        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, new FinishBookRequest()));
        Assert.NotNull((await controller.GetBook(bookId)).Value!.UndoFinishAt);

        // Later completing Part 2 as a real lesson clears the manual finish undo receipt.
        var finishedAt = (await controller.GetBook(bookId)).Value!.UndoFinishAt!.Value;
        await controller.CompleteLesson(bookId, new CompleteLessonDto
        {
            TextId = secondTextId,
            ClientEventId = "complete-part-2",
            Repeat = true,
            SourceRevision = LessonStudyActivity.Revision("adios", 1, null)
        });

        context.ChangeTracker.Clear();
        var bookAfterCompletion = await context.Books.AsNoTracking().SingleAsync();
        Assert.Null(bookAfterCompletion.FinishUndoJson);
        Assert.Null((await controller.GetBook(bookId)).Value!.UndoFinishAt);
        Assert.IsType<ConflictObjectResult>(await controller.UndoBookFinish(bookId, new UndoBookFinishRequest { FinishedAt = finishedAt }));

        // Calling FinishBook without a rating when all parts are already completed does not record a no-op undo.
        bookAfterCompletion = await context.Books.SingleAsync();
        bookAfterCompletion.IsFinished = false;
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, new FinishBookRequest()));
        Assert.Null((await context.Books.AsNoTracking().SingleAsync()).FinishUndoJson);
        Assert.Null((await controller.GetBook(bookId)).Value!.UndoFinishAt);
    }

    [Fact]
    public async Task FinishBook_AndCompleteLesson_RecordPendingHardcoverFinishSentinel_AndPreserveItAcrossRereadStart()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out var firstTextId);
        var secondTextId = firstTextId + 1;
        var channel = new HardcoverSyncChannel();
        var controller = CreateController(context, userId, hardcoverSyncChannel: channel);

        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        Assert.Null((await context.Books.AsNoTracking().SingleAsync()).HardcoverPendingFinishAfterReadId);

        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = secondTextId });
        var finishedBook = await context.Books.AsNoTracking().SingleAsync();
        Assert.Equal(-1, finishedBook.HardcoverPendingFinishAfterReadId);
        Assert.NotNull(finishedBook.LastReadAt);
        Assert.Equal(finishedBook.LastReadAt, finishedBook.HardcoverPendingFinishAt);

        // Starting a reread and completing Part 1 of 2 before Hardcover sync runs preserves the pending finish sentinel.
        var startedResult = await controller.StartBookReread(bookId);
        var startedAt = Assert.IsType<DateTime>(Assert.IsType<OkObjectResult>(startedResult.Result).Value);
        Assert.Equal(0, startedAt.Ticks % TimeSpan.TicksPerMicrosecond);
        Assert.Equal(-1, (await context.Books.AsNoTracking().SingleAsync()).HardcoverPendingFinishAfterReadId);

        await controller.CompleteLesson(bookId, new CompleteLessonDto { TextId = firstTextId });
        var midRereadBook = await context.Books.AsNoTracking().SingleAsync();
        Assert.False(midRereadBook.IsFinished);
        Assert.Equal(-1, midRereadBook.HardcoverPendingFinishAfterReadId);
        Assert.Equal(finishedBook.HardcoverPendingFinishAt, midRereadBook.HardcoverPendingFinishAt);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task UndoRereadFinish_KeepsOnlyTheEarlierPendingHardcoverFinish(bool earlierFinishCleared, bool rereadFinishQueued)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out _);
        var controller = CreateController(context, userId);

        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, new FinishBookRequest()));
        var firstFinish = (await context.Books.AsNoTracking().SingleAsync()).HardcoverPendingFinishAt;
        Assert.NotNull(firstFinish);

        Assert.IsType<OkObjectResult>((await controller.StartBookReread(bookId)).Result);
        Assert.IsType<NoContentResult>(await controller.FinishBook(bookId, new FinishBookRequest()));
        var undoAt = (await controller.GetBook(bookId)).Value!.UndoFinishAt!.Value;

        if (earlierFinishCleared)
        {
            var book = await context.Books.SingleAsync();
            book.ClearPendingHardcoverFinish();
            if (rereadFinishQueued)
            {
                book.QueueHardcoverFinish(undoAt);
                book.HardcoverPendingFinishAfterReadId = 42;
            }
            await context.SaveChangesAsync();
        }

        Assert.IsType<NoContentResult>(await controller.UndoBookFinish(bookId, new UndoBookFinishRequest { FinishedAt = undoAt }));
        var saved = await context.Books.AsNoTracking().SingleAsync();
        Assert.False(saved.IsFinished);
        Assert.Equal(earlierFinishCleared ? null : (int?)-1, saved.HardcoverPendingFinishAfterReadId);
        Assert.Equal(earlierFinishCleared ? null : firstFinish, saved.HardcoverPendingFinishAt);
    }

    [Fact]
    public async Task ReSplitBook_AcquiresHardcoverOperationLockForUser()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedBookWithTwoParts(context, userId, out var bookId, out _);
        var operationLock = new HardcoverOperationLock();
        var controller = CreateController(context, userId, hardcoverOperationLock: operationLock);

        var heldLock = await operationLock.AcquireAsync(userId);
        var reSplitTask = controller.ReSplitBook(bookId, new ReSplitRequestDto
        {
            SplitMethod = "paragraph",
            MaxSegmentSize = 3000
        });

        Assert.False(reSplitTask.IsCompleted);

        heldLock.Dispose();
        var result = await reSplitTask.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.IsType<NoContentResult>(result);
    }

    private static BooksController CreateController(AppDbContext context, Guid userId, IHardcoverService? hardcoverService = null, HardcoverSyncChannel? hardcoverSyncChannel = null, HardcoverOperationLock? hardcoverOperationLock = null)
    {
        return new BooksController(context, NullLogger<BooksController>.Instance, new ChapterDetectionService(), hardcoverService, hardcoverSyncChannel: hardcoverSyncChannel, hardcoverOperationLock: hardcoverOperationLock)
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
        public decimal? LastRating { get; private set; }
        public bool ThrowOnSync { get; init; }

        public Task<HardcoverConnectionResult> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HardcoverConnectionResult(true, true, true, 1, "reader", "ok"));

        public Task<HardcoverMatchResult> MatchBookAsync(Guid userId, int bookId, int? hardcoverBookId = null, int? hardcoverEditionId = null, string? searchQuery = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HardcoverMatchResult(false, null, [], "not used"));

        public Task UnlinkBookAsync(Guid userId, int bookId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new HardcoverMetadataImportResult(false, [], [], "not used"));

        public Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, decimal? rating = null, CancellationToken cancellationToken = default)
        {
            SyncCalls++;
            LastUserId = userId;
            LastBookId = bookId;
            LastRequireSyncEnabled = requireSyncEnabled;
            LastRating = rating;
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
