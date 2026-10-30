using System.Security.Claims;
using System.Text.Json;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Xunit.Abstractions;

namespace LinguaReadApi.Tests;

// Synthetic SQLite compatibility experiment following ReadingCreditCompatibilityTests.
// Candidate arithmetic below is deliberately NOT represented as a production feature.
public class ListeningCompatibilityTests(ITestOutputHelper output)
{
    [Theory]
    [InlineData(1800, 3600, 1.5, .5, 1200)]
    [InlineData(7200, 3600, 2, 2, 3600)] // Replays add exposure; do not union/cap it.
    [InlineData(0, 3600, 1, 0, 0)] // Seek, pause, buffer: no played source interval.
    public void CandidateOnly_SourceExposureAndElapsedTimeAreSeparate(double played, double duration,
        double speed, double expectedEquivalent, double expectedElapsed)
    {
        Assert.Equal(expectedEquivalent, CandidateEquivalent(played, duration));
        Assert.Equal(expectedElapsed, played / speed);
        output.WriteLine($"CANDIDATE ONLY: {played}/{duration}={played / duration} equivalents; elapsed={played / speed}s");
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0d)]
    [InlineData(-1d)]
    public void CandidateOnly_UnknownDurationCannotInventAnEquivalent(double? duration) =>
        Assert.Null(CandidateEquivalent(1800, duration));

    private static double? CandidateEquivalent(double playedSourceSeconds, double? revisionDuration) =>
        revisionDuration is > 0 && double.IsFinite(revisionDuration.Value)
            ? playedSourceSeconds / revisionDuration.Value : null;

    [Fact]
    public async Task ActualPlaybackAndManualPasses_KeepSecondsSeparateFromIntegerCountsAndReading()
    {
        await using var learner = await Learner.Create();
        var preserved = await learner.Preserved();
        await learner.Playback("device-a-half", 1200);
        Assert.Equal(new LessonStudyDto(0, 0), await learner.Counts());
        Assert.Equal(1260, await learner.Seconds());
        Assert.Equal(1200, await learner.ListeningGoalProgress());
        Assert.IsType<OkResult>(await learner.Pass("explicit-pass", 0));
        Assert.Equal(new LessonStudyDto(0, 1), await learner.Counts()); // Not .5: explicit declaration only.
        Assert.Equal(1260, await learner.Seconds()); // Zero avoids duplicating player time.
        Assert.Equal(100, await learner.Words());
        Assert.Equal(preserved, await learner.Preserved());
        output.WriteLine("ACTUAL: 1200 elapsed seconds has no source/duration/rate; explicit listen count=1, cannot derive candidate .5.");
    }

    [Fact]
    public async Task OfflineRetriesAndDistinctDevices_PreserveKeysButLegacyPayloadsCannotDeduplicate()
    {
        await using var learner = await Learner.Create();
        await learner.Playback("device-a-1", 10);
        await learner.Playback("device-a-1", 10); // Lost response / offline replay.
        await learner.Playback("device-b-1", 10); // A separate exposure, even on the same source.
        Assert.Equal(80, await learner.Seconds());
        await learner.Playback(null, 10);
        await learner.Playback(null, 10); // Old stored payloads have no identity.
        Assert.Equal(100, await learner.Seconds());
        await learner.Playback("device-a-1", 999); // Current endpoint silently ignores conflicting content.
        Assert.Equal(100, await learner.Seconds());
        Assert.Equal(100, await learner.Words());
        output.WriteLine("KNOWN GAP: no-key legacy replay adds twice; same keyed ID with changed seconds is accepted as duplicate, not conflict. Devices are sequential separate requests; PostgreSQL concurrency is not proved by SQLite.");
    }

    [Fact]
    public async Task StatisticsReset_PreservesStudyAndPlaybackReceiptsWithoutResurrectingSeconds()
    {
        await using var learner = await Learner.Create();
        var preserved = await learner.Preserved();
        await learner.Playback("queued-before-reset", 10);
        Assert.IsType<OkResult>(await learner.Pass("declared-before-reset", 30));
        Assert.Single(await learner.Context.LessonStudyEvents.ToListAsync()); // No ledger row for ordinary playback.
        await learner.Reset();
        Assert.Equal(0, await learner.Seconds());
        Assert.Equal(new LessonStudyDto(0, 0), await learner.Counts());
        Assert.IsType<OkResult>(await learner.Pass("declared-before-reset", 30));
        Assert.Equal(0, await learner.Seconds());
        await learner.Playback("queued-before-reset", 10);
        await learner.Playback("queued-before-reset", 999); // Preserve mismatched-body duplicate semantics.
        Assert.Equal(0, await learner.Seconds());
        Assert.Equal(-60, await learner.ListeningGoalProgress()); // Baseline 60 remains intact.
        var receipt = await learner.Context.LessonStudyEvents.SingleAsync(e => e.Kind == "time");
        Assert.Equal(LessonStudyActivity.ListeningResetReceiptKey("queued-before-reset"), receipt.SourceRevision);
        Assert.Equal(64, receipt.SourceRevision.Length);
        Assert.Equal(0, receipt.SourceTextId);
        Assert.Equal(1, receipt.CountingVersion);
        Assert.Equal(10, receipt.CreditedListeningSeconds);
        Assert.False(receipt.CountsTowardStatistics);
        Assert.False(receipt.IsCompletionCheckpoint);
        Assert.Equal(preserved, await learner.Preserved());
        output.WriteLine("ACTUAL: reset retains non-statistical playback receipts; old keyed replay cannot restore erased time. Goal baseline is preserved (raw progress is -60).");
    }

    [Fact]
    public async Task RepeatedStatisticsReset_PreservesOneReceiptPerPlayback()
    {
        await using var learner = await Learner.Create();
        await learner.Playback("first-era", 10);
        await learner.Reset();
        var firstReceipt = await learner.Context.LessonStudyEvents.AsNoTracking().SingleAsync();
        await learner.Reset();
        await learner.Playback("first-era", 10);
        Assert.Equal(0, await learner.Seconds());
        var repeatedReceipt = await learner.Context.LessonStudyEvents.AsNoTracking().SingleAsync();
        Assert.Equal(firstReceipt.LessonStudyEventId, repeatedReceipt.LessonStudyEventId);
        Assert.Equal(firstReceipt.CreatedAt, repeatedReceipt.CreatedAt);
        await learner.Playback("second-era", 20);
        Assert.Equal(20, await learner.Seconds());
        await learner.Reset();
        await learner.Playback("first-era", 10);
        await learner.Playback("second-era", 20);
        Assert.Equal(0, await learner.Seconds());
        Assert.Equal(2, await learner.Context.LessonStudyEvents.CountAsync(e => e.Kind == "time" && !e.CountsTowardStatistics));
        Assert.Equal(new LessonStudyDto(0, 0), await learner.Counts());
    }

    [Fact]
    public async Task InterruptedStatisticsReset_RollsBackReceiptsDeletionAndTotals()
    {
        await using var learner = await Learner.Create();
        await learner.Playback("reset-interrupted", 10);
        Assert.IsType<OkResult>(await learner.Pass("pass-before-interrupted-reset", 30));
        await learner.Context.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER fail_reset BEFORE UPDATE OF TotalSecondsListened ON UserLanguageStatistics
            BEGIN SELECT RAISE(ABORT, 'synthetic reset interruption'); END;
            """);
        Assert.Equal(500, Assert.IsType<ObjectResult>(await learner.AttemptReset()).StatusCode);
        learner.Context.ChangeTracker.Clear();
        Assert.Equal(100, await learner.Seconds());
        Assert.True(await learner.Context.UserActivities.AnyAsync(a => a.ClientEventId == "reset-interrupted"));
        Assert.False(await learner.Context.LessonStudyEvents.AnyAsync(e => e.Kind == "time"));
        Assert.Equal(new LessonStudyDto(0, 1), await learner.Counts());
        await learner.Context.Database.ExecuteSqlRawAsync("DROP TRIGGER fail_reset;");
        await learner.Playback("reset-interrupted", 10);
        Assert.Equal(100, await learner.Seconds());
        await learner.Reset();
        await learner.Playback("reset-interrupted", 10);
        Assert.Equal(0, await learner.Seconds());
        Assert.Single(await learner.Context.LessonStudyEvents.Where(e => e.Kind == "time").ToListAsync());
    }

    [Fact]
    public async Task StatisticsReset_ProtectsOldKeyedRowsWithoutInventingLegacyIdentities()
    {
        await using var learner = await Learner.Create();
        var stats = await learner.Context.UserLanguageStatistics.SingleAsync();
        var oldTimestamp = new DateTime(2024, 1, 2, 12, 0, 0, DateTimeKind.Utc);
        learner.Context.UserActivities.Add(new UserActivity { UserId = stats.UserId, LanguageId = 1,
            ActivityType = "Listening", ListeningDurationSeconds = 17, ClientEventId = "old-keyed-row", Timestamp = oldTimestamp });
        stats.TotalSecondsListened += 17;
        await learner.Context.SaveChangesAsync();
        Assert.Equal(77, await learner.Seconds());
        Assert.Empty(await learner.Context.LessonStudyEvents.ToListAsync());
        await learner.Reset();
        var receipt = await learner.Context.LessonStudyEvents.SingleAsync(); // Original no-key 60s row gets no identity.
        Assert.Equal(17, receipt.CreditedListeningSeconds);
        Assert.Equal(oldTimestamp, receipt.CreatedAt);
        Assert.Equal(1, receipt.LanguageId);
        await learner.Playback("old-keyed-row", 17);
        Assert.Equal(0, await learner.Seconds());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task StatisticsReset_PlaybackReceiptDoesNotConsumeTheSameRawManualPassId(bool passBeforeReset)
    {
        await using var learner = await Learner.Create();
        await learner.Playback("shared-raw-id", 10);
        if (passBeforeReset) Assert.IsType<OkResult>(await learner.Pass("shared-raw-id", 0));
        await learner.Reset();
        Assert.IsType<OkResult>(await learner.Pass("shared-raw-id", 0));
        await learner.Playback("shared-raw-id", 10);
        Assert.Equal(0, await learner.Seconds());
        Assert.Equal(new LessonStudyDto(0, passBeforeReset ? 0 : 1), await learner.Counts());
        Assert.Equal(2, await learner.Context.LessonStudyEvents.CountAsync());
    }

    [Fact]
    public async Task StatisticsReset_AllowsDeliberateNewPlaybackAndLegacyAdditivePayloads()
    {
        await using var learner = await Learner.Create();
        await learner.Playback("before-reset", 10);
        await learner.Reset();
        await learner.Playback("after-reset", 10);
        await learner.Playback("after-reset", 999);
        await learner.Playback("another-device-after-reset", 20);
        await learner.Playback(null, 5);
        await learner.Playback(null, 5);
        Assert.Equal(40, await learner.Seconds());
        Assert.Equal(0, await learner.Words());
        Assert.Equal(new LessonStudyDto(0, 0), await learner.Counts());
        Assert.Single(await learner.Context.LessonStudyEvents.ToListAsync()); // Receipts only for erased playback.
    }

    [Fact]
    public async Task StatisticsReset_ReceiptHashCannotCollideWithAnExplicitPassId()
    {
        await using var learner = await Learner.Create();
        const string playbackId = "playback-with-expected-hash";
        var passId = LessonStudyActivity.ListeningResetReceiptKey(playbackId);
        Assert.IsType<OkResult>(await learner.Pass(passId, 0));
        await learner.Playback(playbackId, 10);
        await learner.Reset();
        Assert.IsType<OkResult>(await learner.Pass(passId, 0));
        await learner.Playback(playbackId, 10);
        Assert.Equal(0, await learner.Seconds());
        var receipt = await learner.Context.LessonStudyEvents.SingleAsync(e => e.Kind == "time");
        Assert.NotEqual(passId, receipt.ClientEventId);
        Assert.Equal(passId, receipt.SourceRevision);
        Assert.Equal(2, await learner.Context.LessonStudyEvents.CountAsync());
        Assert.Equal(new LessonStudyDto(0, 0), await learner.Counts());
    }

    [Fact]
    public async Task InterruptedListeningSave_RollsBackSecondsAndId_ThenRetryCommitsOnce()
    {
        await using var learner = await Learner.Create();
        await learner.Context.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER fail_listening BEFORE UPDATE OF TotalSecondsListened ON UserLanguageStatistics
            BEGIN SELECT RAISE(ABORT, 'synthetic interruption'); END;
            """);
        Assert.Equal(500, Assert.IsType<ObjectResult>(await learner.AttemptPlayback("interrupted", 10)).StatusCode);
        learner.Context.ChangeTracker.Clear();
        Assert.Equal(60, await learner.Seconds());
        Assert.False(await learner.Context.UserActivities.AnyAsync(a => a.ClientEventId == "interrupted"));
        await learner.Context.Database.ExecuteSqlRawAsync("DROP TRIGGER fail_listening;");
        await learner.Playback("interrupted", 10);
        await learner.Playback("interrupted", 10);
        Assert.Equal(70, await learner.Seconds());
    }

    [Fact]
    public async Task ExplicitListen_RetryConflictsAndAudioEditsExposeCurrentRevisionBoundary()
    {
        await using var learner = await Learner.Create();
        var original = await learner.Revision();
        Assert.IsType<OkResult>(await learner.Pass("pass-a", 30, original));
        Assert.IsType<OkResult>(await learner.Pass("pass-a", 30, original));
        Assert.IsType<ConflictObjectResult>(await learner.Pass("pass-a", 31, original));
        // Overwriting audio bytes at the same path cannot change this hash; neither
        // media bytes nor authoritative duration is an input to Revision().
        Assert.Equal(original, LessonStudyActivity.Revision("one two. one!", 1, "synthetic/audio.mp3"));
        learner.Context.ChangeTracker.Clear();
        (await learner.Context.Texts.SingleAsync()).AudioFilePath = "synthetic/audio-v2.mp3";
        await learner.Context.SaveChangesAsync();
        Assert.NotEqual(original, await learner.Revision());
        Assert.IsType<ConflictObjectResult>(await learner.Pass("new-pass", 30, original));
        Assert.IsType<OkResult>(await learner.Pass("pass-a", 30, original)); // Committed old retry succeeds.
        Assert.IsType<OkResult>(await learner.Pass("new-pass", 0));
        Assert.Equal(new LessonStudyDto(0, 2), await learner.Counts());
        Assert.Equal(90, await learner.Seconds());
        output.WriteLine("KNOWN GAP: source hash tracks path/content, not audio bytes/duration; changed path rejects new old-revision event, while count aggregates revisions.");
    }

    [Fact]
    public async Task ManualListeningAndSentenceCompletionOverlap_DoNotCreateAudioReadingCredit()
    {
        await using var learner = await Learner.Create();
        await learner.Playback("audio-only", 20);
        Assert.IsType<OkObjectResult>(await learner.Activity().LogManualActivity(new() { LanguageId = 1, ListeningDurationSeconds = 30 }));
        Assert.IsType<OkObjectResult>(await learner.Activity().LogManualActivity(new() { LanguageId = 1, ListeningDurationSeconds = -5 }));
        Assert.Equal(105, await learner.Seconds());
        Assert.Equal(100, await learner.Words());
        Assert.Equal(new LessonStudyDto(0, 0), await learner.Counts()); // Manual language time has no lesson identity.
        Assert.IsType<OkObjectResult>((await learner.Activity().LogSentenceRead(new() { TextId = 1,
            CurrentSegmentIndex = 0, Segments = [new() { SegmentIndex = 0, SegmentText = "one two." }] })).Result);
        Assert.IsType<OkResult>(await learner.Pass("listen-after-sentence", 0));
        Assert.Equal(102, await learner.Words());
        var stats = new StatsRecomputeService(new ServiceCollection().AddSingleton(learner.Context).BuildServiceProvider(),
            NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        var texts = new TextsController(learner.Context, NullLogger<TextsController>.Instance,
            new UserActivityService(learner.Context, NullLogger<UserActivityService>.Instance), new WordLinkingChannel(), stats)
            { ControllerContext = learner.Identity };
        Assert.IsType<OkObjectResult>((await texts.CompleteText(1)).Result);
        Assert.Equal(103, await learner.Words()); // Only missing reading word; listening never supplies it.
        Assert.Equal(105, await learner.Seconds());
    }

    private sealed class Learner(SqliteConnection connection, AppDbContext context) : IAsyncDisposable
    {
        private static readonly Guid Id = Guid.Parse("deadbeef-0000-0000-0000-000000000044");
        public AppDbContext Context => context;
        public ControllerContext Identity => new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(
            new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Id.ToString())], "test")) } };
        public static async Task<Learner> Create()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
            await context.Database.EnsureCreatedAsync();
            var past = new DateTime(2025, 1, 2, 12, 0, 0, DateTimeKind.Utc);
            context.Users.Add(new User { Id = Id, UserName = "synthetic listening learner" });
            context.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
            context.Texts.Add(new Text { TextId = 1, UserId = Id, LanguageId = 1, Title = "Synthetic audio",
                Content = "one two. one!", AudioFilePath = "synthetic/audio.mp3", IsAudioLesson = true });
            context.Words.AddRange(new Word { WordId = 11, UserId = Id, LanguageId = 1, Term = "one", Status = 5 },
                new Word { WordId = 12, UserId = Id, LanguageId = 1, Term = "one two", Status = 6 });
            context.TextWords.Add(new TextWord { TextId = 1, WordId = 11, OccurrenceCount = 2 });
            context.WordTranslations.Add(new WordTranslation { WordId = 11, Translation = "edited meaning", CreatedAt = past });
            context.SrsPhrases.Add(new SrsPhrase { SrsPhraseId = 21, WordId = 11, UserId = Id,
                Sentence = "one two.", TextId = 1, TextTitle = "Synthetic audio", CreatedAt = past });
            context.SrsCardReviews.Add(new SrsCardReview { SrsCardReviewId = 31, WordId = 11, UserId = Id,
                Stability = 12.5, Difficulty = 4.2, Interval = 12, Repetitions = 7, NextReviewAt = past.AddYears(2) });
            context.SrsReviewLogs.Add(new SrsReviewLog { SrsReviewLogId = 41, UserId = Id, SrsCardReviewId = 31,
                Grade = 2, ReviewedAt = past, OldInterval = 9 });
            context.UserAudioLessonProgresses.Add(new UserAudioLessonProgress { UserId = Id, TextId = 1, CurrentPosition = 123.5, UpdatedAt = past });
            context.UserActivities.AddRange(new UserActivity { UserId = Id, LanguageId = 1, ActivityType = "Listening",
                ListeningDurationSeconds = 60, Timestamp = past }, new UserActivity { UserId = Id, LanguageId = 1,
                ActivityType = "TextCompleted", WordCount = 100, Timestamp = past });
            context.UserLanguageStatistics.Add(new UserLanguageStatistics { UserId = Id, LanguageId = 1, TotalSecondsListened = 60, TotalWordsRead = 100 });
            context.UserGoals.Add(new UserGoal { GoalId = 61, UserId = Id, LanguageId = 1, GoalType = GoalType.ListeningSeconds,
                BaselineValue = 60, TargetValue = 10000, CreatedAt = past });
            await context.SaveChangesAsync();
            context.ChangeTracker.Clear();
            return new(connection, context);
        }

        public UserActivityController Activity() => new(context, null!, NullLogger<UserActivityController>.Instance) { ControllerContext = Identity };
        public Task<IActionResult> AttemptPlayback(string? id, int seconds) => Activity().LogListeningActivity(new() { LanguageId = 1, DurationSeconds = seconds, ClientEventId = id });
        public async Task Playback(string? id, int seconds) => Assert.IsType<OkObjectResult>(await AttemptPlayback(id, seconds));
        public async Task<string> Revision() { var t = await context.Texts.AsNoTracking().SingleAsync(); return LessonStudyActivity.Revision(t.Content, t.LanguageId, t.AudioFilePath); }
        public async Task<IActionResult> Pass(string id, int seconds, string? revision = null) => await new LessonStudyController(context) { ControllerContext = Identity }
            .Listen(1, new() { ClientEventId = id, DurationSeconds = seconds, SourceRevision = revision ?? await Revision() });
        public async Task<LessonStudyDto> Counts() => Assert.IsType<LessonStudyDto>((await new LessonStudyController(context) { ControllerContext = Identity }.Get(1)).Value);
        public async Task<long> Seconds()
        {
            context.ChangeTracker.Clear();
            var seconds = await context.UserActivities.SumAsync(a => (long)(a.ListeningDurationSeconds ?? 0));
            Assert.Equal(seconds, (await context.UserLanguageStatistics.SingleAsync()).TotalSecondsListened);
            return seconds;
        }
        public async Task<long> Words()
        {
            var words = await context.UserActivities.SumAsync(a => (long)a.WordCount);
            Assert.Equal(words, (await context.UserLanguageStatistics.AsNoTracking().SingleAsync()).TotalWordsRead);
            return words;
        }
        public async Task<long> ListeningGoalProgress() => (await new GoalProgressService(context).ComputeAsync(Id,
            await context.UserGoals.ToListAsync(), 0, DateTime.UtcNow)).Single().Progress;
        public Task<IActionResult> AttemptReset() => new UsersController(context, NullLogger<UsersController>.Instance) { ControllerContext = Identity }.ResetStatistics();
        public async Task Reset() => Assert.IsType<OkObjectResult>(await AttemptReset());
        public async Task<string> Preserved()
        {
            context.ChangeTracker.Clear();
            Array[] entities = [await context.Words.OrderBy(w => w.WordId).ToArrayAsync(), await context.WordTranslations.ToArrayAsync(),
                await context.SrsPhrases.ToArrayAsync(), await context.SrsCardReviews.ToArrayAsync(), await context.SrsReviewLogs.ToArrayAsync(),
                await context.UserAudioLessonProgresses.ToArrayAsync(), await context.UserGoals.ToArrayAsync()];
            return JsonSerializer.Serialize(entities.Select(rows => rows.Cast<object>().Select(e => context.Entry(e).Properties
                .ToDictionary(p => p.Metadata.Name, p => p.CurrentValue)).ToArray()).ToArray());
        }
        public async ValueTask DisposeAsync() { await context.DisposeAsync(); await connection.DisposeAsync(); }
    }
}
