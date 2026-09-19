using System;
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
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>Leeches, true retention and the SRS statistics endpoints.</summary>
public class SrsMetricsTests
{
    // ---- Leech rule ----

    [Theory]
    [InlineData(7, false)]
    [InlineData(8, true)]
    [InlineData(9, false)]
    [InlineData(12, true)]
    [InlineData(16, true)]
    public void Leech_TripsAtTheThreshold_AndEveryHalfThresholdAfter(int lapses, bool trips)
    {
        Assert.Equal(trips, SrsLeeches.TripsAt(lapses, new UserSettings { SrsLeechThreshold = 8 }));
    }

    [Fact]
    public void Leech_DetectionOff_NeverTrips()
    {
        Assert.False(SrsLeeches.TripsAt(50, new UserSettings { SrsLeechThreshold = 0 }));
    }

    [Fact]
    public void OnLapse_TagsOnce_AndSuspendsWhenAsked_OnUndoReverses()
    {
        var settings = new UserSettings { SrsLeechThreshold = 8, SrsLeechAction = "suspend" };
        var card = new SrsCardReview { Lapses = 8, Tags = "verbs" };

        Assert.True(SrsLeeches.OnLapse(card, settings));
        Assert.True(SrsLeeches.OnLapse(card, settings));
        Assert.Equal("verbs,leech", card.Tags);
        Assert.True(card.IsSuspended);
        Assert.Equal("leech", card.SuspendReason);

        card.Lapses = 7; // undo restored the count
        SrsLeeches.OnUndo(card, lapsesAfterReview: 8, settings);
        Assert.False(card.IsSuspended);
        Assert.Equal("verbs", card.Tags);
    }

    // ---- Through the controller ----

    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static SrsController Srs(AppDbContext context, Guid userId) =>
        new(context, Mock.Of<IStoryGenerationServiceFactory>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
                }
            }
        };

    private static Guid Seed(AppDbContext context, UserSettings? settings = null)
    {
        var userId = Guid.NewGuid();
        settings ??= new UserSettings();
        settings.UserId = userId;
        context.UserSettings.Add(settings);
        context.Languages.AddRange(new Language { LanguageId = 1, Name = "Spanish", Code = "es" }, new Language { LanguageId = 2, Name = "French", Code = "fr" });
        for (int i = 1; i <= 6; i++)
            context.Words.Add(new Word { WordId = i, UserId = userId, LanguageId = i == 6 ? 2 : 1, Term = $"w{i}", Status = 2 });
        context.SaveChanges();
        return userId;
    }

    private static SrsCardReview Graduated(Guid userId, int wordId, int interval, int lapses = 0) => new()
    {
        SrsCardReviewId = wordId, WordId = wordId, UserId = userId, HasEverGraduated = true,
        Stability = interval, Difficulty = 5, Interval = interval, Repetitions = 3, Lapses = lapses,
        LastReviewedAt = DateTime.UtcNow.AddDays(-interval), NextReviewAt = DateTime.UtcNow.AddHours(-1),
    };

    [Fact]
    public async Task LapseReachingTheThreshold_MakesALeech_AndUndoTakesItBack()
    {
        using var context = CreateContext();
        var userId = Seed(context, new UserSettings { SrsLeechThreshold = 8, SrsLeechAction = "suspend", SrsStatusSyncMode = "off" });
        context.SrsCardReviews.Add(Graduated(userId, 1, interval: 5, lapses: 7));
        context.SaveChanges();
        var srs = Srs(context, userId);

        var response = await srs.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = 1, Grade = 0 });

        var result = Assert.IsType<SrsReviewResultDto>(Assert.IsType<OkObjectResult>(response.Result).Value);
        Assert.True(result.BecameLeech);
        Assert.True(result.IsSuspended);
        var card = context.SrsCardReviews.AsNoTracking().Single();
        Assert.Equal((8, "leech", true), (card.Lapses, card.Tags, card.IsSuspended));

        await srs.UndoLastReview(new SrsUndoDto { SrsReviewLogId = result.SrsReviewLogId });

        card = context.SrsCardReviews.AsNoTracking().Single();
        Assert.Equal((7, (string?)null, false), (card.Lapses, card.Tags, card.IsSuspended));
    }

    [Fact]
    public async Task Stats_CountLearningNewYoungMature_AndTrueRetention()
    {
        using var context = CreateContext();
        var userId = Seed(context);
        context.SrsCardReviews.AddRange(
            new SrsCardReview { SrsCardReviewId = 1, WordId = 1, UserId = userId, NextReviewAt = DateTime.UtcNow },                    // new
            new SrsCardReview { SrsCardReviewId = 2, WordId = 2, UserId = userId, IsLearning = true, Stability = 1, Difficulty = 5,
                LastReviewedAt = DateTime.UtcNow, NextReviewAt = DateTime.UtcNow.AddMinutes(5) },                                        // learning
            Graduated(userId, 3, interval: 10),                                                                                          // young
            Graduated(userId, 4, interval: 40));                                                                                         // mature
        var at = DateTime.UtcNow.AddDays(-2);
        foreach (var (grade, kind) in new[] { (0, 1), (1, 1), (2, 1), (3, 1), (0, 0), (2, 3) }) // four reviews, a learning step, a reading credit
            context.SrsReviewLogs.Add(new SrsReviewLog { UserId = userId, SrsCardReviewId = 3, Grade = grade, Kind = kind, ReviewedAt = at });
        context.SaveChanges();

        var stats = (await Srs(context, userId).GetStats()).Value!;

        Assert.Equal((1, 1, 1, 1, 4), (stats.NewCards, stats.LearningCards, stats.YoungCards, stats.MatureCards, stats.TotalCards));
        Assert.Equal(75, stats.RetentionRate); // Hard counts as remembered; learning steps and reading credit don't count
        Assert.Equal(4, stats.DueCount);
    }

    [Fact]
    public async Task Analytics_UsesTrueRetention_LapseLeeches_AndCardsThatCrossedIntoMature()
    {
        using var context = CreateContext();
        var userId = Seed(context, new UserSettings { SrsLeechThreshold = 8 });
        context.SrsCardReviews.AddRange(
            Graduated(userId, 1, interval: 25),
            Graduated(userId, 2, interval: 40),
            Graduated(userId, 3, interval: 3, lapses: 5),
            Graduated(userId, 4, interval: 3, lapses: 9),
            Graduated(userId, 5, interval: 3, lapses: 3),
            Graduated(userId, 6, interval: 3, lapses: 12)); // French
        var recent = DateTime.UtcNow.AddDays(-2);
        context.SrsReviewLogs.AddRange(
            new SrsReviewLog { UserId = userId, SrsCardReviewId = 1, Grade = 2, Kind = 1, ReviewedAt = recent, OldInterval = 15, NewInterval = 25 }, // crossed 21
            new SrsReviewLog { UserId = userId, SrsCardReviewId = 2, Grade = 1, Kind = 1, ReviewedAt = recent, OldInterval = 30, NewInterval = 40 }, // already mature
            new SrsReviewLog { UserId = userId, SrsCardReviewId = 3, Grade = 0, Kind = 1, ReviewedAt = recent, OldInterval = 10, NewInterval = 0 },
            new SrsReviewLog { UserId = userId, SrsCardReviewId = 3, Grade = 0, Kind = 2, ReviewedAt = recent, OldInterval = 0, NewInterval = 0 },
            new SrsReviewLog { UserId = userId, SrsCardReviewId = 6, Grade = 3, Kind = 1, ReviewedAt = recent, OldInterval = 15, NewInterval = 30 });
        context.SaveChanges();

        var analytics = (await Srs(context, userId).GetAnalytics(languageId: 1)).Value!;

        var status2 = Assert.Single(analytics.RetentionByStatus);
        Assert.Equal((3, 2), (status2.TotalReviews, status2.GoodReviews)); // relearn step left out, Hard passes
        Assert.Equal(1, analytics.CardsMaturedThisWeek);
        Assert.Equal(new[] { 9, 5 }, analytics.LeechCards.Select(l => l.LapseCount).ToArray()); // from 4 lapses, Spanish only
        Assert.Equal(8, analytics.LeechThreshold);
        Assert.Equal(4, analytics.TotalReviewsLast30Days);
    }
}
