using System.Text.Json;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Tokenization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class TokenizerV4MigrationAcceptanceTests
{
    [Fact]
    public async Task VersionThreeDatabase_RelinksOnce_WithoutChangingLearnerDataOrEarnedCredit()
    {
        // Exercise the real startup migration, including its rekey and orphan cleanup,
        // in an isolated relational database. Never connect to a learner's database.
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(builder => builder.UseSqlite(connection));
        await using var provider = services.BuildServiceProvider();
        var userId = Guid.Parse("deadbeef-0000-0000-0000-000000000004");
        await using (var scope = provider.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await context.Database.EnsureCreatedAsync();
            await Seed(context, userId);
        }

        var protectedBefore = await ProtectedSnapshot(connection);
        var linksBefore = await Snapshot(connection, "TextWords");
        var service = new WordLinkingMigrationService(provider,
            NullLogger<WordLinkingMigrationService>.Instance, new MigrationSignal());
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await service.RunMigration(timeout.Token);
        Assert.False(timeout.IsCancellationRequested);

        // Deliberately literal: a v3 build must fail before the final version bump.
        await using (var scope = provider.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.All(await context.Texts.AsNoTracking().ToListAsync(),
                text => Assert.Equal(4, text.WordLinkingTokenizerVersion));
            Assert.Equal(4, await context.TextWords.CountAsync());
            Assert.Equal(new[] { 1, 1, 2, 2 }, await context.TextWords
                .OrderBy(tw => tw.OccurrenceCount).Select(tw => tw.OccurrenceCount).ToArrayAsync());
            Assert.All(await context.TextWords.Include(tw => tw.Word).ToListAsync(),
                tw => Assert.Equal(userId, tw.Word.UserId));
        }
        Assert.NotEqual(linksBefore, await Snapshot(connection, "TextWords"));
        Assert.Equal(protectedBefore, await ProtectedSnapshot(connection));

        // The second startup must skip current texts, including their link identities.
        var databaseAfter = await Snapshot(connection, "Texts") + await Snapshot(connection, "TextWords");
        await service.RunMigration(timeout.Token);
        Assert.Equal(databaseAfter, await Snapshot(connection, "Texts") + await Snapshot(connection, "TextWords"));
        Assert.Equal(protectedBefore, await ProtectedSnapshot(connection));
    }

    private static async Task Seed(AppDbContext context, Guid userId)
    {
        var historical = new DateTime(2025, 1, 2, 12, 0, 0, DateTimeKind.Utc);
        context.Users.Add(new User { Id = userId, UserName = "v4 synthetic learner" });
        context.Languages.AddRange(
            new Language { LanguageId = 1, Code = "en", Name = "English", WordCharacters = Language.LatinWordCharacters, WordsRead = 100 },
            new Language { LanguageId = 2, Code = "pt", Name = "Portuguese", WordCharacters = Language.LatinWordCharacters, WordsRead = 200 });
        context.Texts.AddRange(
            new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "English", Content = "one two one.",
                WordLinkingTokenizerVersion = 3, IsFinished = true, LastCompletedAt = historical },
            new Text { TextId = 2, UserId = userId, LanguageId = 2, Title = "Português", Content = "casa água casa.",
                WordLinkingTokenizerVersion = 3, IsFinished = true, LastCompletedAt = historical });
        context.Words.AddRange(
            new Word { WordId = 11, UserId = userId, LanguageId = 1, Term = "one", Status = 5, CreatedAt = historical },
            new Word { WordId = 12, UserId = userId, LanguageId = 1, Term = "two", Status = 2, CreatedAt = historical },
            new Word { WordId = 13, UserId = userId, LanguageId = 2, Term = "casa", Status = 6, CreatedAt = historical },
            new Word { WordId = 14, UserId = userId, LanguageId = 2, Term = "água", Status = 3, CreatedAt = historical },
            // Even unlinked learner-owned vocabulary and a translated Status 0 row survive cleanup.
            new Word { WordId = 15, UserId = userId, LanguageId = 1, Term = "orphan", Status = 1, CreatedAt = historical },
            new Word { WordId = 16, UserId = userId, LanguageId = 2, Term = "saudade", Status = 0, CreatedAt = historical });
        context.WordTranslations.AddRange(
            new WordTranslation { WordId = 11, Translation = "my edited meaning", CreatedAt = historical },
            new WordTranslation { WordId = 16, Translation = "my Portuguese translation", CreatedAt = historical });
        context.TextWords.AddRange(
            new TextWord { TextId = 1, WordId = 11, OccurrenceCount = 99, CreatedAt = historical },
            new TextWord { TextId = 2, WordId = 13, OccurrenceCount = 88, CreatedAt = historical });
        context.SrsPhrases.Add(new SrsPhrase { SrsPhraseId = 21, WordId = 11, UserId = userId,
            Sentence = "one two one.", TextId = 1, TextTitle = "English", CreatedAt = historical });
        context.SrsCardReviews.Add(new SrsCardReview { SrsCardReviewId = 31, WordId = 11, UserId = userId,
            Stability = 12.5, Difficulty = 4.2, Interval = 12, Repetitions = 7, Lapses = 2,
            Flag = 3, Tags = "personal", CreatedAt = historical, LastReviewedAt = historical,
            NextReviewAt = historical.AddYears(2) });
        context.SrsReviewLogs.Add(new SrsReviewLog { SrsReviewLogId = 41, UserId = userId,
            SrsCardReviewId = 31, Grade = 2, ReviewedAt = historical, OldInterval = 9,
            OldStability = 10.5, OldDifficulty = 4.3, ClientEventId = "historical-review" });
        context.UserActivities.Add(new UserActivity { ActivityId = 51, UserId = userId, LanguageId = 1,
            ActivityType = "TextCompleted", WordCount = 100, Timestamp = historical });
        context.UserLanguageStatistics.Add(new UserLanguageStatistics { UserId = userId, LanguageId = 1,
            TotalWordsRead = 100, TotalTextsCompleted = 2, TotalTextCompletions = 3 });
        context.UserGoals.Add(new UserGoal { GoalId = 61, UserId = userId, LanguageId = 1,
            GoalType = GoalType.WordsRead, BaselineValue = 50, TargetValue = 50,
            CreatedAt = historical, CompletedAt = historical.AddHours(1) });
        context.UserGoalPeriods.Add(new UserGoalPeriod { PeriodId = 71, GoalId = 61,
            PeriodStart = new DateOnly(2025, 1, 1), PeriodEnd = new DateOnly(2025, 1, 8),
            FinalProgress = 100, TargetAtTime = 50, Completed = true, ClosedAt = historical.AddDays(6) });
        context.UserSentenceProgresses.Add(new UserSentenceProgress { UserId = userId, TextId = 1,
            CreditedSegmentIndicesJson = "[0,1]", CreditedWordCount = 100, LastSegmentIndex = 1, UpdatedAt = historical });
        context.LessonStudyEvents.Add(new LessonStudyEvent { LessonStudyEventId = 81, UserId = userId,
            SourceTextId = 1, SourceTitle = "English", LanguageId = 1, SourceRevision = "historic-revision",
            ClientEventId = "historic-completion", Kind = "read", CreditedWords = 100,
            CreditedListeningSeconds = 45, IsCompletionCheckpoint = true, CreatedAt = historical });
        await context.SaveChangesAsync();
    }

    private static async Task<string> ProtectedSnapshot(SqliteConnection connection)
    {
        // Raw relational rows include every persisted column, even fields added later.
        // These are the actual models behind LessonStudyActivity and StudyGoals.
        string[] tables = ["Words", "WordTranslations", "SrsPhrases", "SrsCardReviews", "SrsReviewLogs",
            "UserActivities", "UserLanguageStatistics", "UserGoals", "UserGoalPeriods",
            "UserSentenceProgresses", "LessonStudyEvents", "Languages"];
        var snapshots = new Dictionary<string, string>();
        foreach (var table in tables) snapshots[table] = await Snapshot(connection, table);
        return JsonSerializer.Serialize(snapshots);
    }

    private static async Task<string> Snapshot(SqliteConnection connection, string table)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT * FROM \"{table}\" ORDER BY rowid";
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<object?[]>();
        while (await reader.ReadAsync())
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            rows.Add(row);
        }
        Assert.NotEmpty(rows);
        return JsonSerializer.Serialize(rows);
    }
}
