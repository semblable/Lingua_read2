using System;
using System.Collections.Generic;
using System.Linq;
using LinguaReadApi.Utilities;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>
    /// Policy for which untouched new cards enter study first and how daily new/review
    /// budgets interact (mirroring Anki's gather order and "New cards ignore review limit").
    /// </summary>
    public static class SrsQueuePolicy
    {
        /// <summary>
        /// Texts opened or words explicitly saved within this window belong to the learner's
        /// active reading bucket under <see cref="NewCardOrder.RecentFrequent"/>.
        /// </summary>
        public const int RecentWindowDays = 30;

        public static class NewCardOrder
        {
            public const string RecentFrequent = "recent_frequent";
            public const string Frequent = "frequent";
            public const string Newest = "newest";
            public const string Oldest = "oldest";
        }

        public readonly record struct NewCardCandidate(
            int CardId,
            int WordId,
            DateTime CreatedAt,
            DateTime? WordLastManualStatusAt,
            int Occurrences,
            DateTime? LastTextAccessedAt);

        public static bool IsNewCardOrder(string? value) =>
            value is NewCardOrder.RecentFrequent
                or NewCardOrder.Frequent
                or NewCardOrder.Newest
                or NewCardOrder.Oldest;

        public static string NormalizeNewCardOrder(string? value)
        {
            var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
            return IsNewCardOrder(normalized) ? normalized : NewCardOrder.RecentFrequent;
        }

        /// <summary>
        /// Daily new-card cap. 0 is valid and pauses new introductions; null (no settings row)
        /// or negative values fall back to the default cap.
        /// </summary>
        public static int EffectiveMaxNew(int? stored) =>
            stored is >= 0 ? stored.Value : SrsSchedulerSettings.DefaultMaxNewCards;

        /// <summary>Daily review cap; non-positive or missing values fall back to the default cap.</summary>
        public static int EffectiveMaxReviews(int? stored) =>
            stored is > 0 ? stored.Value : SrsSchedulerSettings.DefaultMaxReviews;

        public static int RemainingReviews(int maxReviews, int studiedReviews) =>
            Math.Max(0, maxReviews - Math.Max(0, studiedReviews));

        public static int RemainingNewByNewCap(int maxNew, int studiedNew) =>
            Math.Max(0, maxNew - Math.Max(0, studiedNew));

        /// <summary>
        /// Remaining new cards allowed today. When <paramref name="ignoreReviewLimit"/> is false
        /// (Anki's default), due reviews have first claim on <paramref name="maxReviews"/>:
        /// studied reviews + due reviews + studied new cards consume the daily review budget,
        /// and only leftover room can go to new cards.
        /// </summary>
        public static int RemainingNew(
            int maxNew,
            int maxReviews,
            int studiedNew,
            int studiedReviews,
            int dueReviewCount,
            bool ignoreReviewLimit)
        {
            int byNewCap = RemainingNewByNewCap(maxNew, studiedNew);
            if (byNewCap == 0 || ignoreReviewLimit) return byNewCap;

            int reviewBudgetRoom = Math.Max(
                0,
                maxReviews - Math.Max(0, studiedReviews) - Math.Max(0, studiedNew) - Math.Max(0, dueReviewCount));
            return Math.Min(byNewCap, reviewBudgetRoom);
        }

        /// <summary>
        /// True when untouched new cards exist and the user's own new-card cap would allow more
        /// today, but the review-limit guardrail reduced today's new budget to zero.
        /// </summary>
        public static bool IsNewPausedByReviewLimit(
            int maxNew,
            int maxReviews,
            int studiedNew,
            int studiedReviews,
            int dueReviewCount,
            int dueNewCount,
            bool ignoreReviewLimit)
        {
            if (ignoreReviewLimit || dueNewCount <= 0) return false;
            if (RemainingNewByNewCap(maxNew, studiedNew) <= 0) return false;
            return RemainingNew(maxNew, maxReviews, studiedNew, studiedReviews, dueReviewCount, ignoreReviewLimit: false) == 0;
        }

        public static DateTime LastSeenAt(NewCardCandidate candidate)
        {
            var latest = SrsDay.AsUtc(candidate.CreatedAt);
            if (candidate.WordLastManualStatusAt is { } saved)
            {
                var savedUtc = SrsDay.AsUtc(saved);
                if (savedUtc > latest) latest = savedUtc;
            }
            if (candidate.LastTextAccessedAt is { } accessed)
            {
                var accessedUtc = SrsDay.AsUtc(accessed);
                if (accessedUtc > latest) latest = accessedUtc;
            }
            return latest;
        }

        /// <summary>
        /// Selects up to <paramref name="take"/> card IDs from <paramref name="candidates"/>
        /// according to <paramref name="order"/>.
        /// </summary>
        public static List<int> OrderNewCardIds(
            IEnumerable<NewCardCandidate> candidates,
            string? order,
            DateTime nowUtc,
            int take)
        {
            if (take <= 0) return new List<int>();

            var normalized = NormalizeNewCardOrder(order);
            var recentCutoff = SrsDay.AsUtc(nowUtc).AddDays(-RecentWindowDays);

            IOrderedEnumerable<NewCardCandidate> ordered = normalized switch
            {
                NewCardOrder.Frequent => candidates
                    .OrderByDescending(c => c.Occurrences)
                    .ThenByDescending(LastSeenAt)
                    .ThenByDescending(c => c.CardId),

                NewCardOrder.Newest => candidates
                    .OrderByDescending(LastSeenAt)
                    .ThenByDescending(c => Math.Max(1, c.Occurrences))
                    .ThenByDescending(c => c.CardId),

                NewCardOrder.Oldest => candidates
                    .OrderBy(c => SrsDay.AsUtc(c.CreatedAt))
                    .ThenBy(c => c.CardId),

                _ => candidates // RecentFrequent: floor saved cards without TextWords at 1 so recent phrases/story saves tie on recency
                    .OrderByDescending(c => LastSeenAt(c) >= recentCutoff)
                    .ThenByDescending(c => Math.Max(1, c.Occurrences))
                    .ThenByDescending(LastSeenAt)
                    .ThenByDescending(c => c.CardId),
            };

            return ordered.Take(take).Select(c => c.CardId).ToList();
        }
    }
}
