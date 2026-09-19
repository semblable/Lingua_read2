using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Srs;
using LinguaReadApi.Utilities;
using Microsoft.Data.Sqlite;
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
    public void Sm2LapseOfACardThatSkippedTheLearningSteps_IsRelearning()
    {
        // SM-2 sent a new card straight to review without setting HasEverGraduated (only
        // leaving the learning steps did), so after a lapse it looked like a learning card.
        var logs = new List<SrsReviewLog>
        {
            new() { SrsReviewLogId = 1, Grade = 2, ReviewedAt = Start },
            new() { SrsReviewLogId = 2, Grade = 0, ReviewedAt = Start.AddDays(6), OldInterval = 1, OldLastReviewedAt = Start },
            new() { SrsReviewLogId = 3, Grade = 2, ReviewedAt = Start.AddDays(6).AddMinutes(10),
                    OldIsLearning = true, OldLastReviewedAt = Start.AddDays(6) },
        };
        var card = new SrsCardReview
        {
            IsLearning = true, HasEverGraduated = false, CurrentLearningStepIndex = 1,
            LastReviewedAt = logs[^1].ReviewedAt, NextReviewAt = logs[^1].ReviewedAt.AddMinutes(10),
        };

        Assert.True(SrsMemoryStateInitializer.Ensure(card, logs, new FsrsAlgorithm()));

        Assert.True(card.HasEverGraduated);
        Assert.Equal(SrsCardState.Relearning, card.GetState());
        Assert.Equal(1, card.Lapses);
        Assert.Equal(new[] { SrsReviewKind.Learn, SrsReviewKind.Review, SrsReviewKind.Relearn },
            logs.Select(l => (SrsReviewKind)l.Kind));
    }

    [Fact]
    public void GenuineLearningCard_StaysLearning()
    {
        var (logs, _) = History((0, TimeSpan.Zero), (2, TimeSpan.FromMinutes(1)));
        var card = new SrsCardReview { IsLearning = true, LastReviewedAt = logs[^1].ReviewedAt };

        SrsMemoryStateInitializer.Ensure(card, logs, new FsrsAlgorithm());

        Assert.False(card.HasEverGraduated);
        Assert.Equal(SrsCardState.Learning, card.GetState());
    }

    /// <summary>
    /// A SQLite database with two SM-2-era cards, 7 and 8, each with a short review history.
    /// SQLite, not InMemory: a failed save must roll back as it does on PostgreSQL, whereas
    /// InMemory keeps whatever it applied before the failing row.
    /// </summary>
    private static async Task<(DbContextOptions<AppDbContext> Options, SqliteConnection KeepAlive)> LegacyCardsDatabase()
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = $"SrsBackfill{Guid.NewGuid():N}",
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared,
        }.ToString();
        var keepAlive = new SqliteConnection(connectionString);
        await keepAlive.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connectionString).Options;

        await using var seed = new AppDbContext(options);
        await seed.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        seed.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        seed.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        foreach (var cardId in new[] { 7, 8 })
        {
            seed.Words.Add(new Word { WordId = cardId, UserId = userId, LanguageId = 1, Term = $"word{cardId}", Status = 2 });
            var (logs, final) = History((2, TimeSpan.Zero), (2, TimeSpan.FromMinutes(10)), (2, TimeSpan.FromDays(3)));
            foreach (var log in logs)
            {
                log.SrsReviewLogId += cardId * 10;
                log.UserId = userId;
                log.SrsCardReviewId = cardId;
            }
            seed.SrsCardReviews.Add(new SrsCardReview
            {
                SrsCardReviewId = cardId, WordId = cardId, UserId = userId, HasEverGraduated = true,
                Interval = final.IntervalDays, Repetitions = 2, LastReviewedAt = logs[^1].ReviewedAt, NextReviewAt = final.DueUtc,
            });
            seed.SrsReviewLogs.AddRange(logs);
        }
        await seed.SaveChangesAsync();
        return (options, keepAlive);
    }

    /// <summary>Loads and converts every legacy card the way SrsFsrsBackfillService does, without saving.</summary>
    private static ILookup<int, SrsReviewLog> ConvertBatch(AppDbContext backfill)
    {
        var cards = backfill.SrsCardReviews.ToList();
        var logsByCard = backfill.SrsReviewLogs.ToList().ToLookup(l => l.SrsCardReviewId);
        foreach (var card in cards)
            SrsMemoryStateInitializer.Ensure(card, logsByCard[card.SrsCardReviewId], new FsrsAlgorithm());
        return logsByCard;
    }

    [Fact]
    public async Task Backfill_KeepsACardTheControllerConvertedMeanwhile()
    {
        var (options, keepAlive) = await LegacyCardsDatabase();
        await using var _ = keepAlive;

        // The backfill reads and converts its batch...
        await using var backfill = new AppDbContext(options);
        var logsByCard = ConvertBatch(backfill);

        // ...while the user reviews card 7, which SrsController converts and saves first.
        await using (var controller = new AppDbContext(options))
        {
            var reviewed = controller.SrsCardReviews.Single(c => c.SrsCardReviewId == 7);
            reviewed.Stability = 42;
            reviewed.Difficulty = 3;
            reviewed.Repetitions = 4;
            await controller.SaveChangesAsync();
        }

        var skipped = await SrsFsrsBackfillService.SaveSkippingConflictsAsync(backfill, logsByCard, CancellationToken.None);

        Assert.Equal(new[] { 7 }, skipped);
        await using var check = new AppDbContext(options);
        var kept = check.SrsCardReviews.Single(c => c.SrsCardReviewId == 7);
        Assert.Equal(42, kept.Stability);
        Assert.Equal(4, kept.Repetitions);
        Assert.NotNull(check.SrsCardReviews.Single(c => c.SrsCardReviewId == 8).Stability);
    }

    [Fact]
    public async Task Backfill_DropsACardWhoseReplayedLogWasDeletedMeanwhile()
    {
        var (options, keepAlive) = await LegacyCardsDatabase();
        await using var _ = keepAlive;

        await using var backfill = new AppDbContext(options);
        var logsByCard = ConvertBatch(backfill);

        // One of card 7's logs disappears (an undo) before the batch is saved.
        await using (var other = new AppDbContext(options))
        {
            other.SrsReviewLogs.Remove(other.SrsReviewLogs.First(l => l.SrsCardReviewId == 7));
            await other.SaveChangesAsync();
        }

        var skipped = await SrsFsrsBackfillService.SaveSkippingConflictsAsync(backfill, logsByCard, CancellationToken.None);

        Assert.Equal(new[] { 7 }, skipped);
        await using var check = new AppDbContext(options);
        Assert.Null(check.SrsCardReviews.Single(c => c.SrsCardReviewId == 7).Stability); // left for a later run
        Assert.NotNull(check.SrsCardReviews.Single(c => c.SrsCardReviewId == 8).Stability);
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
