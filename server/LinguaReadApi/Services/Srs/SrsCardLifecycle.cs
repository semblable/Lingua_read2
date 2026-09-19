using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>
    /// Keeps SRS cards and the reader's word statuses (0 unseen, 1-4 learning, 5 Known,
    /// 6 Ignored) consistent, in both directions and per the user's settings:
    /// <list type="bullet">
    /// <item>Status -> card: saving a word may create its card; Ignored always suspends it;
    /// Known suspends it or not (<see cref="UserSettings.SrsKnownCardAction"/>); leaving
    /// Known/Ignored lifts only the suspension that status caused, never a manual one.</item>
    /// <item>Review -> status: as a card's memory strengthens the word's status rises
    /// (<see cref="UserSettings.SrsStatusSyncMode"/>), up to Known if auto-Known is on; in
    /// promote_demote mode forgetting a card lowers it again.</item>
    /// </list>
    /// </summary>
    public static class SrsCardLifecycle
    {
        public const int StatusUnseen = 0;
        public const int StatusKnown = 5;
        public const int StatusIgnored = 6;

        public static class AutoCreate
        {
            public const string Always = "always";
            public const string WithSentence = "with_sentence";
            public const string Never = "never";
        }

        public static class SyncMode
        {
            public const string Off = "off";
            public const string Promote = "promote";
            public const string PromoteDemote = "promote_demote";
        }

        public static class KnownAction
        {
            public const string Keep = "keep";
            public const string Suspend = "suspend";
        }

        public const int DefaultLevel3Days = 7;
        public const int DefaultLevel4Days = 21;

        public static bool IsAutoCreate(string? value) => value is AutoCreate.Always or AutoCreate.WithSentence or AutoCreate.Never;
        public static bool IsSyncMode(string? value) => value is SyncMode.Off or SyncMode.Promote or SyncMode.PromoteDemote;
        public static bool IsKnownAction(string? value) => value is KnownAction.Keep or KnownAction.Suspend;

        public static string AutoCreateMode(UserSettings? settings) =>
            IsAutoCreate(settings?.SrsAutoCreateCards) ? settings!.SrsAutoCreateCards : AutoCreate.Always;

        public static string StatusSyncMode(UserSettings? settings) =>
            IsSyncMode(settings?.SrsStatusSyncMode) ? settings!.SrsStatusSyncMode : SyncMode.Promote;

        public static string KnownCardAction(UserSettings? settings) =>
            IsKnownAction(settings?.SrsKnownCardAction) ? settings!.SrsKnownCardAction : KnownAction.Keep;

        // ---- Status -> card ----

        /// <summary>
        /// Brings <paramref name="card"/> in line with <paramref name="word"/>'s status.
        /// Returns a new card when one should be created (the caller adds it), else null.
        /// </summary>
        public static SrsCardReview? ApplyStatusRules(Word word, SrsCardReview? card, bool hasSentence, UserSettings? settings)
        {
            switch (word.Status)
            {
                case StatusIgnored:
                    // Ignored words must never surface in review.
                    SuspendFor(card, SrsSuspendReasons.Ignored);
                    return null;

                case StatusKnown:
                    if (KnownCardAction(settings) == KnownAction.Suspend) SuspendFor(card, SrsSuspendReasons.Known);
                    else LiftStatusSuspension(card);
                    return null;

                case >= 1 and <= 4:
                    LiftStatusSuspension(card);
                    if (card != null || !ShouldCreate(settings, hasSentence)) return null;
                    var now = DateTime.UtcNow;
                    return new SrsCardReview { WordId = word.WordId, UserId = word.UserId, NextReviewAt = now, CreatedAt = now };

                default:
                    return null;
            }
        }

        /// <summary>Applies <see cref="ApplyStatusRules"/> to one saved word, adding any new card. Does not save.</summary>
        public static async Task ApplyStatusRulesAsync(AppDbContext db, Word word, bool hasSentence, UserSettings? settings)
        {
            var card = db.SrsCardReviews.Local.FirstOrDefault(c => c.WordId == word.WordId && c.UserId == word.UserId)
                ?? await db.SrsCardReviews.FirstOrDefaultAsync(c => c.WordId == word.WordId && c.UserId == word.UserId);
            var created = ApplyStatusRules(word, card, hasSentence, settings);
            if (created != null) db.SrsCardReviews.Add(created);
        }

        /// <summary>Batched <see cref="ApplyStatusRulesAsync(AppDbContext, Word, bool, UserSettings?)"/> for saved words without sentences.</summary>
        public static async Task ApplyStatusRulesAsync(AppDbContext db, Guid userId, IReadOnlyCollection<Word> words, UserSettings? settings)
        {
            if (words.Count == 0) return;
            var wordIds = words.Select(w => w.WordId).Distinct().ToList();
            var cards = await db.SrsCardReviews
                .Where(c => c.UserId == userId && wordIds.Contains(c.WordId))
                .ToListAsync();
            var cardsByWord = cards.GroupBy(c => c.WordId).ToDictionary(g => g.Key, g => g.First());

            foreach (var word in words)
            {
                var created = ApplyStatusRules(word, cardsByWord.GetValueOrDefault(word.WordId), hasSentence: false, settings);
                if (created == null) continue;
                db.SrsCardReviews.Add(created);
                cardsByWord[word.WordId] = created;
            }
        }

        /// <summary>
        /// Undoes a Known/Ignored suspension, e.g. when undoing the review that made a word
        /// Known. Leaves manual and leech suspensions alone.
        /// </summary>
        public static void LiftStatusSuspension(SrsCardReview? card)
        {
            if (card is { IsSuspended: true } && IsStatusReason(card.SuspendReason))
            {
                card.IsSuspended = false;
                card.SuspendReason = null;
            }
        }

        private static bool ShouldCreate(UserSettings? settings, bool hasSentence) => AutoCreateMode(settings) switch
        {
            AutoCreate.Never => false,
            AutoCreate.WithSentence => hasSentence,
            _ => true,
        };

        private static void SuspendFor(SrsCardReview? card, string reason)
        {
            if (card == null) return;
            // A manual or leech suspension stays as it is; a status one follows the status.
            if (card.IsSuspended && !IsStatusReason(card.SuspendReason)) return;
            card.IsSuspended = true;
            card.SuspendReason = reason;
        }

        private static bool IsStatusReason(string? reason) =>
            reason is SrsSuspendReasons.Ignored or SrsSuspendReasons.Known;

        // ---- Review -> status ----

        /// <summary>
        /// The status a word's card state corresponds to: 1 while not yet graduated, 2 once
        /// graduated, 3 and 4 at the stability thresholds, 5 at the auto-Known threshold.
        /// </summary>
        public static int StatusForCard(SrsCardSnapshot card, UserSettings? settings)
        {
            if (card.State is not (SrsCardState.Review or SrsCardState.Relearning) || card.Stability is not { } stability)
                return 1;

            var level3 = settings?.SrsStatusLevel3Days is > 0 ? settings.SrsStatusLevel3Days : DefaultLevel3Days;
            var level4 = settings?.SrsStatusLevel4Days is > 0 ? settings.SrsStatusLevel4Days : DefaultLevel4Days;
            var autoKnown = settings?.SrsAutoKnownDays ?? 0;

            if (autoKnown > 0 && stability >= autoKnown) return StatusKnown;
            if (stability >= level4) return 4;
            if (stability >= level3) return 3;
            return 2;
        }

        /// <summary>
        /// The word's new status after a review, or null to leave it. Promotion only ever
        /// raises the status; demotion (promote_demote mode) only happens on a lapse. Unseen
        /// and Ignored words are never touched.
        /// </summary>
        public static int? StatusAfterReview(int currentStatus, SrsReviewOutcome outcome, UserSettings? settings)
        {
            var mode = StatusSyncMode(settings);
            if (mode == SyncMode.Off || currentStatus is StatusUnseen or StatusIgnored) return null;

            var target = StatusForCard(outcome.Card, settings);
            if (target > currentStatus) return target;
            if (mode == SyncMode.PromoteDemote && outcome.IsLapse && target < currentStatus) return Math.Max(1, target);
            return null;
        }
    }
}
