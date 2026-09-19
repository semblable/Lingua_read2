using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
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
    /// SrsController, which uses the same initializer; a card converted that way while
    /// its batch is in flight fails the Stability concurrency check and is left as the
    /// controller wrote it (see <see cref="SaveSkippingConflictsAsync"/>).
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
            var skipped = new HashSet<int>();

            while (!cancellationToken.IsCancellationRequested)
            {
                using var scope = _serviceProvider.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                var cards = await db.SrsCardReviews
                    .Where(c => c.LastReviewedAt != null && (c.Stability == null || c.Difficulty == null)
                        && !failed.Contains(c.SrsCardReviewId) && !skipped.Contains(c.SrsCardReviewId))
                    .OrderBy(c => c.SrsCardReviewId)
                    .Take(BatchSize)
                    .ToListAsync(cancellationToken);
                if (cards.Count == 0) break;

                var userIds = cards.Select(c => c.UserId).Distinct().ToList();
                var settingsByUser = await db.UserSettings
                    .AsNoTracking()
                    .Where(s => userIds.Contains(s.UserId))
                    .ToDictionaryAsync(s => s.UserId, cancellationToken);

                // All the batch's logs in one query rather than one per card.
                var cardIds = cards.Select(c => c.SrsCardReviewId).ToList();
                var logsByCard = (await db.SrsReviewLogs
                        .Where(l => cardIds.Contains(l.SrsCardReviewId))
                        .ToListAsync(cancellationToken))
                    .ToLookup(l => l.SrsCardReviewId);

                foreach (var card in cards)
                {
                    try
                    {
                        // Historical reviews carry no time zone and the service doesn't know the
                        // user's, so this reschedules on UTC days. Near UTC that's harmless (the due
                        // query serves a Review card for its whole local day), but far from it a card
                        // can land a day early or late; its next review reschedules it on the user's day.
                        var options = SrsSchedulerSettings.FromUserSettings(
                            settingsByUser.GetValueOrDefault(card.UserId), tzOffsetMinutes: 0);
                        var scheduler = new SrsScheduler(options);

                        SrsMemoryStateInitializer.Ensure(card, logsByCard[card.SrsCardReviewId], scheduler.Algorithm);
                        card.Apply(scheduler.Reschedule(card.ToSnapshot()));
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        failed.Add(card.SrsCardReviewId);
                        Revert(db, card, logsByCard);
                        _logger.LogError(ex, "SrsFsrsBackfillService: failed to convert SrsCardReviewId={CardId}", card.SrsCardReviewId);
                    }
                }

                skipped.UnionWith(await SaveSkippingConflictsAsync(db, logsByCard, cancellationToken));
                converted += cards.Count(c => !failed.Contains(c.SrsCardReviewId) && !skipped.Contains(c.SrsCardReviewId));
            }

            if (converted > 0 || failed.Count > 0 || skipped.Count > 0)
            {
                _logger.LogInformation(
                    "SrsFsrsBackfillService: moved {Converted} cards onto FSRS ({Failed} failed, {Skipped} reviewed meanwhile).",
                    converted, failed.Count, skipped.Count);
            }
            return converted;
        }

        /// <summary>
        /// Saves the batch. A card reviewed since the batch was read was converted and
        /// rescheduled by SrsController, so its row fails the Stability concurrency check
        /// (it is no longer null), and a log that review's undo deleted fails its update;
        /// either way the card is dropped from the batch (the controller's version, which
        /// includes the review, stands) and the rest saved. Returns the ids of the cards dropped.
        /// </summary>
        internal static async Task<HashSet<int>> SaveSkippingConflictsAsync(
            AppDbContext db, ILookup<int, SrsReviewLog> logsByCard, CancellationToken cancellationToken)
        {
            var skipped = new HashSet<int>();
            while (true)
            {
                try
                {
                    await db.SaveChangesAsync(cancellationToken);
                    return skipped;
                }
                catch (DbUpdateConcurrencyException ex)
                {
                    var cardIds = ex.Entries
                        .Select(e => e.Entity switch
                        {
                            SrsCardReview card => card.SrsCardReviewId,
                            SrsReviewLog log => log.SrsCardReviewId,
                            _ => (int?)null,
                        })
                        .OfType<int>()
                        .Distinct()
                        .Where(id => !skipped.Contains(id))
                        .ToList();
                    // Nothing new to drop (another entity, or a dropped card failing again): no progress.
                    if (cardIds.Count == 0) throw;
                    foreach (var cardId in cardIds)
                    {
                        skipped.Add(cardId);
                        if (db.SrsCardReviews.Local.FirstOrDefault(c => c.SrsCardReviewId == cardId) is { } card)
                            Revert(db, card, logsByCard);
                    }
                }
            }
        }

        /// <summary>Drops this run's changes to <paramref name="card"/> and to the logs it replayed.</summary>
        private static void Revert(AppDbContext db, SrsCardReview card, ILookup<int, SrsReviewLog> logsByCard)
        {
            RevertEntry(db.Entry(card));
            foreach (var log in logsByCard[card.SrsCardReviewId])
                RevertEntry(db.Entry(log));
        }

        // Puts the loaded values back too, so the next SaveChanges' change detection
        // doesn't find the edits again.
        private static void RevertEntry(EntityEntry entry)
        {
            entry.CurrentValues.SetValues(entry.OriginalValues);
            entry.State = EntityState.Unchanged;
        }
    }
}
