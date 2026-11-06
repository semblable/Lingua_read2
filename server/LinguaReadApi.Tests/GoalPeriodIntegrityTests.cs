using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Data.Migrations;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Xunit;

namespace LinguaReadApi.Tests;

public class GoalPeriodIntegrityTests
{
    [Fact]
    public void PostgreSqlMigration_MatchesModel_AndIncludesCleanupBeforeUniqueIndex()
    {
        using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=unused;Username=unused;Password=unused").Options);
        Assert.False(context.Database.HasPendingModelChanges());
        var script = context.GetService<IMigrator>().GenerateScript("20261105122010_FractionalLessonStudyPasses", "20261105200000_UniqueGoalPeriods");
        Assert.True(script.IndexOf("DELETE FROM", StringComparison.Ordinal) < script.IndexOf("CREATE UNIQUE INDEX", StringComparison.Ordinal));
        Assert.Contains("ROW_NUMBER()", script);
    }
    [Fact]
    public async Task ConcurrentGoalReads_CloseEachPeriodOnce()
    {
        var path = Path.Combine(Path.GetTempPath(), $"lingua-goals-{Guid.NewGuid():N}.db");
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite($"Data Source={path};Pooling=False").Options;
        var user = Guid.NewGuid();
        try
        {
            await using (var seed = new AppDbContext(options))
            {
                await seed.Database.EnsureCreatedAsync();
                await Seed(seed, user);
            }
            async Task Read(bool single)
            {
                await using var context = new AppDbContext(options);
                var controller = new GoalsController(context, new GoalProgressService(context)) {
                    ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext {
                        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user.ToString())], "test")) } }
                };
                if (single) Assert.IsType<OkObjectResult>((await controller.GetGoal(1)).Result);
                else Assert.IsType<OkObjectResult>((await controller.GetGoals()).Result);
            }
            await Task.WhenAll(Task.Run(() => Read(false)), Task.Run(() => Read(true)));
            await using var verify = new AppDbContext(options);
            Assert.Single(await verify.UserGoalPeriods.ToListAsync());
            var goal = await verify.UserGoals.SingleAsync();
            Assert.Equal(GoalProgressService.PeriodStartContaining(DateOnly.FromDateTime(DateTime.UtcNow), GoalRecurrence.Weekly), goal.CurrentPeriodStart);
        }
        finally { if (File.Exists(path)) File.Delete(path); }
    }

    [Fact]
    public async Task Migration_DeduplicatesHistory_ThenEnforcesUniquePeriods()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        await Seed(context, Guid.NewGuid());
        await context.Database.ExecuteSqlRawAsync("DROP INDEX \"IX_UserGoalPeriods_GoalId_PeriodEnd\"");
        var end = new DateOnly(2026, 10, 25);
        var older = Period(end, 10, DateTime.UtcNow.AddMinutes(-1));
        var newer = Period(end, 20, DateTime.UtcNow);
        context.UserGoalPeriods.AddRange(older, newer);
        await context.SaveChangesAsync();
        // The upgrade must also work on databases which already contain duplicates.
        await context.Database.ExecuteSqlRawAsync("CREATE INDEX \"IX_UserGoalPeriods_GoalId_PeriodEnd\" ON \"UserGoalPeriods\" (\"GoalId\", \"PeriodEnd\")");
        var migration = new UniqueGoalPeriods();
        var commands = context.GetService<IMigrationsSqlGenerator>().Generate(migration.UpOperations, context.Model);
        foreach (var command in commands) await context.Database.ExecuteSqlRawAsync(command.CommandText);
        context.ChangeTracker.Clear();
        Assert.Equal(20, (await context.UserGoalPeriods.SingleAsync()).FinalProgress);
        context.UserGoalPeriods.Add(Period(end, 30, DateTime.UtcNow));
        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
    }

    private static UserGoalPeriod Period(DateOnly end, long progress, DateTime closed) => new() {
        GoalId = 1, PeriodStart = end.AddDays(-6), PeriodEnd = end, FinalProgress = progress,
        TargetAtTime = 100, ClosedAt = closed
    };

    private static async Task Seed(AppDbContext context, Guid user)
    {
        context.Users.Add(new User { Id = user, UserName = "goal-test" });
        var monday = GoalProgressService.PeriodStartContaining(DateOnly.FromDateTime(DateTime.UtcNow), GoalRecurrence.Weekly);
        context.UserGoals.Add(new UserGoal { GoalId = 1, UserId = user, GoalType = GoalType.WordsRead,
            Mode = GoalMode.Delta, Recurrence = GoalRecurrence.Weekly, TargetValue = 100,
            CreatedAt = DateTime.UtcNow.AddDays(-14), CurrentPeriodStart = monday.AddDays(-7), CurrentPeriodBaseline = 0 });
        await context.SaveChangesAsync();
    }
}
