using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Controllers;

[ApiController, Authorize, Route("api/lesson-study")]
public class LessonStudyController(AppDbContext context) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("{textId}")]
    public async Task<ActionResult<LessonStudyDto>> Get(int textId)
    {
        if (!await context.Texts.AnyAsync(t => t.TextId == textId && t.UserId == UserId)) return NotFound();
        var events = context.LessonStudyEvents.Where(e => e.UserId == UserId && e.SourceTextId == textId && e.CountsTowardStatistics);
        var counts = await events.GroupBy(e => e.Kind).Select(g => new { Kind = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Kind, g => g.Count);
        return new LessonStudyDto(counts.GetValueOrDefault("read"), counts.GetValueOrDefault("listen"));
    }

    // Explicitly recorded complete listens. In-app playback time is already
    // tracked, so zero seconds records a pass without crediting its time twice.
    [HttpPost("{textId}/listen")]
    public async Task<IActionResult> Listen(int textId, [FromBody] LogLessonListenRequest request)
    {
        if (!ModelState.IsValid || !LessonStudyActivity.ValidId(request.ClientEventId)) return BadRequest(ModelState);
        return await LessonStudyActivity.AtomicAsync<IActionResult>(context, UserId, async () =>
        {
            var text = await context.Texts.SingleOrDefaultAsync(t => t.TextId == textId && t.UserId == UserId);
            if (text == null) return NotFound();
            var existing = await context.LessonStudyEvents.SingleOrDefaultAsync(e => e.UserId == UserId && e.ClientEventId == request.ClientEventId);
            if (existing != null)
                return existing.SourceTextId == textId && existing.Kind == "listen" && existing.CreditedListeningSeconds == request.DurationSeconds
                    && existing.SourceRevision == request.SourceRevision
                    ? Ok() : Conflict(new { message = "This action ID belongs to a different study action." });
            if (request.SourceRevision != LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath))
                return Conflict(new { message = "This lesson changed. Reload it before recording another pass." });
            LessonStudyActivity.Record(context, UserId, textId, text.Title, text.LanguageId, text.Content,
                text.AudioFilePath, request.ClientEventId, "listen", seconds: request.DurationSeconds);
            if (request.DurationSeconds > 0)
            {
                context.UserActivities.Add(new UserActivity { UserId = UserId, LanguageId = text.LanguageId,
                    ActivityType = "Listening", WordCount = 0, ListeningDurationSeconds = request.DurationSeconds, Timestamp = DateTime.UtcNow });
                var stats = await context.UserLanguageStatistics.Where(s => s.UserId == UserId && s.LanguageId == text.LanguageId)
                    .OrderBy(s => s.UserLanguageStatisticsId).FirstOrDefaultAsync();
                if (stats == null) { stats = new UserLanguageStatistics { UserId = UserId, LanguageId = text.LanguageId }; context.UserLanguageStatistics.Add(stats); }
                stats.TotalSecondsListened += request.DurationSeconds;
                stats.LastUpdatedAt = DateTime.UtcNow;
            }
            await context.SaveChangesAsync();
            return Ok();
        });
    }
}

public record LessonStudyDto(int ReadCount, int ListenCount);
public class LogLessonListenRequest
{
    [Required, StringLength(64, MinimumLength = 1)] public string ClientEventId { get; set; } = "";
    [Required, StringLength(64, MinimumLength = 64)] public string SourceRevision { get; set; } = "";
    [Range(0, 86400)] public int DurationSeconds { get; set; }
}
