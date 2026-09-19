using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>
    /// One-time move of SM-2-era cards onto FSRS, run in the background at startup.
    /// For every reviewed card without FSRS memory state it replays the review history
    /// (<see cref="SrsMemoryStateInitializer"/>) and then reschedules Review cards with
    /// the owner's FSRS settings. Idempotent: converted cards have Stability set and
    /// are skipped on later starts, so after the first run this is a single empty query.
    /// Cards reviewed before the service reaches them are converted on the spot by
    /// SrsController, which uses the same initializer.
    /// </summary>
    public class SrsFsrsBackfillService : BackgroundService
    {
        private const int BatchSize = 100;
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(20);

        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<SrsFsrsBackfillService> _logger;

        public SrsFsrsBackfillService(IServiceProvider serviceProvider, ILogger<SrsFsrsBackfillService> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try
            {
                await Task.Delay(StartupDelay, stoppingToken);
                await RunAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Shutting down; the next start resumes where this one stopped.
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SrsFsrsBackfillService aborted unexpectedly.");
            }
        }

        public async Task<int> RunAsync(CancellationToken cancellationToken)
        {
            int converted = 0;
            var failed = new HashSet<int>();

            while (!cancellationToken.IsCancellationRequested)
            {
                using var scope = _serviceProvider.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                var cards = await db.SrsCardReviews
                    .Where(c => c.LastReviewedAt != null && (c.Stability == null || c.Difficulty == null)
                        && !failed.Contains(c.SrsCardReviewId))
                    .OrderBy(c => c.SrsCardReviewId)
                    .Take(BatchSize)
                    .ToListAsync(cancellationToken);
                if (cards.Count == 0) break;

                var userIds = cards.Select(c => c.UserId).Distinct().ToList();
                var settingsByUser = await db.UserSettings
                    .AsNoTracking()
                    .Where(s => userIds.Contains(s.UserId))
                    .ToDictionaryAsync(s => s.UserId, cancellationToken);

                foreach (var card in cards)
                {
                    try
                    {
                        // Historical reviews carry no time zone, so reschedule on UTC days. The
                        // due query counts a Review card as due for the whole of its local day,
                        // so a few hours' difference in the stored due time never shows.
                        var options = SrsSchedulerSettings.FromUserSettings(
                            settingsByUser.GetValueOrDefault(card.UserId), tzOffsetMinutes: 0);
                        var scheduler = new SrsScheduler(options);

                        await SrsMemoryStateInitializer.EnsureAsync(db, card, scheduler.Algorithm, cancellationToken);
                        card.Apply(scheduler.Reschedule(card.ToSnapshot()));
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        failed.Add(card.SrsCardReviewId);
                        db.Entry(card).State = EntityState.Unchanged;
                        _logger.LogError(ex, "SrsFsrsBackfillService: failed to convert SrsCardReviewId={CardId}", card.SrsCardReviewId);
                    }
                }

                await db.SaveChangesAsync(cancellationToken);
                converted += cards.Count(c => !failed.Contains(c.SrsCardReviewId));
            }

            if (converted > 0 || failed.Count > 0)
            {
                _logger.LogInformation(
                    "SrsFsrsBackfillService: moved {Converted} cards onto FSRS ({Failed} failed).",
                    converted, failed.Count);
            }
            return converted;
        }
    }
}
