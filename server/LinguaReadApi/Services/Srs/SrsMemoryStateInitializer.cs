using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Utilities;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>
    /// Builds FSRS memory state (stability, difficulty, lapses) for cards reviewed under
    /// the old SM-2 scheduler by replaying their review logs, and fills in the log
    /// columns that SM-2 never wrote (kind, resulting interval, prior memory state).
    /// </summary>
    public static class SrsMemoryStateInitializer
    {
        /// <summary>
        /// Rough memory state for an SM-2 card with no usable history. With retention 0.9
        /// an FSRS interval equals stability, so the SM-2 interval stands in for it; ease
        /// maps linearly onto difficulty (2.5 -> 5, 1.3 -> 10+, 3.0 -> 2.5).
        /// </summary>
        public static (double Stability, double Difficulty) EstimateFromLegacy(int intervalDays, double easeFactor) =>
            (Math.Max(intervalDays, 1), Math.Clamp(5 + (2.5 - easeFactor) * 5, FsrsAlgorithm.DifficultyMin, FsrsAlgorithm.DifficultyMax));

        public sealed record ReplayResult(double Stability, double Difficulty, int Lapses, int Reviews);

        /// <summary>
        /// Replays <paramref name="logs"/> (any order; sorted here) through the FSRS memory
        /// model and fills each log's Kind, NewInterval, OldStability, OldDifficulty and
        /// OldLapses. <paramref name="currentInterval"/> is the card's interval now, which is
        /// what the newest log produced. Returns null when there are no logs.
        /// Elapsed days are counted between UTC calendar days: historical reviews carry no
        /// time zone, and the error is at most one day at a boundary.
        /// </summary>
        public static ReplayResult? Replay(IEnumerable<SrsReviewLog> logs, int currentInterval, FsrsAlgorithm fsrs)
        {
            var ordered = logs.OrderBy(l => l.ReviewedAt).ThenBy(l => l.SrsReviewLogId).ToList();
            if (ordered.Count == 0) return null;

            double? stability = null;
            double? difficulty = null;
            int lapses = 0;
            DateTime? previous = null;

            for (int i = 0; i < ordered.Count; i++)
            {
                var log = ordered[i];
                var before = SrsCardStates.Derive(log.OldIsLearning, log.OldHasEverGraduated, log.OldLastReviewedAt);
                var rating = FsrsAlgorithm.RatingFromGrade(Math.Clamp(log.Grade, 0, 3));

                if (log.Kind != (int)SrsReviewKind.Reading)
                {
                    log.Kind = (int)(before switch
                    {
                        SrsCardState.Review => SrsReviewKind.Review,
                        SrsCardState.Relearning => SrsReviewKind.Relearn,
                        _ => SrsReviewKind.Learn,
                    });
                }
                log.OldStability = stability;
                log.OldDifficulty = difficulty;
                log.OldLapses = lapses;
                log.NewInterval = i + 1 < ordered.Count ? ordered[i + 1].OldInterval : currentInterval;

                if (stability is not { } s || difficulty is not { } d)
                {
                    stability = fsrs.InitialStability(rating);
                    difficulty = fsrs.InitialDifficulty(rating);
                }
                else
                {
                    var last = previous ?? log.OldLastReviewedAt ?? log.ReviewedAt;
                    var elapsed = Math.Max(0, SrsDay.DaysBetween(last, log.ReviewedAt, 0, 0));
                    stability = elapsed < 1
                        ? fsrs.ShortTermStability(s, rating)
                        : fsrs.NextStability(d, s, fsrs.Retrievability(elapsed, s), rating);
                    difficulty = fsrs.NextDifficulty(d, rating);
                }

                // Under FSRS only Again forgets a graduated card. (SM-2 also lapsed on Hard.)
                if (before == SrsCardState.Review && rating == FsrsRating.Again)
                    lapses++;

                previous = log.ReviewedAt;
            }

            return new ReplayResult(stability!.Value, difficulty!.Value, lapses, ordered.Count);
        }

        /// <summary>
        /// Gives <paramref name="card"/> FSRS memory state if it has been reviewed but has
        /// none yet: replays its tracked logs, or estimates from the SM-2 fields when it has
        /// no logs. Does not save. Returns true if anything changed.
        /// </summary>
        public static async Task<bool> EnsureAsync(
            AppDbContext db, SrsCardReview card, FsrsAlgorithm fsrs, CancellationToken cancellationToken = default)
        {
            if (card.LastReviewedAt == null || (card.Stability != null && card.Difficulty != null))
                return false;

            var logs = await db.SrsReviewLogs
                .Where(l => l.SrsCardReviewId == card.SrsCardReviewId)
                .ToListAsync(cancellationToken);

            var replay = Replay(logs, card.Interval, fsrs);
            if (replay != null)
            {
                card.Stability = replay.Stability;
                card.Difficulty = replay.Difficulty;
                card.Lapses = replay.Lapses;
                card.Repetitions = replay.Reviews;
            }
            else
            {
                (var stability, var difficulty) = EstimateFromLegacy(card.Interval, card.EaseFactor);
                card.Stability = stability;
                card.Difficulty = difficulty;
            }
            return true;
        }
    }
}
