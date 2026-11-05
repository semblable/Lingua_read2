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

public class TokenizerV5MigrationAcceptanceTests
{
    [Fact]
    public async Task VersionFourDatabase_PromotesGreekAndArabicHeadwords_SkipsBareNumericClutter_AndPreservesLearnerData()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(builder => builder.UseSqlite(connection));
        await using var provider = services.BuildServiceProvider();
        var userId = Guid.Parse("deadbeef-0000-0000-0000-000000000005");

        await using (var scope = provider.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await context.Database.EnsureCreatedAsync();
            await SeedV4Database(context, userId);
        }

        var protectedBefore = await ProtectedSnapshot(connection);
        var service = new WordLinkingMigrationService(
            provider,
            NullLogger<WordLinkingMigrationService>.Instance,
            new MigrationSignal());
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await service.RunMigration(timeout.Token);
        Assert.False(timeout.IsCancellationRequested);

        await using (var scope = provider.CreateAsyncScope())
        {
            var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var texts = await context.Texts.AsNoTracking().OrderBy(t => t.TextId).ToListAsync();
            Assert.All(texts, text =>
            {
                Assert.Equal(5, text.WordLinkingTokenizerVersion);
                Assert.Equal(WordLinker.CurrentTokenizerVersion, text.WordLinkingTokenizerVersion);
            });

            var greekWord = await context.Words
                .AsNoTracking()
                .Include(w => w.Translation)
                .SingleAsync(w => w.WordId == 101);
            Assert.Equal("λόγος", greekWord.Term);
            Assert.Equal(4, greekWord.Status);
            Assert.Equal("reason / word", greekWord.Translation?.Translation);

            var arabicWord = await context.Words
                .AsNoTracking()
                .Include(w => w.Translation)
                .SingleAsync(w => w.WordId == 102);
            Assert.Equal("إلى", arabicWord.Term);
            Assert.Equal(3, arabicWord.Status);
            Assert.Equal("to / toward", arabicWord.Translation?.Translation);

            // Both relinked texts link to the surviving promoted WordIds.
            var greekLink = await context.TextWords.AsNoTracking()
                .SingleAsync(tw => tw.TextId == 1 && tw.WordId == 101);
            Assert.Equal(1, greekLink.OccurrenceCount);

            var arabicLink = await context.TextWords.AsNoTracking()
                .SingleAsync(tw => tw.TextId == 2 && tw.WordId == 102);
            Assert.Equal(1, arabicLink.OccurrenceCount);

            // Bare numbers (2026) and space-grouped numbers (2 000) do not create Status = 0 clutter rows.
            Assert.False(await context.Words.AnyAsync(w => w.Term == "2026" || w.Term == "2 000"));

            // Explicitly saved numeric vocabulary is preserved and linked when present.
            var savedNumber = await context.Words.AsNoTracking().SingleAsync(w => w.WordId == 103);
            Assert.Equal("1984", savedNumber.Term);
            Assert.Equal(5, savedNumber.Status);
            Assert.True(await context.TextWords.AnyAsync(tw => tw.TextId == 1 && tw.WordId == 103));
        }

        Assert.Equal(protectedBefore, await ProtectedSnapshot(connection));

        // Second startup pass is a no-op.
        var snapshotAfterFirstPass = await TableSnapshot(connection, "Texts")
            + await TableSnapshot(connection, "Words")
            + await TableSnapshot(connection, "TextWords");
        await service.RunMigration(timeout.Token);
        var snapshotAfterSecondPass = await TableSnapshot(connection, "Texts")
            + await TableSnapshot(connection, "Words")
            + await TableSnapshot(connection, "TextWords");
        Assert.Equal(snapshotAfterFirstPass, snapshotAfterSecondPass);
        Assert.Equal(protectedBefore, await ProtectedSnapshot(connection));
    }

    private static async Task SeedV4Database(AppDbContext context, Guid userId)
    {
        var historical = new DateTime(2026, 1, 15, 12, 0, 0, DateTimeKind.Utc);
        context.Users.Add(new User { Id = userId, UserName = "v5 synthetic learner" });
        context.Languages.AddRange(
            new Language
            {
                LanguageId = 1,
                Code = "el",
                Name = "Greek",
                WordCharacters = Language.DefaultWordCharacters,
                ParserType = "spacedel",
                WordsRead = 250
            },
            new Language
            {
                LanguageId = 2,
                Code = "ar",
                Name = "Arabic",
                WordCharacters = Language.DefaultWordCharacters,
                ParserType = "spacedel",
                WordsRead = 180
            });

        context.Texts.AddRange(
            new Text
            {
                TextId = 1,
                UserId = userId,
                LanguageId = 1,
                Title = "Greek v4 lesson",
                Content = "Ο Σωκράτης είπε ότι ο λόγος το 2026 και το 1984 είναι σημαντικός.",
                WordLinkingTokenizerVersion = 4,
                IsFinished = true,
                LastCompletedAt = historical
            },
            new Text
            {
                TextId = 2,
                UserId = userId,
                LanguageId = 2,
                Title = "Arabic v4 lesson",
                Content = "هَلْ ذَهَبْتَ إِلَى الْمَكْتَبَةِ فِي عَامِ 2026؟",
                WordLinkingTokenizerVersion = 4,
                IsFinished = true,
                LastCompletedAt = historical
            });

        // v4 stored Greek headword without accents and with medial sigma at end ("λογοσ"),
        // and Arabic headword with hamza stripped ("الى").
        context.Words.AddRange(
            new Word
            {
                WordId = 101,
                UserId = userId,
                LanguageId = 1,
                Term = "λογοσ",
                Status = 4,
                CreatedAt = historical
            },
            new Word
            {
                WordId = 102,
                UserId = userId,
                LanguageId = 2,
                Term = "الى",
                Status = 3,
                CreatedAt = historical
            },
            new Word
            {
                WordId = 103,
                UserId = userId,
                LanguageId = 1,
                Term = "1984",
                Status = 5,
                CreatedAt = historical
            });

        context.WordTranslations.AddRange(
            new WordTranslation
            {
                WordId = 101,
                Translation = "reason / word",
                CreatedAt = historical
            },
            new WordTranslation
            {
                WordId = 102,
                Translation = "to / toward",
                CreatedAt = historical
            });

        context.TextWords.AddRange(
            new TextWord { TextId = 1, WordId = 101, OccurrenceCount = 1, CreatedAt = historical },
            new TextWord { TextId = 2, WordId = 102, OccurrenceCount = 1, CreatedAt = historical });

        context.SrsPhrases.Add(new SrsPhrase
        {
            SrsPhraseId = 201,
            WordId = 101,
            UserId = userId,
            Sentence = "Ο Σωκράτης είπε ότι ο λόγος το 2026 και το 1984 είναι σημαντικός.",
            TextId = 1,
            TextTitle = "Greek v4 lesson",
            CreatedAt = historical
        });

        context.SrsCardReviews.Add(new SrsCardReview
        {
            SrsCardReviewId = 301,
            WordId = 101,
            UserId = userId,
            Stability = 14.0,
            Difficulty = 3.8,
            Interval = 15,
            Repetitions = 5,
            Lapses = 1,
            Flag = 2,
            Tags = "greek-philosophy",
            CreatedAt = historical,
            LastReviewedAt = historical,
            NextReviewAt = historical.AddDays(15)
        });

        context.SrsReviewLogs.Add(new SrsReviewLog
        {
            SrsReviewLogId = 401,
            UserId = userId,
            SrsCardReviewId = 301,
            Grade = 3,
            ReviewedAt = historical,
            OldInterval = 7,
            OldStability = 9.2,
            OldDifficulty = 4.0,
            ClientEventId = "v4-greek-review"
        });

        context.UserActivities.Add(new UserActivity
        {
            ActivityId = 501,
            UserId = userId,
            LanguageId = 1,
            ActivityType = "TextCompleted",
            WordCount = 250,
            Timestamp = historical
        });

        await context.SaveChangesAsync();
    }

    private static async Task<string> ProtectedSnapshot(SqliteConnection connection) => string.Join("\n",
        await QuerySnapshot(connection, "SELECT WordId, UserId, LanguageId, Status, CreatedAt FROM Words WHERE Status > 0 ORDER BY WordId"),
        await TableSnapshot(connection, "WordTranslations"),
        await TableSnapshot(connection, "SrsPhrases"),
        await TableSnapshot(connection, "SrsCardReviews"),
        await TableSnapshot(connection, "SrsReviewLogs"),
        await TableSnapshot(connection, "UserActivities"),
        await TableSnapshot(connection, "Languages"),
        await QuerySnapshot(connection, "SELECT TextId, IsFinished, LastCompletedAt FROM Texts ORDER BY TextId"));

    private static Task<string> TableSnapshot(SqliteConnection connection, string table) =>
        QuerySnapshot(connection, $"SELECT * FROM \"{table}\" ORDER BY 1, 2");

    private static async Task<string> QuerySnapshot(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<object?[]>();
        while (await reader.ReadAsync())
        {
            var values = new object?[reader.FieldCount];
            reader.GetValues(values);
            rows.Add(values);
        }
        return JsonSerializer.Serialize(rows);
    }
}
