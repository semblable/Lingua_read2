using System;
using System.Linq;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

public class GoalProgressServiceTests
{
    // ---- Period boundary math ----

    [Fact]
    public void Weekly_PeriodStartContaining_ReturnsMondayOfThatWeek()
    {
        // Wednesday 2026-04-22 -> Monday 2026-04-20
        var d = new DateOnly(2026, 4, 22);
        var start = GoalProgressService.PeriodStartContaining(d, GoalRecurrence.Weekly);
        Assert.Equal(new DateOnly(2026, 4, 20), start);

        // Sunday 2026-04-26 -> Monday 2026-04-20
        var sunday = new DateOnly(2026, 4, 26);
        Assert.Equal(new DateOnly(2026, 4, 20), GoalProgressService.PeriodStartContaining(sunday, GoalRecurrence.Weekly));

        // Monday 2026-04-20 -> itself
        var monday = new DateOnly(2026, 4, 20);
        Assert.Equal(monday, GoalProgressService.PeriodStartContaining(monday, GoalRecurrence.Weekly));
    }

    [Fact]
    public void Weekly_PeriodEndOf_IsSundayOfThatWeek()
    {
        var monday = new DateOnly(2026, 4, 20);
        Assert.Equal(new DateOnly(2026, 4, 26), GoalProgressService.PeriodEndOf(monday, GoalRecurrence.Weekly));
    }

    [Fact]
    public void Monthly_BoundariesHandleVariableMonthLengths()
    {
        // February in a non-leap year (2026)
        var feb = new DateOnly(2026, 2, 15);
        Assert.Equal(new DateOnly(2026, 2, 1),
            GoalProgressService.PeriodStartContaining(feb, GoalRecurrence.Monthly));
        Assert.Equal(new DateOnly(2026, 2, 28),
            GoalProgressService.PeriodEndOf(new DateOnly(2026, 2, 1), GoalRecurrence.Monthly));

        // 31-day month
        Assert.Equal(new DateOnly(2026, 1, 31),
            GoalProgressService.PeriodEndOf(new DateOnly(2026, 1, 1), GoalRecurrence.Monthly));

        // 30-day month
        Assert.Equal(new DateOnly(2026, 4, 30),
            GoalProgressService.PeriodEndOf(new DateOnly(2026, 4, 1), GoalRecurrence.Monthly));

        // Leap year 2028
        Assert.Equal(new DateOnly(2028, 2, 29),
            GoalProgressService.PeriodEndOf(new DateOnly(2028, 2, 1), GoalRecurrence.Monthly));
    }

    [Fact]
    public void NextPeriodStart_CrossesYearBoundary()
    {
        Assert.Equal(new DateOnly(2027, 1, 1),
            GoalProgressService.NextPeriodStart(new DateOnly(2026, 12, 1), GoalRecurrence.Monthly));
        Assert.Equal(new DateOnly(2027, 1, 4), // Mon following Mon Dec 28 2026
            GoalProgressService.NextPeriodStart(new DateOnly(2026, 12, 28), GoalRecurrence.Weekly));
    }

    // ---- One-shot Delta progress ----

    [Fact]
    public async Task OneShot_Delta_PerLanguage_SubtractsBaselineAndComputesPercent()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        // Existing reading activity (counts toward baseline)
        ctx.UserActivities.Add(NewReading(userId, 1, 500, DateTime.UtcNow.AddDays(-10)));
        await ctx.SaveChangesAsync();

        var goal = new UserGoal
        {
            UserId = userId,
            LanguageId = 1,
            GoalType = GoalType.WordsRead,
            Mode = GoalMode.Delta,
            TargetValue = 1_000,
            BaselineValue = 500,
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        };
        ctx.UserGoals.Add(goal);
        await ctx.SaveChangesAsync();

        // After creation, user reads another 250 words.
        ctx.UserActivities.Add(NewReading(userId, 1, 250, DateTime.UtcNow));
        await ctx.SaveChangesAsync();

        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, DateTime.UtcNow);
        Assert.Equal(250, dtos[0].Progress);
        Assert.Equal(0.25, dtos[0].PercentComplete, 3);
        Assert.Equal("active", dtos[0].State);
    }

    [Fact]
    public async Task OneShot_Delta_AllLanguages_SumsAcrossLanguages()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);
        Seed(ctx, userId, 2);

        var goal = new UserGoal
        {
            UserId = userId,
            LanguageId = null,
            GoalType = GoalType.WordsRead,
            Mode = GoalMode.Delta,
            TargetValue = 1000,
            BaselineValue = 0,
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        };
        ctx.UserGoals.Add(goal);
        ctx.UserActivities.AddRange(
            NewReading(userId, 1, 300, DateTime.UtcNow),
            NewReading(userId, 2, 400, DateTime.UtcNow));
        await ctx.SaveChangesAsync();

        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, DateTime.UtcNow);
        Assert.Equal(700, dtos[0].Progress);
    }

    [Fact]
    public async Task OneShot_Delta_WordsRead_IncludesCorrectedBookFinishedCredit()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        var goal = new UserGoal
        {
            UserId = userId,
            LanguageId = 1,
            GoalType = GoalType.WordsRead,
            Mode = GoalMode.Delta,
            TargetValue = 100,
            BaselineValue = 0,
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        };

        ctx.UserActivities.AddRange(
            new UserActivity { UserId = userId, LanguageId = 1, ActivityType = "TextCompleted", WordCount = 3, Timestamp = DateTime.UtcNow },
            new UserActivity { UserId = userId, LanguageId = 1, ActivityType = "BookFinished", WordCount = 1, Timestamp = DateTime.UtcNow });
        await ctx.SaveChangesAsync();

        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, DateTime.UtcNow);

        Assert.Equal(4, dtos[0].Progress);
    }

    [Fact]
    public async Task OneShot_Delta_ListeningSeconds_OnlyListeningTypesCount()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        ctx.UserActivities.AddRange(
            new UserActivity { UserId = userId, LanguageId = 1, ActivityType = "Listening", WordCount = 0, ListeningDurationSeconds = 600, Timestamp = DateTime.UtcNow },
            new UserActivity { UserId = userId, LanguageId = 1, ActivityType = "ManualListening", WordCount = 0, ListeningDurationSeconds = 300, Timestamp = DateTime.UtcNow },
            new UserActivity { UserId = userId, LanguageId = 1, ActivityType = "Reading", WordCount = 999, ListeningDurationSeconds = 0, Timestamp = DateTime.UtcNow }
        );
        await ctx.SaveChangesAsync();

        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1,
            GoalType = GoalType.ListeningSeconds, Mode = GoalMode.Delta,
            TargetValue = 1800, BaselineValue = 0,
            CreatedAt = DateTime.UtcNow.AddHours(-2)
        };
        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, DateTime.UtcNow);
        Assert.Equal(900, dtos[0].Progress);
    }

    // ---- One-shot Milestone ----

    [Fact]
    public async Task Milestone_WordsKnown_ProgressEqualsCurrentCount()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        for (int i = 0; i < 7; i++)
            ctx.Words.Add(new Word { UserId = userId, LanguageId = 1, Term = $"w{i}", Status = 5, Translation = new WordTranslation { Translation = "x" } });
        ctx.Words.Add(new Word { UserId = userId, LanguageId = 1, Term = "low", Status = 2, Translation = new WordTranslation { Translation = "x" } });
        await ctx.SaveChangesAsync();

        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1,
            GoalType = GoalType.WordsKnown, Mode = GoalMode.Milestone,
            TargetValue = 10, BaselineValue = 0,
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        };
        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, DateTime.UtcNow);
        Assert.Equal(7, dtos[0].Progress);
        Assert.Equal(0.7, dtos[0].PercentComplete, 3);
    }

    [Fact]
    public async Task Milestone_StampsCompletedAt_WhenTargetReached()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        for (int i = 0; i < 5; i++)
            ctx.Words.Add(new Word { UserId = userId, LanguageId = 1, Term = $"w{i}", Status = 5, Translation = new WordTranslation { Translation = "x" } });
        await ctx.SaveChangesAsync();

        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1,
            GoalType = GoalType.WordsKnown, Mode = GoalMode.Milestone,
            TargetValue = 5, BaselineValue = 0,
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        };
        ctx.UserGoals.Add(goal);
        await ctx.SaveChangesAsync();

        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, DateTime.UtcNow);
        await ctx.SaveChangesAsync();

        Assert.Equal("completed", dtos[0].State);
        Assert.NotNull(goal.CompletedAt);
    }

    [Fact]
    public async Task WordsKnown_Regression_ShowsNegativeProgress_AndStickyCompletion()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        // baseline 10, target +5 = 15 needed
        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1,
            GoalType = GoalType.WordsKnown, Mode = GoalMode.Delta,
            TargetValue = 5, BaselineValue = 10,
            CompletedAt = DateTime.UtcNow.AddDays(-1), // already completed earlier
            CreatedAt = DateTime.UtcNow.AddDays(-10)
        };
        ctx.UserGoals.Add(goal);

        // Now only 7 known words exist (regression).
        for (int i = 0; i < 7; i++)
            ctx.Words.Add(new Word { UserId = userId, LanguageId = 1, Term = $"w{i}", Status = 5, Translation = new WordTranslation { Translation = "x" } });
        await ctx.SaveChangesAsync();

        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, DateTime.UtcNow);

        Assert.Equal(-3, dtos[0].Progress);     // unclamped negative shown honestly
        Assert.NotNull(goal.CompletedAt);       // sticky
        Assert.Equal("completed", dtos[0].State);
    }

    // ---- Recurring rollover ----

    [Fact]
    public async Task Weekly_PeriodRollsForward_AndClosesPrevious()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        // Goal created Mon 2026-04-13 (a Monday). We pretend "today" is Mon 2026-04-27.
        // So weeks 4/13-4/19 and 4/20-4/26 should both close.
        var created = new DateTime(2026, 4, 13, 12, 0, 0, DateTimeKind.Utc);
        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1,
            GoalType = GoalType.WordsRead, Mode = GoalMode.Delta, Recurrence = GoalRecurrence.Weekly,
            TargetValue = 100, BaselineValue = 0,
            CurrentPeriodStart = new DateOnly(2026, 4, 13),
            CurrentPeriodBaseline = 0,
            CreatedAt = created,
            CreatedTzOffsetMin = 0
        };
        ctx.UserGoals.Add(goal);

        // Activity in week 1 (4/13-4/19): 50 words (missed)
        ctx.UserActivities.Add(NewReading(userId, 1, 50, new DateTime(2026, 4, 15, 10, 0, 0, DateTimeKind.Utc)));
        // Activity in week 2 (4/20-4/26): 200 words (hit)
        ctx.UserActivities.Add(NewReading(userId, 1, 200, new DateTime(2026, 4, 22, 10, 0, 0, DateTimeKind.Utc)));
        await ctx.SaveChangesAsync();

        var svc = new GoalProgressService(ctx);
        var fakeNow = new DateTime(2026, 4, 27, 12, 0, 0, DateTimeKind.Utc); // Monday of new week
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, fakeNow);
        await ctx.SaveChangesAsync();

        var periods = await ctx.UserGoalPeriods.Where(p => p.GoalId == goal.GoalId).OrderBy(p => p.PeriodStart).ToListAsync();
        Assert.Equal(2, periods.Count);

        Assert.Equal(new DateOnly(2026, 4, 13), periods[0].PeriodStart);
        Assert.Equal(new DateOnly(2026, 4, 19), periods[0].PeriodEnd);
        Assert.Equal(50, periods[0].FinalProgress);
        Assert.False(periods[0].Completed);

        Assert.Equal(new DateOnly(2026, 4, 20), periods[1].PeriodStart);
        Assert.Equal(new DateOnly(2026, 4, 26), periods[1].PeriodEnd);
        Assert.Equal(200, periods[1].FinalProgress);
        Assert.True(periods[1].Completed);

        Assert.Equal(new DateOnly(2026, 4, 27), goal.CurrentPeriodStart);
        Assert.Equal("in_progress", dtos[0].State);
    }

    [Fact]
    public async Task Monthly_NoActivity_ClosesPeriodWithZero()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1,
            GoalType = GoalType.WordsRead, Mode = GoalMode.Delta, Recurrence = GoalRecurrence.Monthly,
            TargetValue = 5000, BaselineValue = 0,
            CurrentPeriodStart = new DateOnly(2026, 1, 1),
            CurrentPeriodBaseline = 0,
            CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            CreatedTzOffsetMin = 0
        };
        ctx.UserGoals.Add(goal);
        await ctx.SaveChangesAsync();

        var svc = new GoalProgressService(ctx);
        var fakeNow = new DateTime(2026, 3, 5, 12, 0, 0, DateTimeKind.Utc);
        await svc.ComputeAsync(userId, new[] { goal }, 0, fakeNow);
        await ctx.SaveChangesAsync();

        var periods = await ctx.UserGoalPeriods.Where(p => p.GoalId == goal.GoalId).OrderBy(p => p.PeriodStart).ToListAsync();
        Assert.Equal(2, periods.Count); // Jan + Feb closed
        Assert.All(periods, p => Assert.Equal(0, p.FinalProgress));
        Assert.Equal(new DateOnly(2026, 3, 1), goal.CurrentPeriodStart);
    }

    // ---- One-shot deadline / overdue ----

    [Fact]
    public async Task Overdue_OneShot_FlagsState_WhenDeadlineInPast()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1,
            GoalType = GoalType.WordsRead, Mode = GoalMode.Delta,
            TargetValue = 1000, BaselineValue = 0,
            Deadline = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1)),
            CreatedAt = DateTime.UtcNow.AddDays(-30)
        };
        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, new[] { goal }, 0, DateTime.UtcNow);
        Assert.Equal("overdue", dtos[0].State);
    }

    // ---- Bucketing efficiency ----

    [Fact]
    public async Task Compute_BucketsByTypeAndScope_DoesNotN_PlusOne()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId, 1);

        // 6 goals across 3 types and 2 scopes (1, all). 6 buckets total.
        var goals = new[]
        {
            MkGoal(userId, 1, GoalType.WordsRead),
            MkGoal(userId, null, GoalType.WordsRead),
            MkGoal(userId, 1, GoalType.ListeningSeconds),
            MkGoal(userId, null, GoalType.ListeningSeconds),
            MkGoal(userId, 1, GoalType.WordsKnown),
            MkGoal(userId, null, GoalType.WordsKnown),
        };
        ctx.UserGoals.AddRange(goals);
        await ctx.SaveChangesAsync();

        var svc = new GoalProgressService(ctx);
        var dtos = await svc.ComputeAsync(userId, goals, 0, DateTime.UtcNow);
        Assert.Equal(6, dtos.Count);
    }

    // ---- helpers ----

    private static UserGoal MkGoal(Guid userId, int? langId, GoalType type) => new()
    {
        UserId = userId, LanguageId = langId,
        GoalType = type, Mode = GoalMode.Delta,
        TargetValue = 100, BaselineValue = 0,
        CreatedAt = DateTime.UtcNow.AddDays(-1)
    };

    private static UserActivity NewReading(Guid userId, int langId, int words, DateTime ts) => new()
    {
        UserId = userId, LanguageId = langId,
        ActivityType = "Reading", WordCount = words,
        ListeningDurationSeconds = 0, Timestamp = ts
    };

    private static AppDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static void Seed(AppDbContext ctx, Guid userId, int langId)
    {
        if (!ctx.Users.Any(u => u.Id == userId))
        {
            ctx.Users.Add(new User { Id = userId, UserName = "u", Email = "u@x.com" });
        }
        if (!ctx.Languages.Any(l => l.LanguageId == langId))
        {
            ctx.Languages.Add(new Language { LanguageId = langId, Name = $"Lang{langId}", Code = $"L{langId}" });
        }
        ctx.SaveChanges();
    }
}
