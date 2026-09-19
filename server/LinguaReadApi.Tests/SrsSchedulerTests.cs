using System;
using System.Collections.Generic;
using System.Linq;
using LinguaReadApi.Services.Srs;
using LinguaReadApi.Utilities;
using Xunit;

namespace LinguaReadApi.Tests;

public class SrsSchedulerTests
{
    private const int Again = 0, Hard = 1, Good = 2, Easy = 3;

    // 2026-03-10 12:00 UTC; with offset 0 / day start 0 the user day is 2026-03-10.
    private static readonly DateTime Noon = new(2026, 3, 10, 12, 0, 0, DateTimeKind.Utc);

    private static SrsScheduler Scheduler(Func<SrsSchedulerOptions, SrsSchedulerOptions>? configure = null)
    {
        var options = new SrsSchedulerOptions { TimezoneOffsetMinutes = 0, DayStartHour = 0, EnableFuzz = false };
        return new SrsScheduler(configure?.Invoke(options) ?? options);
    }

    private static SrsCardSnapshot ReviewCard(double stability = 10, double difficulty = 5, int intervalDays = 10, int lapses = 0) => new()
    {
        State = SrsCardState.Review,
        Stability = stability,
        Difficulty = difficulty,
        IntervalDays = intervalDays,
        Reps = 5,
        Lapses = lapses,
        LastReviewedAtUtc = Noon.AddDays(-intervalDays),
        DueUtc = Noon,
    };

    // ---- New cards go through learning steps ----

    [Fact]
    public void NewCard_Good_MovesToSecondLearningStep()
    {
        var outcome = Scheduler().Review(new SrsCardSnapshot(), Good, Noon);

        Assert.Equal(SrsCardState.Learning, outcome.Card.State);
        Assert.Equal(1, outcome.Card.Step);
        Assert.Equal(TimeSpan.FromMinutes(10), outcome.StepDelay);
        Assert.Equal(Noon.AddMinutes(10), outcome.Card.DueUtc);
        Assert.Equal(0, outcome.Card.IntervalDays);
        Assert.Equal(SrsReviewKind.Learn, outcome.Kind);
        Assert.False(outcome.IsLapse);
        Assert.Equal(1, outcome.Card.Reps);
        Assert.Equal(Noon, outcome.Card.LastReviewedAtUtc);
        Assert.NotNull(outcome.Card.Stability);
        Assert.NotNull(outcome.Card.Difficulty);
    }

    [Fact]
    public void NewCard_Again_AndHard_StayOnFirstStep()
    {
        var again = Scheduler().Review(new SrsCardSnapshot(), Again, Noon);
        Assert.Equal((SrsCardState.Learning, 0), (again.Card.State, again.Card.Step));
        Assert.Equal(TimeSpan.FromMinutes(1), again.StepDelay);

        // Hard on step 0 waits halfway between the first two steps.
        var hard = Scheduler().Review(new SrsCardSnapshot(), Hard, Noon);
        Assert.Equal((SrsCardState.Learning, 0), (hard.Card.State, hard.Card.Step));
        Assert.Equal(TimeSpan.FromMinutes(5.5), hard.StepDelay);
    }

    [Fact]
    public void NewCard_Easy_GraduatesImmediately_WithLongerIntervalThanGood()
    {
        var scheduler = Scheduler();
        var easy = scheduler.Review(new SrsCardSnapshot(), Easy, Noon);
        var goodThenGood = scheduler.Review(scheduler.Review(new SrsCardSnapshot(), Good, Noon).Card, Good, Noon.AddMinutes(10));

        Assert.Equal(SrsCardState.Review, easy.Card.State);
        Assert.Null(easy.StepDelay);
        Assert.True(easy.Card.IntervalDays > goodThenGood.Card.IntervalDays,
            $"Easy {easy.Card.IntervalDays}d should beat Good-Good {goodThenGood.Card.IntervalDays}d");
    }

    [Fact]
    public void LastLearningStep_Good_Graduates()
    {
        var scheduler = Scheduler();
        var first = scheduler.Review(new SrsCardSnapshot(), Good, Noon);
        var graduated = scheduler.Review(first.Card, Good, Noon.AddMinutes(10));

        Assert.Equal(SrsCardState.Review, graduated.Card.State);
        Assert.True(graduated.Card.IntervalDays >= 1);
        Assert.Equal(SrsReviewKind.Learn, graduated.Kind);
    }

    // ---- Review cards: Hard is a pass, only Again lapses ----

    [Fact]
    public void ReviewCard_Hard_IsAPass()
    {
        var card = ReviewCard();
        var outcome = Scheduler().Review(card, Hard, Noon);

        Assert.Equal(SrsCardState.Review, outcome.Card.State);
        Assert.False(outcome.IsLapse);
        Assert.Equal(0, outcome.Card.Lapses);
        Assert.True(outcome.Card.Stability > card.Stability, "a successful recall must not lower stability");
        Assert.True(outcome.Card.IntervalDays >= card.IntervalDays, $"Hard gave {outcome.Card.IntervalDays}d");
        Assert.Equal(SrsReviewKind.Review, outcome.Kind);
    }

    [Fact]
    public void ReviewCard_GradesOrderIntervals()
    {
        var preview = Scheduler().PreviewIntervals(ReviewCard(), Noon);
        Assert.True(preview[Again] < preview[Hard], "Again < Hard");
        Assert.True(preview[Hard] <= preview[Good], "Hard <= Good");
        Assert.True(preview[Good] < preview[Easy], "Good < Easy");
    }

    [Fact]
    public void ReviewCard_Again_LapsesIntoRelearning()
    {
        var outcome = Scheduler().Review(ReviewCard(lapses: 2), Again, Noon);

        Assert.True(outcome.IsLapse);
        Assert.Equal(3, outcome.Card.Lapses);
        Assert.Equal(SrsCardState.Relearning, outcome.Card.State);
        Assert.Equal(0, outcome.Card.Step);
        Assert.Equal(TimeSpan.FromMinutes(10), outcome.StepDelay);
        Assert.Equal(SrsReviewKind.Review, outcome.Kind);
    }

    [Fact]
    public void Relearning_Good_GraduatesWithLapseMinimumFloor()
    {
        var scheduler = Scheduler(o => o with { LapseMinimumIntervalDays = 5 });
        var lapsed = scheduler.Review(ReviewCard(stability: 2), Again, Noon);
        var back = scheduler.Review(lapsed.Card, Good, Noon.AddMinutes(10));

        Assert.Equal(SrsCardState.Review, back.Card.State);
        Assert.Equal(SrsReviewKind.Relearn, back.Kind);
        Assert.Equal(5, back.Card.IntervalDays);
        Assert.False(back.IsLapse);
    }

    [Fact]
    public void ReviewCard_Again_WithoutRelearningSteps_StaysInReviewWithFloor()
    {
        var scheduler = Scheduler(o => o with { RelearningSteps = Array.Empty<TimeSpan>(), LapseMinimumIntervalDays = 3 });
        var outcome = scheduler.Review(ReviewCard(stability: 2), Again, Noon);

        Assert.True(outcome.IsLapse);
        Assert.Equal(1, outcome.Card.Lapses);
        Assert.Equal(SrsCardState.Review, outcome.Card.State);
        Assert.Equal(3, outcome.Card.IntervalDays);
    }

    [Fact]
    public void Interval_IsCappedAtMaximum()
    {
        var outcome = Scheduler(o => o with { MaximumIntervalDays = 30 }).Review(ReviewCard(stability: 500, intervalDays: 30), Easy, Noon);
        Assert.Equal(30, outcome.Card.IntervalDays);
    }

    [Fact]
    public void ShortenedStepList_GraduatesCardLeftOnMissingStep()
    {
        var card = new SrsCardSnapshot
        {
            State = SrsCardState.Learning, Step = 3, Stability = 1, Difficulty = 5,
            LastReviewedAtUtc = Noon.AddMinutes(-30), DueUtc = Noon,
        };
        var scheduler = Scheduler();

        Assert.Equal(SrsCardState.Review, scheduler.Review(card, Hard, Noon).Card.State);
        Assert.Equal(SrsCardState.Review, scheduler.Review(card, Good, Noon).Card.State);
        var again = scheduler.Review(card, Again, Noon);
        Assert.Equal((SrsCardState.Learning, 0), (again.Card.State, again.Card.Step));
    }

    // ---- Memory state requirements ----

    [Fact]
    public void ReviewCard_WithoutMemoryState_Throws()
    {
        var card = ReviewCard() with { Stability = null, Difficulty = null };
        Assert.Throws<InvalidOperationException>(() => Scheduler().Review(card, Good, Noon));
    }

    [Fact]
    public void LearningCard_WithoutMemoryState_IsInitialised()
    {
        // e.g. an SM-2-era new card that was failed once and never graduated.
        var card = new SrsCardSnapshot { State = SrsCardState.Learning, Step = 0, LastReviewedAtUtc = Noon.AddMinutes(-5) };
        var outcome = Scheduler().Review(card, Good, Noon);

        var fsrs = new FsrsAlgorithm();
        Assert.Equal(fsrs.InitialStability(FsrsRating.Good), outcome.Card.Stability);
        Assert.Equal(fsrs.InitialDifficulty(FsrsRating.Good), outcome.Card.Difficulty);
    }

    // ---- Elapsed time counts in user days ----

    [Fact]
    public void SameUserDay_UsesShortTermStability()
    {
        var scheduler = Scheduler(o => o with { DayStartHour = 4 });
        var card = ReviewCard() with { LastReviewedAtUtc = new DateTime(2026, 3, 10, 5, 0, 0, DateTimeKind.Utc) };
        var outcome = scheduler.Review(card, Good, new DateTime(2026, 3, 11, 3, 0, 0, DateTimeKind.Utc)); // before 04:00

        Assert.Equal(scheduler.Algorithm.ShortTermStability(10, FsrsRating.Good), outcome.Card.Stability);
    }

    [Fact]
    public void CrossingDayStart_CountsAsANewDay()
    {
        var scheduler = Scheduler(o => o with { DayStartHour = 4 });
        var card = ReviewCard() with { LastReviewedAtUtc = new DateTime(2026, 3, 10, 3, 0, 0, DateTimeKind.Utc) };
        var outcome = scheduler.Review(card, Good, new DateTime(2026, 3, 10, 5, 0, 0, DateTimeKind.Utc));

        var fsrs = scheduler.Algorithm;
        var expected = fsrs.NextStability(5, 10, fsrs.Retrievability(1, 10), FsrsRating.Good);
        Assert.Equal(expected, outcome.Card.Stability);
    }

    [Fact]
    public void GraduatedCard_FallsDueAtStartOfUserDay()
    {
        // UTC+2, day starts 04:00 local. 01:30 UTC is 03:30 local, still user day 2026-03-09.
        var scheduler = Scheduler(o => o with { TimezoneOffsetMinutes = 120, DayStartHour = 4 });
        var now = new DateTime(2026, 3, 10, 1, 30, 0, DateTimeKind.Utc);
        var outcome = scheduler.Review(ReviewCard() with { LastReviewedAtUtc = now.AddDays(-10) }, Good, now);

        var expected = new DateTime(2026, 3, 9, 2, 0, 0, DateTimeKind.Utc).AddDays(outcome.Card.IntervalDays); // 04:00 local
        Assert.Equal(expected, outcome.Card.DueUtc);
    }

    // ---- Preview & fuzz ----

    public static IEnumerable<object[]> PreviewCards() => new[]
    {
        new object[] { new SrsCardSnapshot() },
        new object[] { new SrsCardSnapshot { State = SrsCardState.Learning, Step = 1, Stability = 2.3, Difficulty = 2.1, LastReviewedAtUtc = Noon.AddMinutes(-10) } },
        new object[] { ReviewCard(stability: 45, intervalDays: 40) },
        new object[] { new SrsCardSnapshot { State = SrsCardState.Relearning, Step = 0, Stability = 3, Difficulty = 7, Lapses = 1, LastReviewedAtUtc = Noon.AddMinutes(-10) } },
    };

    [Theory]
    [MemberData(nameof(PreviewCards))]
    public void PreviewIntervals_EqualUnfuzzedReviews(SrsCardSnapshot card)
    {
        var fuzzing = new SrsScheduler(new SrsSchedulerOptions { TimezoneOffsetMinutes = 0, DayStartHour = 0, EnableFuzz = true });
        var plain = Scheduler();

        var preview = fuzzing.PreviewIntervals(card, Noon);

        Assert.Equal(4, preview.Count);
        for (int grade = 0; grade < 4; grade++)
            Assert.Equal(plain.Review(card, grade, Noon).DisplayInterval, preview[grade]);
    }

    [Theory]
    [InlineData(1, 36500, 1, 1)]
    [InlineData(2, 36500, 2, 2)]
    [InlineData(3, 36500, 2, 4)]
    [InlineData(10, 36500, 8, 12)]
    [InlineData(100, 36500, 93, 107)]
    [InlineData(100, 104, 93, 104)]
    public void FuzzRange_MatchesReferenceFormula(int interval, int max, int expectedMin, int expectedMax)
    {
        Assert.Equal((expectedMin, expectedMax), FsrsAlgorithm.FuzzRange(interval, max));
    }

    [Fact]
    public void Fuzz_StaysInRange_AndActuallyVaries()
    {
        var fuzzing = new SrsScheduler(new SrsSchedulerOptions { TimezoneOffsetMinutes = 0, DayStartHour = 0, EnableFuzz = true });
        var card = ReviewCard(stability: 45, intervalDays: 40);
        var unfuzzed = Scheduler().Review(card, Good, Noon).Card.IntervalDays;
        var (min, max) = FsrsAlgorithm.FuzzRange(unfuzzed, 36500);

        var seen = new HashSet<int>();
        for (int seed = 0; seed < 200; seed++)
        {
            var outcome = fuzzing.Review(card, Good, Noon, new Random(seed));
            Assert.InRange(outcome.Card.IntervalDays, min, max);
            Assert.Equal(SrsDay.DayStartUtc(DateOnly.FromDateTime(Noon).AddDays(outcome.Card.IntervalDays), 0, 0), outcome.Card.DueUtc);
            seen.Add(outcome.Card.IntervalDays);
        }
        Assert.True(seen.Count > 1, "fuzz never changed the interval");
    }

    [Fact]
    public void Fuzz_NeverAppliesToLearningSteps()
    {
        var fuzzing = new SrsScheduler(new SrsSchedulerOptions { EnableFuzz = true });
        for (int seed = 0; seed < 20; seed++)
            Assert.Equal(TimeSpan.FromMinutes(10), fuzzing.Review(new SrsCardSnapshot(), Good, Noon, new Random(seed)).StepDelay);
    }

    // ---- Retrievability, state mapping, parsing ----

    [Fact]
    public void Retrievability_IsNullWithoutMemoryState_AndFollowsCurveOtherwise()
    {
        var scheduler = Scheduler();
        Assert.Null(scheduler.Retrievability(new SrsCardSnapshot(), Noon));

        var card = ReviewCard(stability: 10, intervalDays: 10);
        Assert.Equal(0.9, scheduler.Retrievability(card, Noon)!.Value, 10);
    }

    [Theory]
    [InlineData(false, false, false, SrsCardState.New)]
    [InlineData(true, false, true, SrsCardState.Learning)]
    [InlineData(false, true, true, SrsCardState.Review)]
    [InlineData(true, true, true, SrsCardState.Relearning)]
    public void CardState_DerivesFromColumns_AndRoundTrips(bool isLearning, bool hasEverGraduated, bool reviewed, SrsCardState expected)
    {
        var state = SrsCardStates.Derive(isLearning, hasEverGraduated, reviewed ? Noon : null);
        Assert.Equal(expected, state);
        Assert.Equal(isLearning, SrsCardStates.IsLearningColumn(state));
        Assert.Equal(hasEverGraduated, SrsCardStates.HasEverGraduatedColumn(state));
    }

    [Theory]
    [InlineData("1, 10", new[] { 1, 10 })]
    [InlineData("5, x, 15", new[] { 5, 15 })]
    [InlineData("", new[] { 99 })]
    [InlineData("abc,0,-5", new[] { 99 })]
    public void ParseStepMinutes_KeepsPositiveIntegers(string raw, int[] expectedMinutes)
    {
        var fallback = new[] { TimeSpan.FromMinutes(99) };
        var steps = SrsSchedulerOptions.ParseStepMinutes(raw, fallback);
        Assert.Equal(expectedMinutes, steps.Select(s => (int)s.TotalMinutes).ToArray());
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(4)]
    public void Review_RejectsGradesOutsideZeroToThree(int grade)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Scheduler().Review(new SrsCardSnapshot(), grade, Noon));
    }
}
