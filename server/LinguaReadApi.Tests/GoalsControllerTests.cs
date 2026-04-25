using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

public class GoalsControllerTests
{
    [Fact]
    public async Task CreateGoal_SnapshotsBaseline_FromCurrentMetric()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);

        // Existing 700 words read
        ctx.UserActivities.Add(new UserActivity
        {
            UserId = userId, LanguageId = 1, ActivityType = "Reading",
            WordCount = 700, Timestamp = DateTime.UtcNow.AddDays(-2)
        });
        await ctx.SaveChangesAsync();

        var controller = NewController(ctx, userId);

        var result = await controller.CreateGoal(new CreateGoalDto
        {
            LanguageId = 1,
            GoalType = GoalType.WordsRead,
            Mode = GoalMode.Delta,
            Recurrence = GoalRecurrence.None,
            TargetValue = 1_000
        }, timezoneOffsetMinutes: 0);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var dto = Assert.IsType<GoalProgressDto>(created.Value);
        Assert.Equal(1_000, dto.TargetValue);
        var goal = await ctx.UserGoals.SingleAsync();
        Assert.Equal(700, goal.BaselineValue);
    }

    [Fact]
    public async Task CreateGoal_RejectsMilestonePlusRecurring()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);
        var controller = NewController(ctx, userId);

        var result = await controller.CreateGoal(new CreateGoalDto
        {
            LanguageId = 1,
            GoalType = GoalType.WordsKnown,
            Mode = GoalMode.Milestone,
            Recurrence = GoalRecurrence.Weekly,
            TargetValue = 5_000
        }, timezoneOffsetMinutes: 0);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateGoal_RejectsRecurringWithDeadline()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);
        var controller = NewController(ctx, userId);

        var result = await controller.CreateGoal(new CreateGoalDto
        {
            LanguageId = 1,
            GoalType = GoalType.WordsRead,
            Mode = GoalMode.Delta,
            Recurrence = GoalRecurrence.Weekly,
            TargetValue = 1_000,
            Deadline = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(7))
        }, timezoneOffsetMinutes: 0);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateGoal_RejectsZeroTarget()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);
        var controller = NewController(ctx, userId);

        var result = await controller.CreateGoal(new CreateGoalDto
        {
            LanguageId = 1, GoalType = GoalType.WordsRead, TargetValue = 0
        }, timezoneOffsetMinutes: 0);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task CreateGoal_RejectsPastDeadline()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);
        var controller = NewController(ctx, userId);

        var result = await controller.CreateGoal(new CreateGoalDto
        {
            LanguageId = 1, GoalType = GoalType.WordsRead, TargetValue = 100,
            Deadline = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-1))
        }, timezoneOffsetMinutes: 0);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task UpdateGoal_RejectsCadenceChange()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);
        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1, GoalType = GoalType.WordsRead,
            Mode = GoalMode.Delta, Recurrence = GoalRecurrence.Weekly,
            TargetValue = 1000, BaselineValue = 0,
            CurrentPeriodStart = DateOnly.FromDateTime(DateTime.UtcNow),
            CurrentPeriodBaseline = 0,
            CreatedAt = DateTime.UtcNow
        };
        ctx.UserGoals.Add(goal);
        await ctx.SaveChangesAsync();

        var controller = NewController(ctx, userId);
        var result = await controller.UpdateGoal(goal.GoalId, new UpdateGoalDto
        {
            Recurrence = GoalRecurrence.Monthly
        }, 0);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task UpdateGoal_LoweringTargetBelowProgress_FlipsToCompleted()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);
        ctx.UserActivities.Add(new UserActivity
        {
            UserId = userId, LanguageId = 1, ActivityType = "Reading", WordCount = 500, Timestamp = DateTime.UtcNow
        });
        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1, GoalType = GoalType.WordsRead,
            Mode = GoalMode.Delta, TargetValue = 1000, BaselineValue = 0,
            CreatedAt = DateTime.UtcNow.AddHours(-2)
        };
        ctx.UserGoals.Add(goal);
        await ctx.SaveChangesAsync();

        var controller = NewController(ctx, userId);
        var result = await controller.UpdateGoal(goal.GoalId, new UpdateGoalDto
        {
            TargetValue = 400
        }, 0);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<GoalProgressDto>(ok.Value);
        Assert.Equal("completed", dto.State);
        var refreshed = await ctx.UserGoals.SingleAsync();
        Assert.NotNull(refreshed.CompletedAt);
    }

    [Fact]
    public async Task ArchiveAndRestore_RoundTripsState()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);
        var goal = new UserGoal
        {
            UserId = userId, LanguageId = 1, GoalType = GoalType.WordsRead, Mode = GoalMode.Delta,
            TargetValue = 100, BaselineValue = 0, CreatedAt = DateTime.UtcNow
        };
        ctx.UserGoals.Add(goal);
        await ctx.SaveChangesAsync();

        var controller = NewController(ctx, userId);
        Assert.IsType<NoContentResult>(await controller.ArchiveGoal(goal.GoalId));
        var refreshed = await ctx.UserGoals.SingleAsync();
        Assert.NotNull(refreshed.ArchivedAt);

        Assert.IsType<NoContentResult>(await controller.RestoreGoal(goal.GoalId));
        refreshed = await ctx.UserGoals.SingleAsync();
        Assert.Null(refreshed.ArchivedAt);
    }

    [Fact]
    public async Task GetGoal_ReturnsNotFound_ForOtherUsersGoal()
    {
        await using var ctx = NewContext();
        var ownerId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        Seed(ctx, ownerId);
        Seed(ctx, otherId);
        var goal = new UserGoal
        {
            UserId = ownerId, LanguageId = 1, GoalType = GoalType.WordsRead, Mode = GoalMode.Delta,
            TargetValue = 100, BaselineValue = 0, CreatedAt = DateTime.UtcNow
        };
        ctx.UserGoals.Add(goal);
        await ctx.SaveChangesAsync();

        var controller = NewController(ctx, otherId);
        var result = await controller.GetGoal(goal.GoalId);
        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetSuggestion_FallsBackForBrandNewUser()
    {
        await using var ctx = NewContext();
        var userId = Guid.NewGuid();
        Seed(ctx, userId);
        var controller = NewController(ctx, userId);

        var result = await controller.GetSuggestion(GoalType.WordsRead, languageId: 1);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<GoalSuggestionDto>(ok.Value);
        Assert.True(dto.SuggestedTarget > 0);
    }

    // helpers
    private static GoalsController NewController(AppDbContext ctx, Guid userId)
    {
        var svc = new GoalProgressService(ctx);
        var c = new GoalsController(ctx, svc)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "Test"))
                }
            }
        };
        return c;
    }

    private static AppDbContext NewContext()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    private static void Seed(AppDbContext ctx, Guid userId)
    {
        if (!ctx.Users.Any(u => u.Id == userId))
            ctx.Users.Add(new User { Id = userId, UserName = "u", Email = $"{userId}@x.com" });
        if (!ctx.Languages.Any(l => l.LanguageId == 1))
            ctx.Languages.Add(new Language { LanguageId = 1, Name = "L1", Code = "L1" });
        ctx.SaveChanges();
    }
}
