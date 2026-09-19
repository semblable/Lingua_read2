using System;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>FSRS ratings. The public SRS API uses grades 0-3; rating = grade + 1.</summary>
    public enum FsrsRating
    {
        Again = 1,
        Hard = 2,
        Good = 3,
        Easy = 4,
    }

    /// <summary>
    /// Pure FSRS-6 memory model: stability, difficulty, retrievability and interval
    /// math. A line-by-line port of py-fsrs (fsrs/scheduler.py); the state machine
    /// that decides *which* of these to apply lives in <see cref="SrsScheduler"/>.
    /// </summary>
    public sealed class FsrsAlgorithm
    {
        public const double StabilityMin = 0.001;
        public const double DifficultyMin = 1.0;
        public const double DifficultyMax = 10.0;

        private readonly FsrsParameters _p;

        public FsrsAlgorithm(FsrsParameters? parameters = null)
        {
            _p = parameters ?? FsrsParameters.Default;
        }

        public FsrsParameters Parameters => _p;

        public static FsrsRating RatingFromGrade(int grade) => grade switch
        {
            0 => FsrsRating.Again,
            1 => FsrsRating.Hard,
            2 => FsrsRating.Good,
            3 => FsrsRating.Easy,
            _ => throw new ArgumentOutOfRangeException(nameof(grade), grade, "Grade must be 0-3."),
        };

        public double InitialStability(FsrsRating rating) =>
            ClampStability(_p[(int)rating - 1]);

        public double InitialDifficulty(FsrsRating rating, bool clamp = true)
        {
            var d = _p[4] - Math.Exp(_p[5] * ((int)rating - 1)) + 1;
            return clamp ? ClampDifficulty(d) : d;
        }

        public double NextDifficulty(double difficulty, FsrsRating rating)
        {
            var easyInitial = InitialDifficulty(FsrsRating.Easy, clamp: false);
            var delta = -(_p[6] * ((int)rating - 3));
            var damped = difficulty + (10.0 - difficulty) * delta / 9.0;
            var reverted = _p[7] * easyInitial + (1 - _p[7]) * damped;
            return ClampDifficulty(reverted);
        }

        /// <summary>Probability of recall after <paramref name="elapsedDays"/> at the given stability.</summary>
        public double Retrievability(double elapsedDays, double stability) =>
            Math.Pow(1 + _p.Factor * Math.Max(0, elapsedDays) / stability, _p.Decay);

        public double NextRecallStability(double difficulty, double stability, double retrievability, FsrsRating rating)
        {
            var hardPenalty = rating == FsrsRating.Hard ? _p[15] : 1;
            var easyBonus = rating == FsrsRating.Easy ? _p[16] : 1;
            return stability * (1
                + Math.Exp(_p[8])
                * (11 - difficulty)
                * Math.Pow(stability, -_p[9])
                * (Math.Exp((1 - retrievability) * _p[10]) - 1)
                * hardPenalty
                * easyBonus);
        }

        public double NextForgetStability(double difficulty, double stability, double retrievability)
        {
            var longTerm = _p[11]
                * Math.Pow(difficulty, -_p[12])
                * (Math.Pow(stability + 1, _p[13]) - 1)
                * Math.Exp((1 - retrievability) * _p[14]);
            var shortTerm = stability / Math.Exp(_p[17] * _p[18]);
            return Math.Min(longTerm, shortTerm);
        }

        /// <summary>Stability after a review on a later day (clamped).</summary>
        public double NextStability(double difficulty, double stability, double retrievability, FsrsRating rating)
        {
            var next = rating == FsrsRating.Again
                ? NextForgetStability(difficulty, stability, retrievability)
                : NextRecallStability(difficulty, stability, retrievability, rating);
            return ClampStability(next);
        }

        /// <summary>Stability after a same-day review (clamped). Passing grades never shrink it.</summary>
        public double ShortTermStability(double stability, FsrsRating rating)
        {
            var increase = Math.Exp(_p[17] * ((int)rating - 3 + _p[18])) * Math.Pow(stability, -_p[19]);
            if (rating != FsrsRating.Again)
                increase = Math.Max(increase, 1.0);
            return ClampStability(stability * increase);
        }

        /// <summary>Whole-day interval at which retrievability decays to <paramref name="desiredRetention"/>.</summary>
        public int NextIntervalDays(double stability, double desiredRetention, int maximumIntervalDays)
        {
            var raw = stability / _p.Factor * (Math.Pow(desiredRetention, 1.0 / _p.Decay) - 1);
            // Math.Round defaults to banker's rounding, matching Python's round().
            var days = (int)Math.Round(raw);
            return Math.Min(Math.Max(days, 1), Math.Max(1, maximumIntervalDays));
        }

        /// <summary>
        /// Inclusive [min, max] range an interval may be fuzzed into. Intervals under 2.5
        /// days are never fuzzed (min == max == interval).
        /// </summary>
        public static (int Min, int Max) FuzzRange(int intervalDays, int maximumIntervalDays)
        {
            if (intervalDays < 2.5) return (intervalDays, intervalDays);

            double delta = 1.0;
            delta += 0.15 * Math.Max(Math.Min(intervalDays, 7.0) - 2.5, 0.0);
            delta += 0.10 * Math.Max(Math.Min(intervalDays, 20.0) - 7.0, 0.0);
            delta += 0.05 * Math.Max(intervalDays - 20.0, 0.0);

            var min = (int)Math.Round(intervalDays - delta);
            var max = (int)Math.Round(intervalDays + delta);
            min = Math.Max(2, min);
            max = Math.Min(max, maximumIntervalDays);
            min = Math.Min(min, max);
            return (min, max);
        }

        /// <summary>
        /// Picks a uniformly random whole day in <see cref="FuzzRange"/>. Unlike py-fsrs we draw
        /// an integer directly (py-fsrs rounds a float drawn from [min, max+1), which can overshoot max).
        /// </summary>
        public static int Fuzz(int intervalDays, int maximumIntervalDays, Random random)
        {
            var (min, max) = FuzzRange(intervalDays, maximumIntervalDays);
            if (min >= max) return min;
            return random.Next(min, max + 1);
        }

        private static double ClampStability(double stability) => Math.Max(stability, StabilityMin);

        private static double ClampDifficulty(double difficulty) =>
            Math.Min(Math.Max(difficulty, DifficultyMin), DifficultyMax);
    }
}
