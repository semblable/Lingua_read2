using System.Data.Common;
using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class UserActivityControllerTests
{
    [Theory]
    [InlineData("keyed", false, false)]
    [InlineData("keyed", true, false)]
    [InlineData("manual", false, false)]
    [InlineData("manual", true, false)]
    [InlineData("legacy", false, false)]
    [InlineData("legacy", true, false)]
    [InlineData("keyed", false, true)]
    [InlineData("keyed", true, true)]
    [InlineData("manual", false, true)]
    [InlineData("manual", true, true)]
    [InlineData("legacy", false, true)]
    [InlineData("legacy", true, true)]
    public async Task ActivityRetry_AfterGeneratedIds_PreservesExactlyOnceTotals(string kind, bool existingStats, bool committed)
    {
        var manual = kind == "manual";
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var failure = new FailFirstActivityCommit(committed);
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection).AddInterceptors(failure)
            .ReplaceService<IExecutionStrategyFactory, ActivityRetryFactory>().Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, 1);
        if (existingStats)
        {
            context.UserLanguageStatistics.Add(new UserLanguageStatistics {
                UserId = userId, LanguageId = 1, TotalWordsRead = 10, TotalSecondsListened = 20 });
            await context.SaveChangesAsync();
        }
        failure.Armed = true;
        var controller = CreateController(context, userId);
        var result = manual
            ? await controller.LogManualActivity(new() { LanguageId = 1, WordCount = 3, ListeningDurationSeconds = 7 })
            : await controller.LogListeningActivity(new() { LanguageId = 1, DurationSeconds = 7,
                ClientEventId = kind == "keyed" ? "retry-listening" : existingStats ? "" : null });

        Assert.IsType<OkObjectResult>(result);
        Assert.Equal(2, failure.Attempts.Count);
        Assert.All(failure.Attempts[0], first => {
            Assert.True(first.ActivityId > 0); // The failed attempt already received real keys.
            Assert.DoesNotContain(failure.Attempts[1], retry => ReferenceEquals(first, retry));
        });
        context.ChangeTracker.Clear();
        Assert.Equal(manual ? 2 : 1, await context.UserActivities.CountAsync());
        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal((existingStats ? 10 : 0) + (manual ? 3 : 0), stats.TotalWordsRead);
        Assert.Equal((existingStats ? 20 : 0) + 7, stats.TotalSecondsListened);
        Assert.Equal(7, await context.UserActivities.SumAsync(a => a.ListeningDurationSeconds ?? 0));
        if (manual)
        {
            var receipt = await context.LessonStudyEvents.SingleAsync();
            Assert.Equal("time", receipt.Kind);
            Assert.Equal(0, receipt.SourceTextId);
            Assert.False(receipt.CountsTowardStatistics);
            Assert.Equal(0, receipt.PassTenths);
            Assert.Equal(0, receipt.PlaybackPasses);
            Assert.Equal(0, receipt.CreditedWords);
            Assert.Equal(0, receipt.CreditedListeningSeconds);
            Assert.Equal(LessonStudyActivity.ManualActivityReceiptKey(receipt.ClientEventId), receipt.SourceRevision);
            // Equal payloads from separate user actions remain additive.
            failure.Armed = false;
            Assert.IsType<OkObjectResult>(await controller.LogManualActivity(new() {
                LanguageId = 1, WordCount = 3, ListeningDurationSeconds = 7 }));
            Assert.Equal(4, await context.UserActivities.CountAsync());
            Assert.Equal((existingStats ? 10 : 0) + 6, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
            Assert.Equal((existingStats ? 20 : 0) + 14, (await context.UserLanguageStatistics.SingleAsync()).TotalSecondsListened);
            Assert.Equal(2, await context.LessonStudyEvents.CountAsync());
        }
        else if (kind == "keyed")
        {
            Assert.IsType<OkObjectResult>(await controller.LogListeningActivity(new() {
                LanguageId = 1, DurationSeconds = 7, ClientEventId = "retry-listening" }));
            Assert.Single(await context.UserActivities.ToListAsync());
            Assert.Equal(stats.TotalSecondsListened, (await context.UserLanguageStatistics.SingleAsync()).TotalSecondsListened);
        }
        else
        {
            Assert.False(string.IsNullOrEmpty((await context.UserActivities.SingleAsync()).ClientEventId));
            failure.Armed = false;
            Assert.IsType<OkObjectResult>(await controller.LogListeningActivity(new() { LanguageId = 1, DurationSeconds = 7 }));
            Assert.Equal(2, await context.UserActivities.CountAsync());
            Assert.Equal((existingStats ? 20 : 0) + 14, (await context.UserLanguageStatistics.SingleAsync()).TotalSecondsListened);
        }
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task ActivityRetry_AfterCommittedReset_DoesNotRestoreActivity(bool manual, bool resetLanguage)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var failure = new FailFirstActivityCommit(afterCommit: true);
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection).AddInterceptors(failure)
            .ReplaceService<IExecutionStrategyFactory, ActivityRetryFactory>().Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, 1);
        string? listeningKey = null;
        failure.AfterCommit = async () =>
        {
            await using var reset = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
            if (!manual) listeningKey = (await reset.UserActivities.SingleAsync()).ClientEventId;
            if (resetLanguage)
            {
                using var cache = new MemoryCache(new MemoryCacheOptions());
                Assert.True(await new LanguageService(reset, cache).ResetLanguageContentAsync(1, userId));
            }
            else
                Assert.IsType<OkObjectResult>(await new UsersController(reset, NullLogger<UsersController>.Instance) {
                    ControllerContext = BuildControllerContext(userId) }.ResetStatistics());
        };
        failure.Armed = true;
        var controller = CreateController(context, userId);
        Assert.IsType<OkObjectResult>(manual
            ? await controller.LogManualActivity(new() { LanguageId = 1, WordCount = 3, ListeningDurationSeconds = 7 })
            : await controller.LogListeningActivity(new() { LanguageId = 1, DurationSeconds = 7 }));
        context.ChangeTracker.Clear();
        Assert.Equal(2, failure.Attempts.Count);
        Assert.Empty(await context.UserActivities.ToListAsync());
        Assert.All(await context.UserLanguageStatistics.ToListAsync(), stats => {
            Assert.Equal(0, stats.TotalWordsRead);
            Assert.Equal(0, stats.TotalSecondsListened);
        });
        var receipt = await context.LessonStudyEvents.SingleAsync();
        Assert.False(receipt.CountsTowardStatistics);
        Assert.Equal(manual ? LessonStudyActivity.ManualActivityReceiptKey(receipt.ClientEventId)
            : LessonStudyActivity.ListeningResetReceiptKey(listeningKey!), receipt.SourceRevision);
    }

    private sealed class FailFirstActivityCommit(bool afterCommit) : DbTransactionInterceptor
    {
        public bool Armed;
        public Func<Task>? AfterCommit;
        public List<UserActivity[]> Attempts { get; } = [];
        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction,
            TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            if (Armed)
            {
                Attempts.Add(eventData.Context!.ChangeTracker.Entries<UserActivity>().Select(e => e.Entity).ToArray());
                if (Attempts.Count == 1 && !afterCommit) throw new TimeoutException("Synthetic transient failure after saving, before commit.");
            }
            return new(result);
        }

        public override async Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (Armed && afterCommit && Attempts.Count == 1)
            {
                if (AfterCommit != null) await AfterCommit();
                throw new TimeoutException("Synthetic lost commit acknowledgement.");
            }
        }
    }

    public sealed class ActivityRetryFactory(ExecutionStrategyDependencies dependencies) : IExecutionStrategyFactory
    {
        public IExecutionStrategy Create() => new ActivityRetryStrategy(dependencies);
    }

    private sealed class ActivityRetryStrategy(ExecutionStrategyDependencies dependencies) : ExecutionStrategy(dependencies, 1, TimeSpan.Zero)
    {
        protected override bool ShouldRetryOn(Exception exception) => exception is TimeoutException;
    }

    [Fact]
    public async Task SubSecondLessonPlayback_DoesNotCreateListeningChartBuckets_AndKeepsResetReceipt()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserLanguageAndText(context, userId, 1, "audio lesson");
        var text = (await context.Texts.FindAsync(1))!;
        text.IsAudioLesson = true;
        await context.SaveChangesAsync();
        var request = new UserActivityController.LogListeningRequest {
            LanguageId = 1, DurationSeconds = 0, ClientEventId = "sub-second",
            Lesson = new() { TextId = 1, SourceRevision = LessonStudyActivity.Revision(text.Content, 1, null),
                PlayedSeconds = 0.4, AudioDurationSeconds = 4 } };
        var controller = CreateController(context, userId);
        Assert.IsType<OkObjectResult>(await controller.LogListeningActivity(request));
        var stats = Assert.IsType<UserActivityController.ListeningStatsDto>(
            Assert.IsType<OkObjectResult>((await controller.GetListeningStats()).Result).Value);
        Assert.Equal(0, stats.TotalListeningSeconds);
        Assert.Empty(stats.ListeningByDate);
        Assert.Empty(stats.ListeningByLanguage);
        Assert.Single(await context.UserActivities.ToListAsync());
        Assert.Equal(1, (await context.LessonStudyEvents.SingleAsync()).PassTenths);

        // Filtering display buckets must not erase the identity needed by resets.
        Assert.IsType<OkObjectResult>(await new UsersController(context, NullLogger<UsersController>.Instance) {
            ControllerContext = BuildControllerContext(userId) }.ResetStatistics());
        Assert.Single(await LessonStudyActivity.ListeningResetReceipts(context, userId).ToListAsync());
        Assert.IsType<OkObjectResult>(await controller.LogListeningActivity(request));
        Assert.Empty(await context.UserActivities.ToListAsync());
        Assert.Equal(0, (await context.UserLanguageStatistics.SingleAsync()).TotalSecondsListened);
    }

    [Fact]
    public async Task LogListeningActivity_CreatesActivityAndInitializesLanguageStats()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, languageId: 1);

        var controller = CreateController(context, userId);

        var result = await controller.LogListeningActivity(new UserActivityController.LogListeningRequest
        {
            LanguageId = 1,
            DurationSeconds = 45
        });

        Assert.IsType<OkObjectResult>(result);

        var activity = await context.UserActivities.SingleAsync();
        Assert.Equal("Listening", activity.ActivityType);
        Assert.Equal(45, activity.ListeningDurationSeconds);
        Assert.Equal(0, activity.WordCount);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(45, stats.TotalSecondsListened);
    }

    [Fact]
    public async Task LogListeningActivity_UpdatesSameStatsRow_OnSecondCall()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, languageId: 1);

        var controller = CreateController(context, userId);

        await controller.LogListeningActivity(new UserActivityController.LogListeningRequest
        {
            LanguageId = 1,
            DurationSeconds = 20
        });
        await controller.LogListeningActivity(new UserActivityController.LogListeningRequest
        {
            LanguageId = 1,
            DurationSeconds = 30
        });

        Assert.Equal(2, await context.UserActivities.CountAsync());

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(50, stats.TotalSecondsListened);
    }

    [Fact]
    public async Task UpdateAudioLessonProgress_UpsertsProgress_ForOwnedText()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 99;
        SeedUserLanguageAndText(context, userId, textId, "lesson content");

        var controller = CreateController(context, userId);

        var first = await controller.UpdateAudioLessonProgress(new UserActivityController.UpdateAudioLessonProgressRequest
        {
            TextId = textId,
            CurrentPosition = 12.5
        });
        Assert.IsType<OkObjectResult>(first);

        var row = await context.UserAudioLessonProgresses.SingleAsync();
        Assert.Equal(12.5, row.CurrentPosition);

        var second = await controller.UpdateAudioLessonProgress(new UserActivityController.UpdateAudioLessonProgressRequest
        {
            TextId = textId,
            CurrentPosition = 99.0
        });
        Assert.IsType<OkObjectResult>(second);

        row = await context.UserAudioLessonProgresses.SingleAsync();
        Assert.Equal(99.0, row.CurrentPosition);
    }

    [Fact]
    public async Task UpdateAudioLessonProgress_ReturnsNotFound_WhenTextBelongsToAnotherUser()
    {
        await using var context = CreateContext();
        var ownerId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        const int textId = 77;

        SeedUserLanguageAndText(context, ownerId, textId, "private");

        var controller = CreateController(context, otherId);

        var result = await controller.UpdateAudioLessonProgress(new UserActivityController.UpdateAudioLessonProgressRequest
        {
            TextId = textId,
            CurrentPosition = 1.0
        });

        Assert.IsType<NotFoundObjectResult>(result);
        Assert.Empty(context.UserAudioLessonProgresses);
    }

    [Fact]
    public async Task GetReadingStats_SumsAllReadingActivityTypes()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var language = SeedUserAndLanguage(context, userId, languageId: 1);
        var now = DateTime.UtcNow;

        context.UserActivities.AddRange(
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "Reading",
                WordCount = 10,
                Timestamp = now,
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "ManualReading",
                WordCount = 5,
                Timestamp = now,
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "TextCompleted",
                WordCount = 3,
                Timestamp = now,
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "LessonCompleted",
                WordCount = 11,
                Timestamp = now,
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "BookFinished",
                WordCount = 7,
                Timestamp = now,
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "Listening",
                WordCount = 999,
                Timestamp = now,
                ListeningDurationSeconds = 60
            });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);

        var result = await controller.GetReadingStats("all");
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<UserActivityController.ReadingStatsDto>(ok.Value);

        Assert.Equal(36, dto.TotalWordsRead);
        Assert.Equal(36, dto.ActivityByDate.Values.Sum());
        Assert.Single(dto.ActivityByLanguage);
        Assert.Equal(36, dto.ActivityByLanguage[0].TotalWords);
    }

    [Fact]
    public async Task GetListeningStats_SumsOnlyListeningAndManualListening()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var language = SeedUserAndLanguage(context, userId, languageId: 1);
        var now = DateTime.UtcNow;

        context.UserActivities.AddRange(
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "Listening",
                WordCount = 0,
                Timestamp = now,
                ListeningDurationSeconds = 40
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "ManualListening",
                WordCount = 0,
                Timestamp = now,
                ListeningDurationSeconds = 35
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                ActivityType = "ManualListening",
                Timestamp = now,
                ListeningDurationSeconds = -5
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = 2,
                ActivityType = "Listening",
                Timestamp = now.AddDays(-1),
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "Reading",
                WordCount = 100,
                Timestamp = now,
                ListeningDurationSeconds = 0
            });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);

        var result = await controller.GetListeningStats("all");
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<UserActivityController.ListeningStatsDto>(ok.Value);

        Assert.Equal(70, dto.TotalListeningSeconds);
        Assert.Single(dto.ListeningByDate);
        Assert.Equal(70, dto.ListeningByDate.Values.Sum());
        Assert.Single(dto.ListeningByLanguage);
        Assert.Equal(70, dto.ListeningByLanguage[0].TotalSeconds);
    }

    [Fact]
    public async Task UpdateAudiobookProgress_ReturnsNotFound_ForUnknownBook()
    {
        // Without the ownership guard this reached the insert and surfaced the FK violation as a
        // 500 carrying the raw Npgsql message.
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, languageId: 1);

        var controller = CreateController(context, userId);

        var result = await controller.UpdateAudiobookProgress(new UserActivityController.UpdateAudiobookProgressRequest
        {
            BookId = 999,
            CurrentAudiobookPosition = 12.5
        });

        Assert.IsType<NotFoundObjectResult>(result);
        Assert.Empty(await context.UserBookProgresses.ToListAsync());
    }

    [Fact]
    public async Task UpdateAudiobookProgress_ReturnsNotFound_ForAnotherUsersBook()
    {
        await using var context = CreateContext();
        var ownerId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        SeedUserAndLanguage(context, ownerId, languageId: 1);
        context.Users.Add(new User { Id = otherId, UserName = "other", Email = "other@example.com" });
        context.Books.Add(new Book { BookId = 7, UserId = ownerId, LanguageId = 1, Title = "Owned" });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, otherId);

        var result = await controller.UpdateAudiobookProgress(new UserActivityController.UpdateAudiobookProgressRequest
        {
            BookId = 7,
            CurrentAudiobookPosition = 30
        });

        Assert.IsType<NotFoundObjectResult>(result);
        Assert.Empty(await context.UserBookProgresses.ToListAsync());
    }

    [Fact]
    public async Task UpdateAudiobookProgress_RejectsTrackFromAnotherBook()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, languageId: 1);
        context.Books.Add(new Book { BookId = 1, UserId = userId, LanguageId = 1, Title = "First" });
        context.Books.Add(new Book { BookId = 2, UserId = userId, LanguageId = 1, Title = "Second" });
        context.AudiobookTracks.Add(new AudiobookTrack { Id = 50, BookId = 2, FilePath = "audiobooks/2/track_1.mp3", TrackNumber = 1 });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);

        var result = await controller.UpdateAudiobookProgress(new UserActivityController.UpdateAudiobookProgressRequest
        {
            BookId = 1,
            CurrentAudiobookTrackId = 50,
            CurrentAudiobookPosition = 5
        });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task UpdateAudiobookProgress_SavesProgress_ForOwnedBook()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, languageId: 1);
        context.Books.Add(new Book { BookId = 3, UserId = userId, LanguageId = 1, Title = "Mine" });
        context.AudiobookTracks.Add(new AudiobookTrack { Id = 9, BookId = 3, FilePath = "audiobooks/3/track_1.mp3", TrackNumber = 1 });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);

        var result = await controller.UpdateAudiobookProgress(new UserActivityController.UpdateAudiobookProgressRequest
        {
            BookId = 3,
            CurrentAudiobookTrackId = 9,
            CurrentAudiobookPosition = 42.5
        });

        Assert.IsType<OkObjectResult>(result);

        context.ChangeTracker.Clear();
        var progress = await context.UserBookProgresses.SingleAsync();
        Assert.Equal(3, progress.BookId);
        Assert.Equal(9, progress.CurrentAudiobookTrackId);
        Assert.Equal(42.5, progress.CurrentAudiobookPosition);
    }

    private static UserActivityController CreateController(AppDbContext context, Guid userId)
    {
        return new UserActivityController(context, null!, NullLogger<UserActivityController>.Instance)
        {
            ControllerContext = BuildControllerContext(userId)
        };
    }

    private static ControllerContext BuildControllerContext(Guid userId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                ], "TestAuth"))
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

    private static Language SeedUserAndLanguage(AppDbContext context, Guid userId, int languageId)
    {
        var user = new User
        {
            Id = userId,
            UserName = "tester",
            Email = "tester@example.com"
        };
        var language = new Language
        {
            LanguageId = languageId,
            Name = "Spanish",
            Code = "ES"
        };
        context.Users.Add(user);
        context.Languages.Add(language);
        context.SaveChanges();
        return language;
    }

    private static void SeedUserLanguageAndText(AppDbContext context, Guid userId, int textId, string content)
    {
        var user = new User
        {
            Id = userId,
            UserName = "owner",
            Email = "owner@example.com"
        };
        var language = new Language
        {
            LanguageId = 1,
            Name = "Spanish",
            Code = "ES"
        };
        var text = new Text
        {
            TextId = textId,
            UserId = userId,
            LanguageId = 1,
            Title = "Lesson",
            Content = content
        };

        context.Users.Add(user);
        context.Languages.Add(language);
        context.Texts.Add(text);
        context.SaveChanges();
    }
}
