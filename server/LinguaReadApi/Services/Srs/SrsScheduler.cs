using System;
using System.Collections.Generic;
using System.Linq;
using LinguaReadApi.Utilities;

namespace LinguaReadApi.Services.Srs
{
    public enum SrsCardState
    {
        New = 0,
        Learning = 1,
        Review = 2,
        Relearning = 3,
    }

    /// <summary>What kind of review a log row records, judged by the card's state before it.</summary>
    public enum SrsReviewKind
    {
        Learn = 0,
        Review = 1,
        Relearn = 2,
        /// <summary>An implicit review from meeting the word while reading (reading credit).</summary>
        Reading = 3,
    }

    public static class SrsCardStates
    {
        /// <summary>
        /// Maps the persisted columns onto an FSRS state. There is no State column: the
        /// existing IsLearning / HasEverGraduated / LastReviewedAt trio already encodes it,
        /// and the due/stats queries filter on those columns directly.
        /// </summary>
        public static SrsCardState Derive(bool isLearning, bool hasEverGraduated, DateTime? lastReviewedAt)
        {
            if (isLearning) return hasEverGraduated ? SrsCardState.Relearning : SrsCardState.Learning;
            return lastReviewedAt == null ? SrsCardState.New : SrsCardState.Review;
        }

        public static bool IsLearningColumn(SrsCardState state) =>
            state is SrsCardState.Learning or SrsCardState.Relearning;

        public static bool HasEverGraduatedColumn(SrsCardState state) =>
            state is SrsCardState.Review or SrsCardState.Relearning;
    }

    /// <summary>Scheduler-facing view of one card. Immutable; reviews return a new snapshot.</summary>
    public sealed record SrsCardSnapshot
    {
        public SrsCardState State { get; init; } = SrsCardState.New;

        /// <summary>Index into the (re)learning steps; meaningless in New/Review.</summary>
        public int Step { get; init; }

        public double? Stability { get; init; }
        public double? Difficulty { get; init; }

        /// <summary>Scheduled interval in whole days; 0 while on a (re)learning step.</summary>
        public int IntervalDays { get; init; }

        public int Reps { get; init; }
        public int Lapses { get; init; }
        public DateTime? LastReviewedAtUtc { get; init; }
        public DateTime DueUtc { get; init; }
    }

    public sealed record SrsReviewOutcome(
        SrsCardSnapshot Card,
        SrsReviewKind Kind,
        bool IsLapse,
        TimeSpan? StepDelay)
    {
        /// <summary>The interval to show on a grade button: the step delay, or whole days.</summary>
        public TimeSpan DisplayInterval => StepDelay ?? TimeSpan.FromDays(Card.IntervalDays);
    }

    public sealed record SrsSchedulerOptions
    {
        public static readonly IReadOnlyList<TimeSpan> DefaultLearningSteps =
            new[] { TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(10) };

        public static readonly IReadOnlyList<TimeSpan> DefaultRelearningSteps =
            new[] { TimeSpan.FromMinutes(10) };

        public IReadOnlyList<TimeSpan> LearningSteps { get; init; } = DefaultLearningSteps;
        public IReadOnlyList<TimeSpan> RelearningSteps { get; init; } = DefaultRelearningSteps;
        public double DesiredRetention { get; init; } = 0.9;
        public int MaximumIntervalDays { get; init; } = 36500;

        /// <summary>Floor for the interval a lapsed card graduates back to.</summary>
        public int LapseMinimumIntervalDays { get; init; } = 1;

        public FsrsParameters Parameters { get; init; } = FsrsParameters.Default;
        public int TimezoneOffsetMinutes { get; init; }
        public int DayStartHour { get; init; } = SrsDay.DefaultDayStartHour;
        public bool EnableFuzz { get; init; } = true;

        /// <summary>
        /// Parses "1, 10"-style minute lists. Non-numeric and non-positive entries are
        /// dropped; if nothing valid remains the fallback is returned.
        /// </summary>
        public static IReadOnlyList<TimeSpan> ParseStepMinutes(string? raw, IReadOnlyList<TimeSpan> fallback)
        {
            if (string.IsNullOrWhiteSpace(raw)) return fallback;
            var steps = raw.Split(',')
                .Select(s => int.TryParse(s.Trim(), out var minutes) ? minutes : 0)
                .Where(minutes => minutes > 0)
                .Select(minutes => TimeSpan.FromMinutes(minutes))
                .ToList();
            return steps.Count > 0 ? steps : fallback;
        }
    }

    /// <summary>
    /// FSRS-6 card state machine, ported from py-fsrs <c>Scheduler.review_card</c>.
    /// Deliberate differences from py-fsrs:
    /// <list type="bullet">
    /// <item>Elapsed days are whole <see cref="SrsDay"/> user days (Anki semantics), not floor(24h spans).</item>
    /// <item>Graduated cards fall due at the start of a user day, not at review-time-of-day + N days.</item>
    /// <item>A lapsed card's new interval is floored at <see cref="SrsSchedulerOptions.LapseMinimumIntervalDays"/>.</item>
    /// </list>
    /// </summary>
    public sealed class SrsScheduler
    {
        private readonly SrsSchedulerOptions _options;
        private readonly FsrsAlgorithm _fsrs;
        private readonly double _desiredRetention;

        public SrsScheduler(SrsSchedulerOptions? options = null)
        {
            _options = options ?? new SrsSchedulerOptions();
            _fsrs = new FsrsAlgorithm(_options.Parameters);
            _desiredRetention = Math.Clamp(_options.DesiredRetention, 0.5, 0.99);
        }

        public SrsSchedulerOptions Options => _options;
        public FsrsAlgorithm Algorithm => _fsrs;

        /// <summary>Applies a 0-3 grade at <paramref name="nowUtc"/>.</summary>
        public SrsReviewOutcome Review(SrsCardSnapshot card, int grade, DateTime nowUtc, Random? random = null)
        {
            var fuzz = _options.EnableFuzz ? random ?? Random.Shared : null;
            return ReviewCore(card, FsrsAlgorithm.RatingFromGrade(grade), nowUtc, fuzz);
        }

        /// <summary>Unfuzzed next interval for each grade 0-3, for the answer buttons.</summary>
        public IReadOnlyList<TimeSpan> PreviewIntervals(SrsCardSnapshot card, DateTime nowUtc) =>
            Enumerable.Range(0, 4)
                .Select(grade => ReviewCore(card, FsrsAlgorithm.RatingFromGrade(grade), nowUtc, fuzz: null).DisplayInterval)
                .ToList();

        /// <summary>
        /// Recomputes a Review card's interval and due day from its memory state and the
        /// current options (retention, maximum interval, weights), counting from the day of
        /// its last review. Other cards come back unchanged.
        /// </summary>
        public SrsCardSnapshot Reschedule(SrsCardSnapshot card, Random? random = null)
        {
            if (card.State != SrsCardState.Review || card.Stability is not { } stability || card.LastReviewedAtUtc is not { } last)
                return card;

            var max = Math.Max(1, _options.MaximumIntervalDays);
            var days = _fsrs.NextIntervalDays(stability, _desiredRetention, max);
            if (_options.EnableFuzz)
                days = FsrsAlgorithm.Fuzz(days, max, random ?? Random.Shared);

            var lastDay = SrsDay.UserDay(last, _options.TimezoneOffsetMinutes, _options.DayStartHour);
            return card with
            {
                IntervalDays = days,
                DueUtc = SrsDay.DayStartUtc(lastDay.AddDays(days), _options.TimezoneOffsetMinutes, _options.DayStartHour),
            };
        }

        /// <summary>Current probability of recall, or null for cards without memory state.</summary>
        public double? Retrievability(SrsCardSnapshot card, DateTime nowUtc)
        {
            if (card.Stability is not { } stability || card.LastReviewedAtUtc is not { } last) return null;
            return _fsrs.Retrievability(ElapsedDays(last, nowUtc), stability);
        }

        private SrsReviewOutcome ReviewCore(SrsCardSnapshot card, FsrsRating rating, DateTime nowUtc, Random? fuzz)
        {
            var kind = card.State switch
            {
                SrsCardState.Review => SrsReviewKind.Review,
                SrsCardState.Relearning => SrsReviewKind.Relearn,
                _ => SrsReviewKind.Learn,
            };

            // py-fsrs models a brand-new card as Learning, step 0, with no memory state yet.
            var state = card.State == SrsCardState.New ? SrsCardState.Learning : card.State;
            var step = card.State == SrsCardState.New ? 0 : card.Step;
            int? elapsedDays = card.LastReviewedAtUtc is { } last ? ElapsedDays(last, nowUtc) : null;

            double stability;
            double difficulty;
            if (card.Stability is not { } s || card.Difficulty is not { } d)
            {
                if (state != SrsCardState.Learning)
                    throw new InvalidOperationException(
                        $"A {state} card must have FSRS memory state before it can be scheduled.");
                stability = _fsrs.InitialStability(rating);
                difficulty = _fsrs.InitialDifficulty(rating);
            }
            else
            {
                stability = elapsedDays is < 1
                    ? _fsrs.ShortTermStability(s, rating)
                    : _fsrs.NextStability(d, s, _fsrs.Retrievability(elapsedDays ?? 0, s), rating);
                difficulty = _fsrs.NextDifficulty(d, rating);
            }

            var next = card with
            {
                State = state,
                Stability = stability,
                Difficulty = difficulty,
                Reps = card.Reps + 1,
                LastReviewedAtUtc = nowUtc,
            };

            switch (state)
            {
                case SrsCardState.Learning:
                    return Steps(next, step, rating, _options.LearningSteps, kind, nowUtc, fuzz, fromLapse: false);

                case SrsCardState.Relearning:
                    return Steps(next, step, rating, _options.RelearningSteps, kind, nowUtc, fuzz, fromLapse: true);

                case SrsCardState.Review:
                    if (rating != FsrsRating.Again)
                        return Graduate(next, kind, isLapse: false, nowUtc, fuzz, fromLapse: false);

                    next = next with { Lapses = card.Lapses + 1 };
                    if (_options.RelearningSteps.Count == 0)
                        return Graduate(next, kind, isLapse: true, nowUtc, fuzz, fromLapse: true);
                    return OnStep(next with { State = SrsCardState.Relearning }, 0, _options.RelearningSteps[0], kind, isLapse: true, nowUtc);

                default:
                    throw new InvalidOperationException($"Unknown card state {state}.");
            }
        }

        private SrsReviewOutcome Steps(
            SrsCardSnapshot next,
            int step,
            FsrsRating rating,
            IReadOnlyList<TimeSpan> steps,
            SrsReviewKind kind,
            DateTime nowUtc,
            Random? fuzz,
            bool fromLapse)
        {
            // Also covers a card left on a step that no longer exists because the
            // user shortened their step list.
            if (steps.Count == 0 || (step >= steps.Count && rating != FsrsRating.Again))
                return Graduate(next, kind, isLapse: false, nowUtc, fuzz, fromLapse);

            switch (rating)
            {
                case FsrsRating.Again:
                    return OnStep(next, 0, steps[0], kind, isLapse: false, nowUtc);

                case FsrsRating.Hard:
                    TimeSpan delay;
                    if (step == 0 && steps.Count == 1) delay = steps[0] * 1.5;
                    else if (step == 0) delay = (steps[0] + steps[1]) / 2.0;
                    else delay = steps[step];
                    return OnStep(next, step, delay, kind, isLapse: false, nowUtc);

                case FsrsRating.Good:
                    if (step + 1 == steps.Count)
                        return Graduate(next, kind, isLapse: false, nowUtc, fuzz, fromLapse);
                    return OnStep(next, step + 1, steps[step + 1], kind, isLapse: false, nowUtc);

                default: // Easy
                    return Graduate(next, kind, isLapse: false, nowUtc, fuzz, fromLapse);
            }
        }

        private static SrsReviewOutcome OnStep(
            SrsCardSnapshot next, int step, TimeSpan delay, SrsReviewKind kind, bool isLapse, DateTime nowUtc)
        {
            var card = next with
            {
                Step = step,
                IntervalDays = 0,
                DueUtc = nowUtc + delay,
            };
            return new SrsReviewOutcome(card, kind, isLapse, delay);
        }

        private SrsReviewOutcome Graduate(
            SrsCardSnapshot next, SrsReviewKind kind, bool isLapse, DateTime nowUtc, Random? fuzz, bool fromLapse)
        {
            var max = Math.Max(1, _options.MaximumIntervalDays);
            var days = _fsrs.NextIntervalDays(next.Stability!.Value, _desiredRetention, max);
            if (fromLapse)
                days = Math.Min(Math.Max(days, _options.LapseMinimumIntervalDays), max);
            if (fuzz != null)
                days = FsrsAlgorithm.Fuzz(days, max, fuzz);

            var today = SrsDay.UserDay(nowUtc, _options.TimezoneOffsetMinutes, _options.DayStartHour);
            var card = next with
            {
                State = SrsCardState.Review,
                Step = 0,
                IntervalDays = days,
                DueUtc = SrsDay.DayStartUtc(today.AddDays(days), _options.TimezoneOffsetMinutes, _options.DayStartHour),
            };
            return new SrsReviewOutcome(card, kind, isLapse, null);
        }

        private int ElapsedDays(DateTime lastUtc, DateTime nowUtc) =>
            Math.Max(0, SrsDay.DaysBetween(lastUtc, nowUtc, _options.TimezoneOffsetMinutes, _options.DayStartHour));
    }
}
