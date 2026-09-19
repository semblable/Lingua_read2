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
using LinguaReadApi.Utilities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>SrsController behaviour on the FSRS scheduler: reviews, idempotency, undo, reading credit, due days.</summary>
public class SrsFsrsControllerTests
{
    private const int Again = 0, Hard = 1, Good = 2;

    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static SrsController CreateController(AppDbContext context, Guid userId) =>
        new(context, Mock.Of<IStoryGenerationServiceFactory>())
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

    /// <summary>A user with default settings and one Spanish word per term, without cards.</summary>
    private static Guid SeedUser(AppDbContext context, params (int WordId, string Term, int Status)[] words)
    {
        var userId = Guid.NewGuid();
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        foreach (var (wordId, term, status) in words)
            context.Words.Add(new Word { WordId = wordId, UserId = userId, LanguageId = 1, Term = term, Status = status });
        context.UserSettings.Add(new UserSettings { UserId = userId });
        context.SaveChanges();
        return userId;
    }

    private static SrsCardReview NewCard(Guid userId, int wordId) => new()
    {
        WordId = wordId,
        UserId = userId,
        NextReviewAt = DateTime.UtcNow.AddHours(-1),
        CreatedAt = DateTime.UtcNow.AddDays(-1),
    };

    private static SrsCardReview ReviewCard(Guid userId, int wordId, double stability = 10, int intervalDays = 10) => new()
    {
        WordId = wordId,
        UserId = userId,
        HasEverGraduated = true,
        Stability = stability,
        Difficulty = 5,
        Interval = intervalDays,
        Repetitions = 4,
        LastReviewedAt = DateTime.UtcNow.AddDays(-intervalDays),
        NextReviewAt = DateTime.UtcNow.AddHours(-1),
        CreatedAt = DateTime.UtcNow.AddDays(-60),
    };

    private static int AddCard(AppDbContext context, SrsCardReview card)
    {
        context.SrsCardReviews.Add(card);
        context.SaveChanges();
        return card.SrsCardReviewId;
    }

    private static T Unwrap<T>(ActionResult<T> result) where T : class =>
        result.Value ?? Assert.IsType<T>(Assert.IsAssignableFrom<ObjectResult>(result.Result).Value);

    private static object? Property(IActionResult result, string name)
    {
        var value = Assert.IsType<OkObjectResult>(result).Value!;
        return value.GetType().GetProperty(name)!.GetValue(value);
    }

    private static SrsCardReview Reload(AppDbContext context, int cardId) =>
        context.SrsCardReviews.AsNoTracking().Single(c => c.SrsCardReviewId == cardId);

    // ---- Grading ----

    [Fact]
    public async Task NewCard_Good_EntersLearningSteps_AndLogsTheReview()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 1));
        var cardId = AddCard(context, NewCard(userId, 1));
        var before = DateTime.UtcNow;

        var result = Unwrap(await CreateController(context, userId).SubmitReview(
            new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Good }));

        var card = Reload(context, cardId);
        Assert.True(card.IsLearning);
        Assert.False(card.HasEverGraduated);
        Assert.Equal(1, card.CurrentLearningStepIndex);
        Assert.InRange(card.NextReviewAt, before.AddMinutes(10), DateTime.UtcNow.AddMinutes(10));
        Assert.NotNull(card.Stability);
        Assert.NotNull(card.Difficulty);

        var log = context.SrsReviewLogs.AsNoTracking().Single();
        Assert.Equal(result.SrsReviewLogId, log.SrsReviewLogId);
        Assert.Equal((int)SrsReviewKind.Learn, log.Kind);
        Assert.Equal(0, log.NewInterval);
        Assert.Null(log.OldStability);
        Assert.Equal(4, result.NextIntervals.Count);
        Assert.True(result.IsLearning);

        var settings = context.UserSettings.AsNoTracking().Single();
        Assert.Equal(1, settings.SrsDailyNewCardsStudied);
        Assert.Equal(1, settings.SrsCurrentStreak);
    }

    [Fact]
    public async Task ReviewCard_Hard_IsAPass_NotALapse()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));

        await CreateController(context, userId).SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Hard });

        var card = Reload(context, cardId);
        Assert.False(card.IsLearning);
        Assert.Equal(0, card.Lapses);
        Assert.True(card.Stability > 10);
        Assert.True(card.Interval >= 10, $"interval {card.Interval}");
        Assert.Equal((int)SrsReviewKind.Review, context.SrsReviewLogs.AsNoTracking().Single().Kind);
    }

    [Fact]
    public async Task ReviewCard_Again_CountsALapse_AndRelearns()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));

        var result = Unwrap(await CreateController(context, userId).SubmitReview(
            new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Again }));

        var card = Reload(context, cardId);
        Assert.True(card.IsLearning);
        Assert.True(card.HasEverGraduated);
        Assert.Equal(1, card.Lapses);
        Assert.Equal(1, result.Lapses);
        Assert.Equal(0, card.Interval);
    }

    // ---- Offline replay ----

    [Fact]
    public async Task SameClientEventId_IsAppliedOnce()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));
        var dto = new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Good, ClientEventId = "evt-1" };

        var first = Unwrap(await CreateController(context, userId).SubmitReview(dto));
        var second = Unwrap(await CreateController(context, userId).SubmitReview(dto));

        Assert.Equal(first.SrsReviewLogId, second.SrsReviewLogId);
        Assert.Equal(first.NextReviewAt, second.NextReviewAt);
        Assert.Single(context.SrsReviewLogs.AsNoTracking());
        Assert.Equal(5, Reload(context, cardId).Repetitions);
        Assert.Equal(1, context.UserSettings.AsNoTracking().Single().SrsDailyReviewsStudied);
    }

    [Fact]
    public async Task OfflineReview_IsScheduledFromWhenItHappened()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));
        var reviewedAt = DateTime.UtcNow.AddHours(-3);

        await CreateController(context, userId).SubmitReview(
            new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Good, ReviewedAt = reviewedAt });

        Assert.Equal(reviewedAt, context.SrsReviewLogs.AsNoTracking().Single().ReviewedAt);
        Assert.Equal(reviewedAt, Reload(context, cardId).LastReviewedAt);
    }

    [Fact]
    public async Task OfflineReview_IsClampedBetweenPreviousReviewAndNow()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3), (2, "perro", 3));
        var previous = DateTime.UtcNow.AddHours(-1);
        var earlyCard = ReviewCard(userId, 1);
        earlyCard.LastReviewedAt = previous;
        var early = AddCard(context, earlyCard);
        var future = AddCard(context, ReviewCard(userId, 2));

        var controller = CreateController(context, userId);
        await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = early, Grade = Good, ReviewedAt = previous.AddHours(-5) });
        await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = future, Grade = Good, ReviewedAt = DateTime.UtcNow.AddDays(2) });

        var logs = context.SrsReviewLogs.AsNoTracking().ToList();
        Assert.Equal(previous, logs.Single(l => l.SrsCardReviewId == early).ReviewedAt);
        Assert.True(logs.Single(l => l.SrsCardReviewId == future).ReviewedAt <= DateTime.UtcNow);
    }

    // ---- Undo ----

    [Fact]
    public async Task Undo_ById_RestoresFsrsState()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));
        var controller = CreateController(context, userId);

        var review = Unwrap(await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Again }));
        var undo = await controller.UndoLastReview(new SrsUndoDto { SrsReviewLogId = review.SrsReviewLogId });

        Assert.IsType<OkObjectResult>(undo);
        var card = Reload(context, cardId);
        Assert.Equal(10, card.Stability);
        Assert.Equal(5, card.Difficulty);
        Assert.Equal(0, card.Lapses);
        Assert.Equal(10, card.Interval);
        Assert.False(card.IsLearning);
        Assert.Empty(context.SrsReviewLogs.AsNoTracking());
        Assert.Equal(0, context.UserSettings.AsNoTracking().Single().SrsDailyReviewsStudied);
    }

    [Fact]
    public async Task Undo_RefusesAReviewThatWasFollowedByAnother()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));
        var controller = CreateController(context, userId);

        var first = Unwrap(await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Again }));
        await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Good });

        Assert.IsType<ConflictObjectResult>(await controller.UndoLastReview(new SrsUndoDto { SrsReviewLogId = first.SrsReviewLogId }));
        Assert.Equal(2, context.SrsReviewLogs.Count());
    }

    [Fact]
    public async Task Undo_WithoutBody_RevertsTheMostRecentReview()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3), (2, "perro", 3));
        var a = AddCard(context, ReviewCard(userId, 1));
        var b = AddCard(context, ReviewCard(userId, 2));
        var controller = CreateController(context, userId);

        await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = a, Grade = Good });
        await controller.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = b, Grade = Good });
        await controller.UndoLastReview();

        Assert.Equal(a, context.SrsReviewLogs.AsNoTracking().Single().SrsCardReviewId);
        Assert.Equal(10, Reload(context, b).Interval);
    }

    // ---- SM-2 history ----

    [Fact]
    public async Task LegacyCard_GetsFsrsStateFromItsHistory_OnFirstReview()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var t0 = DateTime.UtcNow.AddDays(-7);
        var t1 = DateTime.UtcNow.AddDays(-6);
        var cardId = AddCard(context, new SrsCardReview
        {
            WordId = 1, UserId = userId, HasEverGraduated = true,
            Interval = 6, Repetitions = 2, LastReviewedAt = t1, NextReviewAt = DateTime.UtcNow.AddHours(-1),
        });
        context.SrsReviewLogs.AddRange(
            new SrsReviewLog { UserId = userId, SrsCardReviewId = cardId, Grade = Good, ReviewedAt = t0, OldInterval = 0 },
            new SrsReviewLog { UserId = userId, SrsCardReviewId = cardId, Grade = Good, ReviewedAt = t1, OldInterval = 1,
                OldRepetitions = 1, OldLastReviewedAt = t0, OldHasEverGraduated = true });
        context.SaveChanges();

        await CreateController(context, userId).SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = cardId, Grade = Good });

        var logs = context.SrsReviewLogs.AsNoTracking().OrderBy(l => l.ReviewedAt).ToList();
        Assert.Equal(3, logs.Count);
        Assert.Equal((int)SrsReviewKind.Learn, logs[0].Kind);
        Assert.Equal((int)SrsReviewKind.Review, logs[1].Kind);
        Assert.Equal(1, logs[0].NewInterval);
        Assert.Equal(6, logs[1].NewInterval);
        Assert.NotNull(logs[2].OldStability); // replayed from the two SM-2 reviews
        Assert.NotNull(Reload(context, cardId).Stability);
    }

    // ---- Reading credit ----

    [Fact]
    public async Task ReadingCredit_AppliesOncePerDay_AndStaysOutOfDailyCounts()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));
        var controller = CreateController(context, userId);

        var first = await controller.ApplyReadingCredit(1);
        var second = await controller.ApplyReadingCredit(1);

        Assert.Equal(true, Property(first, "Applied"));
        Assert.Equal(false, Property(second, "Applied"));
        var log = context.SrsReviewLogs.AsNoTracking().Single();
        Assert.Equal((int)SrsReviewKind.Reading, log.Kind);
        Assert.Equal(Good, log.Grade);
        var settings = context.UserSettings.AsNoTracking().Single();
        Assert.Equal(0, settings.SrsDailyReviewsStudied);
        Assert.Equal(0, settings.SrsCurrentStreak);
        Assert.True(Reload(context, cardId).Interval >= 10);
    }

    [Fact]
    public async Task ReadingCredit_SkipsCardsStillBeingLearned()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        AddCard(context, NewCard(userId, 1));

        Assert.Equal(false, Property(await CreateController(context, userId).ApplyReadingCredit(1), "Applied"));
        Assert.Empty(context.SrsReviewLogs);
    }

    // ---- Due days ----

    [Fact]
    public async Task ReviewCards_AreDueForTheWholeUserDay()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3), (2, "perro", 3));
        var now = DateTime.UtcNow;
        var today = SrsDay.UserDay(now, 120, 4);
        var tomorrowStart = SrsDay.DayStartUtc(today.AddDays(1), 120, 4);
        AddCard(context, ReviewCard(userId, 1));
        AddCard(context, ReviewCard(userId, 2));
        context.SrsCardReviews.Single(c => c.WordId == 1).NextReviewAt = tomorrowStart.AddMinutes(-1);
        context.SrsCardReviews.Single(c => c.WordId == 2).NextReviewAt = tomorrowStart.AddMinutes(1);
        context.SaveChanges();

        var due = Unwrap(await CreateController(context, userId).GetDueCards(timezoneOffsetMinutes: 120));

        Assert.Equal("gato", Assert.Single(due).Term);
    }

    [Fact]
    public async Task LearningCards_AreServedWithinTheLearnAheadWindow()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 1), (2, "perro", 1));
        foreach (var (wordId, dueIn) in new[] { (1, 10), (2, 30) })
        {
            AddCard(context, new SrsCardReview
            {
                WordId = wordId, UserId = userId, IsLearning = true, CurrentLearningStepIndex = 1,
                Stability = 2, Difficulty = 5, LastReviewedAt = DateTime.UtcNow,
                NextReviewAt = DateTime.UtcNow.AddMinutes(dueIn),
            });
        }

        var due = Unwrap(await CreateController(context, userId).GetDueCards());

        var card = Assert.Single(due);
        Assert.Equal("gato", card.Term);
        Assert.Equal(4, card.NextIntervals.Count);
    }

    [Fact]
    public async Task OneTarget_CountsUnknownWordsAgainstVocabulary()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 1), (2, "el", 5));
        AddCard(context, NewCard(userId, 1));
        context.SrsPhrases.Add(new SrsPhrase { WordId = 1, UserId = userId, Sentence = "El gato duerme.", CreatedAt = DateTime.UtcNow });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        Assert.Equal(2, Assert.Single(Unwrap(await controller.GetDueCards())).UnknownWordsInPhrase); // gato + duerme
        Assert.Empty(Unwrap(await controller.GetDueCards(onlyOneTarget: true)));

        context.Words.Add(new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "duerme", Status = 5 });
        context.SaveChanges();
        Assert.Equal(1, Assert.Single(Unwrap(await controller.GetDueCards(onlyOneTarget: true))).UnknownWordsInPhrase);
    }

    [Fact]
    public async Task Bury_LastsUntilTheNextUserDay()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));

        await CreateController(context, userId).BuryCard(cardId, timezoneOffsetMinutes: 120);

        var today = SrsDay.UserDay(DateTime.UtcNow, 120, 4);
        Assert.Equal(SrsDay.DayStartUtc(today.AddDays(1), 120, 4), Reload(context, cardId).BuriedUntil);
    }

    [Fact]
    public async Task Heatmap_GroupsReviewsByUserDay()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3));
        var cardId = AddCard(context, ReviewCard(userId, 1));
        var today = SrsDay.UserDay(DateTime.UtcNow, 120, 4);
        var todayStart = SrsDay.DayStartUtc(today, 120, 4);
        context.SrsReviewLogs.AddRange(
            new SrsReviewLog { UserId = userId, SrsCardReviewId = cardId, Grade = Good, ReviewedAt = todayStart.AddMinutes(1) },
            new SrsReviewLog { UserId = userId, SrsCardReviewId = cardId, Grade = Good, ReviewedAt = todayStart.AddMinutes(-1) },
            new SrsReviewLog { UserId = userId, SrsCardReviewId = cardId, Grade = Good, ReviewedAt = todayStart.AddMinutes(2), Kind = (int)SrsReviewKind.Reading });
        context.SaveChanges();

        var heatmap = Unwrap(await CreateController(context, userId).GetHeatmap(timezoneOffsetMinutes: 120));

        Assert.Equal(new[] { (today.AddDays(-1).ToString("yyyy-MM-dd"), 1), (today.ToString("yyyy-MM-dd"), 1) },
            heatmap.Select(h => (h.Date, h.ReviewCount)).ToArray());
    }

    [Fact]
    public async Task Forecast_LeavesOutSuspendedCards()
    {
        using var context = CreateContext();
        var userId = SeedUser(context, (1, "gato", 3), (2, "perro", 3));
        AddCard(context, ReviewCard(userId, 1));
        var suspended = ReviewCard(userId, 2);
        suspended.IsSuspended = true;
        AddCard(context, suspended);

        var forecast = Unwrap(await CreateController(context, userId).GetForecast(days: 3));

        Assert.Equal(new[] { 1, 0, 0 }, forecast.Select(f => f.Count).ToArray());
    }
}
