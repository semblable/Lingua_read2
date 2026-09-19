using System;
using LinguaReadApi.Models;
using LinguaReadApi.Utilities;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>Values for <see cref="SrsCardReview.SuspendReason"/>.</summary>
    public static class SrsSuspendReasons
    {
        public const string Manual = "manual";
        public const string Ignored = "ignored";
        public const string Known = "known";
        public const string Leech = "leech";
    }

    /// <summary>Converts between the persisted card row and the scheduler's snapshot.</summary>
    public static class SrsCardMapping
    {
        public static SrsCardState GetState(this SrsCardReview card) =>
            SrsCardStates.Derive(card.IsLearning, card.HasEverGraduated, card.LastReviewedAt);

        /// <summary>
        /// The scheduler's view of <paramref name="card"/>. With <paramref name="estimateMissingState"/>,
        /// an SM-2-era card that hasn't been backfilled yet gets an estimated memory state
        /// (for previews only; reviews rebuild the real state from history first).
        /// </summary>
        public static SrsCardSnapshot ToSnapshot(this SrsCardReview card, bool estimateMissingState = false)
        {
            var state = card.GetState();
            double? stability = card.Stability;
            double? difficulty = card.Difficulty;
            if (estimateMissingState && (stability == null || difficulty == null)
                && state is SrsCardState.Review or SrsCardState.Relearning)
            {
                (stability, difficulty) = SrsMemoryStateInitializer.EstimateWithoutHistory(card.Interval);
            }

            return new SrsCardSnapshot
            {
                State = state,
                Step = card.CurrentLearningStepIndex,
                Stability = stability,
                Difficulty = difficulty,
                IntervalDays = card.Interval,
                Reps = card.Repetitions,
                Lapses = card.Lapses,
                LastReviewedAtUtc = card.LastReviewedAt,
                DueUtc = card.NextReviewAt,
            };
        }

        public static void Apply(this SrsCardReview card, SrsCardSnapshot snapshot)
        {
            card.IsLearning = SrsCardStates.IsLearningColumn(snapshot.State);
            card.HasEverGraduated = SrsCardStates.HasEverGraduatedColumn(snapshot.State);
            card.CurrentLearningStepIndex = snapshot.Step;
            card.Stability = snapshot.Stability;
            card.Difficulty = snapshot.Difficulty;
            card.Interval = snapshot.IntervalDays;
            card.Repetitions = snapshot.Reps;
            card.Lapses = snapshot.Lapses;
            card.LastReviewedAt = snapshot.LastReviewedAtUtc;
            card.NextReviewAt = snapshot.DueUtc;
        }
    }

    /// <summary>Builds scheduler options from a user's saved SRS settings.</summary>
    public static class SrsSchedulerSettings
    {
        public const double MinDesiredRetention = 0.70;
        public const double MaxDesiredRetention = 0.97;
        public const double DefaultDesiredRetention = 0.9;

        /// <summary>Daily caps when the user hasn't set one (old rows may hold 0).</summary>
        public const int DefaultMaxNewCards = 20;
        public const int DefaultMaxReviews = 200;

        /// <summary>A card with an interval of this many days or more counts as mature.</summary>
        public const int MatureIntervalDays = 21;

        /// <summary>Learning cards due within this window are served early when nothing else is left.</summary>
        public static readonly TimeSpan LearnAhead = TimeSpan.FromMinutes(20);

        public static SrsSchedulerOptions FromUserSettings(UserSettings? settings, int tzOffsetMinutes) => new()
        {
            LearningSteps = SrsSchedulerOptions.ParseStepMinutes(
                settings?.SrsLearningStepMinutes, SrsSchedulerOptions.DefaultLearningSteps),
            RelearningSteps = SrsSchedulerOptions.ParseStepMinutes(
                settings?.SrsRelearningStepMinutes, SrsSchedulerOptions.DefaultRelearningSteps),
            DesiredRetention = settings?.SrsDesiredRetention is >= MinDesiredRetention and <= MaxDesiredRetention
                ? settings.SrsDesiredRetention
                : DefaultDesiredRetention,
            MaximumIntervalDays = settings?.SrsMaxIntervalDays is > 0 ? settings.SrsMaxIntervalDays : 36500,
            LapseMinimumIntervalDays = settings?.SrsLapseMinimumIntervalDays is > 0 ? settings.SrsLapseMinimumIntervalDays : 1,
            Parameters = FsrsParameters.ParseOrDefault(settings?.SrsFsrsWeights),
            TimezoneOffsetMinutes = TimezoneOffset.Clamp(tzOffsetMinutes),
            DayStartHour = SrsDay.ClampDayStartHour(settings?.SrsDayStartHour ?? SrsDay.DefaultDayStartHour),
        };
    }
}
