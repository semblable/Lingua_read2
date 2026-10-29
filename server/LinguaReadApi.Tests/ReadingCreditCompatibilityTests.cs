using System.Security.Claims;
using System.Text.Json;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Tokenization;
using LinguaReadApi.Utilities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Xunit.Abstractions;

namespace LinguaReadApi.Tests;

// Bounded experiment: original synthetic text, real services and relational
// transactions. Output exposes discrepancies; it does not approve word boundaries.
public class ReadingCreditCompatibilityTests(ITestOutputHelper output)
{
    [Theory]
    [InlineData("ascii", "en", "one two. one!", 3, 3, 3)]
    [InlineData("chinese", "zh", "我爱读书。你呢？", 1, 1, 2)]
    [InlineData("japanese", "ja", "私は本を読む。猫も読む。", 1, 1, 2)]
    [InlineData("thai", "th", "ฉันอ่านหนังสือ。คุณอ่านไหม？", 1, 1, 2)]
    [InlineData("punctuation", "en", "one,two—three", 1, 1, 3)]
    [InlineData("punctuation-only", "en", "... !!!", 2, 2, 0)]
    [InlineData("unicode-spaces", "en", "one\u00a0two\u202fthree\u3000four", 1, 4, 4)]
    [InlineData("unicode-space-only", "en", "\u00a0\u202f\u3000", 0, 0, 0)]
    [InlineData("unspaced-run", "zh", "我爱读书你呢", 1, 1, 1)]
    public void CountingCandidates_ExposeDifferentUnits(string id, string code, string text,
        int legacy, int unicodeWhitespace, int currentTokens)
    {
        var actualLegacy = WordCountUtility.CountTotalWords(text);
        var actualUnicode = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length;
        var tokens = Tokenizer.Tokenize(text, new Language { Code = code }).Tokens.Where(t => t.IsWord).ToArray();
        output.WriteLine(JsonSerializer.Serialize(new { id, code, text, legacy = actualLegacy,
            unicodeWhitespace = actualUnicode, currentTokens = tokens.Select(t => t.Text) }));
        Assert.Equal(legacy, actualLegacy);
        Assert.Equal(unicodeWhitespace, actualUnicode);
        Assert.Equal(currentTokens, tokens.Length);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InitialCompletionAndReread_ReconcileSentenceCredit_AndPreserveLearnerData(bool book)
    {
        await using var learner = await Learner.Create(book);
        var preserved = await learner.Snapshot();
        Assert.Equal(4, await learner.Context.Words.CountAsync()); // Includes a phrase and a legacy case collision.
        // The same stored offline payload can arrive repeatedly after a lost response.
        await learner.ReadSentence(0, "one two.");
        await learner.ReadSentence(0, "one two.");
        await learner.Complete();
        var initial = await learner.Earned();
        output.WriteLine($"route={(book ? "book" : "text")}, initial={initial}, expected=103");
        Assert.Equal(103, initial);
        Assert.Equal(3, await learner.GoalProgress());

        // Recomputing coverage repairs caches, never earned activity or goal baselines.
        await learner.RecomputeCoverage();
        Assert.Equal(103, await learner.Earned());
        Assert.Equal(3, (await learner.Context.Texts.SingleAsync()).TotalWords);
        Assert.Equal(2, (await learner.Context.Texts.SingleAsync()).KnownWords);

        // Retry inside the existing window is a no-op, then a distinct reread earns 3.
        await learner.Complete();
        Assert.Equal(103, await learner.Earned());
        await learner.ExpireCompletionWindow();
        await learner.Complete();
        var reread = await learner.Earned();
        output.WriteLine($"route={(book ? "book" : "text")}, reread={reread}, expected=106");
        Assert.Equal(106, reread);
        Assert.Equal(6, await learner.GoalProgress());
        var stats = await learner.Context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(1, stats.TotalTextsCompleted);
        Assert.Equal(2, stats.TotalTextCompletions);
        // Preserve the separate legacy Language counter's completion-only behavior.
        Assert.Equal(book ? 6 : 0, (await learner.Context.Languages.SingleAsync()).WordsRead);
        Assert.Equal(preserved, await learner.Snapshot());
    }

    [Theory]
    [InlineData(false, 3)]
    [InlineData(true, 3)]
    [InlineData(false, 7)]
    [InlineData(true, 7)]
    public async Task FullOrExcessHistoricalSentenceCredit_IsNeverClawedBack(bool book, int earned)
    {
        await using var learner = await Learner.Create(book);
        await learner.ReadSentence(0, string.Join(' ', Enumerable.Repeat("one", earned)));
        var preserved = await learner.Snapshot();
        await learner.Complete();
        Assert.Equal(100 + earned, await learner.Earned());
        Assert.Equal(0, (await learner.Context.UserActivities.OrderBy(a => a.ActivityId).LastAsync()).WordCount);
        Assert.Equal(earned, (await learner.Context.UserSentenceProgresses.SingleAsync()).CreditedWordCount);
        await learner.ExpireCompletionWindow();
        await learner.Complete();
        Assert.Equal(103 + earned, await learner.Earned());
        Assert.Equal(preserved, await learner.Snapshot());
    }

    [Theory]
    [InlineData(false, "one.two", "one.", "two")]
    [InlineData(true, "我爱读书。你呢？", "我爱读书。", "你呢？")]
    public async Task LegacySentenceUnits_CanExceedWholeTextUnits_WithoutRewritingEarnedHistory(
        bool book, string content, string first, string second)
    {
        await using var learner = await Learner.Create(book);
        (await learner.Context.Texts.SingleAsync()).Content = content;
        await learner.Context.SaveChangesAsync();
        Assert.Equal(1, WordCountUtility.CountTotalWords(content));
        await learner.ReadSentence(0, first);
        await learner.ReadSentence(1, second);
        await learner.Complete();
        output.WriteLine($"KNOWN GAP: sentence legacy units=2, whole-text legacy units=1, route={(book ? "book" : "text")}");
        Assert.Equal(102, await learner.Earned()); // Preserve both previously earned sentence events.
        await learner.ExpireCompletionWindow();
        await learner.Complete();
        Assert.Equal(103, await learner.Earned()); // Reread still uses the unchanged whole-text unit.
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task CompletionWithoutCredit_DoesNotMakeLaterRereadSubtractOldSentenceCredit(bool book)
    {
        await using var learner = await Learner.Create(book);
        await learner.ReadSentence(0, "one two.");
        await learner.MarkFinishedWithoutCredit(); // FinishBook or CompleteText(skipStats: true).
        Assert.Equal(102, await learner.Earned());
        await learner.ExpireCompletionWindow();
        await learner.Complete();
        Assert.Equal(105, await learner.Earned()); // Existing sentence activity plus a full new reading.
        Assert.Equal(0, (await learner.Context.UserLanguageStatistics.SingleAsync()).TotalTextsCompleted);
        Assert.Equal(1, (await learner.Context.UserLanguageStatistics.SingleAsync()).TotalTextCompletions);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ExplicitStatisticsReset_ClearsDeductibleCredit_PreservingReplayDedupAndPosition(bool book)
    {
        await using var learner = await Learner.Create(book);
        await learner.ReadSentence(0, "one two.");
        var preserved = await learner.Snapshot(includeHistoricalActivity: false);
        await learner.ResetStatistics();
        Assert.Equal(0, await learner.Earned());
        var progress = await learner.Context.UserSentenceProgresses.SingleAsync();
        Assert.Equal(0, progress.CreditedWordCount);
        Assert.Equal("[0]", progress.CreditedSegmentIndicesJson);
        Assert.Equal(0, progress.LastSegmentIndex);
        // Keep the old dedup indices so a queued pre-reset payload cannot be recredited.
        await learner.ReadSentence(0, "one two.");
        Assert.Equal(0, await learner.Earned());
        await learner.ReadSentence(1, "one!");
        await learner.Complete();
        Assert.Equal(3, await learner.Earned());
        Assert.Equal(preserved, await learner.Snapshot(includeHistoricalActivity: false));
    }

    [Fact]
    public async Task ExplicitStatisticsReset_IsAtomicAndScopedToTheCurrentLearner()
    {
        await using var learner = await Learner.Create(book: true);
        await learner.ReadSentence(0, "one two.");
        var other = Guid.Parse("deadbeef-0000-0000-0000-000000000099");
        learner.Context.Users.Add(new User { Id = other, UserName = "other synthetic learner" });
        learner.Context.Texts.Add(new Text { TextId = 2, UserId = other, LanguageId = 1, Title = "Other", Content = "one" });
        learner.Context.UserActivities.Add(new UserActivity { UserId = other, LanguageId = 1,
            ActivityType = "Reading", WordCount = 25, Timestamp = DateTime.UtcNow.AddDays(-3) });
        learner.Context.UserLanguageStatistics.Add(new UserLanguageStatistics { UserId = other, LanguageId = 1, TotalWordsRead = 25 });
        learner.Context.UserSentenceProgresses.Add(new UserSentenceProgress { UserId = other, TextId = 2,
            CreditedWordCount = 25, CreditedSegmentIndicesJson = "[4]", LastSegmentIndex = 4 });
        await learner.Context.SaveChangesAsync();
        var before = await learner.CreditSnapshot();
        var otherBefore = await learner.CreditSnapshot(other);
        // A real statement failure inside SaveChanges, rather than an exception
        // before saving, proves prior writes roll back with the credit update.
        await learner.Context.Database.ExecuteSqlRawAsync("""
            CREATE TRIGGER fail_credit_reset BEFORE UPDATE OF CreditedWordCount ON UserSentenceProgresses
            BEGIN SELECT RAISE(ABORT, 'synthetic reset interruption'); END;
            """);
        var failure = Assert.IsType<ObjectResult>(await learner.AttemptResetStatistics());
        Assert.Equal(500, failure.StatusCode);
        Assert.Equal(before, await learner.CreditSnapshot());
        Assert.Equal(otherBefore, await learner.CreditSnapshot(other));
        await learner.Context.Database.ExecuteSqlRawAsync("DROP TRIGGER fail_credit_reset;");
        await learner.ResetStatistics();
        Assert.Equal(otherBefore, await learner.CreditSnapshot(other));
        Assert.Empty(await learner.Context.UserActivities.Where(a => a.UserId != other).ToArrayAsync());
        Assert.Equal(0, (await learner.Context.UserSentenceProgresses.SingleAsync(p => p.TextId == 1)).CreditedWordCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OfflineSentenceReplay_ExposesMissingCompletionCheckpoint_ButDeduplicatesSameIndex(bool book)
    {
        await using var learner = await Learner.Create(book);
        await learner.Complete();
        await learner.ReadSentence(1, "one!");
        var firstReplay = await learner.Earned();
        await learner.ReadSentence(1, "one!");
        // Audit evidence, not an accepted credit contract: a previously unseen
        // index can still add credit after completion. IsFinished cannot repair
        // this safely: FinishBook and skipStats set it without earning credit.
        output.WriteLine($"KNOWN GAP: route={(book ? "book" : "text")}, lateReplay={firstReplay}, desired=103");
        Assert.Equal(firstReplay, await learner.Earned());
        Assert.Equal(firstReplay - 100, await learner.GoalProgress());
        Assert.Equal(1, (await learner.Context.UserSentenceProgresses.SingleAsync()).LastSegmentIndex);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InterruptedCompletion_RollsBack_ThenRetryPreservesEarnedCredit(bool book)
    {
        await using var learner = await Learner.Create(book);
        await learner.ReadSentence(0, "one two.");
        var preserved = await learner.Snapshot();
        // Standalone completion has two SaveChanges calls inside its transaction;
        // fail the second after the activity was written. Book has a single save.
        learner.Failure.FailOnSave = book ? 1 : 2;
        await Assert.ThrowsAsync<InvalidOperationException>(() => learner.Complete());
        learner.Context.ChangeTracker.Clear();
        Assert.Equal(102, await learner.Earned());
        Assert.False((await learner.Context.Texts.SingleAsync()).IsFinished);
        Assert.Equal(0, (await learner.Context.UserLanguageStatistics.SingleAsync()).TotalTextCompletions);
        await learner.Complete();
        Assert.Equal(103, await learner.Earned());
        Assert.Equal(preserved, await learner.Snapshot());
    }

    private sealed class FailSave : SaveChangesInterceptor
    {
        public int FailOnSave { get; set; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (FailOnSave > 0 && --FailOnSave == 0) throw new InvalidOperationException("synthetic interruption");
            return ValueTask.FromResult(result);
        }
    }

    private sealed class Learner(SqliteConnection connection, AppDbContext context, bool book, FailSave failure) : IAsyncDisposable
    {
        private static readonly Guid UserId = Guid.Parse("deadbeef-0000-0000-0000-000000000044");
        private static readonly DateTime HistoricalDate = new(2025, 1, 2, 12, 0, 0, DateTimeKind.Utc);
        public AppDbContext Context => context;
        public FailSave Failure => failure;
        private ControllerContext Identity => new() { HttpContext = new DefaultHttpContext {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test")) } };

        public static async Task<Learner> Create(bool book)
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var failure = new FailSave();
            var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlite(connection).AddInterceptors(failure).Options);
            await context.Database.EnsureCreatedAsync();
            context.Users.Add(new User { Id = UserId, UserName = "synthetic" });
            context.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
            if (book) context.Books.Add(new Book { BookId = 1, UserId = UserId, LanguageId = 1, Title = "Synthetic book" });
            context.Texts.Add(new Text { TextId = 1, UserId = UserId, LanguageId = 1, BookId = book ? 1 : null,
                Title = "Synthetic text", Content = "one two. one!", TotalWords = 999, KnownWords = 998 });
            context.Words.AddRange(
                new Word { WordId = 11, UserId = UserId, LanguageId = 1, Term = "one", Status = 5 },
                new Word { WordId = 12, UserId = UserId, LanguageId = 1, Term = "two", Status = 2 },
                new Word { WordId = 13, UserId = UserId, LanguageId = 1, Term = "one two", Status = 6 },
                new Word { WordId = 14, UserId = UserId, LanguageId = 1, Term = "ONE", Status = 3 });
            context.TextWords.AddRange(new TextWord { TextId = 1, WordId = 11, OccurrenceCount = 2 },
                new TextWord { TextId = 1, WordId = 12, OccurrenceCount = 1 },
                new TextWord { TextId = 1, WordId = 13, OccurrenceCount = 99 });
            context.WordTranslations.Add(new WordTranslation { WordId = 11, Translation = "my edited meaning", CreatedAt = HistoricalDate });
            context.SrsPhrases.Add(new SrsPhrase { SrsPhraseId = 21, WordId = 11, UserId = UserId,
                Sentence = "one two.", TextId = 1, TextTitle = "Synthetic text", CreatedAt = HistoricalDate });
            context.SrsCardReviews.Add(new SrsCardReview { SrsCardReviewId = 31, WordId = 11, UserId = UserId,
                Stability = 12.5, Difficulty = 4.2, Interval = 12, Repetitions = 7, NextReviewAt = HistoricalDate.AddYears(2) });
            context.SrsReviewLogs.Add(new SrsReviewLog { SrsReviewLogId = 41, UserId = UserId,
                SrsCardReviewId = 31, Grade = 2, ReviewedAt = HistoricalDate, OldInterval = 9 });
            context.UserActivities.Add(new UserActivity { ActivityId = 51, UserId = UserId, LanguageId = 1,
                ActivityType = "TextCompleted", WordCount = 100, Timestamp = HistoricalDate });
            context.UserLanguageStatistics.Add(new UserLanguageStatistics { UserId = UserId, LanguageId = 1, TotalWordsRead = 100 });
            context.UserGoals.Add(new UserGoal { GoalId = 61, UserId = UserId, LanguageId = 1,
                GoalType = GoalType.WordsRead, BaselineValue = 100, TargetValue = 10, CreatedAt = HistoricalDate });
            context.UserGoals.Add(new UserGoal { GoalId = 62, UserId = UserId, LanguageId = 1,
                GoalType = GoalType.WordsRead, BaselineValue = 50, TargetValue = 50,
                CreatedAt = HistoricalDate, CompletedAt = HistoricalDate.AddHours(1) });
            await context.SaveChangesAsync();
            context.ChangeTracker.Clear();
            return new Learner(connection, context, book, failure);
        }

        public async Task ReadSentence(int index, string text)
        {
            context.ChangeTracker.Clear();
            var controller = new UserActivityController(context, null!, NullLogger<UserActivityController>.Instance) { ControllerContext = Identity };
            var result = await controller.LogSentenceRead(new UserActivityController.LogSentenceReadRequest {
                TextId = 1, CurrentSegmentIndex = index, Segments = [new() { SegmentIndex = index, SegmentText = text }] });
            Assert.IsType<OkObjectResult>(result.Result);
        }

        public async Task Complete()
        {
            if (book)
            {
                var controller = new BooksController(context, NullLogger<BooksController>.Instance, new ChapterDetectionService()) { ControllerContext = Identity };
                var result = await controller.CompleteLesson(1, new CompleteLessonDto { TextId = 1 });
                Assert.IsType<BookStatsDto>(result.Value);
            }
            else
            {
                var controller = new TextsController(context, NullLogger<TextsController>.Instance,
                    new UserActivityService(context, NullLogger<UserActivityService>.Instance), new WordLinkingChannel(), StatsService()) { ControllerContext = Identity };
                Assert.IsType<OkObjectResult>((await controller.CompleteText(1)).Result);
            }
        }

        public async Task MarkFinishedWithoutCredit()
        {
            if (book)
            {
                var controller = new BooksController(context, NullLogger<BooksController>.Instance, new ChapterDetectionService()) { ControllerContext = Identity };
                Assert.IsType<NoContentResult>(await controller.FinishBook(1, new FinishBookRequest()));
            }
            else
            {
                var controller = new TextsController(context, NullLogger<TextsController>.Instance,
                    new UserActivityService(context, NullLogger<UserActivityService>.Instance), new WordLinkingChannel(), StatsService()) { ControllerContext = Identity };
                Assert.IsType<OkObjectResult>((await controller.CompleteText(1, skipStats: true)).Result);
            }
        }

        public async Task ResetStatistics()
        {
            Assert.IsType<OkObjectResult>(await AttemptResetStatistics());
            context.ChangeTracker.Clear();
        }

        public Task<IActionResult> AttemptResetStatistics() => new UsersController(context,
            NullLogger<UsersController>.Instance) { ControllerContext = Identity }.ResetStatistics();

        public async Task ExpireCompletionWindow()
        {
            context.ChangeTracker.Clear();
            (await context.Texts.SingleAsync()).LastCompletedAt = DateTime.UtcNow.AddMinutes(-5);
            await context.SaveChangesAsync();
        }

        public async Task<long> Earned()
        {
            context.ChangeTracker.Clear();
            var activity = await context.UserActivities.SumAsync(a => (long)a.WordCount);
            Assert.Equal(activity, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
            return activity;
        }

        public async Task<long> GoalProgress() => (await new GoalProgressService(context).ComputeAsync(UserId,
            await context.UserGoals.ToListAsync(), 0, DateTime.UtcNow)).Single(g => g.GoalId == 61).Progress;

        private StatsRecomputeService StatsService() => new(new ServiceCollection().AddSingleton(context).BuildServiceProvider(),
            NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        public Task RecomputeCoverage() => StatsService().RecomputeAllAsync(CancellationToken.None);

        // Scalar snapshots include identities, values and timestamps; no navigation cycles.
        public async Task<string> Snapshot(bool includeHistoricalActivity = true)
        {
            context.ChangeTracker.Clear();
            var entities = new object[] { (await context.Words.OrderBy(w => w.WordId).ToArrayAsync()),
                (await context.WordTranslations.ToArrayAsync()), (await context.SrsPhrases.ToArrayAsync()),
                (await context.SrsCardReviews.ToArrayAsync()), (await context.SrsReviewLogs.ToArrayAsync()),
                (await context.UserActivities.Where(a => includeHistoricalActivity && a.ActivityId == 51).ToArrayAsync()),
                (await context.UserGoals.ToArrayAsync()) };
            var scalar = entities.Cast<Array>().Select(a => a.Cast<object>().Select(e => context.Entry(e).Properties
                .ToDictionary(p => p.Metadata.Name, p => p.CurrentValue)).ToArray()).ToArray();
            return JsonSerializer.Serialize(scalar);
        }

        public async Task<string> CreditSnapshot(Guid? learnerId = null)
        {
            context.ChangeTracker.Clear();
            var id = learnerId ?? UserId;
            var rows = new Array[] {
                await context.UserActivities.Where(a => a.UserId == id).OrderBy(a => a.ActivityId).ToArrayAsync(),
                await context.UserLanguageStatistics.Where(s => s.UserId == id).ToArrayAsync(),
                await context.UserSentenceProgresses.Where(p => p.UserId == id).ToArrayAsync() };
            return JsonSerializer.Serialize(rows.Select(a => a.Cast<object>().Select(e => context.Entry(e).Properties
                .ToDictionary(p => p.Metadata.Name, p => p.CurrentValue)).ToArray()).ToArray());
        }

        public async ValueTask DisposeAsync() { await context.DisposeAsync(); await connection.DisposeAsync(); }
    }
}
