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
        return await Counts(textId);
    }

    private async Task<LessonStudyDto> Counts(int textId)
    {
        var counts = await LessonStudyActivity.PassCountsAsync(context, UserId, textId);
        return new LessonStudyDto(counts.Read / 10m, counts.Listen / 10m);
    }

    [HttpPut("{textId}/count")]
    public async Task<IActionResult> SetCount(int textId, [FromBody] SetLessonStudyCountRequest request)
    {
        if (!ModelState.IsValid || string.IsNullOrWhiteSpace(request.ClientEventId)
            || !LessonStudyActivity.ValidId(request.ClientEventId)
            || request.Kind is not ("read" or "listen")
            || request.Count < 0 || request.Count > 10000 || request.Count * 10 != decimal.Truncate(request.Count * 10)
            || request.ExpectedCount < 0 || request.ExpectedCount > int.MaxValue / 10m
            || request.ExpectedCount * 10 != decimal.Truncate(request.ExpectedCount * 10))
            return BadRequest(new { message = "Enter a total between 0 and 10,000 in steps of 0.1." });

        var target = (int)(request.Count * 10);
        var expected = (int)(request.ExpectedCount * 10);
        var kind = request.Kind == "read" ? "read-set" : "list-set";
        return await LessonStudyActivity.AtomicAsync<IActionResult>(context, UserId, async () =>
        {
            var text = await context.Texts.SingleOrDefaultAsync(t => t.TextId == textId && t.UserId == UserId);
            if (text == null) return NotFound();
            var existing = await context.LessonStudyEvents.SingleOrDefaultAsync(e => e.UserId == UserId && e.ClientEventId == request.ClientEventId);
            if (existing != null)
                return existing.SourceTextId == textId && existing.Kind == kind && existing.SourceRevision == request.SourceRevision
                    && existing.TargetPassTenths == target && existing.PassTenths == target - expected
                    ? Ok(await Counts(textId)) : Conflict(new { message = "This action ID belongs to a different study action." });
            if (request.SourceRevision != LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath))
                return Conflict(new { message = "This lesson changed. Reload it before changing its total." });
            var counts = await LessonStudyActivity.PassCountsAsync(context, UserId, textId);
            if ((request.Kind == "read" ? counts.Read : counts.Listen) != expected)
                return Conflict(new { message = "This total changed elsewhere. Review the refreshed total and try again." });

            var wordDelta = 0L;
            bool? reconcileSentences = null;
            if (request.Kind == "read")
            {
                var reads = await context.LessonStudyEvents.Where(e => e.UserId == UserId && e.SourceTextId == textId
                    && e.CountsTowardStatistics && (e.Kind == "read" || e.Kind == "read-set"))
                    .OrderBy(e => e.LessonStudyEventId)
                    .Select(e => new { e.CreditedWords, e.SourceRevision, e.ReconcilesSentenceCredit, e.LanguageId, e.PassTenths, e.TargetPassTenths }).ToListAsync();
                if (target != expected && reads.Any(e => e.LanguageId != text.LanguageId))
                    return Conflict(new { message = "This lesson changed language. Earlier reading credit belongs to another language and cannot be adjusted here." });
                var credited = reads.Sum(e => (long)e.CreditedWords);
                var sentence = await context.UserSentenceProgresses.FindAsync(UserId, textId);
                var words = Utilities.WordCountUtility.CountTotalWords(text.Content);
                // Finish without credit makes later reads independent of the old
                // initial sentence read. Keep that distinction in future edits.
                reconcileSentences = reads.FirstOrDefault(e => e.ReconcilesSentenceCredit.HasValue)?.ReconcilesSentenceCredit
                    ?? (reads.Count == 0 ? !text.IsFinished : reads[0].CreditedWords < words);
                var sentenceWords = reconcileSentences == true ? sentence?.CreditedWordCount ?? 0 : 0;
                if (target == expected) { /* Saving the same total must not rewrite legacy credit. */ }
                else if (reads.All(e => e.SourceRevision == request.SourceRevision))
                    wordDelta = Math.Max(0L, LessonStudyActivity.RoundedWords(target, words) - sentenceWords) - credited;
                else if (target >= expected)
                {
                    // Content edits must not revalue previously earned passes.
                    var extra = LessonStudyActivity.RoundedWords(target, words) - LessonStudyActivity.RoundedWords(expected, words);
                    wordDelta = Math.Max(0L, extra - Math.Max(0L, sentenceWords - LessonStudyActivity.RoundedWords(expected, words)));
                }
                else
                {
                    // Reconstruct the start of consecutive reductions so each
                    // 0.1 step rounds from one basis, never an already rounded result.
                    var basisWords = credited;
                    var basisTenths = (long)expected;
                    foreach (var prior in reads.AsEnumerable().Reverse())
                    {
                        if (prior.SourceRevision != request.SourceRevision || prior.TargetPassTenths == null || prior.PassTenths > 0) break;
                        if (prior.PassTenths == 0 && prior.CreditedWords != 0) break;
                        basisWords -= prior.CreditedWords;
                        basisTenths -= prior.PassTenths;
                    }
                    wordDelta = Math.Max(0L, (long)Math.Round((basisWords + sentenceWords) * (decimal)target / basisTenths,
                        MidpointRounding.AwayFromZero) - sentenceWords) - credited;
                }
                // Legacy sentence units can exceed whole-text units. Preserve
                // that history instead of reversing credit when increasing a total.
                wordDelta = target >= expected ? Math.Max(0, wordDelta) : Math.Min(0, wordDelta);
                if (wordDelta < int.MinValue || wordDelta > int.MaxValue)
                    return BadRequest(new { message = "Change this total by a smaller amount." });
            }

            var adjustment = LessonStudyActivity.Record(context, UserId, textId, text.Title, text.LanguageId,
                text.Content, text.AudioFilePath, request.ClientEventId, kind, words: (int)wordDelta);
            adjustment.PassTenths = target - expected;
            adjustment.TargetPassTenths = target;
            adjustment.ReconcilesSentenceCredit = reconcileSentences;
            adjustment.IsCompletionCheckpoint = request.Kind == "read" && target >= 10;
            if (request.Kind == "read")
            {
                var stats = await context.UserLanguageStatistics.Where(s => s.UserId == UserId && s.LanguageId == text.LanguageId)
                    .OrderBy(s => s.UserLanguageStatisticsId).FirstOrDefaultAsync();
                if (stats == null) { stats = new UserLanguageStatistics { UserId = UserId, LanguageId = text.LanguageId }; context.UserLanguageStatistics.Add(stats); }
                stats.TotalWordsRead += wordDelta;
                stats.TotalTextCompletions = Math.Max(0, stats.TotalTextCompletions + target / 10 - expected / 10);
                stats.LastUpdatedAt = DateTime.UtcNow;
                if (wordDelta != 0)
                    context.UserActivities.Add(new UserActivity { UserId = UserId, LanguageId = text.LanguageId,
                        ActivityType = "ManualReading", WordCount = (int)wordDelta, Timestamp = DateTime.UtcNow });
            }
            await context.SaveChangesAsync();
            return Ok(await Counts(textId));
        });
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

public record LessonStudyDto(decimal ReadCount, decimal ListenCount);
public class SetLessonStudyCountRequest
{
    [Required, StringLength(64, MinimumLength = 1)] public string ClientEventId { get; set; } = "";
    [Required, StringLength(64, MinimumLength = 64)] public string SourceRevision { get; set; } = "";
    [Required] public string Kind { get; set; } = "";
    public decimal Count { get; set; }
    public decimal ExpectedCount { get; set; }
}
public class LogLessonListenRequest
{
    [Required, StringLength(64, MinimumLength = 1)] public string ClientEventId { get; set; } = "";
    [Required, StringLength(64, MinimumLength = 64)] public string SourceRevision { get; set; } = "";
    [Range(0, 86400)] public int DurationSeconds { get; set; }
}
