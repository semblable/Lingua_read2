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

public class PostgresStudyActivityTests
{
    private static readonly Guid UserId = Guid.Parse("deadbeef-0000-0000-0000-000000000044");
    private static ControllerContext Identity => new() { HttpContext = new DefaultHttpContext {
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test")) } };

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
        await Seed(c);
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
        Assert.Single(await c.LessonStudyEvents.ToListAsync());
        Assert.Equal(beforeData, await Snapshot(c));
    }

    private static string Revision => LessonStudyActivity.Revision("one two. one!", 1, null);
    private static UserActivityController Activity(AppDbContext c) => new(c, null!, NullLogger<UserActivityController>.Instance) { ControllerContext = Identity };
    private static async Task Reset(AppDbContext c) => Assert.IsType<OkObjectResult>(await new UsersController(c,
        NullLogger<UsersController>.Instance) { ControllerContext = Identity }.ResetStatistics());
    private static async Task Complete(AppDbContext c, int textId, string id)
    {
        using var provider = new ServiceCollection().AddSingleton(c).BuildServiceProvider();
        var controller = new TextsController(c, NullLogger<TextsController>.Instance,
            new UserActivityService(c, NullLogger<UserActivityService>.Instance), new WordLinkingChannel(),
            new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal())) { ControllerContext = Identity };
        Assert.IsType<OkObjectResult>((await controller.CompleteText(textId, clientEventId: id, repeat: true, sourceRevision: Revision)).Result);
    }
    private static string Connection()
    {
        var value = Environment.GetEnvironmentVariable("LINGUA_STUDY_TEST_POSTGRES")!;
        if (new NpgsqlConnectionStringBuilder(value).Database != "studycheck") throw new InvalidOperationException("Synthetic checks require Database=studycheck.");
        return value;
    }
    private static DbContextOptions<AppDbContext> Options(string connection) => new DbContextOptionsBuilder<AppDbContext>()
        .UseNpgsql(connection, o => o.EnableRetryOnFailure(5, TimeSpan.FromMilliseconds(100), null)).Options;
    private static async Task Seed(AppDbContext c)
    {
        c.Users.Add(new User { Id = UserId, UserName = "synthetic" });
        c.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
        c.Texts.AddRange(Enumerable.Range(1, 2).Select(id => new Text { TextId = id, UserId = UserId, LanguageId = 1,
            Title = "Synthetic", Content = "one two. one!" }));
        c.Words.Add(new Word { WordId = 1, UserId = UserId, LanguageId = 1, Term = "one", Status = 5 });
        await c.SaveChangesAsync();
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
