using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Srs;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Covers new-card prioritization (frequency + recency), SrsMaxNewCards = 0,
/// Anki's "New cards ignore review limit" guardrail, and quota-aware stats breakdown.
/// </summary>
public class SrsQueuePolicyTests
{
    private static readonly DateTime Now = new(2026, 11, 22, 12, 0, 0, DateTimeKind.Utc);

    // ---- Pure policy unit tests ----

    [Theory]
    [InlineData(null, 20)]
    [InlineData(-5, 20)]
    [InlineData(0, 0)]
    [InlineData(5, 5)]
    public void EffectiveMaxNew_AllowsZero_AndFallsBackOnlyForMissingOrNegative(int? stored, int expected)
    {
        Assert.Equal(expected, SrsQueuePolicy.EffectiveMaxNew(stored));
    }

    [Fact]
    public void RemainingNew_RespectsDailyReviewLimitByDefault_AndIsInvariantWhileStudying()
    {
        // 192 due reviews out of 200 cap -> only 8 slots left for new cards (not 20).
        Assert.Equal(8, SrsQueuePolicy.RemainingNew(
            maxNew: 20, maxReviews: 200, studiedNew: 0, studiedReviews: 0, dueReviewCount: 192, ignoreReviewLimit: false));

        // After studying 50 reviews (142 due left), still 8 new cards allowed today.
        Assert.Equal(8, SrsQueuePolicy.RemainingNew(
            maxNew: 20, maxReviews: 200, studiedNew: 0, studiedReviews: 50, dueReviewCount: 142, ignoreReviewLimit: false));

        // After also studying 3 new cards, 5 new cards remain (total 8 new today).
        Assert.Equal(5, SrsQueuePolicy.RemainingNew(
            maxNew: 20, maxReviews: 200, studiedNew: 3, studiedReviews: 50, dueReviewCount: 142, ignoreReviewLimit: false));

        // Backlog of 250 due reviews fills the 200 cap -> 0 new cards unless ignored.
        Assert.Equal(0, SrsQueuePolicy.RemainingNew(
            maxNew: 20, maxReviews: 200, studiedNew: 0, studiedReviews: 0, dueReviewCount: 250, ignoreReviewLimit: false));
        Assert.Equal(20, SrsQueuePolicy.RemainingNew(
            maxNew: 20, maxReviews: 200, studiedNew: 0, studiedReviews: 0, dueReviewCount: 250, ignoreReviewLimit: true));
    }

    [Fact]
    public void IsNewPausedByReviewLimit_TrueOnlyWhenReviewLimitReducesAvailableNewToZero()
    {
        // Paused by review limit
        Assert.True(SrsQueuePolicy.IsNewPausedByReviewLimit(
            maxNew: 20, maxReviews: 200, studiedNew: 0, studiedReviews: 0, dueReviewCount: 250, dueNewCount: 100, ignoreReviewLimit: false));

        // Partially reduced (8 still available) -> NOT paused
        Assert.False(SrsQueuePolicy.IsNewPausedByReviewLimit(
            maxNew: 20, maxReviews: 200, studiedNew: 0, studiedReviews: 0, dueReviewCount: 192, dueNewCount: 100, ignoreReviewLimit: false));

        // User set maxNew = 0 -> paused by user setting, not review limit
        Assert.False(SrsQueuePolicy.IsNewPausedByReviewLimit(
            maxNew: 0, maxReviews: 200, studiedNew: 0, studiedReviews: 0, dueReviewCount: 250, dueNewCount: 100, ignoreReviewLimit: false));

        // Ignore flag enabled -> NOT paused
        Assert.False(SrsQueuePolicy.IsNewPausedByReviewLimit(
            maxNew: 20, maxReviews: 200, studiedNew: 0, studiedReviews: 0, dueReviewCount: 250, dueNewCount: 100, ignoreReviewLimit: true));

        // No untouched new cards -> NOT paused
        Assert.False(SrsQueuePolicy.IsNewPausedByReviewLimit(
            maxNew: 20, maxReviews: 200, studiedNew: 0, studiedReviews: 0, dueReviewCount: 250, dueNewCount: 0, ignoreReviewLimit: false));
    }

    [Fact]
    public void OrderNewCardIds_SupportsAllFourModes_AndUsesLastTextAccessedAtForRecency()
    {
        var candidates = new[]
        {
            // 1: Old card (90d ago), high frequency (50), never opened recently (stale book)
            new SrsQueuePolicy.NewCardCandidate(1, 1, Now.AddDays(-90), null, Occurrences: 50, LastTextAccessedAt: Now.AddDays(-60)),
            // 2: Saved 80d ago, medium frequency (12), BUT appeared in a chapter read yesterday!
            new SrsQueuePolicy.NewCardCandidate(2, 2, Now.AddDays(-80), null, Occurrences: 12, LastTextAccessedAt: Now.AddDays(-1)),
            // 3: Saved 2d ago, low frequency (2), read 2d ago
            new SrsQueuePolicy.NewCardCandidate(3, 3, Now.AddDays(-2), null, Occurrences: 2, LastTextAccessedAt: Now.AddDays(-2)),
            // 4: Saved 70d ago, unread book import (LastTextAccessedAt = null), frequency 30
            new SrsQueuePolicy.NewCardCandidate(4, 4, Now.AddDays(-70), null, Occurrences: 30, LastTextAccessedAt: null),
            // 5: Saved yesterday, frequency 2 (ties with 3 on frequency, more recent than 3)
            new SrsQueuePolicy.NewCardCandidate(5, 5, Now.AddDays(-1), null, Occurrences: 2, LastTextAccessedAt: Now.AddHours(-6)),
        };

        // recent_frequent: recent bucket {2 (12), 5 (2, -6h), 3 (2, -2d)} before stale {1 (50), 4 (30)}
        Assert.Equal(new[] { 2, 5, 3, 1, 4 },
            SrsQueuePolicy.OrderNewCardIds(candidates, SrsQueuePolicy.NewCardOrder.RecentFrequent, Now, 10));

        // frequent: pure frequency desc (50, 30, 12, 2@-6h, 2@-2d)
        Assert.Equal(new[] { 1, 4, 2, 5, 3 },
            SrsQueuePolicy.OrderNewCardIds(candidates, SrsQueuePolicy.NewCardOrder.Frequent, Now, 10));

        // newest: LastSeenAt desc (5@-6h, 2@-1d, 3@-2d, 1@-60d, 4@-70d)
        Assert.Equal(new[] { 5, 2, 3, 1, 4 },
            SrsQueuePolicy.OrderNewCardIds(candidates, SrsQueuePolicy.NewCardOrder.Newest, Now, 10));

        // oldest: CreatedAt asc (1@-90d, 2@-80d, 4@-70d, 3@-2d, 5@-1d)
        Assert.Equal(new[] { 1, 2, 4, 3, 5 },
            SrsQueuePolicy.OrderNewCardIds(candidates, SrsQueuePolicy.NewCardOrder.Oldest, Now, 10));
    }

    [Fact]
    public void OrderNewCardIds_FloorsZeroOccurrenceRecentSaves_AndUsesLastManualStatusAt()
    {
        var candidates = new[]
        {
            // 1: Saved today without any TextWord (e.g. saved phrase or Story Mode save)
            new SrsQueuePolicy.NewCardCandidate(1, 1, Now.AddHours(-1), null, Occurrences: 0, LastTextAccessedAt: null),
            // 2: Saved 10d ago, 1 occurrence in a text read 10d ago
            new SrsQueuePolicy.NewCardCandidate(2, 2, Now.AddDays(-10), null, Occurrences: 1, LastTextAccessedAt: Now.AddDays(-10)),
            // 3: Saved 5d ago, 3 occurrences in a text read 5d ago
            new SrsQueuePolicy.NewCardCandidate(3, 3, Now.AddDays(-5), null, Occurrences: 3, LastTextAccessedAt: Now.AddDays(-5)),
            // 4: Created 60d ago, but user explicitly re-saved its status 30m ago (Unspecified kind to check normalization)
            new SrsQueuePolicy.NewCardCandidate(4, 4, Now.AddDays(-60), DateTime.SpecifyKind(Now.AddMinutes(-30), DateTimeKind.Unspecified), Occurrences: 2, LastTextAccessedAt: Now.AddDays(-60)),
        };

        // RecentFrequent: all 4 are in the 30d recent window; freq desc with 0 floored to 1 -> 3 (3), 4 (2), 1 (1@-1h), 2 (1@-10d)
        Assert.Equal(new[] { 3, 4, 1, 2 },
            SrsQueuePolicy.OrderNewCardIds(candidates, SrsQueuePolicy.NewCardOrder.RecentFrequent, Now, 10));

        // Frequent: raw occurrences desc -> 3 (3), 4 (2), 2 (1), 1 (0)
        Assert.Equal(new[] { 3, 4, 2, 1 },
            SrsQueuePolicy.OrderNewCardIds(candidates, SrsQueuePolicy.NewCardOrder.Frequent, Now, 10));

        // Newest: LastSeenAt desc -> 4 (-30m via LastManualStatusAt), 1 (-1h), 3 (-5d), 2 (-10d)
        Assert.Equal(new[] { 4, 1, 3, 2 },
            SrsQueuePolicy.OrderNewCardIds(candidates, SrsQueuePolicy.NewCardOrder.Newest, Now, 10));
    }

    // ---- Controller integration tests (InMemory + SQLite) ----

    private static async Task<(AppDbContext Context, SqliteConnection? Connection)> CreateContextAsync(bool useSqlite)
    {
        if (!useSqlite)
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            return (new AppDbContext(options), null);
        }

        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var sqliteOptions = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new AppDbContext(sqliteOptions);
        await context.Database.EnsureCreatedAsync();
        return (context, connection);
    }

    private static SrsController CreateController(
        AppDbContext context,
        Guid userId,
        IStoryGenerationServiceFactory? storyFactory = null) =>
        new(context, storyFactory ?? Mock.Of<IStoryGenerationServiceFactory>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
                }
            }
        };

    private static T Unwrap<T>(ActionResult<T> result) where T : class =>
        result.Value ?? Assert.IsType<T>(Assert.IsAssignableFrom<ObjectResult>(result.Result).Value);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task GetDueCards_OrdersNewCardsByOccurrenceCountAndRecentReading_AndIgnoresSrsStories(bool useSqlite)
    {
        var (context, connection) = await CreateContextAsync(useSqlite);
        await using var _conn = connection;
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 10,
            SrsMaxReviews = 200,
            SrsNewCardOrder = SrsQueuePolicy.NewCardOrder.RecentFrequent,
        });

        // Texts: one recently opened chapter, one old finished text, one unread import, one AI srs-story.
        var recentText = new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Current Ch 1", Content = "x", LastAccessedAt = now.AddDays(-1) };
        var oldText = new Text { TextId = 2, UserId = userId, LanguageId = 1, Title = "Old Book", Content = "x", LastAccessedAt = now.AddDays(-90) };
        var unreadText = new Text { TextId = 3, UserId = userId, LanguageId = 1, Title = "Unread Import", Content = "x", LastAccessedAt = null };
        var storyText = new Text { TextId = 4, UserId = userId, LanguageId = 1, Title = "SRS Micro-Contexts", Content = "x", Tag = "srs-story", LastAccessedAt = now.AddMinutes(-5) };
        context.Texts.AddRange(recentText, oldText, unreadText, storyText);

        var words = new[]
        {
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "stale_common", Status = 1, CreatedAt = now.AddDays(-100) },
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "recent_many_in_one", Status = 1, CreatedAt = now.AddDays(-80) },
            new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "recent_rare", Status = 1, CreatedAt = now.AddDays(-2) },
            new Word { WordId = 4, UserId = userId, LanguageId = 1, Term = "story_only_boost", Status = 1, CreatedAt = now.AddDays(-70) },
        };
        context.Words.AddRange(words);

        // Card creation dates intentionally favor stale words under old FIFO ordering.
        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 1, WordId = 1, UserId = userId, CreatedAt = now.AddDays(-100), NextReviewAt = now.AddDays(-100) },
            new SrsCardReview { SrsCardReviewId = 2, WordId = 2, UserId = userId, CreatedAt = now.AddDays(-80), NextReviewAt = now.AddDays(-80) },
            new SrsCardReview { SrsCardReviewId = 3, WordId = 3, UserId = userId, CreatedAt = now.AddDays(-2), NextReviewAt = now.AddDays(-2) },
            new SrsCardReview { SrsCardReviewId = 4, WordId = 4, UserId = userId, CreatedAt = now.AddDays(-70), NextReviewAt = now.AddDays(-70) }
        );

        // stale_common: 50 occurrences in oldText (stale)
        // recent_many_in_one: 12 occurrences in recentText (only 1 TextWord row, but OccurrenceCount=12!)
        // recent_rare: 1 occurrence in recentText + 1 in unreadText = 2 occurrences total
        // story_only_boost: 99 occurrences in srs-story (must be ignored!) + 1 in oldText
        context.TextWords.AddRange(
            new TextWord { TextId = 2, WordId = 1, OccurrenceCount = 50 },
            new TextWord { TextId = 1, WordId = 2, OccurrenceCount = 12 },
            new TextWord { TextId = 1, WordId = 3, OccurrenceCount = 1 },
            new TextWord { TextId = 3, WordId = 3, OccurrenceCount = 1 },
            new TextWord { TextId = 4, WordId = 4, OccurrenceCount = 99 },
            new TextWord { TextId = 2, WordId = 4, OccurrenceCount = 1 }
        );
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        // 1. recent_frequent (default): recent reading first by OccurrenceCount desc, then stale by OccurrenceCount desc
        var recentFrequent = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(new[] { "recent_many_in_one", "recent_rare", "stale_common", "story_only_boost" },
            recentFrequent.Select(c => c.Term).ToArray());

        // 2. frequent: pure OccurrenceCount desc across non-srs-story texts
        var settings = await context.UserSettings.SingleAsync();
        settings.SrsNewCardOrder = SrsQueuePolicy.NewCardOrder.Frequent;
        await context.SaveChangesAsync();
        var frequent = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(new[] { "stale_common", "recent_many_in_one", "recent_rare", "story_only_boost" },
            frequent.Select(c => c.Term).ToArray());

        // 3. newest: LastSeenAt desc (recent_many_in_one & recent_rare both accessed -1d via recentText;
        //    recent_many_in_one breaks the tie with higher occurrences; then story_only_boost@-70d, stale_common@-90d)
        settings.SrsNewCardOrder = SrsQueuePolicy.NewCardOrder.Newest;
        await context.SaveChangesAsync();
        var newest = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(new[] { "recent_many_in_one", "recent_rare", "story_only_boost", "stale_common" },
            newest.Select(c => c.Term).ToArray());

        // 4. oldest: classic CreatedAt ASC
        settings.SrsNewCardOrder = SrsQueuePolicy.NewCardOrder.Oldest;
        await context.SaveChangesAsync();
        var oldest = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(new[] { "stale_common", "recent_many_in_one", "story_only_boost", "recent_rare" },
            oldest.Select(c => c.Term).ToArray());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SelectNewCards_HandlesZeroTextWords_UnreadNews_MultipleTexts_AndManualStatusVsGlossEdit(bool useSqlite)
    {
        var (context, connection) = await CreateContextAsync(useSqlite);
        await using var _conn = connection;
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 10,
            SrsMaxReviews = 200,
            SrsNewCardOrder = SrsQueuePolicy.NewCardOrder.RecentFrequent,
        });
        context.NewsFeeds.Add(new NewsFeed { NewsFeedId = 1, UserId = userId, LanguageId = 1, Title = "Feed", Url = "https://example.test/rss" });

        // Texts: recent book, old book, unread non-news book, unread auto-imported RSS news, read RSS news.
        context.Texts.AddRange(
            new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Recent Ch", Content = "x", LastAccessedAt = now.AddDays(-2) },
            new Text { TextId = 2, UserId = userId, LanguageId = 1, Title = "Old Book", Content = "x", LastAccessedAt = now.AddDays(-90) },
            new Text { TextId = 3, UserId = userId, LanguageId = 1, Title = "Unread Book", Content = "x", LastAccessedAt = null },
            new Text { TextId = 4, UserId = userId, LanguageId = 1, Title = "Unread RSS", Content = "x", NewsFeedId = 1, LastAccessedAt = null },
            new Text { TextId = 5, UserId = userId, LanguageId = 1, Title = "Read RSS", Content = "x", NewsFeedId = 1, LastAccessedAt = now.AddDays(-1) }
        );

        context.Words.AddRange(
            // 1: Appears in Old Book (5) + Recent Ch (2) -> total 7 occurrences, MAX(LastAccessedAt) = -2d (recent!)
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "multi_text", Status = 1, CreatedAt = now.AddDays(-80) },
            // 2: Saved 1h ago with 0 TextWord rows (e.g. phrase/story save) -> recent, occurrences floored to 1
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "zero_tw_today", Status = 1, CreatedAt = now.AddHours(-1) },
            // 3: Saved 10d ago with 1 occurrence in Read RSS (-1d) -> recent, occurrences 1 (older than zero_tw_today)
            new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "read_rss_word", Status = 1, CreatedAt = now.AddDays(-10) },
            // 4: Stale word (80d) whose gloss was edited 1m ago (LastEditedAt only, NOT LastManualStatusAt) + 99x in Unread RSS -> stays stale with 0 counted occurrences
            new Word { WordId = 4, UserId = userId, LanguageId = 1, Term = "gloss_edited_rss", Status = 1, CreatedAt = now.AddDays(-80), LastEditedAt = now.AddMinutes(-1) },
            // 5: Stale word (80d) manually re-saved today (LastManualStatusAt = -10m), 2 occurrences in Old Book -> bumped into recent bucket!
            new Word { WordId = 5, UserId = userId, LanguageId = 1, Term = "manual_resave", Status = 1, CreatedAt = now.AddDays(-80), LastManualStatusAt = now.AddMinutes(-10) },
            // 6: Unread non-news book word created 70d ago (LastAccessedAt = null) -> NOT recent, but its 4 occurrences count in stale bucket
            new Word { WordId = 6, UserId = userId, LanguageId = 1, Term = "unread_book_word", Status = 1, CreatedAt = now.AddDays(-70) }
        );

        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 1, WordId = 1, UserId = userId, CreatedAt = now.AddDays(-80), NextReviewAt = now.AddDays(-80) },
            new SrsCardReview { SrsCardReviewId = 2, WordId = 2, UserId = userId, CreatedAt = now.AddHours(-1), NextReviewAt = now.AddHours(-1) },
            new SrsCardReview { SrsCardReviewId = 3, WordId = 3, UserId = userId, CreatedAt = now.AddDays(-10), NextReviewAt = now.AddDays(-10) },
            new SrsCardReview { SrsCardReviewId = 4, WordId = 4, UserId = userId, CreatedAt = now.AddDays(-80), NextReviewAt = now.AddDays(-80) },
            new SrsCardReview { SrsCardReviewId = 5, WordId = 5, UserId = userId, CreatedAt = now.AddDays(-80), NextReviewAt = now.AddDays(-80) },
            new SrsCardReview { SrsCardReviewId = 6, WordId = 6, UserId = userId, CreatedAt = now.AddDays(-70), NextReviewAt = now.AddDays(-70) }
        );

        context.TextWords.AddRange(
            new TextWord { TextId = 2, WordId = 1, OccurrenceCount = 5 },
            new TextWord { TextId = 1, WordId = 1, OccurrenceCount = 2 },
            new TextWord { TextId = 5, WordId = 3, OccurrenceCount = 1 },
            new TextWord { TextId = 4, WordId = 4, OccurrenceCount = 99 }, // unread RSS -> excluded!
            new TextWord { TextId = 2, WordId = 5, OccurrenceCount = 2 },
            new TextWord { TextId = 3, WordId = 6, OccurrenceCount = 4 }
        );
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var result = Unwrap(await controller.GetDueCards(languageId: 1));

        // Recent bucket: multi_text (7), manual_resave (2), zero_tw_today (floored 1, -1h), read_rss_word (1, -1d)
        // Stale bucket: unread_book_word (4), gloss_edited_rss (0 -> floored 1, unread RSS ignored & gloss edit ignored)
        Assert.Equal(
            new[] { "multi_text", "manual_resave", "zero_tw_today", "read_rss_word", "unread_book_word", "gloss_edited_rss" },
            result.Select(c => c.Term).ToArray());
    }

    [Fact]
    public async Task GetDueCards_OnlyOneTarget_PreFiltersPhraselessCardsSoHighFrequencyCardsDoNotStarve1TCards()
    {
        var (context, connection) = await CreateContextAsync(useSqlite: true);
        await using var _conn = connection;
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 2,
            SrsMaxReviews = 200,
            SrsNewCardOrder = SrsQueuePolicy.NewCardOrder.RecentFrequent,
        });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Ch 1", Content = "x", LastAccessedAt = now.AddHours(-1) });

        // Known helper words so the 1T sentences have exactly 1 unknown word (the target).
        context.Words.AddRange(
            new Word { WordId = 100, UserId = userId, LanguageId = 1, Term = "el", Status = 5 },
            new Word { WordId = 101, UserId = userId, LanguageId = 1, Term = "duerme", Status = 5 }
        );

        // 25 high-frequency recent New cards WITHOUT any SrsPhrase rows.
        for (int i = 1; i <= 25; i++)
        {
            context.Words.Add(new Word { WordId = i, UserId = userId, LanguageId = 1, Term = $"nophrase{i}", Status = 1, CreatedAt = now.AddHours(-1) });
            context.SrsCardReviews.Add(new SrsCardReview { SrsCardReviewId = i, WordId = i, UserId = userId, CreatedAt = now.AddHours(-1), NextReviewAt = now.AddHours(-1) });
            context.TextWords.Add(new TextWord { TextId = 1, WordId = i, OccurrenceCount = 100 + i });
        }

        // 2 lower-frequency New cards WITH valid 1T phrases.
        context.Words.AddRange(
            new Word { WordId = 30, UserId = userId, LanguageId = 1, Term = "gato", Status = 1, CreatedAt = now.AddDays(-5) },
            new Word { WordId = 31, UserId = userId, LanguageId = 1, Term = "perro", Status = 1, CreatedAt = now.AddDays(-5) }
        );
        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 30, WordId = 30, UserId = userId, CreatedAt = now.AddDays(-5), NextReviewAt = now.AddDays(-5) },
            new SrsCardReview { SrsCardReviewId = 31, WordId = 31, UserId = userId, CreatedAt = now.AddDays(-5), NextReviewAt = now.AddDays(-5) }
        );
        context.SrsPhrases.AddRange(
            new SrsPhrase { SrsPhraseId = 1, UserId = userId, WordId = 30, Sentence = "El gato duerme.", CreatedAt = now },
            new SrsPhrase { SrsPhraseId = 2, UserId = userId, WordId = 31, Sentence = "El perro duerme.", CreatedAt = now }
        );
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var due = Unwrap(await controller.GetDueCards(languageId: 1, onlyOneTarget: true, limit: 2));

        Assert.Equal(2, due.Count);
        Assert.Contains(due, c => c.Term == "gato");
        Assert.Contains(due, c => c.Term == "perro");
    }

    [Fact]
    public async Task GetDueCards_SessionFiltersPreserveDeckLevelReviewLimitGuardrail()
    {
        var (context, connection) = await CreateContextAsync(useSqlite: true);
        await using var _conn = connection;
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 5,
            SrsMaxReviews = 2,
            SrsNewCardsIgnoreReviewLimit = false,
        });

        // 2 overdue Status-3 review cards fill SrsMaxReviews=2; 2 untouched Status-1 new cards exist.
        context.Words.AddRange(
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "rev1", Status = 3 },
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "rev2", Status = 3 },
            new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "new1", Status = 1 },
            new Word { WordId = 4, UserId = userId, LanguageId = 1, Term = "new2", Status = 1 }
        );
        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 1, WordId = 1, UserId = userId, HasEverGraduated = true, Stability = 5, Difficulty = 5, Interval = 5, Repetitions = 2, LastReviewedAt = now.AddDays(-6), NextReviewAt = now.AddHours(-2) },
            new SrsCardReview { SrsCardReviewId = 2, WordId = 2, UserId = userId, HasEverGraduated = true, Stability = 5, Difficulty = 5, Interval = 5, Repetitions = 2, LastReviewedAt = now.AddDays(-6), NextReviewAt = now.AddHours(-1) },
            new SrsCardReview { SrsCardReviewId = 3, WordId = 3, UserId = userId, CreatedAt = now.AddHours(-3), NextReviewAt = now.AddHours(-3) },
            new SrsCardReview { SrsCardReviewId = 4, WordId = 4, UserId = userId, CreatedAt = now.AddHours(-2), NextReviewAt = now.AddHours(-2) }
        );
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        // Filtering to status=1 must still respect the deck-level review-limit guardrail (0 new allowed).
        var filtered = Unwrap(await controller.GetDueCards(languageId: 1, status: "1"));
        Assert.Empty(filtered);
    }

    [Fact]
    public async Task GetForecast_ExcludesUntouchedNewCards_AndShiftsBuriedCardsOntoUnburyDay()
    {
        var (context, connection) = await CreateContextAsync(useSqlite: true);
        await using var _conn = connection;
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        var today = LinguaReadApi.Utilities.SrsDay.UserDay(now, 0, 4);
        var tomorrowStart = LinguaReadApi.Utilities.SrsDay.DayStartUtc(today.AddDays(1), 0, 4);
        var inThreeDays = LinguaReadApi.Utilities.SrsDay.DayStartUtc(today.AddDays(3), 0, 4).AddHours(1);

        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings { UserId = userId, SrsDayStartHour = 4 });

        // 10 untouched new cards (must be excluded from future due forecast!)
        for (int i = 1; i <= 10; i++)
        {
            context.Words.Add(new Word { WordId = i, UserId = userId, LanguageId = 1, Term = $"untouched{i}", Status = 1 });
            context.SrsCardReviews.Add(new SrsCardReview { SrsCardReviewId = i, WordId = i, UserId = userId, NextReviewAt = now.AddDays(-5) });
        }

        // 2 due reviews + 1 learning card due today + 1 buried review (shifts to tomorrow) + 1 review in 3 days + 1 suspended review
        for (int i = 11; i <= 16; i++)
            context.Words.Add(new Word { WordId = i, UserId = userId, LanguageId = 1, Term = $"sched{i}", Status = 2 });

        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 11, WordId = 11, UserId = userId, HasEverGraduated = true, LastReviewedAt = now.AddDays(-10), NextReviewAt = now.AddHours(-2) },
            new SrsCardReview { SrsCardReviewId = 12, WordId = 12, UserId = userId, HasEverGraduated = true, LastReviewedAt = now.AddDays(-5), NextReviewAt = now.AddHours(-1) },
            new SrsCardReview { SrsCardReviewId = 13, WordId = 13, UserId = userId, IsLearning = true, LastReviewedAt = now.AddMinutes(-10), NextReviewAt = now.AddMinutes(-1) },
            new SrsCardReview { SrsCardReviewId = 14, WordId = 14, UserId = userId, HasEverGraduated = true, LastReviewedAt = now.AddDays(-5), NextReviewAt = now.AddHours(-1), BuriedUntil = tomorrowStart.AddMinutes(5) },
            new SrsCardReview { SrsCardReviewId = 15, WordId = 15, UserId = userId, HasEverGraduated = true, LastReviewedAt = now.AddDays(-2), NextReviewAt = inThreeDays },
            new SrsCardReview { SrsCardReviewId = 16, WordId = 16, UserId = userId, HasEverGraduated = true, IsSuspended = true, LastReviewedAt = now.AddDays(-5), NextReviewAt = now.AddHours(-1) }
        );
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var forecast = Unwrap(await controller.GetForecast(languageId: 1, days: 7, timezoneOffsetMinutes: 0));

        Assert.Equal(7, forecast.Count);
        Assert.Equal(3, forecast[0].Count); // 2 due reviews + 1 learning; excludes 10 untouched new, buried, suspended
        Assert.Equal(1, forecast[1].Count); // buried card shifts to tomorrow
        Assert.Equal(0, forecast[2].Count);
        Assert.Equal(1, forecast[3].Count); // scheduled in 3 days
    }

    [Fact]
    public async Task MaxNewZero_PausesNewCards_WhileServingDueReviewsAndLearningCards()
    {
        var (context, _) = await CreateContextAsync(useSqlite: false);
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 0,
            SrsMaxReviews = 200,
        });
        context.Words.AddRange(
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "untouched", Status = 1 },
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "due_review", Status = 3 },
            new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "learning_now", Status = 2 }
        );
        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 1, WordId = 1, UserId = userId, NextReviewAt = now.AddHours(-1) },
            new SrsCardReview
            {
                SrsCardReviewId = 2, WordId = 2, UserId = userId,
                HasEverGraduated = true, Stability = 10, Difficulty = 5, Interval = 10, Repetitions = 3,
                LastReviewedAt = now.AddDays(-10), NextReviewAt = now.AddHours(-1)
            },
            new SrsCardReview
            {
                SrsCardReviewId = 3, WordId = 3, UserId = userId,
                IsLearning = true, Stability = 1, Difficulty = 5, Repetitions = 1,
                LastReviewedAt = now.AddMinutes(-5), NextReviewAt = now.AddMinutes(-1)
            }
        );
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        var due = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(new[] { "learning_now", "due_review" }, due.Select(c => c.Term).ToArray());

        var stats = Unwrap(await controller.GetStats(languageId: 1));
        Assert.Equal(0, stats.MaxNewCards);
        Assert.Equal(3, stats.DueCount);
        Assert.Equal(2, stats.ReviewableCount);
        Assert.Equal(1, stats.DueLearningCount);
        Assert.Equal(1, stats.DueReviewCount);
        Assert.Equal(1, stats.DueNewCount);
        Assert.Equal(1, stats.ReviewableReviewCount);
        Assert.Equal(0, stats.ReviewableNewCount);
        Assert.False(stats.NewCardsPausedByReviewLimit);
    }

    [Fact]
    public async Task DueReviewsFillingDailyLimit_PausesNewCardsByDefault_AndResumesWhenIgnoreFlagEnabled()
    {
        var (context, _) = await CreateContextAsync(useSqlite: false);
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 5,
            SrsMaxReviews = 2,
            SrsReviewOrder = "mix",
            SrsNewCardsIgnoreReviewLimit = false,
        });

        // 3 overdue review cards (more than SrsMaxReviews=2) + 2 untouched new cards.
        for (int i = 1; i <= 5; i++)
            context.Words.Add(new Word { WordId = i, UserId = userId, LanguageId = 1, Term = $"w{i}", Status = 2 });
        for (int i = 1; i <= 3; i++)
        {
            context.SrsCardReviews.Add(new SrsCardReview
            {
                SrsCardReviewId = i, WordId = i, UserId = userId,
                HasEverGraduated = true, Stability = 10, Difficulty = 5, Interval = 10, Repetitions = 3,
                LastReviewedAt = now.AddDays(-10), NextReviewAt = now.AddHours(-i)
            });
        }
        for (int i = 4; i <= 5; i++)
        {
            context.SrsCardReviews.Add(new SrsCardReview
            {
                SrsCardReviewId = i, WordId = i, UserId = userId,
                CreatedAt = now.AddHours(-i), NextReviewAt = now.AddHours(-i)
            });
        }
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        // Default (ignoreReviewLimit = false): 2 reviews, 0 new.
        var statsDefault = Unwrap(await controller.GetStats(languageId: 1));
        Assert.Equal(5, statsDefault.DueCount);
        Assert.Equal(2, statsDefault.ReviewableCount);
        Assert.Equal(3, statsDefault.DueReviewCount);
        Assert.Equal(2, statsDefault.DueNewCount);
        Assert.Equal(2, statsDefault.ReviewableReviewCount);
        Assert.Equal(0, statsDefault.ReviewableNewCount);
        Assert.True(statsDefault.NewCardsPausedByReviewLimit);

        var dueDefault = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(2, dueDefault.Count);
        Assert.All(dueDefault, c => Assert.True(c.Repetitions > 0));

        // Flip SrsNewCardsIgnoreReviewLimit = true: 2 reviews + 2 new = 4 reviewable.
        var settings = await context.UserSettings.SingleAsync();
        settings.SrsNewCardsIgnoreReviewLimit = true;
        await context.SaveChangesAsync();

        var statsIgnored = Unwrap(await controller.GetStats(languageId: 1));
        Assert.Equal(4, statsIgnored.ReviewableCount);
        Assert.Equal(2, statsIgnored.ReviewableNewCount);
        Assert.False(statsIgnored.NewCardsPausedByReviewLimit);

        var dueIgnored = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(4, dueIgnored.Count);
        Assert.Equal(2, dueIgnored.Count(c => c.Repetitions == 0));
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_HonorsNewCardOrder_MaxNewZero_AndReviewLimitGuardrail()
    {
        var (context, _) = await CreateContextAsync(useSqlite: false);
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 1,
            SrsMaxReviews = 200,
            SrsNewCardOrder = SrsQueuePolicy.NewCardOrder.RecentFrequent,
        });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Recent", Content = "x", LastAccessedAt = now.AddHours(-2) });
        context.Words.AddRange(
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "old_word", Status = 1 },
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "hot_word", Status = 1 }
        );
        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 1, WordId = 1, UserId = userId, CreatedAt = now.AddDays(-60), NextReviewAt = now.AddDays(-60) },
            new SrsCardReview { SrsCardReviewId = 2, WordId = 2, UserId = userId, CreatedAt = now.AddDays(-1), NextReviewAt = now.AddDays(-1) }
        );
        context.TextWords.Add(new TextWord { TextId = 1, WordId = 2, OccurrenceCount = 8 });
        await context.SaveChangesAsync();

        string? capturedPrompt = null;
        var mockService = new Mock<IStoryGenerationService>();
        mockService.Setup(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()))
            .Callback<string, int>((p, _) => capturedPrompt = p)
            .ReturnsAsync(@"[{""term"": ""hot_word"", ""context"": ""Esta es hot_word hoy.""}]");
        var mockFactory = new Mock<IStoryGenerationServiceFactory>();
        mockFactory.Setup(f => f.GetServiceForUserAsync(userId)).ReturnsAsync(mockService.Object);

        var controller = CreateController(context, userId, mockFactory.Object);
        var res = Unwrap(await controller.GenerateStoryFromDueWords(new SrsStoryGenerateRequest
        {
            LanguageId = 1,
            CardType = "new",
            MaxWords = 5,
        }));

        // Cap of 1 picks hot_word (recent + frequent), NOT old_word (oldest).
        Assert.NotNull(capturedPrompt);
        Assert.Contains("hot_word", capturedPrompt);
        Assert.DoesNotContain("old_word", capturedPrompt);
        Assert.Single(res.MicroContexts);

        // Now set SrsMaxNewCards = 0 -> returns empty without calling AI.
        var settings = await context.UserSettings.SingleAsync();
        settings.SrsMaxNewCards = 0;
        await context.SaveChangesAsync();

        var paused = Unwrap(await controller.GenerateStoryFromDueWords(new SrsStoryGenerateRequest
        {
            LanguageId = 1,
            CardType = "new",
            MaxWords = 5,
        }));
        Assert.Empty(paused.MicroContexts);
        Assert.Equal(0, paused.RemainingNewBudget);
        mockService.Verify(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()), Times.Once);
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_ReviewLimitGuardrail_BlocksNewCardsInBothNewAndAllModes()
    {
        var (context, connection) = await CreateContextAsync(useSqlite: true);
        await using var _conn = connection;
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 5,
            SrsMaxReviews = 2,
            SrsNewCardsIgnoreReviewLimit = false,
        });

        context.Words.AddRange(
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "rev_one", Status = 3 },
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "rev_two", Status = 3 },
            new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "rev_three", Status = 3 },
            new Word { WordId = 4, UserId = userId, LanguageId = 1, Term = "untouched_new", Status = 1 }
        );
        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 1, WordId = 1, UserId = userId, HasEverGraduated = true, Stability = 10, Difficulty = 5, Interval = 10, Repetitions = 3, LastReviewedAt = now.AddDays(-11), NextReviewAt = now.AddHours(-3) },
            new SrsCardReview { SrsCardReviewId = 2, WordId = 2, UserId = userId, HasEverGraduated = true, Stability = 10, Difficulty = 5, Interval = 10, Repetitions = 3, LastReviewedAt = now.AddDays(-11), NextReviewAt = now.AddHours(-2) },
            new SrsCardReview { SrsCardReviewId = 3, WordId = 3, UserId = userId, HasEverGraduated = true, Stability = 10, Difficulty = 5, Interval = 10, Repetitions = 3, LastReviewedAt = now.AddDays(-11), NextReviewAt = now.AddHours(-1) },
            new SrsCardReview { SrsCardReviewId = 4, WordId = 4, UserId = userId, CreatedAt = now.AddHours(-1), NextReviewAt = now.AddHours(-1) }
        );
        await context.SaveChangesAsync();

        string? capturedPrompt = null;
        var mockService = new Mock<IStoryGenerationService>();
        mockService.Setup(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()))
            .Callback<string, int>((p, _) => capturedPrompt = p)
            .ReturnsAsync(@"[{""term"": ""rev_one"", ""context"": ""Veo rev_one hoy.""}, {""term"": ""rev_two"", ""context"": ""Veo rev_two hoy.""}]");
        var mockFactory = new Mock<IStoryGenerationServiceFactory>();
        mockFactory.Setup(f => f.GetServiceForUserAsync(userId)).ReturnsAsync(mockService.Object);

        var controller = CreateController(context, userId, mockFactory.Object);

        // 1. CardType = "new" returns empty without invoking AI.
        var newMode = Unwrap(await controller.GenerateStoryFromDueWords(new SrsStoryGenerateRequest
        {
            LanguageId = 1,
            CardType = "new",
            MaxWords = 5,
        }));
        Assert.Empty(newMode.MicroContexts);
        Assert.Equal(0, newMode.RemainingNewBudget);
        mockService.Verify(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()), Times.Never);

        // 2. CardType = "all" serves only the 2 capped review cards and never leaks untouched_new.
        var allMode = Unwrap(await controller.GenerateStoryFromDueWords(new SrsStoryGenerateRequest
        {
            LanguageId = 1,
            CardType = "all",
            MaxWords = 5,
        }));
        Assert.NotNull(capturedPrompt);
        Assert.Contains("rev_one", capturedPrompt);
        Assert.Contains("rev_two", capturedPrompt);
        Assert.DoesNotContain("untouched_new", capturedPrompt);
        Assert.Equal(0, allMode.RemainingNewBudget);
        Assert.Equal(2, allMode.MicroContexts.Count);
    }

    [Fact]
    public async Task CarriedOverLearningCard_DoesNotConsumeDailyReviewLimit_AndUndoDoesNotCorruptCounters()
    {
        var (context, connection) = await CreateContextAsync(useSqlite: true);
        await using var _conn = connection;
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 5,
            SrsMaxReviews = 1,
            SrsDayStartHour = 4,
            SrsNewCardsIgnoreReviewLimit = false,
        });
        context.Words.AddRange(
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "carried_learning", Status = 2 },
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "due_review", Status = 3 }
        );
        context.SrsCardReviews.AddRange(
            new SrsCardReview
            {
                SrsCardReviewId = 1, WordId = 1, UserId = userId,
                IsLearning = true, CurrentLearningStepIndex = 1, HasEverGraduated = false,
                Stability = 1.5, Difficulty = 5.0, Repetitions = 1,
                LastReviewedAt = now.AddDays(-1), NextReviewAt = now.AddHours(-2)
            },
            new SrsCardReview
            {
                SrsCardReviewId = 2, WordId = 2, UserId = userId,
                HasEverGraduated = true, Stability = 10, Difficulty = 5, Interval = 10, Repetitions = 3,
                LastReviewedAt = now.AddDays(-10), NextReviewAt = now.AddHours(-1)
            }
        );
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        // Reviewing a carried-over learning card advances streak, but must NOT consume SrsDailyReviewsStudied.
        var reviewRes = Unwrap(await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = 1, Grade = 2 }));
        var settingsAfter = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal(0, settingsAfter.SrsDailyReviewsStudied);
        Assert.Equal(0, settingsAfter.SrsDailyNewCardsStudied);
        Assert.Equal(1, settingsAfter.SrsCurrentStreak);

        // The 1 due review card must still be available under SrsMaxReviews = 1.
        var statsAfter = Unwrap(await controller.GetStats(languageId: 1));
        Assert.Equal(1, statsAfter.ReviewableReviewCount);
        Assert.Equal(0, statsAfter.StudiedReviewsToday);

        // Undoing the learning review leaves daily counters at 0 and cleanly reverts the streak.
        await controller.UndoLastReview(new SrsUndoDto { SrsReviewLogId = reviewRes.SrsReviewLogId });
        var settingsUndone = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal(0, settingsUndone.SrsDailyReviewsStudied);
        Assert.Equal(0, settingsUndone.SrsDailyNewCardsStudied);
        Assert.Equal(0, settingsUndone.SrsCurrentStreak);
    }

    [Fact]
    public async Task DailyLimitInvariance_AcrossGetStatsSubmitReviewGetDueCardsAndUndo()
    {
        var (context, connection) = await CreateContextAsync(useSqlite: true);
        await using var _conn = connection;
        await using var _ctx = context;

        var userId = Guid.NewGuid();
        var now = DateTime.UtcNow;
        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            SrsMaxNewCards = 20,
            SrsMaxReviews = 5,
            SrsReviewOrder = "reviews_first",
            SrsNewCardsIgnoreReviewLimit = false,
        });

        // 3 overdue reviews + 10 untouched new cards -> maxReviews=5 leaves exactly 2 new-card slots today.
        for (int i = 1; i <= 13; i++)
            context.Words.Add(new Word { WordId = i, UserId = userId, LanguageId = 1, Term = $"word{i}", Status = 2 });
        for (int i = 1; i <= 3; i++)
        {
            context.SrsCardReviews.Add(new SrsCardReview
            {
                SrsCardReviewId = i, WordId = i, UserId = userId,
                HasEverGraduated = true, Stability = 10, Difficulty = 5, Interval = 10, Repetitions = 3,
                LastReviewedAt = now.AddDays(-11), NextReviewAt = now.AddHours(-i)
            });
        }
        for (int i = 4; i <= 13; i++)
        {
            context.SrsCardReviews.Add(new SrsCardReview
            {
                SrsCardReviewId = i, WordId = i, UserId = userId,
                CreatedAt = now.AddHours(-i), NextReviewAt = now.AddHours(-i)
            });
        }
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        var s0 = Unwrap(await controller.GetStats(languageId: 1));
        Assert.Equal(3, s0.ReviewableReviewCount);
        Assert.Equal(2, s0.ReviewableNewCount);
        Assert.Equal(5, s0.ReviewableCount);

        // 1. Grade 1 review card (Good -> graduates to future day). New budget must stay invariant at 2.
        await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = 1, Grade = 2 });
        var s1 = Unwrap(await controller.GetStats(languageId: 1));
        Assert.Equal(1, s1.StudiedReviewsToday);
        Assert.Equal(2, s1.DueReviewCount);
        Assert.Equal(2, s1.ReviewableReviewCount);
        Assert.Equal(2, s1.ReviewableNewCount);

        var due1 = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(4, due1.Count);
        Assert.Equal(2, due1.Count(c => c.HasEverGraduated));
        Assert.Equal(2, due1.Count(c => !c.HasEverGraduated && c.Repetitions == 0));

        // 2. Grade 1 new card (Easy -> graduates immediately so it doesn't enter learning). Remaining new drops to 1.
        var newReview = Unwrap(await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = 4, Grade = 3 }));
        var s2 = Unwrap(await controller.GetStats(languageId: 1));
        Assert.Equal(1, s2.StudiedNewCardsToday);
        Assert.Equal(1, s2.ReviewableNewCount);
        Assert.Equal(2, s2.ReviewableReviewCount);

        var due2 = Unwrap(await controller.GetDueCards(languageId: 1));
        Assert.Equal(3, due2.Count);

        // 3. Undo that new card review -> remaining new returns cleanly to 2.
        await controller.UndoLastReview(new SrsUndoDto { SrsReviewLogId = newReview.SrsReviewLogId });
        var s3 = Unwrap(await controller.GetStats(languageId: 1));
        Assert.Equal(0, s3.StudiedNewCardsToday);
        Assert.Equal(2, s3.ReviewableNewCount);
        Assert.Equal(2, s3.ReviewableReviewCount);
    }
}
