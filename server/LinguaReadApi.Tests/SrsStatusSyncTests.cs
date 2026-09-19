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
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>The configurable link between reader word status and SRS cards (SrsCardLifecycle).</summary>
public class SrsStatusSyncTests
{
    private static readonly DateTime Now = new(2026, 3, 10, 12, 0, 0, DateTimeKind.Utc);

    private static UserSettings Settings(
        string autoCreate = "always", string sync = "promote", int level3 = 7, int level4 = 21,
        int autoKnown = 0, string knownAction = "keep") => new()
    {
        SrsAutoCreateCards = autoCreate,
        SrsStatusSyncMode = sync,
        SrsStatusLevel3Days = level3,
        SrsStatusLevel4Days = level4,
        SrsAutoKnownDays = autoKnown,
        SrsKnownCardAction = knownAction,
    };

    private static SrsCardReview Card(bool suspended = false, string? reason = null) =>
        new() { WordId = 1, IsSuspended = suspended, SuspendReason = reason };

    private static Word Word(int status) => new() { WordId = 1, Status = status };

    // ---- Status -> card ----

    [Theory]
    [InlineData(null, true, "ignored")]
    [InlineData("known", true, "ignored")]
    [InlineData("manual", true, "manual")]
    [InlineData("leech", true, "leech")]
    public void Ignored_SuspendsTheCard_WithoutOverridingAManualOrLeechSuspension(string? existingReason, bool expectSuspended, string expectedReason)
    {
        var card = Card(suspended: existingReason != null, reason: existingReason);

        Assert.Null(SrsCardLifecycle.ApplyStatusRules(Word(6), card, hasSentence: true, Settings()));

        Assert.Equal(expectSuspended, card.IsSuspended);
        Assert.Equal(expectedReason, card.SuspendReason);
    }

    [Fact]
    public void Known_KeepsOrSuspendsTheCard_PerSetting()
    {
        var kept = Card(suspended: true, reason: "ignored");
        SrsCardLifecycle.ApplyStatusRules(Word(5), kept, true, Settings(knownAction: "keep"));
        Assert.False(kept.IsSuspended);

        var suspended = Card();
        SrsCardLifecycle.ApplyStatusRules(Word(5), suspended, true, Settings(knownAction: "suspend"));
        Assert.True(suspended.IsSuspended);
        Assert.Equal("known", suspended.SuspendReason);
    }

    [Theory]
    [InlineData("ignored", false)]
    [InlineData("known", false)]
    [InlineData("manual", true)]
    public void LearningStatus_LiftsOnlyStatusSuspensions(string reason, bool stillSuspended)
    {
        var card = Card(suspended: true, reason: reason);
        SrsCardLifecycle.ApplyStatusRules(Word(2), card, true, Settings());
        Assert.Equal(stillSuspended, card.IsSuspended);
    }

    [Theory]
    [InlineData("always", false, true)]
    [InlineData("always", true, true)]
    [InlineData("with_sentence", false, false)]
    [InlineData("with_sentence", true, true)]
    [InlineData("never", true, false)]
    public void LearningStatus_CreatesACard_PerAutoCreateSetting(string autoCreate, bool hasSentence, bool expectCard)
    {
        var created = SrsCardLifecycle.ApplyStatusRules(Word(1), card: null, hasSentence, Settings(autoCreate: autoCreate));
        Assert.Equal(expectCard, created != null);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    [InlineData(6)]
    public void NoCardIsCreated_ForUnseenKnownOrIgnoredWords(int status)
    {
        Assert.Null(SrsCardLifecycle.ApplyStatusRules(Word(status), card: null, true, Settings()));
    }

    // ---- Review -> status ----

    private static SrsCardSnapshot ReviewSnapshot(double stability) =>
        new() { State = SrsCardState.Review, Stability = stability, Difficulty = 5, LastReviewedAtUtc = Now };

    [Theory]
    [InlineData(0.5, 2)]
    [InlineData(6.9, 2)]
    [InlineData(7, 3)]
    [InlineData(21, 4)]
    [InlineData(400, 4)]
    public void StatusForCard_FollowsStabilityThresholds(double stability, int expected)
    {
        Assert.Equal(expected, SrsCardLifecycle.StatusForCard(ReviewSnapshot(stability), Settings()));
    }

    [Fact]
    public void StatusForCard_IsOneWhileLearning_AndKnownPastAutoKnown()
    {
        var learning = new SrsCardSnapshot { State = SrsCardState.Learning, Stability = 50, Difficulty = 5 };
        Assert.Equal(1, SrsCardLifecycle.StatusForCard(learning, Settings()));
        Assert.Equal(5, SrsCardLifecycle.StatusForCard(ReviewSnapshot(30), Settings(autoKnown: 30)));
        Assert.Equal(3, SrsCardLifecycle.StatusForCard(ReviewSnapshot(4), Settings(level3: 3, level4: 10)));
    }

    private static SrsReviewOutcome Outcome(double stability, bool lapse = false) =>
        new(ReviewSnapshot(stability) with { State = lapse ? SrsCardState.Relearning : SrsCardState.Review },
            SrsReviewKind.Review, lapse, null, 1);

    [Fact]
    public void StatusAfterReview_PromotesOnly_UnlessDemotionIsOn()
    {
        Assert.Equal(4, SrsCardLifecycle.StatusAfterReview(2, Outcome(25), Settings()));
        Assert.Null(SrsCardLifecycle.StatusAfterReview(4, Outcome(8), Settings()));            // never lowers
        Assert.Null(SrsCardLifecycle.StatusAfterReview(2, Outcome(25), Settings(sync: "off")));
        Assert.Null(SrsCardLifecycle.StatusAfterReview(6, Outcome(25), Settings()));            // Ignored untouched
        Assert.Null(SrsCardLifecycle.StatusAfterReview(0, Outcome(25), Settings()));            // unseen untouched

        var demote = Settings(sync: "promote_demote");
        Assert.Null(SrsCardLifecycle.StatusAfterReview(4, Outcome(8), demote));                // no lapse, no demotion
        Assert.Equal(2, SrsCardLifecycle.StatusAfterReview(5, Outcome(1, lapse: true), demote));
    }

    // ---- Through the controllers ----

    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static ControllerContext Auth(Guid userId) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
        }
    };

    private static SrsController Srs(AppDbContext context, Guid userId) =>
        new(context, Mock.Of<IStoryGenerationServiceFactory>()) { ControllerContext = Auth(userId) };

    private static WordsController Words(AppDbContext context, Guid userId) =>
        new(context, NullLogger<WordsController>.Instance) { ControllerContext = Auth(userId) };

    private static Guid Seed(AppDbContext context, UserSettings settings, int wordStatus)
    {
        var userId = Guid.NewGuid();
        settings.UserId = userId;
        context.UserSettings.Add(settings);
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        context.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "gato", Status = wordStatus });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "T", Content = "El gato." });
        context.SaveChanges();
        return userId;
    }

    [Fact]
    public async Task Graduating_PromotesTheWord_AndReportsIt()
    {
        using var context = CreateContext();
        var userId = Seed(context, Settings(), wordStatus: 1);
        context.SrsCardReviews.Add(new SrsCardReview { WordId = 1, UserId = userId, NextReviewAt = DateTime.UtcNow.AddHours(-1) });
        context.SaveChanges();

        // Easy graduates a new card straight to Review (initial stability ~8.3 days -> status 3).
        var response = await Srs(context, userId).SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = 1, Grade = 3 });

        var result = Assert.IsType<SrsReviewResultDto>(Assert.IsType<OkObjectResult>(response.Result).Value);
        Assert.Equal(1, result.WordStatusChange!.From);
        Assert.Equal(3, result.WordStatusChange.To);
        Assert.Equal(3, context.Words.AsNoTracking().Single().Status);
        Assert.Equal(1, context.SrsReviewLogs.AsNoTracking().Single().WordStatusBefore);
    }

    [Fact]
    public async Task AutoKnown_WithSuspend_RetiresTheCard_AndUndoBringsItBack()
    {
        using var context = CreateContext();
        var userId = Seed(context, Settings(autoKnown: 30, knownAction: "suspend"), wordStatus: 4);
        context.SrsCardReviews.Add(new SrsCardReview
        {
            WordId = 1, UserId = userId, HasEverGraduated = true, Stability = 25, Difficulty = 4, Interval = 25,
            Repetitions = 6, LastReviewedAt = DateTime.UtcNow.AddDays(-25), NextReviewAt = DateTime.UtcNow.AddHours(-1),
        });
        context.SaveChanges();
        var srs = Srs(context, userId);

        var response = await srs.SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = 1, Grade = 2 });
        var result = Assert.IsType<SrsReviewResultDto>(Assert.IsType<OkObjectResult>(response.Result).Value);

        Assert.Equal(5, context.Words.AsNoTracking().Single().Status);
        var card = context.SrsCardReviews.AsNoTracking().Single();
        Assert.True(card.IsSuspended);
        Assert.Equal("known", card.SuspendReason);

        await srs.UndoLastReview(new SrsUndoDto { SrsReviewLogId = result.SrsReviewLogId });

        Assert.Equal(4, context.Words.AsNoTracking().Single().Status);
        card = context.SrsCardReviews.AsNoTracking().Single();
        Assert.False(card.IsSuspended);
        Assert.Equal(25, card.Stability);
    }

    [Fact]
    public async Task SyncOff_LeavesTheWordAlone()
    {
        using var context = CreateContext();
        var userId = Seed(context, Settings(sync: "off"), wordStatus: 1);
        context.SrsCardReviews.Add(new SrsCardReview { WordId = 1, UserId = userId, NextReviewAt = DateTime.UtcNow.AddHours(-1) });
        context.SaveChanges();

        var response = await Srs(context, userId).SubmitReview(new SrsReviewSubmitDto { SrsCardReviewId = 1, Grade = 3 });

        Assert.Null(Assert.IsType<SrsReviewResultDto>(Assert.IsType<OkObjectResult>(response.Result).Value).WordStatusChange);
        Assert.Equal(1, context.Words.AsNoTracking().Single().Status);
    }

    [Theory]
    [InlineData("always", true)]
    [InlineData("with_sentence", false)]
    public async Task SavingAWordWithoutASentence_CreatesACard_PerSetting(string autoCreate, bool expectCard)
    {
        using var context = CreateContext();
        var userId = Seed(context, Settings(autoCreate: autoCreate), wordStatus: 0);

        await Words(context, userId).CreateWord(new CreateWordDto { TextId = 1, Term = "gato", Status = 1 });

        Assert.Equal(expectCard, context.SrsCardReviews.Any());
    }

    [Fact]
    public async Task RaisingAWordToIgnored_OnSave_SuspendsItsCard()
    {
        using var context = CreateContext();
        var userId = Seed(context, Settings(), wordStatus: 2);
        context.SrsCardReviews.Add(new SrsCardReview { WordId = 1, UserId = userId, NextReviewAt = DateTime.UtcNow });
        context.SaveChanges();

        await Words(context, userId).CreateWord(new CreateWordDto { TextId = 1, Term = "gato", Status = 6 });

        var card = context.SrsCardReviews.AsNoTracking().Single();
        Assert.True(card.IsSuspended);
        Assert.Equal("ignored", card.SuspendReason);
    }

    [Fact]
    public async Task BatchImportAsKnown_SuspendsCards_WhenKnownCardsAreRetired()
    {
        using var context = CreateContext();
        var userId = Seed(context, Settings(knownAction: "suspend"), wordStatus: 2);
        context.SrsCardReviews.Add(new SrsCardReview { WordId = 1, UserId = userId, NextReviewAt = DateTime.UtcNow });
        context.SaveChanges();

        await Words(context, userId).AddTermsBatch(new AddTermBatchDto
        {
            LanguageId = 1,
            Terms = new List<NewTermDto> { new() { Term = "gato" }, new() { Term = "perro", Status = 2 } },
        });

        var gato = context.SrsCardReviews.AsNoTracking().Single(c => c.WordId == 1);
        Assert.True(gato.IsSuspended);
        Assert.Equal("known", gato.SuspendReason);
        var perroId = context.Words.AsNoTracking().Single(w => w.Term == "perro").WordId;
        Assert.False(context.SrsCardReviews.AsNoTracking().Single(c => c.WordId == perroId).IsSuspended);
    }
}
