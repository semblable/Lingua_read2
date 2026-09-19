using System;

namespace LinguaReadApi.Utilities
{
    /// <summary>
    /// The SRS "user day": a local calendar day that rolls over at
    /// <c>dayStartHour</c> local time rather than at midnight UTC (Anki's
    /// "next day starts at"). Review cards fall due at the start of a user day,
    /// and daily limits, streaks and bury all count in user days.
    /// </summary>
    public static class SrsDay
    {
        public const int DefaultDayStartHour = 4;

        public static int ClampDayStartHour(int hour) => Math.Clamp(hour, 0, 23);

        /// <summary>The user day an instant belongs to.</summary>
        public static DateOnly UserDay(DateTime utc, int tzOffsetMinutes, int dayStartHour)
        {
            var local = AsUtc(utc)
                .AddMinutes(TimezoneOffset.Clamp(tzOffsetMinutes))
                .AddHours(-ClampDayStartHour(dayStartHour));
            return DateOnly.FromDateTime(local);
        }

        /// <summary>The UTC instant at which <paramref name="day"/> begins.</summary>
        public static DateTime DayStartUtc(DateOnly day, int tzOffsetMinutes, int dayStartHour)
        {
            var localStart = day.ToDateTime(new TimeOnly(ClampDayStartHour(dayStartHour), 0));
            return DateTime.SpecifyKind(
                localStart.AddMinutes(-TimezoneOffset.Clamp(tzOffsetMinutes)),
                DateTimeKind.Utc);
        }

        /// <summary>Whole user days from <paramref name="fromUtc"/> to <paramref name="toUtc"/> (negative if earlier).</summary>
        public static int DaysBetween(DateTime fromUtc, DateTime toUtc, int tzOffsetMinutes, int dayStartHour) =>
            UserDay(toUtc, tzOffsetMinutes, dayStartHour).DayNumber
            - UserDay(fromUtc, tzOffsetMinutes, dayStartHour).DayNumber;

        /// <summary>
        /// Npgsql hands back timestamptz as Kind=Utc, but in-memory/test values (and
        /// client-sent ones) may be Unspecified; every DateTime in the SRS tables is UTC by convention.
        /// </summary>
        public static DateTime AsUtc(DateTime value) =>
            value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : DateTime.SpecifyKind(value, DateTimeKind.Utc);
    }
}
