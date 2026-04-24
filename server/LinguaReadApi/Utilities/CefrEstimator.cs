using System;
using System.Collections.Generic;

namespace LinguaReadApi.Utilities
{
    public static class CefrEstimator
    {
        private static readonly string[] Levels = { "A1", "A2", "B1", "B2", "C1", "C2" };

        // Per-language known-word thresholds for A1 / A2 / B1 / B2 / C1 / C2.
        // Lookup by ISO-639 language prefix. Below the A1 threshold the learner
        // is treated as "pre-A1" (level = null, next = A1).
        private static readonly Dictionary<string, int[]> ThresholdsByLanguage =
            new(StringComparer.OrdinalIgnoreCase)
            {
                ["en"] = new[] { 500, 1500, 6000, 12000, 20750, 30250 },
                ["fr"] = new[] { 680, 2040, 8160, 16320, 28220, 41140 },
                ["es"] = new[] { 670, 2010, 8040, 16080, 27805, 40535 },
                ["de"] = new[] { 690, 2070, 8280, 16560, 28635, 41745 },
                ["it"] = new[] { 720, 2160, 8640, 17280, 29880, 43560 },
                ["pt"] = new[] { 665, 1995, 7980, 15960, 27598, 40233 },
                ["ru"] = new[] { 855, 2565, 10260, 20520, 35483, 51728 },
                ["zh"] = new[] { 585, 1755, 7020, 14040, 24278, 35393 },
                ["ja"] = new[] { 665, 1995, 7980, 15960, 27598, 40233 },
                ["ko"] = new[] { 1085, 3255, 13020, 26040, 45028, 65643 },
                ["ar"] = new[] { 945, 2835, 11340, 22680, 39218, 57173 },
                ["uk"] = new[] { 990, 2970, 11880, 23760, 41085, 59895 },
                ["nl"] = new[] { 560, 1680, 6720, 13440, 23240, 33880 },
                ["sv"] = new[] { 545, 1635, 6540, 13080, 22618, 32973 },
                ["pl"] = new[] { 850, 2550, 10200, 20400, 35275, 51425 },
                ["ro"] = new[] { 760, 2280, 9120, 18240, 31540, 45890 },
                ["el"] = new[] { 865, 2595, 10380, 20760, 35898, 52333 },
            };

        // Fallback thresholds when the language code is not in the table above.
        // Matches English as a middle-of-the-road default. Estimates returned
        // from this fallback are flagged as approximate so the UI can mark them.
        private static readonly int[] DefaultThresholds =
            { 500, 1500, 6000, 12000, 20750, 30250 };

        public readonly record struct Result(
            string? Level,
            string? NextLevel,
            int KnownToNext,
            int BandProgressPercent,
            bool IsApproximate);

        public static Result Estimate(int knownWords, string? languageCode)
        {
            if (knownWords < 0) knownWords = 0;

            var (thresholds, isApproximate) = ResolveThresholds(languageCode);

            // Below the A1 threshold: pre-A1, next target is A1, band runs 0 -> A1.
            if (knownWords < thresholds[0])
            {
                int pct = thresholds[0] == 0
                    ? 0
                    : (int)Math.Round((double)knownWords / thresholds[0] * 100);
                return new Result(
                    Level: null,
                    NextLevel: Levels[0],
                    KnownToNext: thresholds[0] - knownWords,
                    BandProgressPercent: Math.Clamp(pct, 0, 100),
                    IsApproximate: isApproximate);
            }

            int levelIndex = 0;
            for (int i = Levels.Length - 1; i >= 0; i--)
            {
                if (knownWords >= thresholds[i])
                {
                    levelIndex = i;
                    break;
                }
            }

            string level = Levels[levelIndex];
            string? nextLevel = levelIndex < Levels.Length - 1 ? Levels[levelIndex + 1] : null;

            int knownToNext;
            int bandProgressPercent;
            if (nextLevel != null)
            {
                int bandStart = thresholds[levelIndex];
                int bandEnd = thresholds[levelIndex + 1];
                int bandSize = Math.Max(1, bandEnd - bandStart);
                int intoBand = Math.Max(0, knownWords - bandStart);
                knownToNext = Math.Max(0, bandEnd - knownWords);
                bandProgressPercent = Math.Clamp(
                    (int)Math.Round((double)intoBand / bandSize * 100), 0, 100);
            }
            else
            {
                knownToNext = 0;
                bandProgressPercent = 100;
            }

            return new Result(level, nextLevel, knownToNext, bandProgressPercent, isApproximate);
        }

        // Exposes the lookup result so callers can log a one-time warning for
        // languages that fall back to the default table.
        private static (int[] Thresholds, bool IsApproximate) ResolveThresholds(string? languageCode)
        {
            if (string.IsNullOrEmpty(languageCode)) return (DefaultThresholds, true);
            var prefix = languageCode.Split('-')[0].ToLowerInvariant();
            return ThresholdsByLanguage.TryGetValue(prefix, out var t)
                ? (t, false)
                : (DefaultThresholds, true);
        }

        public static bool HasThresholdsFor(string? languageCode)
        {
            if (string.IsNullOrEmpty(languageCode)) return false;
            var prefix = languageCode.Split('-')[0].ToLowerInvariant();
            return ThresholdsByLanguage.ContainsKey(prefix);
        }
    }
}
