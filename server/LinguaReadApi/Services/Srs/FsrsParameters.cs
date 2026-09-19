using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>
    /// The 21 FSRS-6 model weights (w0..w20). Values and bounds are ported from
    /// py-fsrs (open-spaced-repetition/py-fsrs, fsrs/scheduler.py), which is the
    /// reference the golden vectors in the test project are generated from.
    /// </summary>
    public sealed class FsrsParameters
    {
        public const int Count = 21;

        public static readonly IReadOnlyList<double> DefaultWeights = new[]
        {
            0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
            1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
        };

        private const double StabilityMin = FsrsAlgorithm.StabilityMin;
        private const double InitialStabilityMax = 100.0;

        private static readonly double[] LowerBounds =
        {
            StabilityMin, StabilityMin, StabilityMin, StabilityMin,
            1.0, 0.001, 0.001, 0.001, 0.0, 0.0, 0.001, 0.001, 0.001, 0.001, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.1,
        };

        private static readonly double[] UpperBounds =
        {
            InitialStabilityMax, InitialStabilityMax, InitialStabilityMax, InitialStabilityMax,
            10.0, 4.0, 4.0, 0.75, 4.5, 0.8, 3.5, 5.0, 0.25, 0.9, 4.0, 1.0, 6.0, 2.0, 2.0, 0.8, 0.8,
        };

        public static FsrsParameters Default { get; } = new FsrsParameters(DefaultWeights.ToArray());

        private readonly double[] _w;

        private FsrsParameters(double[] weights)
        {
            _w = weights;
            Decay = -weights[20];
            Factor = Math.Pow(0.9, 1.0 / Decay) - 1.0;
        }

        public double this[int index] => _w[index];

        public IReadOnlyList<double> Weights => _w;

        /// <summary>Exponent of the power forgetting curve (negative).</summary>
        public double Decay { get; }

        /// <summary>Chosen so that retrievability is exactly 0.9 when elapsed days equal stability.</summary>
        public double Factor { get; }

        /// <summary>
        /// Parses a comma/whitespace-separated list of 21 weights. Null or blank means
        /// "use the defaults" and succeeds. Any other malformed or out-of-bounds input fails
        /// with a human-readable error.
        /// </summary>
        public static bool TryParse(string? raw, out FsrsParameters parameters, out string? error)
        {
            parameters = Default;
            error = null;
            if (string.IsNullOrWhiteSpace(raw)) return true;

            var parts = raw.Split(new[] { ',', ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != Count)
            {
                error = $"FSRS weights must contain exactly {Count} numbers (got {parts.Length}).";
                return false;
            }

            var weights = new double[Count];
            for (int i = 0; i < Count; i++)
            {
                if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
                    || double.IsNaN(value) || double.IsInfinity(value))
                {
                    error = $"FSRS weight w{i} is not a number: '{parts[i]}'.";
                    return false;
                }
                if (value < LowerBounds[i] || value > UpperBounds[i])
                {
                    error = $"FSRS weight w{i} = {value.ToString(CultureInfo.InvariantCulture)} is outside [{LowerBounds[i].ToString(CultureInfo.InvariantCulture)}, {UpperBounds[i].ToString(CultureInfo.InvariantCulture)}].";
                    return false;
                }
                weights[i] = value;
            }

            parameters = new FsrsParameters(weights);
            return true;
        }

        /// <summary>Like <see cref="TryParse"/> but falls back to the defaults on bad input.</summary>
        public static FsrsParameters ParseOrDefault(string? raw) =>
            TryParse(raw, out var parameters, out _) ? parameters : Default;
    }
}
