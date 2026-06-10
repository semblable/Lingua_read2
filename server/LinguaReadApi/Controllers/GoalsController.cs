using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Utilities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class GoalsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IGoalProgressService _progress;

        public GoalsController(AppDbContext context, IGoalProgressService progress)
        {
            _context = context;
            _progress = progress;
        }

        // GET: api/goals?status=active|completed|archived&timezoneOffsetMinutes=...
        [HttpGet]
        public async Task<ActionResult<IEnumerable<GoalProgressDto>>> GetGoals(
            [FromQuery] string status = "active",
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            timezoneOffsetMinutes = TimezoneOffset.Clamp(timezoneOffsetMinutes);
            var userId = GetUserId();
            var statusLower = (status ?? "active").Trim().ToLowerInvariant();

            var query = _context.UserGoals.Where(g => g.UserId == userId);

            switch (statusLower)
            {
                case "archived":
                    query = query.Where(g => g.ArchivedAt != null);
                    break;
                case "completed":
                    query = query.Where(g => g.ArchivedAt == null && g.CompletedAt != null);
                    break;
                case "all":
                    break;
                case "active":
                default:
                    query = query.Where(g => g.ArchivedAt == null && g.CompletedAt == null);
                    break;
            }

            var goals = await query.OrderByDescending(g => g.CreatedAt).ToListAsync();
            var dtos = await _progress.ComputeAsync(userId, goals, timezoneOffsetMinutes, DateTime.UtcNow);

            // Persist any side-effects (rolled periods, sticky completion stamps)
            await _context.SaveChangesAsync();

            return Ok(dtos.ToList());
        }

        // GET: api/goals/{id}?timezoneOffsetMinutes=...
        [HttpGet("{id}")]
        public async Task<ActionResult<GoalProgressDto>> GetGoal(int id, [FromQuery] int timezoneOffsetMinutes = 0)
        {
            timezoneOffsetMinutes = TimezoneOffset.Clamp(timezoneOffsetMinutes);
            var userId = GetUserId();
            var goal = await _context.UserGoals.FirstOrDefaultAsync(g => g.GoalId == id && g.UserId == userId);
            if (goal == null) return NotFound();

            var dtos = await _progress.ComputeAsync(userId, new[] { goal }, timezoneOffsetMinutes, DateTime.UtcNow);
            await _context.SaveChangesAsync();

            return Ok(dtos[0]);
        }

        // POST: api/goals
        [HttpPost]
        public async Task<ActionResult<GoalProgressDto>> CreateGoal([FromBody] CreateGoalDto dto, [FromQuery] int timezoneOffsetMinutes = 0)
        {
            timezoneOffsetMinutes = TimezoneOffset.Clamp(timezoneOffsetMinutes);
            var userId = GetUserId();

            // --- Validation ---
            if (dto.TargetValue <= 0)
                return BadRequest("Target must be greater than zero.");

            if (!Enum.IsDefined(typeof(GoalType), dto.GoalType))
                return BadRequest("Invalid goal type.");

            if (!Enum.IsDefined(typeof(GoalMode), dto.Mode))
                return BadRequest("Invalid goal mode.");

            if (!Enum.IsDefined(typeof(GoalRecurrence), dto.Recurrence))
                return BadRequest("Invalid recurrence.");

            if (dto.Recurrence != GoalRecurrence.None && dto.Mode == GoalMode.Milestone)
                return BadRequest("Milestone goals cannot recur.");

            if (dto.Recurrence != GoalRecurrence.None && dto.Deadline.HasValue)
                return BadRequest("Recurring goals do not take a deadline.");

            if (dto.LanguageId.HasValue)
            {
                var langExists = await _context.Languages.AnyAsync(l => l.LanguageId == dto.LanguageId.Value);
                if (!langExists) return BadRequest("Language not found.");
            }

            var nowUtc = DateTime.UtcNow;
            var todayUserTz = DateOnly.FromDateTime(nowUtc.AddMinutes(timezoneOffsetMinutes));

            if (dto.Deadline.HasValue && dto.Deadline.Value < todayUserTz)
                return BadRequest("Deadline cannot be in the past.");

            // --- Build goal ---
            var baseline = dto.Mode == GoalMode.Milestone
                ? 0L
                : await _progress.SnapshotMetricAsync(userId, dto.GoalType, dto.LanguageId);

            var goal = new UserGoal
            {
                UserId = userId,
                LanguageId = dto.LanguageId,
                GoalType = dto.GoalType,
                Mode = dto.Mode,
                Recurrence = dto.Recurrence,
                TargetValue = dto.TargetValue,
                BaselineValue = baseline,
                Deadline = dto.Deadline,
                CreatedAt = nowUtc,
                CreatedTzOffsetMin = timezoneOffsetMinutes,
                Title = string.IsNullOrWhiteSpace(dto.Title) ? null : dto.Title.Trim()
            };

            if (dto.Recurrence != GoalRecurrence.None)
            {
                goal.CurrentPeriodStart = GoalProgressService.PeriodStartContaining(todayUserTz, dto.Recurrence);
                goal.CurrentPeriodBaseline = baseline;
            }

            _context.UserGoals.Add(goal);
            await _context.SaveChangesAsync();

            var dtos = await _progress.ComputeAsync(userId, new[] { goal }, timezoneOffsetMinutes, nowUtc);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetGoal), new { id = goal.GoalId }, dtos[0]);
        }

        // PUT: api/goals/{id}
        [HttpPut("{id}")]
        public async Task<ActionResult<GoalProgressDto>> UpdateGoal(int id, [FromBody] UpdateGoalDto dto, [FromQuery] int timezoneOffsetMinutes = 0)
        {
            timezoneOffsetMinutes = TimezoneOffset.Clamp(timezoneOffsetMinutes);
            var userId = GetUserId();
            var goal = await _context.UserGoals.FirstOrDefaultAsync(g => g.GoalId == id && g.UserId == userId);
            if (goal == null) return NotFound();

            // Disallow cadence/type/mode/scope changes (per plan)
            if (dto.GoalType.HasValue && dto.GoalType.Value != goal.GoalType)
                return BadRequest("Goal type cannot be changed. Create a new goal instead.");
            if (dto.Mode.HasValue && dto.Mode.Value != goal.Mode)
                return BadRequest("Goal mode cannot be changed.");
            if (dto.Recurrence.HasValue && dto.Recurrence.Value != goal.Recurrence)
                return BadRequest("Cadence cannot be changed.");
            if (dto.LanguageId.HasValue && dto.LanguageId.Value != goal.LanguageId)
                return BadRequest("Goal scope cannot be changed.");

            if (dto.TargetValue.HasValue)
            {
                if (dto.TargetValue.Value <= 0) return BadRequest("Target must be greater than zero.");
                goal.TargetValue = dto.TargetValue.Value;
            }

            if (dto.Deadline.HasValue)
            {
                if (goal.Recurrence != GoalRecurrence.None)
                    return BadRequest("Recurring goals do not have a deadline.");
                goal.Deadline = dto.Deadline.Value;
                // If extending past today on an Overdue goal, allow it to flow back to active.
                // If goal was completed and we shorten the deadline below today — completion is sticky.
            }

            if (dto.ClearDeadline == true)
                goal.Deadline = null;

            if (dto.Title != null)
                goal.Title = string.IsNullOrWhiteSpace(dto.Title) ? null : dto.Title.Trim();

            await _context.SaveChangesAsync();

            var dtos = await _progress.ComputeAsync(userId, new[] { goal }, timezoneOffsetMinutes, DateTime.UtcNow);
            await _context.SaveChangesAsync();

            return Ok(dtos[0]);
        }

        // POST: api/goals/{id}/archive
        [HttpPost("{id}/archive")]
        public async Task<IActionResult> ArchiveGoal(int id)
        {
            var userId = GetUserId();
            var goal = await _context.UserGoals.FirstOrDefaultAsync(g => g.GoalId == id && g.UserId == userId);
            if (goal == null) return NotFound();

            if (!goal.ArchivedAt.HasValue) goal.ArchivedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();
            return NoContent();
        }

        // POST: api/goals/{id}/restore
        [HttpPost("{id}/restore")]
        public async Task<IActionResult> RestoreGoal(int id)
        {
            var userId = GetUserId();
            var goal = await _context.UserGoals.FirstOrDefaultAsync(g => g.GoalId == id && g.UserId == userId);
            if (goal == null) return NotFound();

            goal.ArchivedAt = null;
            await _context.SaveChangesAsync();
            return NoContent();
        }

        // DELETE: api/goals/{id}  (hard delete)
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteGoal(int id)
        {
            var userId = GetUserId();
            var goal = await _context.UserGoals.FirstOrDefaultAsync(g => g.GoalId == id && g.UserId == userId);
            if (goal == null) return NotFound();
            _context.UserGoals.Remove(goal);
            await _context.SaveChangesAsync();
            return NoContent();
        }

        // GET: api/goals/suggestions?type=&languageId=&recurrence=&mode=&timezoneOffsetMinutes=
        // Returns a smart default target for the creation modal.
        [HttpGet("suggestions")]
        public async Task<ActionResult<GoalSuggestionDto>> GetSuggestion(
            [FromQuery] GoalType type,
            [FromQuery] int? languageId,
            [FromQuery] GoalRecurrence recurrence = GoalRecurrence.None,
            [FromQuery] GoalMode mode = GoalMode.Delta,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            timezoneOffsetMinutes = TimezoneOffset.Clamp(timezoneOffsetMinutes);
            var userId = GetUserId();
            var nowUtc = DateTime.UtcNow;
            var weekStart = nowUtc.AddDays(-7);
            var monthStart = nowUtc.AddDays(-30);

            long suggestion = 0;
            long currentMetric = await _progress.SnapshotMetricAsync(userId, type, languageId);

            if (mode == GoalMode.Milestone)
            {
                // Words known: round up to next nice number above current.
                suggestion = NextRoundUp(currentMetric);
            }
            else
            {
                long pace7 = await PaceForAsync(userId, type, languageId, weekStart);
                long pace30 = await PaceForAsync(userId, type, languageId, monthStart);

                switch (recurrence)
                {
                    case GoalRecurrence.Weekly:
                        suggestion = pace7 > 0 ? RoundDownToNice(pace7, type) : DefaultEmpty(type, recurrence);
                        break;
                    case GoalRecurrence.Monthly:
                        suggestion = pace30 > 0 ? RoundDownToNice(pace30, type) : DefaultEmpty(type, recurrence);
                        break;
                    default: // None / one-shot
                        if (type == GoalType.WordsKnown)
                            suggestion = pace30 > 0 ? RoundUpToNice(Math.Max(50, pace30 / 4), type) : DefaultEmpty(type, recurrence);
                        else
                            suggestion = pace7 > 0 ? RoundUpToNice(pace7 * 4, type) : DefaultEmpty(type, recurrence);
                        break;
                }
            }

            return Ok(new GoalSuggestionDto
            {
                SuggestedTarget = suggestion,
                CurrentMetric = currentMetric,
                Last7DaysTotal = await PaceForAsync(userId, type, languageId, weekStart),
                Last30DaysTotal = await PaceForAsync(userId, type, languageId, monthStart)
            });
        }

        // ---- helpers ----

        private async Task<long> PaceForAsync(Guid userId, GoalType type, int? languageId, DateTime sinceUtc)
        {
            switch (type)
            {
                case GoalType.WordsRead:
                {
                    var q = _context.UserActivities.AsNoTracking()
                        .Where(a => a.UserId == userId
                                    && (a.ActivityType == "Reading" || a.ActivityType == "ManualReading"
                                        || a.ActivityType == "TextCompleted" || a.ActivityType == "LessonCompleted"
                                        || a.ActivityType == "BookFinished")
                                    && a.Timestamp >= sinceUtc);
                    if (languageId.HasValue) q = q.Where(a => a.LanguageId == languageId.Value);
                    return await q.SumAsync(a => (long)a.WordCount);
                }
                case GoalType.ListeningSeconds:
                {
                    var q = _context.UserActivities.AsNoTracking()
                        .Where(a => a.UserId == userId
                                    && (a.ActivityType == "Listening" || a.ActivityType == "ManualListening")
                                    && a.Timestamp >= sinceUtc);
                    if (languageId.HasValue) q = q.Where(a => a.LanguageId == languageId.Value);
                    return await q.SumAsync(a => (long?)a.ListeningDurationSeconds ?? 0L);
                }
                case GoalType.WordsKnown:
                    // Words don't have a status-change timestamp; approximate using created date as a proxy.
                    {
                        var q = _context.Words.AsNoTracking()
                            .Where(w => w.UserId == userId && w.Status >= 4 && w.Status <= 5 && w.CreatedAt >= sinceUtc);
                        if (languageId.HasValue) q = q.Where(w => w.LanguageId == languageId.Value);
                        return await q.LongCountAsync();
                    }
                default:
                    return 0;
            }
        }

        private static long DefaultEmpty(GoalType type, GoalRecurrence recurrence)
        {
            // Brand-new user fallback
            return (type, recurrence) switch
            {
                (GoalType.WordsRead, GoalRecurrence.None) => 5_000,
                (GoalType.WordsRead, GoalRecurrence.Weekly) => 1_000,
                (GoalType.WordsRead, GoalRecurrence.Monthly) => 4_000,
                (GoalType.ListeningSeconds, GoalRecurrence.None) => 5 * 3600,
                (GoalType.ListeningSeconds, GoalRecurrence.Weekly) => 3600,
                (GoalType.ListeningSeconds, GoalRecurrence.Monthly) => 4 * 3600,
                (GoalType.WordsKnown, GoalRecurrence.None) => 100,
                (GoalType.WordsKnown, GoalRecurrence.Weekly) => 20,
                (GoalType.WordsKnown, GoalRecurrence.Monthly) => 80,
                _ => 0
            };
        }

        private static long RoundUpToNice(long value, GoalType type)
        {
            if (type == GoalType.ListeningSeconds)
            {
                // Round up to next 30 min, 1 h, or 5 h.
                if (value < 1800) return 1800;       // 30 min
                if (value < 3600) return 3600;       // 1 h
                if (value < 18000) return RoundUpToMultiple(value, 3600);   // next hour
                return RoundUpToMultiple(value, 18000);                     // next 5 h
            }
            if (type == GoalType.WordsKnown)
            {
                if (value < 100) return RoundUpToMultiple(value, 50);
                if (value < 1000) return RoundUpToMultiple(value, 100);
                return RoundUpToMultiple(value, 500);
            }
            // WordsRead
            if (value < 5_000) return RoundUpToMultiple(value, 500);
            if (value < 50_000) return RoundUpToMultiple(value, 1_000);
            return RoundUpToMultiple(value, 5_000);
        }

        private static long RoundDownToNice(long value, GoalType type)
        {
            if (type == GoalType.ListeningSeconds)
            {
                if (value < 1800) return Math.Max(900, value / 900 * 900); // 15-min steps
                if (value < 3600) return value / 1800 * 1800;
                return value / 3600 * 3600;
            }
            if (type == GoalType.WordsKnown)
            {
                if (value < 100) return Math.Max(20, value / 20 * 20);
                return value / 50 * 50;
            }
            if (value < 5_000) return Math.Max(500, value / 500 * 500);
            if (value < 50_000) return value / 1_000 * 1_000;
            return value / 5_000 * 5_000;
        }

        private static long RoundUpToMultiple(long value, long step)
        {
            if (step <= 0) return value;
            var rem = value % step;
            return rem == 0 ? value : value + (step - rem);
        }

        // For Milestone words-known: jump to a motivating round number.
        private static long NextRoundUp(long current)
        {
            if (current < 100) return 100;
            if (current < 500) return 500;
            if (current < 1_000) return 1_000;
            if (current < 2_000) return 2_000;
            if (current < 5_000) return 5_000;
            if (current < 10_000) return 10_000;
            return RoundUpToMultiple(current + 1, 5_000);
        }

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                throw new UnauthorizedAccessException("User ID not found or invalid in token.");
            }
            return userId;
        }
    }

    public class CreateGoalDto
    {
        public int? LanguageId { get; set; }
        public GoalType GoalType { get; set; }
        public GoalMode Mode { get; set; } = GoalMode.Delta;
        public GoalRecurrence Recurrence { get; set; } = GoalRecurrence.None;
        public long TargetValue { get; set; }
        public DateOnly? Deadline { get; set; }
        public string? Title { get; set; }
    }

    public class UpdateGoalDto
    {
        // Only TargetValue / Deadline / Title may change.
        // Other fields are accepted only to surface a clear error if provided.
        public GoalType? GoalType { get; set; }
        public GoalMode? Mode { get; set; }
        public GoalRecurrence? Recurrence { get; set; }
        public int? LanguageId { get; set; }
        public long? TargetValue { get; set; }
        public DateOnly? Deadline { get; set; }
        public bool? ClearDeadline { get; set; }
        public string? Title { get; set; }
    }

    public class GoalSuggestionDto
    {
        public long SuggestedTarget { get; set; }
        public long CurrentMetric { get; set; }
        public long Last7DaysTotal { get; set; }
        public long Last30DaysTotal { get; set; }
    }
}
