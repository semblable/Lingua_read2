using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;

namespace LinguaReadApi.Services;

public sealed record HardcoverRateLimitBucket(string Name, int? Remaining, int? ResetSeconds);

public sealed class HardcoverRateLimiter
{
    private const int MaxNonDailyWaitSeconds = 300;
    private const int MaxProactiveWaitSeconds = 10;

    private readonly ConcurrentDictionary<Guid, HardcoverThrottleState> _states = new();

    public void Clear(Guid userId) => _states.TryRemove(userId, out _);

    public TimeSpan GetRequiredDelay(
        Guid userId,
        DateTimeOffset now,
        out bool isDailyExhausted,
        out int? dailyResetSeconds,
        string? tokenFingerprint = null)
    {
        isDailyExhausted = false;
        dailyResetSeconds = null;

        if (!_states.TryGetValue(userId, out var state))
        {
            return TimeSpan.Zero;
        }

        lock (state)
        {
            if (tokenFingerprint != null &&
                state.TokenFingerprint != null &&
                !string.Equals(state.TokenFingerprint, tokenFingerprint, StringComparison.Ordinal))
            {
                ResetState(state, tokenFingerprint);
                return TimeSpan.Zero;
            }

            if (state.DailyResetUtc.HasValue)
            {
                if (state.DailyResetUtc.Value > now)
                {
                    isDailyExhausted = true;
                    dailyResetSeconds = Math.Max(1, (int)Math.Ceiling((state.DailyResetUtc.Value - now).TotalSeconds));
                    return TimeSpan.Zero;
                }

                state.DailyResetUtc = null;
                state.DailyResetEstablishedUtc = null;
            }

            if (state.NextAllowedUtc.HasValue)
            {
                if (state.NextAllowedUtc.Value > now)
                {
                    return state.NextAllowedUtc.Value - now;
                }

                state.NextAllowedUtc = null;
                state.NextAllowedEstablishedUtc = null;
            }

            return TimeSpan.Zero;
        }
    }

    public void RecordResponse(
        Guid userId,
        HttpResponseHeaders headers,
        HttpStatusCode statusCode,
        DateTimeOffset now,
        DateTimeOffset? requestStartedUtc = null,
        string? tokenFingerprint = null)
    {
        var state = _states.GetOrAdd(userId, _ => new HardcoverThrottleState());
        var buckets = headers.TryGetValues("RateLimit", out var rateLimitValues)
            ? ParseRateLimitHeader(rateLimitValues)
            : Array.Empty<HardcoverRateLimitBucket>();
        var retryAfterSeconds = ParseRetryAfterSeconds(headers, now);
        var startedUtc = requestStartedUtc ?? now;

        lock (state)
        {
            if (tokenFingerprint != null)
            {
                if (state.TokenFingerprint != null &&
                    !string.Equals(state.TokenFingerprint, tokenFingerprint, StringComparison.Ordinal))
                {
                    ResetState(state, tokenFingerprint);
                }
                else if (state.TokenFingerprint == null)
                {
                    state.TokenFingerprint = tokenFingerprint;
                }
            }

            var dailyExhausted = false;
            var sawNonDailyThrottle = false;
            var sawNonDailyAvailable = false;

            foreach (var bucket in buckets)
            {
                if (string.Equals(bucket.Name, "daily", StringComparison.OrdinalIgnoreCase))
                {
                    if (bucket.Remaining is <= 0)
                    {
                        var resetSeconds = bucket.ResetSeconds switch
                        {
                            > 0 => bucket.ResetSeconds.Value,
                            0 => 2,
                            _ => 3600
                        };
                        var candidate = now + TimeSpan.FromSeconds(resetSeconds);
                        if (!state.DailyResetUtc.HasValue || candidate > state.DailyResetUtc.Value)
                        {
                            state.DailyResetUtc = candidate;
                        }
                        if (!state.DailyResetEstablishedUtc.HasValue || now > state.DailyResetEstablishedUtc.Value)
                        {
                            state.DailyResetEstablishedUtc = now;
                        }
                        dailyExhausted = true;
                    }
                    else if (bucket.Remaining is > 0)
                    {
                        if (!state.DailyResetEstablishedUtc.HasValue || startedUtc >= state.DailyResetEstablishedUtc.Value)
                        {
                            state.DailyResetUtc = null;
                            state.DailyResetEstablishedUtc = null;
                        }
                    }
                }
                else if (bucket.Remaining.HasValue)
                {
                    if (bucket.Remaining.Value <= 0)
                    {
                        var waitSeconds = bucket.ResetSeconds is > 0
                            ? Math.Clamp(bucket.ResetSeconds.Value, 1, MaxNonDailyWaitSeconds)
                            : 2;
                        SetNextAllowed(state, now, waitSeconds);
                        sawNonDailyThrottle = true;
                    }
                    else if (bucket.Remaining.Value == 1)
                    {
                        var maxCap = statusCode == HttpStatusCode.TooManyRequests
                            ? MaxNonDailyWaitSeconds
                            : MaxProactiveWaitSeconds;
                        var waitSeconds = bucket.ResetSeconds is > 0
                            ? Math.Clamp(bucket.ResetSeconds.Value, 1, maxCap)
                            : 2;
                        SetNextAllowed(state, now, waitSeconds);
                        sawNonDailyThrottle = true;
                    }
                    else
                    {
                        sawNonDailyAvailable = true;
                    }
                }
            }

            if (!sawNonDailyThrottle && sawNonDailyAvailable && statusCode != HttpStatusCode.TooManyRequests)
            {
                if (!state.NextAllowedEstablishedUtc.HasValue || startedUtc >= state.NextAllowedEstablishedUtc.Value)
                {
                    state.NextAllowedUtc = null;
                    state.NextAllowedEstablishedUtc = null;
                }
            }

            if (statusCode == HttpStatusCode.TooManyRequests && !dailyExhausted)
            {
                var waitSeconds = retryAfterSeconds is > 0
                    ? Math.Clamp(retryAfterSeconds.Value, 1, MaxNonDailyWaitSeconds)
                    : 2;
                SetNextAllowed(state, now, waitSeconds);
            }
        }
    }

    private static void SetNextAllowed(HardcoverThrottleState state, DateTimeOffset now, int waitSeconds)
    {
        var candidate = now + TimeSpan.FromSeconds(waitSeconds);
        if (!state.NextAllowedUtc.HasValue || candidate > state.NextAllowedUtc.Value)
        {
            state.NextAllowedUtc = candidate;
        }
        if (!state.NextAllowedEstablishedUtc.HasValue || now > state.NextAllowedEstablishedUtc.Value)
        {
            state.NextAllowedEstablishedUtc = now;
        }
    }

    private static void ResetState(HardcoverThrottleState state, string? newFingerprint)
    {
        state.TokenFingerprint = newFingerprint;
        state.NextAllowedUtc = null;
        state.DailyResetUtc = null;
        state.NextAllowedEstablishedUtc = null;
        state.DailyResetEstablishedUtc = null;
    }

    public static int? ParseRetryAfterSeconds(HttpResponseHeaders headers) =>
        ParseRetryAfterSeconds(headers, DateTimeOffset.UtcNow);

    public static int? ParseRetryAfterSeconds(HttpResponseHeaders headers, DateTimeOffset now)
    {
        if (headers.RetryAfter == null)
        {
            return null;
        }

        if (headers.RetryAfter.Delta.HasValue)
        {
            var seconds = (int)Math.Ceiling(headers.RetryAfter.Delta.Value.TotalSeconds);
            return seconds > 0 ? seconds : 1;
        }

        if (headers.RetryAfter.Date.HasValue)
        {
            var seconds = (int)Math.Ceiling((headers.RetryAfter.Date.Value - now).TotalSeconds);
            return seconds > 0 ? seconds : 1;
        }

        return null;
    }

    public static IReadOnlyList<HardcoverRateLimitBucket> ParseRateLimitHeader(IEnumerable<string> values)
    {
        var buckets = new List<HardcoverRateLimitBucket>();
        foreach (var rawHeader in values)
        {
            if (string.IsNullOrWhiteSpace(rawHeader))
            {
                continue;
            }

            foreach (var entry in SplitRespectingQuotes(rawHeader, ','))
            {
                var parts = SplitRespectingQuotes(entry, ';');
                if (parts.Count == 0)
                {
                    continue;
                }

                var name = parts[0].Trim().Trim('"');
                if (string.IsNullOrEmpty(name))
                {
                    continue;
                }

                int? remaining = null;
                int? resetSeconds = null;

                for (var i = 1; i < parts.Count; i++)
                {
                    var eqIndex = parts[i].IndexOf('=');
                    if (eqIndex <= 0 || eqIndex == parts[i].Length - 1)
                    {
                        continue;
                    }

                    var key = parts[i][..eqIndex].Trim();
                    var value = parts[i][(eqIndex + 1)..].Trim().Trim('"');
                    if (string.Equals(key, "r", StringComparison.OrdinalIgnoreCase) &&
                        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var r))
                    {
                        remaining = r;
                    }
                    else if (string.Equals(key, "t", StringComparison.OrdinalIgnoreCase) &&
                             int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var t))
                    {
                        resetSeconds = t;
                    }
                }

                buckets.Add(new HardcoverRateLimitBucket(name, remaining, resetSeconds));
            }
        }

        return buckets;
    }

    private static List<string> SplitRespectingQuotes(string input, char delimiter)
    {
        var parts = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;
        var escaped = false;

        foreach (var c in input)
        {
            if (escaped)
            {
                current.Append(c);
                escaped = false;
                continue;
            }

            if (c == '\\' && inQuotes)
            {
                escaped = true;
                current.Append(c);
                continue;
            }

            if (c == '"')
            {
                inQuotes = !inQuotes;
                current.Append(c);
                continue;
            }

            if (c == delimiter && !inQuotes)
            {
                var segment = current.ToString().Trim();
                if (segment.Length > 0)
                {
                    parts.Add(segment);
                }
                current.Clear();
                continue;
            }

            current.Append(c);
        }

        var last = current.ToString().Trim();
        if (last.Length > 0)
        {
            parts.Add(last);
        }

        return parts;
    }

    private sealed class HardcoverThrottleState
    {
        public string? TokenFingerprint { get; set; }
        public DateTimeOffset? NextAllowedUtc { get; set; }
        public DateTimeOffset? DailyResetUtc { get; set; }
        public DateTimeOffset? NextAllowedEstablishedUtc { get; set; }
        public DateTimeOffset? DailyResetEstablishedUtc { get; set; }
    }
}
