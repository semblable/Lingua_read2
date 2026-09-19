using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Srs;
using LinguaReadApi.Utilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class SrsBackfillTests
{
    private static readonly DateTime Start = new(2026, 1, 5, 9, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// Reviews a card with the scheduler and records SM-2-style logs of each review, i.e.
    /// only the "Old*" columns SM-2 wrote. Returns the logs and the final card.
    /// </summary>
    private static (List<SrsReviewLog> Logs, SrsCardSnapshot Final) History(params (int Grade, TimeSpan After)[] reviews)
    {
        var scheduler = new SrsScheduler(new SrsSchedulerOptions { TimezoneOffsetMinutes = 0, DayStartHour = 0, EnableFuzz = false });
        var card = new SrsCardSnapshot();
        var at = Start;
        var logs = new List<SrsReviewLog>();
        int id = 1;
        foreach (var (grade, after) in reviews)
        {
            at += after;
            logs.Add(new SrsReviewLog
            {
                SrsReviewLogId = id++,
                Grade = grade,
                ReviewedAt = at,
                OldInterval = card.IntervalDays,
                OldIsLearning = SrsCardStates.IsLearningColumn(card.State),
                OldHasEverGraduated = SrsCardStates.HasEverGraduatedColumn(card.State),
                OldLastReviewedAt = card.LastReviewedAtUtc,
                OldCurrentLearningStepIndex = card.Step,
            });
            card = scheduler.Review(card, grade, at).Card;
        }
        return (logs, card);
    }

    [Fact]
    public void Replay_ReproducesTheSchedulersMemoryState()
    {
        var (logs, final) = History(
            (2, TimeSpan.Zero), (2, TimeSpan.FromMinutes(10)), (2, TimeSpan.FromDays(3)),
            (0, TimeSpan.FromDays(9)), (2, TimeSpan.FromMinutes(10)), (1, TimeSpan.FromDays(2)), (3, TimeSpan.FromDays(6)));

        // Shuffled input: replay must sort by review time itself.
        var replay = SrsMemoryStateInitializer.Replay(logs.AsEnumerable().Reverse(), final.IntervalDays, new FsrsAlgorithm());

        Assert.NotNull(replay);
        Assert.Equal(final.Stability!.Value, replay!.Stability, 12);
        Assert.Equal(final.Difficulty!.Value, replay.Difficulty, 12);
        Assert.Equal(1, replay.Lapses);
        Assert.Equal(7, replay.Reviews);
    }

    [Fact]
    public void Replay_FillsTheLogColumnsSm2NeverWrote()
    {
        var (logs, final) = History((2, TimeSpan.Zero), (2, TimeSpan.FromMinutes(10)), (0, TimeSpan.FromDays(3)), (2, TimeSpan.FromMinutes(10)));

        SrsMemoryStateInitializer.Replay(logs, final.IntervalDays, new FsrsAlgorithm());

        Assert.Equal(
            new[] { SrsReviewKind.Learn, SrsReviewKind.Learn, SrsReviewKind.Review, SrsReviewKind.Relearn },
            logs.Select(l => (SrsReviewKind)l.Kind).ToArray());
        Assert.Null(logs[0].OldStability);
        Assert.All(logs.Skip(1), l => Assert.NotNull(l.OldStability));
        Assert.Equal(new[] { 0, 0, 0, 1 }, logs.Select(l => l.OldLapses).ToArray());
        Assert.Equal(logs[1].OldInterval, logs[0].NewInterval);
        Assert.Equal(final.IntervalDays, logs[^1].NewInterval);
    }

    [Fact]
    public void Replay_WithNoLogs_ReturnsNull_AndTheEstimateIsSane()
    {
        Assert.Null(SrsMemoryStateInitializer.Replay(Array.Empty<SrsReviewLog>(), 5, new FsrsAlgorithm()));

        Assert.Equal((12.0, 5.0), SrsMemoryStateInitializer.EstimateWithoutHistory(12));
        Assert.Equal((1.0, 5.0), SrsMemoryStateInitializer.EstimateWithoutHistory(0));
    }

    [Fact]
    public async Task BackfillService_ConvertsAndReschedulesLegacyCards_Once()
    {
        var services = new ServiceCollection();
        var dbName = Guid.NewGuid().ToString();
        services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase(dbName));
        using var provider = services.BuildServiceProvider();

        var userId = Guid.NewGuid();
        var (logs, _) = History((2, TimeSpan.Zero), (2, TimeSpan.FromMinutes(10)), (2, TimeSpan.FromDays(3)));
        using (var scope = provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.UserSettings.Add(new UserSettings { UserId = userId });
            var legacy = new SrsCardReview
            {
                SrsCardReviewId = 7, WordId = 1, UserId = userId, HasEverGraduated = true,
                Interval = 6, Repetitions = 2, LastReviewedAt = logs[^1].ReviewedAt,
                NextReviewAt = logs[^1].ReviewedAt.AddDays(6).AddHours(5),
            };
            var untouchedNew = new SrsCardReview { SrsCardReviewId = 8, WordId = 2, UserId = userId, NextReviewAt = Start };
            db.SrsCardReviews.AddRange(legacy, untouchedNew);
            foreach (var log in logs)
            {
                log.UserId = userId;
                log.SrsCardReviewId = 7;
            }
            db.SrsReviewLogs.AddRange(logs);
            db.SaveChanges();
        }

        var service = new SrsFsrsBackfillService(provider, NullLogger<SrsFsrsBackfillService>.Instance);
        Assert.Equal(1, await service.RunAsync(CancellationToken.None));
        Assert.Equal(0, await service.RunAsync(CancellationToken.None));

        using (var scope = provider.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var card = db.SrsCardReviews.AsNoTracking().Single(c => c.SrsCardReviewId == 7);
            Assert.NotNull(card.Stability);
            Assert.NotNull(card.Difficulty);
            Assert.Equal(3, card.Repetitions);
            var lastDay = SrsDay.UserDay(card.LastReviewedAt!.Value, 0, SrsDay.DefaultDayStartHour);
            Assert.Equal(SrsDay.DayStartUtc(lastDay.AddDays(card.Interval), 0, SrsDay.DefaultDayStartHour), card.NextReviewAt);
            Assert.All(db.SrsReviewLogs.AsNoTracking(), l => Assert.NotNull(l.NewInterval));

            var fresh = db.SrsCardReviews.AsNoTracking().Single(c => c.SrsCardReviewId == 8);
            Assert.Null(fresh.Stability);
            Assert.Equal(Start, fresh.NextReviewAt);
        }
    }
}
