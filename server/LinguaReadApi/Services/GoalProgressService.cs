using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services
{
    public interface IGoalProgressService
    {
        // Computes derived progress for a set of goals belonging to one user.
        // Side effects: writes UserGoalPeriod rows for elapsed recurring periods,
        // rolls forward CurrentPeriodStart/Baseline, and stamps CompletedAt for
        // one-shot goals on first completion. Caller must SaveChangesAsync.
        Task<IReadOnlyList<GoalProgressDto>> ComputeAsync(
            Guid userId,
            IEnumerable<UserGoal> goals,
            int tzOffsetMinutes,
            DateTime utcNow);

        // Captures the current metric value for a (type, scope) tuple so a
        // freshly-created goal can store its baseline.
        Task<long> SnapshotMetricAsync(Guid userId, GoalType type, int? languageId);
    }

    public sealed class GoalProgressDto
    {
        public int GoalId { get; set; }
        public Guid UserId { get; set; }
        public int? LanguageId { get; set; }
        public string? LanguageName { get; set; }
        public GoalType GoalType { get; set; }
        public GoalMode Mode { get; set; }
        public GoalRecurrence Recurrence { get; set; }
        public long TargetValue { get; set; }
        public long BaselineValue { get; set; }
        public long Progress { get; set; }            // signed; can be negative for words-known regression
        public double PercentComplete { get; set; }   // clamped 0..1 for the bar
        public DateOnly? Deadline { get; set; }
        public DateOnly? CurrentPeriodStart { get; set; }
        public DateOnly? CurrentPeriodEnd { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public DateTime? ArchivedAt { get; set; }
        public string? Title { get; set; }

        // Derived render-time state. One of:
        // "active", "completed", "overdue", "archived",
        // "in_progress" (recurring), "hit_this_period" (recurring).
        public string State { get; set; } = "active";

        // For one-shot Delta with deadline only. null otherwise.
        public string? Pace { get; set; }            // "on_track" | "ahead" | "slightly_behind" | "behind"
        public long? ExpectedAtToday { get; set; }   // expected progress by today
        public long? RemainingToTarget { get; set; }

        // Rolling-pace inferred finish date for goals with no deadline.
        public DateOnly? InferredFinishOn { get; set; }

        // Most recently closed period (for recurring goals) — populated only if it just rolled.
        public ClosedPeriodDto? LastClosedPeriod { get; set; }
    }

    public sealed class ClosedPeriodDto
    {
        public DateOnly PeriodStart { get; set; }
        public DateOnly PeriodEnd { get; set; }
        public long FinalProgress { get; set; }
        public long TargetAtTime { get; set; }
        public bool Completed { get; set; }
    }

    public sealed class GoalProgressService : IGoalProgressService
    {
        private readonly AppDbContext _db;

        // Activity types that count toward "Words read".
        private static readonly string[] ReadingTypes =
            { "Reading", "ManualReading", "TextCompleted", "LessonCompleted", "BookFinished" };

        // Activity types that count toward "Listening seconds".
        private static readonly string[] ListeningTypes =
            { "Listening", "ManualListening" };

        public GoalProgressService(AppDbContext db)
        {
            _db = db;
        }

        public async Task<long> SnapshotMetricAsync(Guid userId, GoalType type, int? languageId)
        {
            switch (type)
            {
                case GoalType.WordsRead:
                {
                    var q = _db.UserActivities.AsNoTracking()
                        .Where(a => a.UserId == userId && ReadingTypes.Contains(a.ActivityType));
                    if (languageId.HasValue) q = q.Where(a => a.LanguageId == languageId.Value);
                    return await q.SumAsync(a => (long)a.WordCount);
                }
                case GoalType.ListeningSeconds:
                {
                    var q = _db.UserActivities.AsNoTracking()
                        .Where(a => a.UserId == userId && ListeningTypes.Contains(a.ActivityType));
                    if (languageId.HasValue) q = q.Where(a => a.LanguageId == languageId.Value);
                    return await q.SumAsync(a => (long?)a.ListeningDurationSeconds ?? 0L);
                }
                case GoalType.WordsKnown:
                {
                    var q = _db.Words.AsNoTracking()
                        .Where(w => w.UserId == userId && w.Status >= 4 && w.Status <= 5);
                    if (languageId.HasValue) q = q.Where(w => w.LanguageId == languageId.Value);
                    return await q.LongCountAsync();
                }
                default:
                    throw new ArgumentOutOfRangeException(nameof(type));
            }
        }

        public async Task<IReadOnlyList<GoalProgressDto>> ComputeAsync(
            Guid userId,
            IEnumerable<UserGoal> goals,
            int tzOffsetMinutes,
            DateTime utcNow)
        {
            var goalList = goals as IList<UserGoal> ?? goals.ToList();
            if (goalList.Count == 0) return Array.Empty<GoalProgressDto>();

            var todayUserTz = DateOnly.FromDateTime(utcNow.AddMinutes(tzOffsetMinutes));

            // Bucket goals by (type, scope) so we run one metric query per bucket.
            var buckets = goalList
                .GroupBy(g => (g.GoalType, g.LanguageId))
                .ToList();

            var metricByBucket = new Dictionary<(GoalType, int?), long>();
            foreach (var b in buckets)
            {
                metricByBucket[(b.Key.GoalType, b.Key.LanguageId)] =
                    await SnapshotMetricAsync(userId, b.Key.GoalType, b.Key.LanguageId);
            }

            // For language-name resolution
            var languageIds = goalList.Where(g => g.LanguageId.HasValue)
                                      .Select(g => g.LanguageId!.Value)
                                      .Distinct()
                                      .ToList();
            var languageNames = languageIds.Count == 0
                ? new Dictionary<int, string>()
                : await _db.Languages.AsNoTracking()
                    .Where(l => languageIds.Contains(l.LanguageId))
                    .ToDictionaryAsync(l => l.LanguageId, l => l.Name);

            var output = new List<GoalProgressDto>(goalList.Count);

            foreach (var goal in goalList)
            {
                var current = metricByBucket[(goal.GoalType, goal.LanguageId)];
                ClosedPeriodDto? lastClosed = null;

                // Recurring rollover (lazy): close any periods whose end < today.
                if (goal.Recurrence != GoalRecurrence.None)
                {
                    lastClosed = await RollPeriodsForwardAsync(goal, current, todayUserTz, utcNow);
                }

                long baseline = goal.Mode == GoalMode.Milestone
                    ? 0
                    : goal.Recurrence != GoalRecurrence.None
                        ? (goal.CurrentPeriodBaseline ?? goal.BaselineValue)
                        : goal.BaselineValue;

                long progress = goal.Mode == GoalMode.Milestone
                    ? current
                    : current - baseline;

                double percent = goal.TargetValue <= 0
                    ? 0
                    : Math.Clamp((double)progress / goal.TargetValue, 0, 1);

                bool hitTarget = progress >= goal.TargetValue;

                // Sticky completion for one-shot goals.
                if (goal.Recurrence == GoalRecurrence.None && hitTarget && goal.CompletedAt == null
                    && goal.ArchivedAt == null)
                {
                    goal.CompletedAt = utcNow;
                }

                var dto = new GoalProgressDto
                {
                    GoalId = goal.GoalId,
                    UserId = goal.UserId,
                    LanguageId = goal.LanguageId,
                    LanguageName = goal.LanguageId.HasValue && languageNames.TryGetValue(goal.LanguageId.Value, out var ln) ? ln : null,
                    GoalType = goal.GoalType,
                    Mode = goal.Mode,
                    Recurrence = goal.Recurrence,
                    TargetValue = goal.TargetValue,
                    BaselineValue = baseline,
                    Progress = progress,
                    PercentComplete = percent,
                    Deadline = goal.Deadline,
                    CurrentPeriodStart = goal.CurrentPeriodStart,
                    CurrentPeriodEnd = goal.CurrentPeriodStart.HasValue ? PeriodEndOf(goal.CurrentPeriodStart.Value, goal.Recurrence) : (DateOnly?)null,
                    CreatedAt = goal.CreatedAt,
                    CompletedAt = goal.CompletedAt,
                    ArchivedAt = goal.ArchivedAt,
                    Title = goal.Title,
                    LastClosedPeriod = lastClosed,
                    RemainingToTarget = Math.Max(0, goal.TargetValue - progress)
                };

                AssignStateAndPace(dto, goal, todayUserTz);
                output.Add(dto);
            }

            return output;
        }

        // Closes elapsed periods and rolls forward CurrentPeriodStart/Baseline.
        // Returns the most recently closed period (if any) for UI nudges.
        private async Task<ClosedPeriodDto?> RollPeriodsForwardAsync(
            UserGoal goal,
            long currentMetric,
            DateOnly todayUserTz,
            DateTime utcNow)
        {
            // Initialise period bookkeeping if missing (older rows or test data).
            if (!goal.CurrentPeriodStart.HasValue)
            {
                goal.CurrentPeriodStart = PeriodStartContaining(
                    DateOnly.FromDateTime(goal.CreatedAt.AddMinutes(goal.CreatedTzOffsetMin)),
                    goal.Recurrence);
                goal.CurrentPeriodBaseline = goal.BaselineValue;
            }

            ClosedPeriodDto? lastClosed = null;
            // Loop with a cap to prevent runaway in case of corrupted data.
            for (int i = 0; i < 520; i++) // 10 years of weekly rollovers, way past any real case
            {
                var pStart = goal.CurrentPeriodStart!.Value;
                var pEnd = PeriodEndOf(pStart, goal.Recurrence);
                if (pEnd >= todayUserTz) break; // still in current period

                long finalProgress = await ComputeFinalProgressForClosedPeriodAsync(
                    goal, pStart, pEnd, currentMetric);

                var period = new UserGoalPeriod
                {
                    GoalId = goal.GoalId,
                    PeriodStart = pStart,
                    PeriodEnd = pEnd,
                    FinalProgress = finalProgress,
                    TargetAtTime = goal.TargetValue,
                    Completed = finalProgress >= goal.TargetValue,
                    ClosedAt = utcNow
                };
                _db.UserGoalPeriods.Add(period);

                lastClosed = new ClosedPeriodDto
                {
                    PeriodStart = pStart,
                    PeriodEnd = pEnd,
                    FinalProgress = finalProgress,
                    TargetAtTime = goal.TargetValue,
                    Completed = period.Completed
                };

                // Advance to next period. Snapshot fresh baseline.
                goal.CurrentPeriodStart = NextPeriodStart(pStart, goal.Recurrence);
                goal.CurrentPeriodBaseline = goal.GoalType == GoalType.WordsKnown
                    ? currentMetric  // for stocks, the baseline is the current count
                    : await EstimateMetricAtAsync(goal, NextPeriodStart(pStart, goal.Recurrence));
            }

            return lastClosed;
        }

        // For accumulators (words read / listening), final progress = sum of activity in [PeriodStart, PeriodEnd] in UTC range.
        // For words known (stock), we don't have status-change history, so we approximate with current - period baseline.
        // The approximation is fair when periods close on time (the baseline was captured at PeriodStart) — overstates only
        // when the close is delayed and the user kept learning words after PeriodEnd. Acceptable v1 trade-off.
        private async Task<long> ComputeFinalProgressForClosedPeriodAsync(
            UserGoal goal,
            DateOnly periodStart,
            DateOnly periodEnd,
            long currentMetric)
        {
            if (goal.GoalType == GoalType.WordsKnown)
            {
                long baseline = goal.CurrentPeriodBaseline ?? goal.BaselineValue;
                return Math.Max(0, currentMetric - baseline);
            }

            // Convert user-TZ period to UTC range for activity query.
            var startUtc = periodStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc)
                            .AddMinutes(-goal.CreatedTzOffsetMin);
            var endUtc = periodEnd.ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc)
                            .AddMinutes(-goal.CreatedTzOffsetMin);

            if (goal.GoalType == GoalType.WordsRead)
            {
                var q = _db.UserActivities.AsNoTracking()
                    .Where(a => a.UserId == goal.UserId
                                && ReadingTypes.Contains(a.ActivityType)
                                && a.Timestamp >= startUtc
                                && a.Timestamp <= endUtc);
                if (goal.LanguageId.HasValue) q = q.Where(a => a.LanguageId == goal.LanguageId.Value);
                return await q.SumAsync(a => (long)a.WordCount);
            }
            else // ListeningSeconds
            {
                var q = _db.UserActivities.AsNoTracking()
                    .Where(a => a.UserId == goal.UserId
                                && ListeningTypes.Contains(a.ActivityType)
                                && a.Timestamp >= startUtc
                                && a.Timestamp <= endUtc);
                if (goal.LanguageId.HasValue) q = q.Where(a => a.LanguageId == goal.LanguageId.Value);
                return await q.SumAsync(a => (long?)a.ListeningDurationSeconds ?? 0L);
            }
        }

        // Estimates the cumulative metric value at the start of the given period, for accumulators.
        // Sums all activity strictly before the period start in UTC.
        private async Task<long> EstimateMetricAtAsync(UserGoal goal, DateOnly periodStart)
        {
            if (goal.GoalType == GoalType.WordsKnown)
            {
                // Stocks: caller handles. Should not be invoked.
                return 0;
            }

            var startUtc = periodStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc)
                            .AddMinutes(-goal.CreatedTzOffsetMin);

            if (goal.GoalType == GoalType.WordsRead)
            {
                var q = _db.UserActivities.AsNoTracking()
                    .Where(a => a.UserId == goal.UserId
                                && ReadingTypes.Contains(a.ActivityType)
                                && a.Timestamp < startUtc);
                if (goal.LanguageId.HasValue) q = q.Where(a => a.LanguageId == goal.LanguageId.Value);
                return await q.SumAsync(a => (long)a.WordCount);
            }
            else
            {
                var q = _db.UserActivities.AsNoTracking()
                    .Where(a => a.UserId == goal.UserId
                                && ListeningTypes.Contains(a.ActivityType)
                                && a.Timestamp < startUtc);
                if (goal.LanguageId.HasValue) q = q.Where(a => a.LanguageId == goal.LanguageId.Value);
                return await q.SumAsync(a => (long?)a.ListeningDurationSeconds ?? 0L);
            }
        }

        private void AssignStateAndPace(GoalProgressDto dto, UserGoal goal, DateOnly todayUserTz)
        {
            if (goal.ArchivedAt.HasValue)
            {
                dto.State = "archived";
                return;
            }

            if (goal.Recurrence != GoalRecurrence.None)
            {
                bool hit = dto.Progress >= dto.TargetValue;
                dto.State = hit ? "hit_this_period" : "in_progress";

                // Pace within current period.
                if (dto.CurrentPeriodStart.HasValue && dto.CurrentPeriodEnd.HasValue)
                {
                    var totalDays = Math.Max(1, dto.CurrentPeriodEnd.Value.DayNumber - dto.CurrentPeriodStart.Value.DayNumber + 1);
                    var elapsed = Math.Clamp(todayUserTz.DayNumber - dto.CurrentPeriodStart.Value.DayNumber + 1, 1, totalDays);
                    long expected = (long)Math.Round(dto.TargetValue * (double)elapsed / totalDays);
                    dto.ExpectedAtToday = expected;
                    AssignPaceLabel(dto, expected);
                }
                return;
            }

            // One-shot
            if (goal.CompletedAt.HasValue)
            {
                dto.State = "completed";
                return;
            }

            if (goal.Deadline.HasValue && goal.Deadline.Value < todayUserTz)
            {
                dto.State = "overdue";
                return;
            }

            dto.State = "active";

            if (goal.Mode == GoalMode.Delta && goal.Deadline.HasValue)
            {
                var createdDate = DateOnly.FromDateTime(goal.CreatedAt.AddMinutes(goal.CreatedTzOffsetMin));
                var totalDays = Math.Max(1, goal.Deadline.Value.DayNumber - createdDate.DayNumber + 1);
                var elapsed = Math.Clamp(todayUserTz.DayNumber - createdDate.DayNumber + 1, 1, totalDays);
                long expected = (long)Math.Round(goal.TargetValue * (double)elapsed / totalDays);
                dto.ExpectedAtToday = expected;
                AssignPaceLabel(dto, expected);
            }
        }

        private static void AssignPaceLabel(GoalProgressDto dto, long expected)
        {
            long delta = dto.Progress - expected;
            long aheadThreshold = (long)Math.Round(0.2 * expected);
            long behindThreshold = -(long)Math.Round(0.1 * dto.TargetValue);

            if (delta >= aheadThreshold && dto.Progress >= expected) dto.Pace = "ahead";
            else if (delta >= 0) dto.Pace = "on_track";
            else if (delta >= behindThreshold) dto.Pace = "slightly_behind";
            else dto.Pace = "behind";
        }

        // ---- Period boundary math (user-TZ DateOnly) ----

        public static DateOnly PeriodStartContaining(DateOnly d, GoalRecurrence recurrence)
        {
            return recurrence switch
            {
                GoalRecurrence.Weekly => StartOfIsoWeek(d),
                GoalRecurrence.Monthly => new DateOnly(d.Year, d.Month, 1),
                _ => d
            };
        }

        public static DateOnly PeriodEndOf(DateOnly periodStart, GoalRecurrence recurrence)
        {
            return recurrence switch
            {
                GoalRecurrence.Weekly => periodStart.AddDays(6),
                GoalRecurrence.Monthly => new DateOnly(
                    periodStart.Year,
                    periodStart.Month,
                    DateTime.DaysInMonth(periodStart.Year, periodStart.Month)),
                _ => periodStart
            };
        }

        public static DateOnly NextPeriodStart(DateOnly periodStart, GoalRecurrence recurrence)
        {
            return recurrence switch
            {
                GoalRecurrence.Weekly => periodStart.AddDays(7),
                GoalRecurrence.Monthly => periodStart.AddMonths(1),
                _ => periodStart
            };
        }

        // Monday-anchored ISO week.
        private static DateOnly StartOfIsoWeek(DateOnly d)
        {
            // .NET DayOfWeek: Sunday=0, Monday=1, ..., Saturday=6.
            // Days back to Monday = (DayOfWeek + 6) % 7.
            int daysBack = ((int)d.DayOfWeek + 6) % 7;
            return d.AddDays(-daysBack);
        }
    }
}
