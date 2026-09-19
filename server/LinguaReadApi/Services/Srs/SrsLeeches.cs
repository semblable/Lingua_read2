using System;
using System.Linq;
using LinguaReadApi.Models;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>
    /// Leeches: cards forgotten so often that reviewing them wastes time (Anki's rule).
    /// When a lapse brings a card to the threshold, and again every half-threshold after
    /// it, the card is tagged "leech" and, if the user chose so, suspended.
    /// </summary>
    public static class SrsLeeches
    {
        public const int DefaultThreshold = 8;
        public const string Tag = "leech";

        public static class Actions
        {
            public const string Tag = "tag";
            public const string Suspend = "suspend";
        }

        public static bool IsAction(string? value) => value is Actions.Tag or Actions.Suspend;

        /// <summary>Lapses that make a card a leech; 0 turns detection off.</summary>
        public static int Threshold(UserSettings? settings) =>
            settings?.SrsLeechThreshold is >= 0 ? settings.SrsLeechThreshold : DefaultThreshold;

        public static string LeechAction(UserSettings? settings) =>
            IsAction(settings?.SrsLeechAction) ? settings!.SrsLeechAction : Actions.Tag;

        /// <summary>Whether reaching <paramref name="lapses"/> trips the leech rule.</summary>
        public static bool TripsAt(int lapses, UserSettings? settings)
        {
            var threshold = Threshold(settings);
            if (threshold <= 0 || lapses < threshold) return false;
            return (lapses - threshold) % Math.Max(1, threshold / 2) == 0;
        }

        /// <summary>Call after a lapse was applied to <paramref name="card"/>. Returns true if it tripped the rule.</summary>
        public static bool OnLapse(SrsCardReview card, UserSettings? settings)
        {
            if (!TripsAt(card.Lapses, settings)) return false;
            card.Tags = AddTag(card.Tags, Tag);
            if (LeechAction(settings) == Actions.Suspend)
            {
                card.IsSuspended = true;
                card.SuspendReason = SrsSuspendReasons.Leech;
            }
            return true;
        }

        /// <summary>
        /// Call when undoing a review that took the card to <paramref name="lapsesAfterReview"/>
        /// lapses, after its lapse count was restored: reverses what <see cref="OnLapse"/> did.
        /// </summary>
        public static void OnUndo(SrsCardReview card, int lapsesAfterReview, UserSettings? settings)
        {
            if (lapsesAfterReview == card.Lapses || !TripsAt(lapsesAfterReview, settings)) return;
            if (card.IsSuspended && card.SuspendReason == SrsSuspendReasons.Leech)
            {
                card.IsSuspended = false;
                card.SuspendReason = null;
            }
            if (card.Lapses < Threshold(settings))
                card.Tags = RemoveTag(card.Tags, Tag);
        }

        internal static string AddTag(string? tags, string tag)
        {
            var list = Split(tags);
            if (!list.Contains(tag, StringComparer.OrdinalIgnoreCase)) list.Add(tag);
            return string.Join(",", list);
        }

        internal static string? RemoveTag(string? tags, string tag)
        {
            var list = Split(tags).Where(t => !string.Equals(t, tag, StringComparison.OrdinalIgnoreCase)).ToList();
            return list.Count == 0 ? null : string.Join(",", list);
        }

        private static System.Collections.Generic.List<string> Split(string? tags) =>
            (tags ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
    }
}
