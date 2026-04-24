using System;

namespace LinguaReadApi.Utilities
{
    public static class CefrEstimator
    {
        private static readonly string[] Levels = { "A1", "A2", "B1", "B2", "C1", "C2" };

        private static readonly int[] DefaultThresholds = { 0, 1000, 2000, 4000, 8000, 16000 };

        private static readonly int[] CjkThresholds = { 0, 500, 1500, 3000, 6000, 12000 };

        public static (string Level, string? NextLevel, int KnownToNext) Estimate(
            int knownWords, string? languageCode)
        {
            if (knownWords < 0) knownWords = 0;

            var thresholds = IsCjk(languageCode) ? CjkThresholds : DefaultThresholds;

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
            int knownToNext = nextLevel != null
                ? Math.Max(0, thresholds[levelIndex + 1] - knownWords)
                : 0;

            return (level, nextLevel, knownToNext);
        }

        private static bool IsCjk(string? languageCode)
        {
            if (string.IsNullOrEmpty(languageCode)) return false;
            var prefix = languageCode.Split('-')[0].ToLowerInvariant();
            return prefix == "ja" || prefix == "zh" || prefix == "ko";
        }
    }
}
