using System.Text.Json;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>Real relational linking with original Korean text and synthetic learner history.</summary>
public class KoreanWordLinkerTests
{
    [Theory]
    [InlineData("한글", "한글 한글 한글.")]
    [InlineData("한글", "한글 한글 한글.")]
    public async Task UniqueCanonicalAlias_ReusesWordIdAndAggregatesOccurrences_WithoutRewritingHistory(string savedTerm, string content)
    {
        await using var learner = await Learner.Create(content,
            (41, savedTerm, 4, "saved word meaning"),
            (42, "한글 테스트", 3, "saved phrase meaning"));
        var before = await learner.Snapshot();

        await WordLinker.LinkAsync(learner.Context, 1, content, 1, learner.UserId);
        await WordLinker.LinkAsync(learner.Context, 1, content, 1, learner.UserId);
        await WordLinker.RelinkAsync(learner.Context, 1, content, 1, learner.UserId);

        Assert.Equal(2, await learner.Context.Words.CountAsync());
        var link = await learner.Context.TextWords.SingleAsync();
        Assert.Equal(41, link.WordId);
        Assert.Equal(3, link.OccurrenceCount);
        Assert.Equal(0, await WordLinker.RekeyLegacyTermsAsync(learner.Context));
        Assert.Equal(0, await WordLinker.CleanupOrphanWordsAsync(learner.Context));
        Assert.Equal(before, await learner.Snapshot());
        var phrase = await learner.Context.Words.SingleAsync(word => word.WordId == 42);
        Assert.Equal("한글 테스트", phrase.Term);
        Assert.Single(KoreanLookup.FindMatches("한글 테스트.", phrase.Term));
    }

    [Fact]
    public async Task ConflictingExactRows_KeepTheirOwnMeaningStatusAndCards_AndThirdAliasDoesNotChooseEither()
    {
        const string content = "각 각 각.";
        await using var learner = await Learner.Create(content,
            (41, "각", 5, "first meaning"), (42, "각", 2, "second meaning"));
        var before = await learner.Snapshot();

        await WordLinker.LinkAsync(learner.Context, 1, content, 1, learner.UserId);
        await WordLinker.RelinkAsync(learner.Context, 1, content, 1, learner.UserId);

        var links = await learner.Context.TextWords.OrderBy(link => link.WordId).ToArrayAsync();
        Assert.Equal(3, links.Length);
        Assert.All(links, link => Assert.Equal(1, link.OccurrenceCount));
        Assert.Contains(links, link => link.WordId == 41);
        Assert.Contains(links, link => link.WordId == 42);
        var unresolvedSurface = await learner.Context.Words.SingleAsync(word => word.Term == "각");
        Assert.NotEqual(41, unresolvedSurface.WordId);
        Assert.NotEqual(42, unresolvedSurface.WordId);
        Assert.Equal(0, unresolvedSurface.Status);
        Assert.Equal(3, await learner.Context.Words.CountAsync());
        Assert.Equal(0, await WordLinker.RekeyLegacyTermsAsync(learner.Context));
        Assert.Equal(before, await learner.Snapshot());
    }

    [Fact]
    public async Task NewEquivalentSurfacesInOneUpload_CreateOneWordAndCountEveryOccurrence()
    {
        const string content = "한글 한글 한글.";
        await using var learner = await Learner.Create(content);
        var before = await learner.Snapshot();

        await WordLinker.LinkAsync(learner.Context, 1, content, 1, learner.UserId);
        await WordLinker.RelinkAsync(learner.Context, 1, content, 1, learner.UserId);

        var word = await learner.Context.Words.SingleAsync();
        Assert.Equal("한글", word.Term);
        Assert.Equal(0, word.Status);
        var link = await learner.Context.TextWords.SingleAsync();
        Assert.Equal(word.WordId, link.WordId);
        Assert.Equal(3, link.OccurrenceCount);
        Assert.Equal(before, await learner.Snapshot());
    }

    [Fact]
    public async Task CompatibilityJamo_RemainSeparateFromCanonicalSyllables()
    {
        const string content = "가 가 ㄱㅏ.";
        await using var learner = await Learner.Create(content,
            (41, "가", 4, "syllable meaning"), (42, "ㄱㅏ", 2, "compatibility spelling"));
        var before = await learner.Snapshot();
        await WordLinker.LinkAsync(learner.Context, 1, content, 1, learner.UserId);

        Assert.Equal(2, await learner.Context.Words.CountAsync());
        var counts = await learner.Context.TextWords.ToDictionaryAsync(link => link.WordId, link => link.OccurrenceCount);
        Assert.Equal(2, counts[41]);
        Assert.Equal(1, counts[42]);
        Assert.Equal(before, await learner.Snapshot());
    }

    [Fact]
    public async Task AmbiguousNormalizedExactKey_FailsClearlyBeforeAnyInsertOrLink_AndPreservesBothRows()
    {
        const string content = "새말 한글AbC.";
        await using var learner = await Learner.Create(content,
            (41, "한글ABC", 5, "first meaning"), (42, "한글abc", 2, "second meaning"));
        var before = await learner.Snapshot();
        var language = await learner.Context.Languages.SingleAsync();
        var index = KoreanLookup.CreateIndex(await learner.Context.Words.AsNoTracking().ToArrayAsync(),
            word => Tokenizer.NormalizeKey(word.Term, language));
        Assert.True(index.ContainsExact("한글abc"));
        Assert.Null(index.Resolve("한글abc"));
        Assert.False(index.ContainsExact("새말"));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            WordLinker.LinkAsync(learner.Context, 1, content, 1, learner.UserId));

        Assert.Contains("ambiguous", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Korean", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(2, await learner.Context.Words.CountAsync());
        Assert.Empty(await learner.Context.TextWords.ToArrayAsync());
        Assert.Equal(before, await learner.Snapshot());

        var oldLink = new TextWord { TextWordId = 501, TextId = 1, WordId = 41, OccurrenceCount = 7,
            CreatedAt = new DateTime(2025, 6, 1, 12, 0, 0, DateTimeKind.Utc) };
        learner.Context.TextWords.Add(oldLink);
        await learner.Context.SaveChangesAsync();
        learner.Context.ChangeTracker.Clear();

        var relinkError = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            WordLinker.RelinkAsync(learner.Context, 1, content, 1, learner.UserId));

        Assert.Contains("ambiguous", relinkError.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Korean", relinkError.Message, StringComparison.OrdinalIgnoreCase);
        learner.Context.ChangeTracker.Clear();
        var retainedLink = await learner.Context.TextWords.SingleAsync();
        Assert.Equal((501, 1, 41, 7, oldLink.CreatedAt),
            (retainedLink.TextWordId, retainedLink.TextId, retainedLink.WordId, retainedLink.OccurrenceCount, retainedLink.CreatedAt));
        Assert.Equal(2, await learner.Context.Words.CountAsync());
        Assert.Equal(before, await learner.Snapshot());
    }

    private sealed class Learner(SqliteConnection connection, AppDbContext context, Guid userId, int[] protectedWordIds) : IAsyncDisposable
    {
        public AppDbContext Context => context;
        public Guid UserId => userId;
        private static readonly DateTime HistoricalDate = new(2025, 6, 1, 12, 0, 0, DateTimeKind.Utc);

        public static async Task<Learner> Create(string content, params (int Id, string Term, int Status, string Meaning)[] saved)
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
            await context.Database.EnsureCreatedAsync();
            var userId = Guid.NewGuid();
            context.Users.Add(new User { Id = userId, UserName = "synthetic-korean" });
            context.Languages.Add(new Language { LanguageId = 1, Code = "ko-KR", Name = "Korean", ParserType = "spacedel", CharacterSubstitutions = "" });
            context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Korean fixture", Content = content });
            foreach (var row in saved)
            {
                context.Words.Add(new Word { WordId = row.Id, UserId = userId, LanguageId = 1,
                    Term = row.Term, Status = row.Status, CreatedAt = HistoricalDate });
                context.WordTranslations.Add(new WordTranslation { WordId = row.Id, Translation = row.Meaning, CreatedAt = HistoricalDate });
                context.SrsPhrases.Add(new SrsPhrase { SrsPhraseId = row.Id + 100, WordId = row.Id, UserId = userId,
                    Sentence = content, TextId = 1, TextTitle = "Korean fixture", CreatedAt = HistoricalDate });
                context.SrsCardReviews.Add(new SrsCardReview { SrsCardReviewId = row.Id + 200, WordId = row.Id, UserId = userId,
                    Stability = 12.5, Difficulty = 4.2, Interval = 12, Repetitions = 7, NextReviewAt = HistoricalDate.AddYears(2), CreatedAt = HistoricalDate });
                context.SrsReviewLogs.Add(new SrsReviewLog { SrsReviewLogId = row.Id + 300, UserId = userId,
                    SrsCardReviewId = row.Id + 200, Grade = 2, ReviewedAt = HistoricalDate, OldInterval = 9 });
            }
            context.UserActivities.Add(new UserActivity { ActivityId = 51, UserId = userId, LanguageId = 1,
                ActivityType = "TextCompleted", WordCount = 100, Timestamp = HistoricalDate });
            context.UserLanguageStatistics.Add(new UserLanguageStatistics { UserId = userId, LanguageId = 1, TotalWordsRead = 100 });
            context.UserGoals.Add(new UserGoal { GoalId = 61, UserId = userId, LanguageId = 1,
                GoalType = GoalType.WordsRead, BaselineValue = 100, TargetValue = 10, CreatedAt = HistoricalDate });
            context.UserSentenceProgresses.Add(new UserSentenceProgress { UserId = userId, TextId = 1,
                CreditedSegmentIndicesJson = "[0]", CreditedWordCount = 17, LastSegmentIndex = 0, UpdatedAt = HistoricalDate });
            context.TextBookmarks.Add(new TextBookmark { UserId = userId, TextId = 1, SentenceIndex = 0,
                IsActive = true, BookmarkedAt = HistoricalDate, UpdatedAt = HistoricalDate });
            await context.SaveChangesAsync();
            context.ChangeTracker.Clear();
            return new Learner(connection, context, userId, saved.Select(row => row.Id).ToArray());
        }

        public async Task<string> Snapshot()
        {
            context.ChangeTracker.Clear();
            return JsonSerializer.Serialize(new
            {
                words = await context.Words.AsNoTracking().Where(word => protectedWordIds.Contains(word.WordId)).OrderBy(word => word.WordId)
                    .Select(word => new { word.WordId, word.Term, word.Status, word.CreatedAt }).ToArrayAsync(),
                translations = await context.WordTranslations.AsNoTracking().OrderBy(row => row.WordId)
                    .Select(row => new { row.WordId, row.Translation, row.CreatedAt, row.UpdatedAt }).ToArrayAsync(),
                phrases = await context.SrsPhrases.AsNoTracking().OrderBy(row => row.SrsPhraseId)
                    .Select(row => new { row.SrsPhraseId, row.WordId, row.Sentence, row.TextId, row.TextTitle, row.CreatedAt }).ToArrayAsync(),
                cards = await context.SrsCardReviews.AsNoTracking().OrderBy(row => row.SrsCardReviewId)
                    .Select(row => new { row.SrsCardReviewId, row.WordId, row.Interval, row.Repetitions, row.Stability, row.Difficulty, row.NextReviewAt, row.CreatedAt }).ToArrayAsync(),
                reviews = await context.SrsReviewLogs.AsNoTracking().OrderBy(row => row.SrsReviewLogId)
                    .Select(row => new { row.SrsReviewLogId, row.SrsCardReviewId, row.Grade, row.ReviewedAt, row.OldInterval }).ToArrayAsync(),
                activity = await context.UserActivities.AsNoTracking().OrderBy(row => row.ActivityId)
                    .Select(row => new { row.ActivityId, row.ActivityType, row.WordCount, row.Timestamp, row.ClientEventId }).ToArrayAsync(),
                statistics = await context.UserLanguageStatistics.AsNoTracking().Select(row => new { row.LanguageId, row.TotalWordsRead }).ToArrayAsync(),
                goals = await context.UserGoals.AsNoTracking().Select(row => new { row.GoalId, row.BaselineValue, row.TargetValue, row.CompletedAt }).ToArrayAsync(),
                progress = await context.UserSentenceProgresses.AsNoTracking()
                    .Select(row => new { row.TextId, row.CreditedSegmentIndicesJson, row.CreditedWordCount, row.LastSegmentIndex, row.UpdatedAt }).ToArrayAsync(),
                bookmarks = await context.TextBookmarks.AsNoTracking()
                    .Select(row => new { row.TextId, row.SentenceIndex, row.IsActive, row.BookmarkedAt, row.UpdatedAt }).ToArrayAsync()
            });
        }

        public async ValueTask DisposeAsync()
        {
            await context.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}
