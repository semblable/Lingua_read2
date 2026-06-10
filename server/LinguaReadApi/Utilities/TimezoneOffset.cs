using System;

namespace LinguaReadApi.Utilities
{
    public static class TimezoneOffset
    {
        // Real-world UTC offsets span -12:00 to +14:00. Clamping the client-supplied
        // value keeps an extreme query parameter from skewing the local-day boundary
        // math in the activity/goal endpoints by years.
        public const int MinMinutes = -14 * 60;
        public const int MaxMinutes = 14 * 60;

        public static int Clamp(int minutes) => Math.Clamp(minutes, MinMinutes, MaxMinutes);

        public static int? Clamp(int? minutes) => minutes.HasValue ? Clamp(minutes.Value) : null;
    }
}
