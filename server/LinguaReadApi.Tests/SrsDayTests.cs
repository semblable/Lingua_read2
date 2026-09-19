using System;
using System.Linq;
using LinguaReadApi.Services.Srs;
using LinguaReadApi.Utilities;
using Xunit;

namespace LinguaReadApi.Tests;

public class SrsDayTests
{
    [Theory]
    // 2026-03-10 02:30 UTC seen from several offsets, with midnight and 04:00 day starts.
    [InlineData(-300, 0, "2026-03-09")] // 21:30 local on the 9th
    [InlineData(-300, 4, "2026-03-09")]
    [InlineData(0, 0, "2026-03-10")]
    [InlineData(0, 4, "2026-03-09")]    // 02:30 is before the 04:00 rollover
    [InlineData(120, 0, "2026-03-10")]  // 04:30 local
    [InlineData(120, 4, "2026-03-10")]
    [InlineData(840, 0, "2026-03-10")]  // 16:30 local
    [InlineData(840, 4, "2026-03-10")]
    public void UserDay_AppliesOffsetAndDayStart(int offset, int dayStart, string expected)
    {
        var utc = new DateTime(2026, 3, 10, 2, 30, 0, DateTimeKind.Utc);
        Assert.Equal(DateOnly.Parse(expected), SrsDay.UserDay(utc, offset, dayStart));
    }

    [Theory]
    [InlineData(-300, 0)]
    [InlineData(-300, 4)]
    [InlineData(0, 0)]
    [InlineData(0, 4)]
    [InlineData(120, 4)]
    [InlineData(840, 4)]
    public void DayStartUtc_IsTheFirstInstantOfThatUserDay(int offset, int dayStart)
    {
        var day = new DateOnly(2026, 3, 29); // DST change in Europe; offsets are explicit here anyway
        var start = SrsDay.DayStartUtc(day, offset, dayStart);

        Assert.Equal(DateTimeKind.Utc, start.Kind);
        Assert.Equal(day, SrsDay.UserDay(start, offset, dayStart));
        Assert.Equal(day.AddDays(-1), SrsDay.UserDay(start.AddTicks(-1), offset, dayStart));
    }

    [Fact]
    public void DayStartUtc_ForUtcPlusTwoAtFourAm_IsTwoAmUtc()
    {
        Assert.Equal(new DateTime(2026, 3, 10, 2, 0, 0, DateTimeKind.Utc),
            SrsDay.DayStartUtc(new DateOnly(2026, 3, 10), 120, 4));
    }

    [Fact]
    public void DaysBetween_CountsDayBoundariesNot24hSpans()
    {
        var lateEvening = new DateTime(2026, 3, 10, 23, 0, 0, DateTimeKind.Utc);
        var nextMorning = new DateTime(2026, 3, 11, 5, 0, 0, DateTimeKind.Utc);

        Assert.Equal(1, SrsDay.DaysBetween(lateEvening, nextMorning, 0, 4));
        Assert.Equal(0, SrsDay.DaysBetween(lateEvening, nextMorning.AddHours(-2), 0, 4)); // 03:00 is still "yesterday"
        Assert.Equal(-1, SrsDay.DaysBetween(nextMorning, lateEvening, 0, 4));
    }

    [Fact]
    public void ExtremeInputs_AreClamped()
    {
        var utc = new DateTime(2026, 3, 10, 12, 0, 0, DateTimeKind.Utc);
        Assert.Equal(SrsDay.UserDay(utc, TimezoneOffset.MaxMinutes, 0), SrsDay.UserDay(utc, 100_000, 0));
        Assert.Equal(SrsDay.UserDay(utc, 0, 23), SrsDay.UserDay(utc, 0, 99));
        Assert.Equal(SrsDay.UserDay(utc, 0, 0), SrsDay.UserDay(utc, 0, -5));
    }

    [Fact]
    public void UnspecifiedKind_IsTreatedAsUtc()
    {
        var unspecified = new DateTime(2026, 3, 10, 2, 30, 0, DateTimeKind.Unspecified);
        var utc = DateTime.SpecifyKind(unspecified, DateTimeKind.Utc);
        Assert.Equal(SrsDay.UserDay(utc, 120, 4), SrsDay.UserDay(unspecified, 120, 4));
    }
}

public class FsrsParametersTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void BlankInput_MeansDefaults(string? raw)
    {
        Assert.True(FsrsParameters.TryParse(raw, out var parameters, out var error));
        Assert.Null(error);
        Assert.Same(FsrsParameters.Default, parameters);
    }

    [Fact]
    public void ValidList_IsParsed_WithCommasOrWhitespace()
    {
        var raw = string.Join(", ", FsrsParameters.DefaultWeights.Select(w => w.ToString(System.Globalization.CultureInfo.InvariantCulture)))
            .Replace(", 1.4835", "\n1.4835");
        raw = raw.Replace("0.212", "0.3");

        Assert.True(FsrsParameters.TryParse(raw, out var parameters, out var error), error);
        Assert.Equal(0.3, parameters[0]);
        Assert.Equal(0.3, new FsrsAlgorithm(parameters).InitialStability(FsrsRating.Again));
        Assert.Equal(FsrsParameters.Default.Decay, parameters.Decay);
    }

    [Theory]
    [InlineData("1,2,3", "exactly 21")]
    [InlineData("0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, abc", "not a number")]
    [InlineData("0.212, 1.2931, 2.3065, 8.2956, 11, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542", "w4")]
    public void InvalidInput_FailsWithReason(string raw, string expectedFragment)
    {
        Assert.False(FsrsParameters.TryParse(raw, out var parameters, out var error));
        Assert.Same(FsrsParameters.Default, parameters);
        Assert.Contains(expectedFragment, error);
        Assert.Same(FsrsParameters.Default, FsrsParameters.ParseOrDefault(raw));
    }
}
