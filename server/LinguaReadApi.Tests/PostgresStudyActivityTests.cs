using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace LinguaReadApi.Tests;

public class PostgresStudyFactAttribute : FactAttribute
{
    public PostgresStudyFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LINGUA_STUDY_TEST_POSTGRES")))
            Skip = "Set LINGUA_STUDY_TEST_POSTGRES to the isolated studycheck database; CI supplies it.";
    }
}

// Separate schemas do not isolate database-wide extension creation. Keep setup
// sequential across classes; concurrency within each test remains unchanged.
[CollectionDefinition("Postgres study database")]
public class PostgresStudyDatabaseCollection { }

[Collection("Postgres study database")]
public class PostgresStudyActivityTests
{
    private static readonly Guid UserId = Guid.Parse("deadbeef-0000-0000-0000-000000000044");
    private static ControllerContext Identity => new() { HttpContext = new DefaultHttpContext {
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test")) } };

    [PostgresStudyFact]
    public async Task LibraryContents_ProjectsFractionalPracticeCounts_AndScopesFolderAndOwner()
    {
        await using var db = await Database.Create();
        await using var c = db.Context();
        var otherUser = Guid.NewGuid();
        c.Users.Add(new User { Id = otherUser, UserName = "other synthetic learner" });
        c.Folders.Add(new Folder { FolderId = 1, UserId = UserId, Name = "Lessons" });
        c.Books.Add(new Book { BookId = 1, UserId = UserId, LanguageId = 1, Title = "Book" });
        (await c.Texts.FindAsync(1))!.IsAudioLesson = true;
        (await c.Texts.FindAsync(2))!.FolderId = 1;
        c.Texts.AddRange(
            new Text { TextId = 3, UserId = UserId, LanguageId = 1, Title = "Story", Content = "one", Tag = "srs-story" },
            new Text { TextId = 4, UserId = otherUser, LanguageId = 1, Title = "Private", Content = "one" },
            new Text { TextId = 5, UserId = UserId, LanguageId = 1, Title = "Part", Content = "one", BookId = 1 });
        foreach (var (kind, tenths) in new[] { ("read", 10), ("read-set", 3), ("listen", 10), ("list-set", 12), ("playback", 3) })
        {
            var e = LessonStudyActivity.Record(c, UserId, 1, "Synthetic", 1, "one two. one!", null, "library-" + kind, kind);
            e.PassTenths = tenths;
        }
        LessonStudyActivity.Record(c, UserId, 1, "Synthetic", 1, "one two. one!", null, "excluded", "read").CountsTowardStatistics = false;
        LessonStudyActivity.Record(c, otherUser, 1, "Synthetic", 1, "one two. one!", null, "other-user", "read");
        await c.SaveChangesAsync();
        c.ChangeTracker.Clear();

        var controller = new FoldersController(c, NullLogger<FoldersController>.Instance) { ControllerContext = Identity };
        var root = (await controller.GetLibraryContents()).Value!;
        var lesson = Assert.Single(root.Texts);
        Assert.Equal(1, lesson.TextId);
        Assert.True(lesson.IsAudioLesson);
        Assert.Equal(1.3m, lesson.ReadCount);
        Assert.Equal(2.5m, lesson.ListenCount);
        Assert.Equal(1, Assert.Single(root.Books).PartCount);
        Assert.Equal(1, Assert.Single(root.Folders).ItemCount);
        var folder = (await controller.GetLibraryContents(1)).Value!;
        var unread = Assert.Single(folder.Texts);
        Assert.Equal(2, unread.TextId);
        Assert.Equal(0m, unread.ReadCount);
        Assert.Equal(0m, unread.ListenCount);
    }

    [PostgresStudyFact]
    public async Task RecentTexts_LimitsAfterBookDeduplication_AndEnrichesOnlyOwnerProgress()
    {
        await using var db = await Database.Create();
        await using var c = db.Context();
        var accessed = new DateTime(2026, 11, 12, 10, 0, 0, DateTimeKind.Utc);
        var otherUser = Guid.NewGuid();
        c.Users.Add(new User { Id = otherUser, UserName = "other synthetic learner" });
        c.Books.Add(new Book { BookId = 1, UserId = UserId, LanguageId = 1, Title = "Book", CoverImagePath = "cover.jpg" });
        // A long run of parts must not hide older standalone entries behind a
        // candidate limit. Equal timestamps also need one consistent book winner.
        c.Texts.AddRange(Enumerable.Range(10, 75).Select(id => new Text {
            TextId = id, UserId = UserId, LanguageId = 1, Title = $"Part {id}", Content = "one two",
            BookId = 1, LastAccessedAt = id <= 11 ? accessed : accessed.AddSeconds(-id) }));
        c.Texts.AddRange(Enumerable.Range(100, 7).Select(id => new Text {
            TextId = id, UserId = UserId, LanguageId = 1, Title = $"Lesson {id}",
            Content = new string('a', 310) + "<span title='" + new string('x', 330) + "'>&amp;" + new string('b', 30) + "</span>",
            LastAccessedAt = accessed.AddMinutes(-id), IsAudioLesson = true,
            SrtContent = "1\n00:00:00,000 --> 00:01:00,500\none\n" }));
        c.Texts.AddRange(
            new Text { TextId = 200, UserId = UserId, LanguageId = 1, Title = "Story", Content = "hidden", Tag = "srs-story", LastAccessedAt = accessed.AddDays(1), BookId = 1 },
            new Text { TextId = 201, UserId = otherUser, LanguageId = 1, Title = "Private", Content = "hidden", LastAccessedAt = accessed.AddDays(2) });
        c.UserSentenceProgresses.Add(new UserSentenceProgress { UserId = UserId, TextId = 100, CreditedWordCount = 5 });
        c.UserAudioLessonProgresses.AddRange(
            new UserAudioLessonProgress { UserId = UserId, TextId = 100, CurrentPosition = 12 },
            new UserAudioLessonProgress { UserId = otherUser, TextId = 100, CurrentPosition = 99 });
        await c.SaveChangesAsync();
        c.ChangeTracker.Clear();
        using var provider = new ServiceCollection().AddSingleton(c).BuildServiceProvider();
        var controller = Texts(c, provider);

        var recent = (await controller.GetRecentTexts()).Value!.ToList();
        Assert.Equal(new[] { 11, 100, 101, 102, 103 }, recent.Select(t => t.TextId));
        Assert.Equal("cover.jpg", recent[0].CoverImagePath);
        Assert.Equal(new string('a', 310) + " &" + new string('b', 8), recent[1].Preview);
        Assert.Equal(5, recent[1].ReadWords);
        Assert.Equal(12d, recent[1].AudioPositionSeconds);
        Assert.Equal(60.5d, recent[1].AudioDurationSeconds);
        Assert.Equal(accessed.AddMinutes(-100), await c.Texts.Where(t => t.TextId == 100).Select(t => t.LastAccessedAt).SingleAsync());
        Assert.Empty(c.ChangeTracker.Entries());
    }

    [PostgresStudyFact]
    public async Task LessonPlayback_AccumulatesFractionalCredit_DeduplicatesConcurrentFlushes_AndPreservesResetReceipts()
    {
        await using var db = await Database.Create();
        await using (var c = db.Context())
        {
            (await c.Texts.FindAsync(1))!.IsAudioLesson = true;
            await c.SaveChangesAsync();
        }
        var request = new UserActivityController.LogListeningRequest {
            LanguageId = 1, DurationSeconds = 0, ClientEventId = "lesson-fraction-a",
            Lesson = new() { TextId = 1, SourceRevision = Revision, PlayedSeconds = 0.4, AudioDurationSeconds = 4 } };
        await using var a = db.Context();
        await using var b = db.Context();
        Assert.All(await Task.WhenAll(Activity(a).LogListeningActivity(request), Activity(b).LogListeningActivity(request)),
            result => Assert.IsType<OkObjectResult>(result));
        await using var verify = db.Context();
        Assert.Single(await verify.UserActivities.ToListAsync());
        var first = await verify.LessonStudyEvents.SingleAsync();
        Assert.Equal("playback", first.Kind);
        Assert.Equal(1, first.PassTenths);
        Assert.Equal(0.1, first.PlaybackPasses, 8);
        var emptyStats = Assert.IsType<UserActivityController.ListeningStatsDto>(
            Assert.IsType<OkObjectResult>((await Activity(verify).GetListeningStats()).Result).Value);
        Assert.Empty(emptyStats.ListeningByDate);
        Assert.Empty(emptyStats.ListeningByLanguage);

        request = new() { LanguageId = 1, DurationSeconds = 1, ClientEventId = "lesson-fraction-b",
            Lesson = new() { TextId = 1, SourceRevision = Revision, PlayedSeconds = 1, AudioDurationSeconds = 4 } };
        Assert.IsType<OkObjectResult>(await Activity(verify).LogListeningActivity(request));
        Assert.IsType<OkObjectResult>(await Activity(verify).LogListeningActivity(request));
        Assert.Equal(3, (await LessonStudyActivity.PassCountsAsync(verify, UserId, 1)).Listen);
        Assert.Equal(1, (await verify.UserLanguageStatistics.SingleAsync()).TotalSecondsListened);
        Assert.Equal(2, await verify.LessonStudyEvents.CountAsync(e => e.Kind == "playback"));
        await Reset(verify);
        Assert.Equal(2, await LessonStudyActivity.ListeningResetReceipts(verify, UserId).CountAsync());
        Assert.IsType<OkObjectResult>(await Activity(verify).LogListeningActivity(request));
        Assert.Empty(await verify.UserActivities.ToListAsync());
        Assert.Equal(0, (await verify.UserLanguageStatistics.SingleAsync()).TotalSecondsListened);
    }

    [PostgresStudyFact]
    public async Task ConcurrentFractionalEdits_RejectStaleTotals_AndDeduplicateRetries()
    {
        await using var db = await Database.Create();
        var first = new SetLessonStudyCountRequest { ClientEventId = "set-first", SourceRevision = Revision,
            Kind = "read", Count = 2.5m, ExpectedCount = 0 };
        var second = new SetLessonStudyCountRequest { ClientEventId = "set-second", SourceRevision = Revision,
            Kind = "read", Count = 0.3m, ExpectedCount = 0 };
        await using var a = db.Context();
        await using var b = db.Context();
        var results = await Task.WhenAll(
            new LessonStudyController(a) { ControllerContext = Identity }.SetCount(1, first),
            new LessonStudyController(b) { ControllerContext = Identity }.SetCount(1, second));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Single(results.OfType<ConflictObjectResult>());
        var accepted = results[0] is OkObjectResult ? first : second;
        await using var verify = db.Context();
        Assert.IsType<OkObjectResult>(await new LessonStudyController(verify) { ControllerContext = Identity }.SetCount(1, accepted));
        Assert.Equal(accepted.Count * 10, (await LessonStudyActivity.PassCountsAsync(verify, UserId, 1)).Read);
        Assert.Equal(LessonStudyActivity.RoundedWords((int)(accepted.Count * 10), 3),
            (await verify.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
        Assert.Single(await verify.LessonStudyEvents.ToListAsync());
    }

    [PostgresStudyFact]
    public async Task FractionalMigration_BackfillsExistingPasses_AndProtectsCorrectionsOnDowngrade()
    {
        await using var db = await Database.Create(createTables: false);
        await using var c = db.Context();
        var migrator = c.GetService<IMigrator>();
        const string before = "20261030122947_AddTextSegmentationProfile";
        await migrator.MigrateAsync(before);
        await Seed(c);
        // Simulate a row written by the previous server, without the new columns.
        await c.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "LessonStudyEvents" ("UserId", "SourceTextId", "SourceTitle", "LanguageId", "SourceRevision",
                "ClientEventId", "Kind", "CreditedWords", "CreditedListeningSeconds", "CountingVersion",
                "CountsTowardStatistics", "IsCompletionCheckpoint", "CreatedAt")
            VALUES ({UserId}, 1, 'Synthetic', 1, {Revision}, 'legacy-read', 'read', 3, 0, 1, TRUE, TRUE, {DateTime.UtcNow})
            """);
        c.UserLanguageStatistics.Add(new UserLanguageStatistics { UserId = UserId, LanguageId = 1, TotalWordsRead = 3 });
        c.UserActivities.Add(new UserActivity { UserId = UserId, LanguageId = 1, ActivityType = "TextCompleted", WordCount = 3, Timestamp = DateTime.UtcNow });
        await c.SaveChangesAsync();
        await migrator.MigrateAsync();
        Assert.Equal(10, (await c.LessonStudyEvents.SingleAsync()).PassTenths);
        Assert.IsType<OkObjectResult>(await new LessonStudyController(c) { ControllerContext = Identity }.SetCount(1,
            new SetLessonStudyCountRequest { ClientEventId = "fractional", SourceRevision = Revision, Kind = "read", Count = 0.3m, ExpectedCount = 1 }));
        Assert.Equal(1, (await c.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
        await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(before));
        Assert.Equal(2, await c.LessonStudyEvents.CountAsync());
    }

    [PostgresStudyFact]
    public async Task ConcurrentDifferentLessonsAndExistingListening_PreserveSharedTotalsAndDedup()
    {
        await using var db = await Database.Create();
        await Task.WhenAll(
            Worker(async (c, i) => await Complete(c, 1, "same-read")),
            Worker(async (c, i) => await Complete(c, 2, $"read-{i}")),
            Worker(async (c, i) => Assert.IsType<OkObjectResult>(await Activity(c).LogListeningActivity(new() {
                LanguageId = 1, DurationSeconds = 7, ClientEventId = $"old-listening-{i}" }))),
            Worker(async (c, i) => {
                var controller = new LessonStudyController(c) { ControllerContext = Identity };
                var request = new LogLessonListenRequest { ClientEventId = $"new-listening-{i}", DurationSeconds = 11, SourceRevision = Revision };
                Assert.IsType<OkResult>(await controller.Listen(1, request));
                Assert.IsType<OkResult>(await controller.Listen(1, request));
            }));
        await using var verify = db.Context();
        var stats = await verify.UserLanguageStatistics.SingleAsync();
        Assert.Equal(18, stats.TotalWordsRead); // 1 pass of text 1 + 5 deliberate passes of text 2.
        Assert.Equal(90, stats.TotalSecondsListened);
        Assert.Equal(6, stats.TotalTextCompletions);
        Assert.Equal(2, stats.TotalTextsCompleted);
        Assert.Equal(18, await verify.UserActivities.SumAsync(a => a.WordCount));
        Assert.Equal(90, await verify.UserActivities.SumAsync(a => a.ListeningDurationSeconds ?? 0));
        Assert.Equal(11, await verify.LessonStudyEvents.CountAsync());

        async Task Worker(Func<AppDbContext, int, Task> action)
        {
            for (var i = 0; i < 5; i++) { await using var c = db.Context(); await action(c, i); }
        }
    }

    [PostgresStudyFact]
    public async Task ConcurrentSentenceCompletionAndReset_KeepAtomicEarnedTotals()
    {
        await using var db = await Database.Create();
        for (var i = 0; i < 6; i++)
        {
            await using var sentence = db.Context();
            await using var completion = db.Context();
            await using var reset = db.Context();
            await Task.WhenAll(
                Activity(sentence).LogSentenceRead(new() { TextId = 1, Segments = [new() { SegmentIndex = i, SegmentText = "one two." }] }),
                Complete(completion, 1, $"read-cycle-{i}"),
                Reset(reset));
            await using var verify = db.Context();
            var words = await verify.UserActivities.SumAsync(a => a.WordCount);
            Assert.Equal(words, (await verify.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
            Assert.Contains(words, new[] { 0, 3 });
        }
    }

    [PostgresStudyFact]
    public async Task ConcurrentListeningReplayAndReset_DoNotResurrectAcceptedSeconds()
    {
        await using var db = await Database.Create();
        for (var i = 0; i < 5; i++)
        {
            var request = new UserActivityController.LogListeningRequest {
                LanguageId = 1, DurationSeconds = 7, ClientEventId = $"reset-listening-{i}" };
            await using (var first = db.Context())
                Assert.IsType<OkObjectResult>(await Activity(first).LogListeningActivity(request));
            await using var replay = db.Context();
            await using var reset = db.Context();
            await Task.WhenAll(Activity(replay).LogListeningActivity(request), Reset(reset));
            await using var after = db.Context();
            Assert.IsType<OkObjectResult>(await Activity(after).LogListeningActivity(request));
            Assert.Equal(0, (await after.UserLanguageStatistics.SingleAsync()).TotalSecondsListened);
            Assert.Empty(await after.UserActivities.ToListAsync());
            Assert.Equal(i + 1, await after.LessonStudyEvents.CountAsync(e => e.Kind == "time"));
        }
    }

    [PostgresStudyFact]
    public async Task AdditiveMigration_PreservesHistoricalData_AndRefusesToDropRecordedPasses()
    {
        await using var db = await Database.Create(createTables: false);
        await using var c = db.Context();
        var migrator = c.GetService<IMigrator>();
        const string before = "20260927181306_AddTextImagePath";
        await migrator.MigrateAsync(before);
        await Seed(c, legacyTextSchema: true);
        c.UserActivities.Add(new UserActivity { UserId = UserId, LanguageId = 1, ActivityType = "Reading",
            WordCount = 123, Timestamp = DateTime.UtcNow.AddYears(-1) });
        c.WordTranslations.Add(new WordTranslation { WordId = 1, Translation = "edited meaning" });
        c.SrsPhrases.Add(new SrsPhrase { UserId = UserId, WordId = 1, TextId = 1, Sentence = "one two.", TextTitle = "Synthetic" });
        c.SrsCardReviews.Add(new SrsCardReview { SrsCardReviewId = 1, WordId = 1, UserId = UserId, Stability = 4.5,
            Difficulty = 3.2, NextReviewAt = DateTime.UtcNow.AddDays(12) });
        c.SrsReviewLogs.Add(new SrsReviewLog { SrsCardReviewId = 1, UserId = UserId, Grade = 2 });
        await c.SaveChangesAsync();
        var beforeData = await Snapshot(c);
        await migrator.MigrateAsync();
        Assert.Empty(await c.LessonStudyEvents.ToListAsync());
        Assert.Equal(beforeData, await Snapshot(c));
        await migrator.MigrateAsync(before); // Empty ledger can be removed.
        Assert.Equal(beforeData, await Snapshot(c));
        await migrator.MigrateAsync();
        LessonStudyActivity.Record(c, UserId, 1, "Synthetic", 1, "one two. one!", null, "migration-pass", "read", words: 3);
        await c.SaveChangesAsync();
        await Assert.ThrowsAsync<PostgresException>(() => migrator.MigrateAsync(before));
        // Earlier successful downgrade steps may already have removed additive
        // columns. Inspect history through a column present in both schemas.
        Assert.Single(await c.LessonStudyEvents.Select(e => e.LessonStudyEventId).ToListAsync());
        Assert.Equal(beforeData, await Snapshot(c));
    }

    private static string Revision => LessonStudyActivity.Revision("one two. one!", 1, null);
    private static UserActivityController Activity(AppDbContext c) => new(c, null!, NullLogger<UserActivityController>.Instance) { ControllerContext = Identity };
    private static async Task Reset(AppDbContext c) => Assert.IsType<OkObjectResult>(await new UsersController(c,
        NullLogger<UsersController>.Instance) { ControllerContext = Identity }.ResetStatistics());
    private static async Task Complete(AppDbContext c, int textId, string id)
    {
        using var provider = new ServiceCollection().AddSingleton(c).BuildServiceProvider();
        var controller = Texts(c, provider);
        Assert.IsType<OkObjectResult>((await controller.CompleteText(textId, clientEventId: id, repeat: true, sourceRevision: Revision)).Result);
    }
    private static TextsController Texts(AppDbContext c, IServiceProvider provider) => new(c, NullLogger<TextsController>.Instance,
            new UserActivityService(c, NullLogger<UserActivityService>.Instance), new WordLinkingChannel(),
            new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal())) { ControllerContext = Identity };
    private static string Connection()
    {
        var value = Environment.GetEnvironmentVariable("LINGUA_STUDY_TEST_POSTGRES")!;
        if (new NpgsqlConnectionStringBuilder(value).Database != "studycheck") throw new InvalidOperationException("Synthetic checks require Database=studycheck.");
        return value;
    }
    private static DbContextOptions<AppDbContext> Options(string connection) => new DbContextOptionsBuilder<AppDbContext>()
        .UseNpgsql(connection, o => o.EnableRetryOnFailure(5, TimeSpan.FromMilliseconds(100), null)).Options;
    private static async Task Seed(AppDbContext c, bool legacyTextSchema = false)
    {
        c.Users.Add(new User { Id = UserId, UserName = "synthetic" });
        c.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
        if (!legacyTextSchema)
            c.Texts.AddRange(Enumerable.Range(1, 2).Select(id => new Text { TextId = id, UserId = UserId, LanguageId = 1,
                Title = "Synthetic", Content = "one two. one!" }));
        c.Words.Add(new Word { WordId = 1, UserId = UserId, LanguageId = 1, Term = "one", Status = 5 });
        await c.SaveChangesAsync();
        if (legacyTextSchema)
        {
            // Seed the historical table shape without projecting new optional columns.
            foreach (var id in Enumerable.Range(1, 2))
                await c.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO "Texts" ("TextId", "UserId", "LanguageId", "Title", "Content", "CreatedAt",
                        "SortOrder", "IsAudioLesson", "IsFinished", "TotalWords", "KnownWords")
                    VALUES ({id}, {UserId}, 1, 'Synthetic', 'one two. one!', {DateTime.UtcNow}, 0, FALSE, FALSE, 0, 0)
                    """);
        }
        c.ChangeTracker.Clear();
    }
    private static async Task<string> Snapshot(AppDbContext c)
    {
        c.ChangeTracker.Clear();
        Array[] rows = [await c.Words.ToArrayAsync(), await c.WordTranslations.ToArrayAsync(), await c.SrsPhrases.ToArrayAsync(),
            await c.SrsCardReviews.ToArrayAsync(), await c.SrsReviewLogs.ToArrayAsync(), await c.UserActivities.ToArrayAsync()];
        return System.Text.Json.JsonSerializer.Serialize(rows.Select(a => a.Cast<object>().Select(e => c.Entry(e).Properties
            .ToDictionary(p => p.Metadata.Name, p => p.CurrentValue)).ToArray()).ToArray());
    }
    private sealed class Database(string schema, DbContextOptions<AppDbContext> options) : IAsyncDisposable
    {
        public AppDbContext Context() => new(options);
        public static async Task<Database> Create(bool createTables = true)
        {
            var schema = "study_probe_" + Guid.NewGuid().ToString("N");
            await using var connection = new NpgsqlConnection(Connection());
            await connection.OpenAsync();
            await new NpgsqlCommand($"CREATE SCHEMA {schema}", connection).ExecuteNonQueryAsync();
            var settings = new NpgsqlConnectionStringBuilder(Connection()) { SearchPath = schema };
            var db = new Database(schema, Options(settings.ToString()));
            await using var c = db.Context();
            if (createTables)
            {
                await c.Database.ExecuteSqlRawAsync(c.Database.GenerateCreateScript());
                await Seed(c);
            }
            return db;
        }
        public async ValueTask DisposeAsync()
        {
            await using var connection = new NpgsqlConnection(Connection());
            await connection.OpenAsync();
            await new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", connection).ExecuteNonQueryAsync();
        }
    }
}
