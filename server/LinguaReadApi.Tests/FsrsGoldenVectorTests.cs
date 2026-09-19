using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json;
using LinguaReadApi.Services.Srs;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Checks the C# FSRS port against outputs of py-fsrs, the reference implementation.
/// The vectors live in FsrsGoldenVectors/fsrs-golden-vectors.json and are regenerated
/// with FsrsGoldenVectors/generate.py.
/// </summary>
public class FsrsGoldenVectorTests
{
    private const double Tolerance = 1e-9;

    private static readonly Lazy<JsonDocument> Vectors = new(() =>
    {
        var path = Path.Combine(AppContext.BaseDirectory, "FsrsGoldenVectors", "fsrs-golden-vectors.json");
        return JsonDocument.Parse(File.ReadAllText(path));
    });

    private static JsonElement Formulas(string name) => Vectors.Value.RootElement.GetProperty("formulas").GetProperty(name);

    private static readonly FsrsAlgorithm Fsrs = new();

    public static IEnumerable<object[]> SequenceNames() =>
        Vectors.Value.RootElement.GetProperty("sequences").EnumerateArray()
            .Select(s => new object[] { s.GetProperty("name").GetString()! });

    [Fact]
    public void DefaultWeights_MatchReference()
    {
        var reference = Vectors.Value.RootElement.GetProperty("parameters").EnumerateArray().Select(e => e.GetDouble()).ToArray();
        Assert.Equal(reference, FsrsParameters.DefaultWeights);
    }

    [Fact]
    public void InitialStabilityAndDifficulty_MatchReference()
    {
        foreach (var v in Formulas("initial").EnumerateArray())
        {
            var rating = (FsrsRating)v.GetProperty("rating").GetInt32();
            AssertClose(v.GetProperty("stability").GetDouble(), Fsrs.InitialStability(rating), $"S0({rating})");
            AssertClose(v.GetProperty("difficulty").GetDouble(), Fsrs.InitialDifficulty(rating), $"D0({rating})");
        }
    }

    [Fact]
    public void NextDifficulty_MatchesReference()
    {
        foreach (var v in Formulas("next_difficulty").EnumerateArray())
        {
            var d = v.GetProperty("difficulty").GetDouble();
            var rating = (FsrsRating)v.GetProperty("rating").GetInt32();
            AssertClose(v.GetProperty("expected").GetDouble(), Fsrs.NextDifficulty(d, rating), $"D'({d}, {rating})");
        }
    }

    [Fact]
    public void Retrievability_MatchesReference()
    {
        foreach (var v in Formulas("retrievability").EnumerateArray())
        {
            var s = v.GetProperty("stability").GetDouble();
            var t = v.GetProperty("elapsed_days").GetInt32();
            AssertClose(v.GetProperty("expected").GetDouble(), Fsrs.Retrievability(t, s), $"R(t={t}, S={s})");
        }
    }

    [Fact]
    public void NextStability_MatchesReference()
    {
        foreach (var v in Formulas("next_stability").EnumerateArray())
        {
            var d = v.GetProperty("difficulty").GetDouble();
            var s = v.GetProperty("stability").GetDouble();
            var r = v.GetProperty("retrievability").GetDouble();
            var rating = (FsrsRating)v.GetProperty("rating").GetInt32();
            AssertClose(v.GetProperty("expected").GetDouble(), Fsrs.NextStability(d, s, r, rating),
                $"S'(D={d}, S={s}, R={r}, {rating})");
        }
    }

    [Fact]
    public void ShortTermStability_MatchesReference()
    {
        foreach (var v in Formulas("short_term_stability").EnumerateArray())
        {
            var s = v.GetProperty("stability").GetDouble();
            var rating = (FsrsRating)v.GetProperty("rating").GetInt32();
            AssertClose(v.GetProperty("expected").GetDouble(), Fsrs.ShortTermStability(s, rating), $"S_short(S={s}, {rating})");
        }
    }

    [Fact]
    public void NextInterval_MatchesReference()
    {
        foreach (var v in Formulas("next_interval").EnumerateArray())
        {
            var s = v.GetProperty("stability").GetDouble();
            var retention = v.GetProperty("desired_retention").GetDouble();
            var max = v.GetProperty("maximum_interval").GetInt32();
            Assert.True(
                v.GetProperty("expected").GetInt32() == Fsrs.NextIntervalDays(s, retention, max),
                $"I(S={s}, r={retention}, max={max})");
        }
    }

    [Theory]
    [MemberData(nameof(SequenceNames))]
    public void ReviewSequence_MatchesReference(string name)
    {
        var sequence = Vectors.Value.RootElement.GetProperty("sequences").EnumerateArray()
            .Single(s => s.GetProperty("name").GetString() == name);
        var config = sequence.GetProperty("config");

        // UTC offset 0 and a midnight day start make user days equal the calendar days
        // the generator aligned py-fsrs's elapsed-day counting to.
        var scheduler = new SrsScheduler(new SrsSchedulerOptions
        {
            LearningSteps = Minutes(config.GetProperty("learning_steps")),
            RelearningSteps = Minutes(config.GetProperty("relearning_steps")),
            DesiredRetention = config.GetProperty("desired_retention").GetDouble(),
            MaximumIntervalDays = config.GetProperty("maximum_interval").GetInt32(),
            TimezoneOffsetMinutes = 0,
            DayStartHour = 0,
            EnableFuzz = false,
        });

        var card = new SrsCardSnapshot();
        int i = 0;
        foreach (var review in sequence.GetProperty("reviews").EnumerateArray())
        {
            var at = DateTime.Parse(review.GetProperty("reviewed_at").GetString()!, CultureInfo.InvariantCulture,
                DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
            var grade = review.GetProperty("rating").GetInt32() - 1;
            var outcome = scheduler.Review(card, grade, at);
            card = outcome.Card;
            var where = $"{name} review #{i++}";

            Assert.True(review.GetProperty("state").GetString() == card.State.ToString(), $"{where}: state");
            if (review.GetProperty("step").ValueKind == JsonValueKind.Number)
                Assert.True(review.GetProperty("step").GetInt32() == card.Step, $"{where}: step");
            AssertClose(review.GetProperty("stability").GetDouble(), card.Stability!.Value, $"{where}: stability");
            AssertClose(review.GetProperty("difficulty").GetDouble(), card.Difficulty!.Value, $"{where}: difficulty");
            Assert.True(
                Math.Abs(review.GetProperty("interval_seconds").GetDouble() - outcome.DisplayInterval.TotalSeconds) < 0.001,
                $"{where}: interval {outcome.DisplayInterval} vs {review.GetProperty("interval_seconds").GetDouble()}s");
        }
    }

    private static IReadOnlyList<TimeSpan> Minutes(JsonElement array) =>
        array.EnumerateArray().Select(e => TimeSpan.FromMinutes(e.GetDouble())).ToList();

    private static void AssertClose(double expected, double actual, string what) =>
        Assert.True(Math.Abs(expected - actual) <= Tolerance * Math.Max(1, Math.Abs(expected)),
            $"{what}: expected {expected:R}, got {actual:R}");
}
