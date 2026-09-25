using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using System.Linq.Expressions;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Ai;
using LinguaReadApi.Services.Srs;
using LinguaReadApi.Utilities;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class SrsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IStoryGenerationServiceFactory _storyGenerationServiceFactory;

        public SrsController(AppDbContext context, IStoryGenerationServiceFactory storyGenerationServiceFactory)
        {
            _context = context;
            _storyGenerationServiceFactory = storyGenerationServiceFactory;
        }

        // GET: api/srs/due?languageId=1&status=1,2&onlyOneTarget=false&limit=20&timezoneOffsetMinutes=120
        [HttpGet("due")]
        public async Task<ActionResult<List<SrsDueCardDto>>> GetDueCards(
            [FromQuery] int? languageId = null,
            [FromQuery] string? status = null,
            [FromQuery] bool onlyOneTarget = false,
            [FromQuery] int? flag = null,
            [FromQuery] string? tags = null,
            [FromQuery] int limit = 50,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;
            limit = Math.Clamp(limit, 1, 200);

            // 1. Get User Limits
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);
            // Migration AddAnkiSrsSettings defaulted these columns to 0; 0 is not a valid cap (pools stay empty).
            int maxNew = EffectiveSrsMaxNew(settings?.SrsMaxNewCards);
            int maxReviews = EffectiveSrsMaxReviews(settings?.SrsMaxReviews);
            string reviewOrder = string.IsNullOrWhiteSpace(settings?.SrsReviewOrder)
                ? "mix"
                : settings!.SrsReviewOrder;

            // Card style: translation (default), cloze (mask term in mined sentence), or mixed.
            // Cloze/mixed populate the new ClozeSentence DTO field; translation leaves it null
            // so existing clients keep working unchanged.
            string cardType = NormalizeCardType(settings?.SrsCardType);
            bool emitClozeSentence = cardType is "cloze" or "mixed";

            var (studiedNew, studiedReviews) = StudiedOn(settings, day.Today);
            int remainingNew = Math.Max(0, maxNew - studiedNew);
            int remainingReviews = Math.Max(0, maxReviews - studiedReviews);

            // Do not short-circuit when both daily quotas are exhausted: learning-phase
            // cards still apply (see validLearningCards below, which ignores these limits).

            // 2. Base query for due cards
            var query = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId && !scr.IsSuspended)
                .Where(scr => scr.BuriedUntil == null || scr.BuriedUntil <= now)
                .Where(IsDue(now, day.TomorrowStartUtc))
                .Include(scr => scr.Word)
                    .ThenInclude(w => w.Translation)
                .AsQueryable();

            if (languageId.HasValue)
                query = query.Where(scr => scr.Word.LanguageId == languageId.Value);

            if (!string.IsNullOrEmpty(status))
            {
                var statusList = status.Split(',').Select(s => s.Trim()).Where(s => int.TryParse(s, out _)).Select(int.Parse).ToList();
                if (statusList.Any()) query = query.Where(scr => statusList.Contains(scr.Word.Status));
            }

            if (flag.HasValue && flag.Value > 0)
                query = query.Where(scr => scr.Flag == flag.Value);

            if (!string.IsNullOrEmpty(tags))
            {
                var tagList = tags.Split(',').Select(t => t.Trim().ToLowerInvariant()).Where(t => t.Length > 0).ToList();
                if (tagList.Any())
                    query = query.Where(scr => scr.Tags != null && tagList.Any(t =>
                        ("," + scr.Tags.ToLower() + ",").Contains("," + t + ",")));
            }

            // 3. Separate queries. The 1T filter drops cards after fetching, so over-fetch when it's on.
            int overFetch = onlyOneTarget ? 4 : 1;
            var learningCardsPool = await query
                .Where(scr => scr.IsLearning)
                .OrderBy(scr => scr.NextReviewAt)
                .Take(limit * overFetch)
                .ToListAsync();

            var newCardsPool = new List<SrsCardReview>();
            if (remainingNew > 0)
            {
                var newCardsQuery = query
                    .Where(scr => !scr.IsLearning && scr.Repetitions == 0 && scr.LastReviewedAt == null)
                    .OrderByDescending(scr => _context.TextWords.Count(tw => tw.WordId == scr.WordId)) // Safe EF Core explicit subquery
                    .ThenBy(scr => scr.CreatedAt);
                newCardsPool = await newCardsQuery.Take(Math.Min(remainingNew, limit) * overFetch).ToListAsync();
            }

            var reviewCardsPool = new List<SrsCardReview>();
            if (remainingReviews > 0)
            {
                var reviewCardsQuery = query.Where(scr => !scr.IsLearning && (scr.Repetitions > 0 || scr.LastReviewedAt != null)).OrderBy(scr => scr.NextReviewAt);
                reviewCardsPool = await reviewCardsQuery.Take(Math.Min(remainingReviews, limit) * overFetch).ToListAsync();
            }

            var allFetchedCards = learningCardsPool.Concat(newCardsPool).Concat(reviewCardsPool).ToList();
            if (!allFetchedCards.Any()) return new List<SrsDueCardDto>();

            // 4. Fetch phrases, then count unknown words in each card's newest phrase in one pass (1T).
            var cardWordIds = allFetchedCards.Select(c => c.WordId).Distinct().ToList();
            var phrases = await _context.SrsPhrases
                .AsNoTracking()
                .Where(sp => sp.UserId == userId && cardWordIds.Contains(sp.WordId))
                .ToListAsync();
            var phrasesByWordId = phrases
                .GroupBy(p => p.WordId)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.CreatedAt).ToList());

            var unknownCounts = await SrsUnknownWordCounter.CountAsync(_context, userId, allFetchedCards
                .Where(c => phrasesByWordId.ContainsKey(c.WordId))
                .Select(c => new SrsUnknownWordCounter.Sentence(
                    c.SrsCardReviewId, c.WordId, c.Word.LanguageId, phrasesByWordId[c.WordId][0].Sentence))
                .ToList());

            // 5. Apply 1T filter to build lists
            var scheduler = new SrsScheduler(day.Options);
            var validLearningCards = new List<SrsDueCardDto>();
            var validNewCards = new List<SrsDueCardDto>();
            var validReviewCards = new List<SrsDueCardDto>();

            foreach (var card in allFetchedCards)
            {
                var cardPhrases = phrasesByWordId.GetValueOrDefault(card.WordId) ?? new List<SrsPhrase>();
                var bestPhrase = cardPhrases.FirstOrDefault();
                int unknownWordsInBestPhrase = unknownCounts.GetValueOrDefault(card.SrsCardReviewId);

                // 1T needs a phrase whose only unknown word is the card's own.
                if (onlyOneTarget && (bestPhrase == null || unknownWordsInBestPhrase != 1)) continue;

                string? clozeSentence = null;
                if (emitClozeSentence && bestPhrase != null)
                {
                    clozeSentence = BuildClozeSentence(bestPhrase.Sentence, card.Word.Term);
                }

                var dto = ToDueCardDto(card, cardPhrases, unknownWordsInBestPhrase, clozeSentence, scheduler, now);

                switch (card.GetState())
                {
                    case SrsCardState.Learning:
                    case SrsCardState.Relearning:
                        validLearningCards.Add(dto);
                        break;
                    case SrsCardState.New:
                        validNewCards.Add(dto);
                        break;
                    default:
                        validReviewCards.Add(dto);
                        break;
                }
            }

            // 6. Enforce remaining limits
            validNewCards = validNewCards.Take(remainingNew).ToList();
            validReviewCards = validReviewCards.Take(remainingReviews).ToList();

            // 7. Apply Order
            var rawResult = new List<SrsDueCardDto>();
            rawResult.AddRange(validLearningCards); // Learning cards ignore limits and sort first
            if (reviewOrder == "new_first")
            {
                rawResult.AddRange(validNewCards);
                rawResult.AddRange(validReviewCards);
            }
            else if (reviewOrder == "reviews_first")
            {
                rawResult.AddRange(validReviewCards);
                rawResult.AddRange(validNewCards);
            }
            else // "mix"
            {
                int mixMax = Math.Max(validNewCards.Count, validReviewCards.Count);
                for (int i = 0; i < mixMax; i++)
                {
                    if (i < validNewCards.Count) rawResult.Add(validNewCards[i]);
                    if (i < validReviewCards.Count) rawResult.Add(validReviewCards[i]);
                }
            }

            return rawResult.Take(limit).ToList();
        }

        // POST: api/srs/review?timezoneOffsetMinutes=120
        [HttpPost("review")]
        public async Task<ActionResult<SrsReviewResultDto>> SubmitReview(
            [FromBody] SrsReviewSubmitDto dto,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var userId = GetUserId();
            var now = DateTime.UtcNow;

            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);
            var scheduler = new SrsScheduler(day.Options);

            // An offline replay (or a retry whose response was lost) of a review that was
            // already applied: report the stored result instead of grading the card twice.
            if (!string.IsNullOrEmpty(dto.ClientEventId))
            {
                var replayed = await FindReplayedReviewAsync(userId, dto.ClientEventId, scheduler, now);
                if (replayed != null) return Ok(replayed);
            }

            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == dto.SrsCardReviewId && scr.UserId == userId);

            if (card == null)
                return NotFound("Card not found.");

            if (card.IsSuspended)
                return BadRequest(new { Message = "Card is suspended." });

            if (card.BuriedUntil.HasValue && card.BuriedUntil.Value > now)
                return BadRequest(new { Message = "Card is buried." });

            // Offline reviews are scheduled from when they happened, but never from before
            // the card's previous review or from the future.
            var reviewedAt = dto.ReviewedAt is { } at ? SrsDay.AsUtc(at) : now;
            if (reviewedAt > now) reviewedAt = now;
            if (card.LastReviewedAt is { } lastReviewed && reviewedAt < lastReviewed) reviewedAt = lastReviewed;

            // SM-2-era cards the backfill hasn't reached yet get their FSRS state from history first.
            await SrsMemoryStateInitializer.EnsureAsync(_context, card, scheduler.Algorithm);
            var before = card.ToSnapshot();
            var outcome = scheduler.Review(before, dto.Grade, reviewedAt);

            // 1. Streak & daily limits, on the user day the review happened.
            if (settings != null)
                CountTowardDailyLimits(settings, before, reviewedAt, day.Options);

            // 2. Log for undo & statistics, capturing the state before the review.
            var reviewLog = NewReviewLog(userId, card, dto.Grade, reviewedAt, outcome);
            reviewLog.ClientEventId = string.IsNullOrEmpty(dto.ClientEventId) ? null : dto.ClientEventId;
            _context.SrsReviewLogs.Add(reviewLog);

            card.Apply(outcome.Card);
            bool becameLeech = outcome.IsLapse && SrsLeeches.OnLapse(card, settings);

            // 3. The word's reader status follows the card (word-status sync settings).
            var statusChange = await SyncWordStatusAsync(userId, card, outcome, settings, reviewLog);

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException) when (!string.IsNullOrEmpty(dto.ClientEventId))
            {
                // A concurrent replay of the same event won the unique index; report its result.
                _context.ChangeTracker.Clear();
                var replayed = await FindReplayedReviewAsync(userId, dto.ClientEventId!, scheduler, now);
                if (replayed != null) return Ok(replayed);
                throw;
            }

            var result = ToReviewResult(card, reviewLog, scheduler, now);
            result.WordStatusChange = statusChange;
            result.BecameLeech = becameLeech;
            return Ok(result);
        }

        // POST: api/srs/mine
        [HttpPost("mine")]
        public async Task<IActionResult> MineSentence([FromBody] SrsMineDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var userId = GetUserId();

            // Verify word belongs to this user
            var word = await _context.Words
                .FirstOrDefaultAsync(w => w.WordId == dto.WordId && w.UserId == userId);

            if (word == null)
                return NotFound("Word not found.");

            // Check for duplicate phrase
            var duplicateExists = await _context.SrsPhrases
                .AnyAsync(sp => sp.WordId == dto.WordId && sp.UserId == userId && sp.Sentence == dto.Sentence);
            if (duplicateExists)
                return Conflict(new { Message = "This sentence has already been mined for this word." });

            // TextId comes from the client and is persisted on the phrase, so it has to be one of
            // the caller's texts — the word ownership check above says nothing about it.
            if (dto.TextId.HasValue)
            {
                var textBelongsToUser = await _context.Texts
                    .AnyAsync(t => t.TextId == dto.TextId.Value && t.UserId == userId);
                if (!textBelongsToUser)
                    return NotFound("Text not found.");
            }

            // Create the phrase
            var phrase = new SrsPhrase
            {
                WordId = dto.WordId,
                UserId = userId,
                Sentence = dto.Sentence,
                TextId = dto.TextId,
                TextTitle = dto.TextTitle,
                CreatedAt = DateTime.UtcNow
            };
            _context.SrsPhrases.Add(phrase);

            // Mining asks for a card, so create one if needed (never for an Ignored word), then
            // apply the status rules to it: a Known word's card is suspended if Known cards are retired.
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            await SrsCardLifecycle.EnsureMinedCardAsync(_context, word, settings);

            await _context.SaveChangesAsync();

            return Ok(new { Message = "Sentence mined successfully.", SrsPhraseId = phrase.SrsPhraseId });
        }

        // GET: api/srs/last-review
        [HttpGet("last-review")]
        public async Task<ActionResult<SrsReviewLogDto>> GetLastReview()
        {
            var userId = GetUserId();
            // Get the latest review log from the last 15 minutes
            var cutoffTime = DateTime.UtcNow.AddMinutes(-15);
            var lastReviewLog = await _context.SrsReviewLogs
                .AsNoTracking()
                .Where(log => log.UserId == userId && log.ReviewedAt >= cutoffTime)
                .OrderByDescending(log => log.ReviewedAt)
                .Select(log => new SrsReviewLogDto
                {
                    SrsReviewLogId = log.SrsReviewLogId,
                    SrsCardReviewId = log.SrsCardReviewId,
                    Grade = log.Grade,
                    ReviewedAt = log.ReviewedAt
                })
                .FirstOrDefaultAsync();

            if (lastReviewLog == null) return NotFound();

            return lastReviewLog;
        }

        // POST: api/srs/undo  body: { "srsReviewLogId": 123 } or { "clientEventId": "..." }
        // Reverts that review; the client event id finds a grade that was queued offline and
        // synced since, so the client never got its log id. Without a body (older clients) it
        // reverts the user's most recent review from the last 15 minutes.
        [HttpPost("undo")]
        public async Task<IActionResult> UndoLastReview(
            [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] SrsUndoDto? dto = null,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;
            var cutoffTime = now.AddMinutes(-15);

            var clientEventId = dto?.ClientEventId;
            var lastLog = dto?.SrsReviewLogId is { } logId
                ? await _context.SrsReviewLogs
                    .FirstOrDefaultAsync(log => log.SrsReviewLogId == logId && log.UserId == userId)
                : !string.IsNullOrEmpty(clientEventId)
                ? await _context.SrsReviewLogs
                    .FirstOrDefaultAsync(log => log.UserId == userId && log.ClientEventId == clientEventId)
                : await _context.SrsReviewLogs
                    .Where(log => log.UserId == userId && log.ReviewedAt >= cutoffTime && log.Kind != (int)SrsReviewKind.Reading)
                    .OrderByDescending(log => log.ReviewedAt)
                    .ThenByDescending(log => log.SrsReviewLogId)
                    .FirstOrDefaultAsync();

            if (lastLog == null || lastLog.ReviewedAt < cutoffTime)
                return NotFound(new { Message = "No recent review found to undo." });

            // Undo restores the state *before* this review, which is only right if nothing
            // reviewed the card after it.
            bool newerReviewExists = await _context.SrsReviewLogs.AnyAsync(log =>
                log.SrsCardReviewId == lastLog.SrsCardReviewId
                && log.SrsReviewLogId != lastLog.SrsReviewLogId
                && (log.ReviewedAt > lastLog.ReviewedAt
                    || (log.ReviewedAt == lastLog.ReviewedAt && log.SrsReviewLogId > lastLog.SrsReviewLogId)));
            if (newerReviewExists)
                return Conflict(new { Message = "This card was reviewed again afterwards; undo that review first." });

            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == lastLog.SrsCardReviewId && scr.UserId == userId);

            if (card == null) return NotFound();

            // Restore state
            var lapsesAfterReview = card.Lapses;
            card.Interval = lastLog.OldInterval;
            card.Repetitions = lastLog.OldRepetitions;
            card.NextReviewAt = lastLog.OldNextReviewAt;
            card.IsLearning = lastLog.OldIsLearning;
            card.CurrentLearningStepIndex = lastLog.OldCurrentLearningStepIndex;
            card.LastReviewedAt = lastLog.OldLastReviewedAt;
            card.HasEverGraduated = lastLog.OldHasEverGraduated;
            card.Stability = lastLog.OldStability;
            card.Difficulty = lastLog.OldDifficulty;
            card.Lapses = lastLog.OldLapses;

            // Put back the word status this review changed, and lift the Known suspension that
            // change may have caused. Not if the status has changed since (say the user ignored
            // the word meanwhile): that newer choice stands. Logs from before WordStatusAfter
            // existed don't record it and are always restored.
            int? restoredWordStatus = null;
            if (lastLog.WordStatusBefore is { } statusBefore)
            {
                var word = await _context.Words.FirstOrDefaultAsync(w => w.WordId == card.WordId && w.UserId == userId);
                if (word != null && (lastLog.WordStatusAfter is not { } statusAfter || word.Status == statusAfter))
                {
                    word.Status = statusBefore;
                    restoredWordStatus = statusBefore;
                    if (statusBefore != SrsCardLifecycle.StatusKnown) SrsCardLifecycle.LiftStatusSuspension(card);
                }
            }

            // Revert daily limits and streak. Reading credit never counted toward them.
            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            SrsLeeches.OnUndo(card, lapsesAfterReview, settings);
            if (settings != null && lastLog.Kind != (int)SrsReviewKind.Reading)
            {
                var day = DayContext(settings, timezoneOffsetMinutes, now);
                await RevertDailyLimitsAsync(settings, lastLog, day.Options);
            }

            // Remove the log
            _context.SrsReviewLogs.Remove(lastLog);

            await _context.SaveChangesAsync();
            return Ok(new { Message = "Undo successful.", card.SrsCardReviewId, lastLog.SrsReviewLogId, RestoredWordStatus = restoredWordStatus });
        }

        // GET: api/srs/forecast?languageId=1&days=14&timezoneOffsetMinutes=120
        [HttpGet("forecast")]
        public async Task<ActionResult<List<SrsForecastDto>>> GetForecast(
            [FromQuery] int? languageId = null,
            [FromQuery] int days = 14,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;
            days = Math.Clamp(days, 1, 366);

            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);
            var end = SrsDay.DayStartUtc(day.Today.AddDays(days), day.Options.TimezoneOffsetMinutes, day.Options.DayStartHour);

            var query = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId && !scr.IsSuspended && scr.NextReviewAt < end);

            if (languageId.HasValue)
            {
                query = query.Where(scr => scr.Word.LanguageId == languageId.Value);
            }

            var dueTimes = await query.Select(scr => scr.NextReviewAt).ToListAsync();

            // Group by user day in memory; past-due cards all land on today.
            var countsByDay = dueTimes
                .Select(t => SrsDay.UserDay(t, day.Options.TimezoneOffsetMinutes, day.Options.DayStartHour))
                .Select(d => d < day.Today ? day.Today : d)
                .GroupBy(d => d)
                .ToDictionary(g => g.Key, g => g.Count());

            // Fill empty days for charting consistency
            var forecastList = new List<SrsForecastDto>();
            for (int i = 0; i < days; i++)
            {
                var date = day.Today.AddDays(i);
                forecastList.Add(new SrsForecastDto
                {
                    Date = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    Count = countsByDay.GetValueOrDefault(date),
                });
            }

            return forecastList;
        }

        // GET: api/srs/phrases/5
        [HttpGet("phrases/{wordId}")]
        public async Task<ActionResult<List<SrsPhraseDto>>> GetPhrases(int wordId)
        {
            var userId = GetUserId();

            var phrases = await _context.SrsPhrases
                .AsNoTracking()
                .Where(sp => sp.WordId == wordId && sp.UserId == userId)
                .OrderByDescending(sp => sp.CreatedAt)
                .Select(sp => new SrsPhraseDto
                {
                    SrsPhraseId = sp.SrsPhraseId,
                    Sentence = sp.Sentence,
                    TextTitle = sp.TextTitle,
                    CreatedAt = sp.CreatedAt
                })
                .ToListAsync();

            return phrases;
        }

        // DELETE: api/srs/phrases/5
        [HttpDelete("phrases/{phraseId}")]
        public async Task<IActionResult> DeletePhrase(int phraseId)
        {
            var userId = GetUserId();

            var phrase = await _context.SrsPhrases
                .FirstOrDefaultAsync(sp => sp.SrsPhraseId == phraseId && sp.UserId == userId);

            if (phrase == null)
                return NotFound();

            _context.SrsPhrases.Remove(phrase);
            await _context.SaveChangesAsync();

            return NoContent();
        }

        // GET: api/srs/stats?languageId=1&timezoneOffsetMinutes=120
        [HttpGet("stats")]
        public async Task<ActionResult<SrsStatsDto>> GetStats(
            [FromQuery] int? languageId = null,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;

            // Fetch settings for limit info, streak and the user's day boundary
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);

            var cardQuery = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId)
                .Where(scr => !scr.IsSuspended)
                .Where(scr => scr.BuriedUntil == null || scr.BuriedUntil <= now);

            if (languageId.HasValue)
            {
                cardQuery = cardQuery.Where(scr => scr.Word.LanguageId == languageId.Value);
            }

            // Counted in the database: learning (0), new (1), young (2), mature (3).
            var byGroup = await cardQuery
                .GroupBy(c => c.IsLearning ? 0 : c.LastReviewedAt == null ? 1 : c.Interval < SrsSchedulerSettings.MatureIntervalDays ? 2 : 3)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(g => g.Key, g => g.Count);
            var dueByGroup = await cardQuery
                .Where(IsDue(now, day.TomorrowStartUtc))
                .GroupBy(c => c.IsLearning ? 0 : c.LastReviewedAt == null ? 1 : 2)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(g => g.Key, g => g.Count);

            int learningCards = byGroup.GetValueOrDefault(0);
            int newCards = byGroup.GetValueOrDefault(1);
            int youngCards = byGroup.GetValueOrDefault(2);
            int matureCards = byGroup.GetValueOrDefault(3);
            int dueLearnCount = dueByGroup.GetValueOrDefault(0);
            int dueNewCount = dueByGroup.GetValueOrDefault(1);
            int dueReviewCount = dueByGroup.GetValueOrDefault(2);

            var reviewedToday = await cardQuery.CountAsync(c => c.LastReviewedAt >= day.TodayStartUtc);

            var totalPhrases = await _context.SrsPhrases
                .AsNoTracking()
                .CountAsync(sp => sp.UserId == userId);

            var (studiedNew, studiedReviews) = StudiedOn(settings, day.Today);

            // Calculate reviewable count (quota-aware) to match what GetDueCards would serve
            int maxNew = EffectiveSrsMaxNew(settings?.SrsMaxNewCards);
            int maxReviews = EffectiveSrsMaxReviews(settings?.SrsMaxReviews);
            int remainingNew = Math.Max(0, maxNew - studiedNew);
            int remainingReviews = Math.Max(0, maxReviews - studiedReviews);
            int reviewableCount = dueLearnCount + Math.Min(dueNewCount, remainingNew) + Math.Min(dueReviewCount, remainingReviews);

            // True retention (last 30 days): how often graduated cards were remembered when
            // they came due. Learning steps and reading credit are left out, and Hard counts
            // as remembered.
            var thirtyDaysAgo = now.AddDays(-30);
            var reviewLogs = _context.SrsReviewLogs
                .AsNoTracking()
                .Where(log => log.UserId == userId && log.ReviewedAt >= thirtyDaysAgo && log.Kind == (int)SrsReviewKind.Review);
            if (languageId.HasValue)
                reviewLogs = reviewLogs.Where(log => log.SrsCardReview.Word.LanguageId == languageId.Value);
            var recent = await reviewLogs
                .GroupBy(log => 1)
                .Select(g => new { Total = g.Count(), Passed = g.Count(log => log.Grade >= 1) })
                .FirstOrDefaultAsync();
            double retentionRate = recent is { Total: > 0 }
                ? Math.Round((double)recent.Passed / recent.Total * 100, 1)
                : 0;

            return new SrsStatsDto
            {
                DueCount = dueLearnCount + dueNewCount + dueReviewCount,
                ReviewableCount = reviewableCount,
                TotalCards = learningCards + newCards + youngCards + matureCards,
                NewCards = newCards,
                LearningCards = learningCards,
                YoungCards = youngCards,
                MatureCards = matureCards,
                TotalPhrases = totalPhrases,
                ReviewedToday = reviewedToday,
                MaxNewCards = maxNew,
                MaxReviews = maxReviews,
                StudiedNewCardsToday = studiedNew,
                StudiedReviewsToday = studiedReviews,
                CurrentStreak = settings?.SrsCurrentStreak ?? 0,
                LongestStreak = settings?.SrsLongestStreak ?? 0,
                RetentionRate = retentionRate
            };
        }

        // POST: api/srs/suspend/{cardId}
        [HttpPost("suspend/{cardId}")]
        public async Task<IActionResult> SuspendCard(int cardId)
        {
            var userId = GetUserId();
            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == cardId && scr.UserId == userId);
            if (card == null) return NotFound();
            card.IsSuspended = true;
            card.SuspendReason = SrsSuspendReasons.Manual;
            await _context.SaveChangesAsync();
            return Ok(new { Message = "Card suspended." });
        }

        // POST: api/srs/unsuspend/{cardId}
        [HttpPost("unsuspend/{cardId}")]
        public async Task<IActionResult> UnsuspendCard(int cardId)
        {
            var userId = GetUserId();
            var card = await _context.SrsCardReviews
                .Include(scr => scr.Word)
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == cardId && scr.UserId == userId);
            if (card == null) return NotFound();
            // Ignored words never come up in review; changing the word's status lifts that suspension.
            if (card.Word.Status == SrsCardLifecycle.StatusIgnored)
                return BadRequest(new { Message = "The word is ignored; change its status to review it again." });
            card.IsSuspended = false;
            card.SuspendReason = null;
            await _context.SaveChangesAsync();
            return Ok(new { Message = "Card unsuspended." });
        }

        // GET: api/srs/suspended?languageId=1
        // Cards suspended by hand or as leeches, which stay out of review until unsuspended.
        // Cards suspended for their word's status (Ignored, or Known when Known cards are
        // retired) aren't listed: they follow the status, so changing it brings them back.
        [HttpGet("suspended")]
        public async Task<ActionResult<List<SrsSuspendedCardDto>>> GetSuspendedCards([FromQuery] int? languageId = null)
        {
            var userId = GetUserId();
            var query = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId && scr.IsSuspended
                    && scr.SuspendReason != SrsSuspendReasons.Ignored
                    && scr.SuspendReason != SrsSuspendReasons.Known
                    && scr.Word.Status != SrsCardLifecycle.StatusIgnored);
            if (languageId.HasValue)
                query = query.Where(scr => scr.Word.LanguageId == languageId.Value);

            return await query
                .OrderBy(scr => scr.Word.Term)
                .ThenBy(scr => scr.SrsCardReviewId)
                .Take(200)
                .Select(scr => new SrsSuspendedCardDto
                {
                    SrsCardReviewId = scr.SrsCardReviewId,
                    WordId = scr.WordId,
                    Term = scr.Word.Term,
                    Translation = scr.Word.Translation != null ? scr.Word.Translation.Translation : "",
                    WordStatus = scr.Word.Status,
                    SuspendReason = scr.SuspendReason,
                    Lapses = scr.Lapses,
                })
                .ToListAsync();
        }

        // POST: api/srs/bury/{cardId}?timezoneOffsetMinutes=120
        [HttpPost("bury/{cardId}")]
        public async Task<IActionResult> BuryCard(int cardId, [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == cardId && scr.UserId == userId);
            if (card == null) return NotFound();
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            card.BuriedUntil = DayContext(settings, timezoneOffsetMinutes, DateTime.UtcNow).TomorrowStartUtc;
            await _context.SaveChangesAsync();
            return Ok(new { Message = "Card buried until tomorrow." });
        }

        // PATCH: api/srs/cards/{cardId}
        [HttpPatch("cards/{cardId}")]
        public async Task<IActionResult> UpdateCard(int cardId, [FromBody] SrsCardPatchDto dto)
        {
            var userId = GetUserId();
            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == cardId && scr.UserId == userId);
            if (card == null) return NotFound();

            if (dto.Flag.HasValue)
                card.Flag = Math.Clamp(dto.Flag.Value, 0, 4);
            if (dto.Tags != null)
                card.Tags = dto.Tags;

            await _context.SaveChangesAsync();
            return Ok(new { card.Flag, card.Tags });
        }

        // GET: api/srs/heatmap?days=365&timezoneOffsetMinutes=120
        [HttpGet("heatmap")]
        public async Task<ActionResult<List<SrsHeatmapDto>>> GetHeatmap(
            [FromQuery] int days = 365,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            days = Math.Clamp(days, 1, 731);
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, DateTime.UtcNow);
            var tz = day.Options.TimezoneOffsetMinutes;
            var dayStart = day.Options.DayStartHour;
            var startDate = SrsDay.DayStartUtc(day.Today.AddDays(-days), tz, dayStart);

            var reviewTimes = await _context.SrsReviewLogs
                .AsNoTracking()
                .Where(log => log.UserId == userId && log.ReviewedAt >= startDate && log.Kind != (int)SrsReviewKind.Reading)
                .Select(log => log.ReviewedAt)
                .ToListAsync();

            // Keyed by user day, so the client can match cells on its local calendar date.
            var grouped = reviewTimes
                .GroupBy(t => SrsDay.UserDay(t, tz, dayStart))
                .OrderBy(g => g.Key)
                .Select(g => new SrsHeatmapDto
                {
                    Date = g.Key.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    ReviewCount = g.Count()
                })
                .ToList();

            return grouped;
        }

        // POST: api/srs/reading-credit/{wordId}?timezoneOffsetMinutes=120
        // Meeting a word while reading counts as a successful (Good) review of its card: once
        // per card per day, only for graduated cards, logged like any other review, but kept
        // out of the daily limits, streak and retention figures. FSRS gives an early review a
        // small boost only, so this can't inflate intervals the way the old flat +10% did.
        [HttpPost("reading-credit/{wordId}")]
        public async Task<IActionResult> ApplyReadingCredit(int wordId, [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;
            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.WordId == wordId && scr.UserId == userId);

            if (card == null) return NotFound(new { Message = "No SRS card found for this word." });
            if (card.IsSuspended)
                return Ok(new { Message = "Card is suspended.", Applied = false });

            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);
            var scheduler = new SrsScheduler(day.Options);

            if (card.GetState() != SrsCardState.Review)
                return Ok(new { Message = "Card too new for reading credit.", Applied = false });
            if (card.LastReviewedAt >= day.TodayStartUtc)
                return Ok(new { Message = "Card already reviewed today.", Applied = false });

            await SrsMemoryStateInitializer.EnsureAsync(_context, card, scheduler.Algorithm);
            var outcome = scheduler.Review(card.ToSnapshot(), grade: 2, now) with { Kind = SrsReviewKind.Reading };

            _context.SrsReviewLogs.Add(NewReviewLog(userId, card, grade: 2, now, outcome));
            card.Apply(outcome.Card);

            await _context.SaveChangesAsync();
            return Ok(new { Message = "Reading credit applied.", Applied = true, card.Interval, card.NextReviewAt });
        }

        // --- User-day helpers ---

        private sealed record SrsDayContext(SrsSchedulerOptions Options, DateOnly Today, DateTime TodayStartUtc, DateTime TomorrowStartUtc);

        private static SrsDayContext DayContext(UserSettings? settings, int timezoneOffsetMinutes, DateTime now)
        {
            var options = SrsSchedulerSettings.FromUserSettings(settings, timezoneOffsetMinutes);
            var tz = options.TimezoneOffsetMinutes;
            var today = SrsDay.UserDay(now, tz, options.DayStartHour);
            return new SrsDayContext(
                options,
                today,
                SrsDay.DayStartUtc(today, tz, options.DayStartHour),
                SrsDay.DayStartUtc(today.AddDays(1), tz, options.DayStartHour));
        }

        /// <summary>
        /// Cards to review now. A graduated card is due for the whole of the user day it falls
        /// on, from the start of that day (so "1 day" never turns into 2 because of the time
        /// it was last reviewed). Learning cards are due to the minute; those due within the
        /// learn-ahead window are included so the client can show them when nothing else is left.
        /// </summary>
        private static Expression<Func<SrsCardReview, bool>> IsDue(DateTime now, DateTime tomorrowStartUtc)
        {
            var learnAheadUntil = now + SrsSchedulerSettings.LearnAhead;
            return scr => (scr.IsLearning && scr.NextReviewAt <= learnAheadUntil)
                || (!scr.IsLearning && scr.NextReviewAt < tomorrowStartUtc);
        }

        private static DateOnly? StudyDay(UserSettings? settings) =>
            settings?.SrsDailyStudyDate is { } date ? DateOnly.FromDateTime(date) : null;

        private static DateTime AsStudyDate(DateOnly day) =>
            DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);

        private static (int New, int Reviews) StudiedOn(UserSettings? settings, DateOnly day) =>
            StudyDay(settings) == day
                ? (settings!.SrsDailyNewCardsStudied, settings.SrsDailyReviewsStudied)
                : (0, 0);

        /// <summary>
        /// Advances the streak and daily new/review counters for a review that happened at
        /// <paramref name="reviewedAt"/>. A card counts once per day, on its first review that day.
        /// </summary>
        private static void CountTowardDailyLimits(UserSettings settings, SrsCardSnapshot before, DateTime reviewedAt, SrsSchedulerOptions options)
        {
            var tz = options.TimezoneOffsetMinutes;
            var reviewDay = SrsDay.UserDay(reviewedAt, tz, options.DayStartHour);
            var studyDay = StudyDay(settings);

            // A late offline replay of an earlier day: those counters are gone, leave today's alone.
            if (studyDay is { } current && reviewDay < current) return;

            if (studyDay != reviewDay)
            {
                settings.SrsCurrentStreak = studyDay == reviewDay.AddDays(-1) ? settings.SrsCurrentStreak + 1 : 1;
                settings.SrsLongestStreak = Math.Max(settings.SrsLongestStreak, settings.SrsCurrentStreak);
                settings.SrsDailyStudyDate = AsStudyDate(reviewDay);
                settings.SrsDailyNewCardsStudied = 0;
                settings.SrsDailyReviewsStudied = 0;
            }
            else if (settings.SrsCurrentStreak == 0)
            {
                // Edge case: manual reset or starting today
                settings.SrsCurrentStreak = 1;
                settings.SrsLongestStreak = Math.Max(settings.SrsLongestStreak, 1);
            }

            bool firstReviewThatDay = before.LastReviewedAtUtc is not { } last
                || SrsDay.UserDay(last, tz, options.DayStartHour) != reviewDay;
            if (firstReviewThatDay)
            {
                if (before.State == SrsCardState.New) settings.SrsDailyNewCardsStudied++;
                else settings.SrsDailyReviewsStudied++;
            }
        }

        /// <summary>Reverses <see cref="CountTowardDailyLimits"/> for an undone review.</summary>
        private async Task RevertDailyLimitsAsync(UserSettings settings, SrsReviewLog log, SrsSchedulerOptions options)
        {
            var tz = options.TimezoneOffsetMinutes;
            var reviewDay = SrsDay.UserDay(log.ReviewedAt, tz, options.DayStartHour);
            if (StudyDay(settings) != reviewDay) return;

            bool wasFirstReviewThatDay = log.OldLastReviewedAt is not { } last
                || SrsDay.UserDay(last, tz, options.DayStartHour) != reviewDay;
            if (wasFirstReviewThatDay)
            {
                var stateBefore = SrsCardStates.Derive(log.OldIsLearning, log.OldHasEverGraduated, log.OldLastReviewedAt);
                if (stateBefore == SrsCardState.New)
                    settings.SrsDailyNewCardsStudied = Math.Max(0, settings.SrsDailyNewCardsStudied - 1);
                else
                    settings.SrsDailyReviewsStudied = Math.Max(0, settings.SrsDailyReviewsStudied - 1);
            }

            // Revert the streak if this undo leaves no other reviews that day
            var dayStartUtc = SrsDay.DayStartUtc(reviewDay, tz, options.DayStartHour);
            var nextDayStartUtc = SrsDay.DayStartUtc(reviewDay.AddDays(1), tz, options.DayStartHour);
            bool hasOtherReviewsThatDay = await _context.SrsReviewLogs.AnyAsync(l =>
                l.UserId == log.UserId
                && l.SrsReviewLogId != log.SrsReviewLogId
                && l.Kind != (int)SrsReviewKind.Reading
                && l.ReviewedAt >= dayStartUtc && l.ReviewedAt < nextDayStartUtc);
            if (hasOtherReviewsThatDay) return;

            var previousLog = await _context.SrsReviewLogs
                .AsNoTracking()
                .Where(l => l.UserId == log.UserId && l.Kind != (int)SrsReviewKind.Reading && l.ReviewedAt < dayStartUtc)
                .OrderByDescending(l => l.ReviewedAt)
                .FirstOrDefaultAsync();
            DateOnly? previousDay = previousLog != null
                ? SrsDay.UserDay(previousLog.ReviewedAt, tz, options.DayStartHour)
                : null;

            // Had a streak going before that day: just decrement. Otherwise it started that day.
            settings.SrsCurrentStreak = previousDay == reviewDay.AddDays(-1)
                ? Math.Max(0, settings.SrsCurrentStreak - 1)
                : 0;
            settings.SrsDailyStudyDate = previousDay is { } p ? AsStudyDate(p) : null;
            settings.SrsDailyNewCardsStudied = 0;
            settings.SrsDailyReviewsStudied = 0;
        }

        /// <summary>
        /// Moves the reviewed word's status per the word-status sync settings (records the old
        /// one on <paramref name="log"/> for undo) and applies the Known card rule. Returns the
        /// change, or null if the status stays.
        /// </summary>
        private async Task<SrsWordStatusChangeDto?> SyncWordStatusAsync(
            Guid userId, SrsCardReview card, SrsReviewOutcome outcome, UserSettings? settings, SrsReviewLog log)
        {
            var word = await _context.Words.FirstOrDefaultAsync(w => w.WordId == card.WordId && w.UserId == userId);
            if (word == null) return null;

            if (SrsCardLifecycle.StatusAfterReview(word.Status, outcome, settings) is not { } newStatus)
                return null;

            var change = new SrsWordStatusChangeDto { From = word.Status, To = newStatus };
            log.WordStatusBefore = word.Status;
            log.WordStatusAfter = newStatus;
            word.Status = newStatus;
            SrsCardLifecycle.ApplyStatusRules(word, card, hasSentence: true, settings);
            return change;
        }

        /// <summary>A log row capturing <paramref name="card"/>'s state before <paramref name="outcome"/> is applied.</summary>
        private static SrsReviewLog NewReviewLog(Guid userId, SrsCardReview card, int grade, DateTime reviewedAt, SrsReviewOutcome outcome) => new()
        {
            UserId = userId,
            SrsCardReviewId = card.SrsCardReviewId,
            Grade = grade,
            ReviewedAt = reviewedAt,
            OldInterval = card.Interval,
            OldRepetitions = card.Repetitions,
            OldNextReviewAt = card.NextReviewAt,
            OldIsLearning = card.IsLearning,
            OldCurrentLearningStepIndex = card.CurrentLearningStepIndex,
            OldLastReviewedAt = card.LastReviewedAt,
            OldHasEverGraduated = card.HasEverGraduated,
            OldStability = card.Stability,
            OldDifficulty = card.Difficulty,
            OldLapses = card.Lapses,
            Kind = (int)outcome.Kind,
            NewInterval = outcome.Card.IntervalDays,
        };

        private async Task<SrsReviewResultDto?> FindReplayedReviewAsync(Guid userId, string clientEventId, SrsScheduler scheduler, DateTime now)
        {
            var log = await _context.SrsReviewLogs
                .AsNoTracking()
                .FirstOrDefaultAsync(l => l.UserId == userId && l.ClientEventId == clientEventId);
            if (log == null) return null;

            var card = await _context.SrsCardReviews
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.SrsCardReviewId == log.SrsCardReviewId && c.UserId == userId);
            return card == null ? null : ToReviewResult(card, log, scheduler, now);
        }

        private static SrsReviewResultDto ToReviewResult(SrsCardReview card, SrsReviewLog log, SrsScheduler scheduler, DateTime now)
        {
            var snapshot = card.ToSnapshot(estimateMissingState: true);
            return new SrsReviewResultDto
            {
                SrsCardReviewId = card.SrsCardReviewId,
                SrsReviewLogId = log.SrsReviewLogId,
                Interval = card.Interval,
                Repetitions = card.Repetitions,
                NextReviewAt = card.NextReviewAt,
                IsLearning = card.IsLearning,
                CurrentLearningStepIndex = card.CurrentLearningStepIndex,
                HasEverGraduated = card.HasEverGraduated,
                IsSuspended = card.IsSuspended,
                Stability = card.Stability,
                Difficulty = card.Difficulty,
                Lapses = card.Lapses,
                Retrievability = scheduler.Retrievability(snapshot, now),
                NextIntervals = PreviewSeconds(scheduler, snapshot, now),
            };
        }

        private static SrsDueCardDto ToDueCardDto(
            SrsCardReview card,
            IEnumerable<SrsPhrase> phrases,
            int unknownWordsInPhrase,
            string? clozeSentence,
            SrsScheduler scheduler,
            DateTime now)
        {
            var snapshot = card.ToSnapshot(estimateMissingState: true);
            return new SrsDueCardDto
            {
                SrsCardReviewId = card.SrsCardReviewId,
                WordId = card.WordId,
                Term = card.Word.Term,
                Translation = card.Word.Translation?.Translation ?? "",
                WordStatus = card.Word.Status,
                Interval = card.Interval,
                Repetitions = card.Repetitions,
                IsLearning = card.IsLearning,
                CurrentLearningStepIndex = card.CurrentLearningStepIndex,
                HasEverGraduated = card.HasEverGraduated,
                IsSuspended = card.IsSuspended,
                Flag = card.Flag,
                Tags = card.Tags,
                NextReviewAt = card.NextReviewAt,
                Stability = card.Stability,
                Difficulty = card.Difficulty,
                Lapses = card.Lapses,
                Retrievability = scheduler.Retrievability(snapshot, now),
                NextIntervals = PreviewSeconds(scheduler, snapshot, now),
                Phrases = phrases
                    .Select(p => new SrsPhraseDto
                    {
                        SrsPhraseId = p.SrsPhraseId,
                        Sentence = p.Sentence,
                        TextTitle = p.TextTitle,
                        CreatedAt = p.CreatedAt
                    }).ToList(),
                UnknownWordsInPhrase = unknownWordsInPhrase,
                ClozeSentence = clozeSentence
            };
        }

        private static List<long> PreviewSeconds(SrsScheduler scheduler, SrsCardSnapshot snapshot, DateTime now) =>
            scheduler.PreviewIntervals(snapshot, now).Select(t => (long)Math.Round(t.TotalSeconds)).ToList();

        // GET: api/srs/stories?languageId=1
        [HttpGet("stories")]
        public async Task<ActionResult<List<SrsStoryListDto>>> GetStories([FromQuery] int? languageId = null)
        {
            var userId = GetUserId();

            var query = _context.Texts
                .AsNoTracking()
                .Where(t => t.UserId == userId && t.Tag == "srs-story");

            if (languageId.HasValue)
                query = query.Where(t => t.LanguageId == languageId.Value);

            var stories = await query
                .Include(t => t.Language)
                .OrderByDescending(t => t.CreatedAt)
                .Take(20)
                .Select(t => new SrsStoryListDto
                {
                    TextId = t.TextId,
                    Title = t.Title,
                    LanguageName = t.Language.Name,
                    CreatedAt = t.CreatedAt,
                    ContentPreview = t.Content.Length > 120 ? t.Content.Substring(0, 120) + "…" : t.Content
                })
                .ToListAsync();

            return stories;
        }

        // GET: api/srs/analytics?languageId=1&timezoneOffsetMinutes=120
        [HttpGet("analytics")]
        public async Task<ActionResult<SrsAnalyticsDto>> GetAnalytics(
            [FromQuery] int? languageId = null,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;
            var thirtyDaysAgo = now.AddDays(-30);
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var dayOptions = DayContext(settings, timezoneOffsetMinutes, now).Options;
            string UserDate(DateTime t) => SrsDay.UserDay(t, dayOptions.TimezoneOffsetMinutes, dayOptions.DayStartHour)
                .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

            // Review logs of the last 30 days, filtered and projected in the database
            // (reading credit is not a review).
            var logQuery = _context.SrsReviewLogs
                .AsNoTracking()
                .Where(log => log.UserId == userId && log.ReviewedAt >= thirtyDaysAgo && log.Kind != (int)SrsReviewKind.Reading);
            if (languageId.HasValue)
                logQuery = logQuery.Where(log => log.SrsCardReview.Word.LanguageId == languageId.Value);

            var recentLogs = await logQuery
                .Select(log => new
                {
                    log.SrsCardReviewId,
                    log.ReviewedAt,
                    log.Grade,
                    log.Kind,
                    log.OldInterval,
                    log.NewInterval,
                    WordStatus = log.SrsCardReview.Word.Status,
                })
                .ToListAsync();

            // Retention counts only graduated cards coming due (true retention); Hard is a pass.
            var retentionLogs = recentLogs.Where(log => log.Kind == (int)SrsReviewKind.Review).ToList();
            static double Rate(int passed, int total) => total > 0 ? Math.Round((double)passed / total * 100, 1) : 0;

            // 1. Retention by word status
            var retentionByStatus = retentionLogs
                .GroupBy(log => log.WordStatus)
                .Select(g => new RetentionByStatusDto
                {
                    Status = g.Key,
                    TotalReviews = g.Count(),
                    GoodReviews = g.Count(l => l.Grade >= 1),
                    RetentionRate = Rate(g.Count(l => l.Grade >= 1), g.Count())
                })
                .OrderBy(r => r.Status)
                .ToList();

            // 2. Accuracy trend (daily true retention for the last 30 days)
            var accuracyTrend = retentionLogs
                .GroupBy(log => UserDate(log.ReviewedAt))
                .Select(g => new AccuracyTrendDto
                {
                    Date = g.Key,
                    TotalReviews = g.Count(),
                    GoodReviews = g.Count(l => l.Grade >= 1),
                    RetentionRate = Rate(g.Count(l => l.Grade >= 1), g.Count())
                })
                .OrderBy(a => a.Date)
                .ToList();

            // 3. Grade distribution
            var gradeDistribution = recentLogs
                .GroupBy(log => log.Grade)
                .Select(g => new GradeDistributionDto { Grade = g.Key, Count = g.Count() })
                .OrderBy(g => g.Grade)
                .ToList();

            // 4. Reviews per day (last 30 days)
            var reviewsPerDay = recentLogs
                .GroupBy(log => UserDate(log.ReviewedAt))
                .Select(g => new ReviewsPerDayDto
                {
                    Date = g.Key,
                    Count = g.Count()
                })
                .OrderBy(r => r.Date)
                .ToList();

            // 5. Leeches: cards forgotten again and again, by their lifetime lapse count.
            // Listed from half the leech threshold on, so trouble shows before it trips.
            int leechThreshold = SrsLeeches.Threshold(settings);
            int listFrom = Math.Max(2, (leechThreshold > 0 ? leechThreshold : SrsLeeches.DefaultThreshold) / 2);
            var leechQuery = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId && scr.Lapses >= listFrom);
            if (languageId.HasValue)
                leechQuery = leechQuery.Where(scr => scr.Word.LanguageId == languageId.Value);
            var leechCards = await leechQuery
                .OrderByDescending(scr => scr.Lapses)
                .Take(20)
                .Select(scr => new LeechCardDto
                {
                    SrsCardReviewId = scr.SrsCardReviewId,
                    WordId = scr.WordId,
                    Term = scr.Word.Term,
                    Translation = scr.Word.Translation != null ? scr.Word.Translation.Translation : "",
                    LapseCount = scr.Lapses,
                    WordStatus = scr.Word.Status,
                    Difficulty = scr.Difficulty,
                    IsSuspended = scr.IsSuspended,
                })
                .ToListAsync();

            // 6. Cards that crossed into mature (interval of 21+ days) in the last 7 days
            var weekAgo = now.AddDays(-7);
            var maturedThisWeek = recentLogs
                .Where(log => log.ReviewedAt >= weekAgo
                    && log.OldInterval < SrsSchedulerSettings.MatureIntervalDays
                    && log.NewInterval >= SrsSchedulerSettings.MatureIntervalDays)
                .Select(log => log.SrsCardReviewId)
                .Distinct()
                .Count();

            return new SrsAnalyticsDto
            {
                RetentionByStatus = retentionByStatus,
                AccuracyTrend = accuracyTrend,
                GradeDistribution = gradeDistribution,
                ReviewsPerDay = reviewsPerDay,
                LeechCards = leechCards,
                LeechThreshold = leechThreshold,
                CardsMaturedThisWeek = maturedThisWeek,
                TotalReviewsLast30Days = recentLogs.Count,
                AvgReviewsPerDay = recentLogs.Count > 0 ? Math.Round((double)recentLogs.Count / 30, 1) : 0
            };
        }

        // POST: api/srs/story-generate
        [HttpPost("story-generate")]
        public async Task<ActionResult<SrsStoryGenerateResponse>> GenerateStoryFromDueWords(
            [FromBody] SrsStoryGenerateRequest request,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var userId = GetUserId();
            var now = DateTime.UtcNow;

            // 1. Load user settings for daily limits
            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);
            var (studiedNew, studiedReviews) = StudiedOn(settings, day.Today);
            // Same caps as /srs/due (this used to default reviews to 100 instead of 200).
            int effectiveMaxNew = EffectiveSrsMaxNew(settings?.SrsMaxNewCards);
            int effectiveMaxReviews = EffectiveSrsMaxReviews(settings?.SrsMaxReviews);
            int remainingNew = Math.Max(0, effectiveMaxNew - studiedNew);
            int remainingReviews = Math.Max(0, effectiveMaxReviews - studiedReviews);

            // 2. Fetch due cards with card type filter and daily limits
            var baseQuery = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId)
                .Where(IsDue(now, day.TomorrowStartUtc))
                .Where(scr => !scr.IsSuspended)
                .Where(scr => scr.BuriedUntil == null || scr.BuriedUntil <= now)
                .Include(scr => scr.Word)
                    .ThenInclude(w => w.Translation)
                .Where(scr => scr.Word.LanguageId == request.LanguageId);

            if (!string.IsNullOrEmpty(request.Status))
            {
                var statusList = request.Status.Split(',').Select(s => s.Trim()).Where(s => int.TryParse(s, out _)).Select(int.Parse).ToList();
                if (statusList.Any()) baseQuery = baseQuery.Where(scr => statusList.Contains(scr.Word.Status));
            }

            var cardType = (request.CardType ?? "all").Trim().ToLowerInvariant();

            // One micro-context per due card; cap directly at MaxWords (no pool/AI selection step).
            int poolSize = request.MaxWords;

            // Fetch cards based on card type, respecting daily limits for the pool
            var allDueCards = new List<SrsCardReview>();

            if (cardType == "new")
            {
                allDueCards = await baseQuery
                    .Where(scr => scr.Repetitions == 0 && scr.LastReviewedAt == null)
                    .OrderBy(scr => scr.NextReviewAt)
                    .Take(Math.Min(poolSize, remainingNew))
                    .ToListAsync();
            }
            else if (cardType == "review")
            {
                // Learning cards + review cards
                var learningCards = await baseQuery
                    .Where(scr => scr.IsLearning)
                    .OrderBy(scr => scr.NextReviewAt)
                    .Take(poolSize)
                    .ToListAsync();
                var reviewCards = await baseQuery
                    .Where(scr => !scr.IsLearning && (scr.Repetitions > 0 || scr.LastReviewedAt != null))
                    .OrderBy(scr => scr.NextReviewAt)
                    .Take(Math.Min(poolSize, remainingReviews))
                    .ToListAsync();
                allDueCards = learningCards.Concat(reviewCards).Take(poolSize).ToList();
            }
            else // "all"
            {
                // Learning cards (no limit)
                var learningCards = await baseQuery
                    .Where(scr => scr.IsLearning)
                    .OrderBy(scr => scr.NextReviewAt)
                    .Take(poolSize)
                    .ToListAsync();
                // New cards (capped by remaining budget)
                var newCards = await baseQuery
                    .Where(scr => !scr.IsLearning && scr.Repetitions == 0 && scr.LastReviewedAt == null)
                    .OrderBy(scr => scr.NextReviewAt)
                    .Take(Math.Min(poolSize, remainingNew))
                    .ToListAsync();
                // Review cards (capped by remaining budget)
                var reviewCards = await baseQuery
                    .Where(scr => !scr.IsLearning && (scr.Repetitions > 0 || scr.LastReviewedAt != null))
                    .OrderBy(scr => scr.NextReviewAt)
                    .Take(Math.Min(poolSize, remainingReviews))
                    .ToListAsync();
                allDueCards = learningCards.Concat(newCards).Concat(reviewCards).Take(poolSize).ToList();
            }

            if (!allDueCards.Any())
                return Ok(new SrsStoryGenerateResponse { MicroContexts = new(), RemainingNewBudget = remainingNew, RemainingReviewBudget = remainingReviews });

            // 3. Build target words list
            var targetWords = allDueCards.Select(card => new SrsStoryWordDto
            {
                SrsCardReviewId = card.SrsCardReviewId,
                WordId = card.WordId,
                Term = card.Word.Term,
                Translation = card.Word.Translation?.Translation ?? "",
                WordStatus = card.Word.Status,
                Interval = card.Interval,
                Repetitions = card.Repetitions,
                IsLearning = card.IsLearning,
                CurrentLearningStepIndex = card.CurrentLearningStepIndex,
                HasEverGraduated = card.HasEverGraduated
            }).ToList();

            // 4. Build prompt
            var language = await _context.Languages.AsNoTracking()
                .FirstOrDefaultAsync(l => l.LanguageId == request.LanguageId);
            var languageName = language?.Name ?? "the target language";

            // Auto-compute level based on word status mix
            var avgStatus = targetWords.Average(w => w.WordStatus);
            var level = avgStatus <= 2.0 ? "beginner" : avgStatus <= 3.5 ? "intermediate" : "advanced";

            var wordList = string.Join("\n", targetWords.Select(w => $"- {w.Term} ({w.Translation})"));

            var defaultPrompt = $@"For each vocabulary word below, write a short, natural micro-context in {languageName} that uses the word in a form whose meaning matches its provided translation.

Vocabulary:
{wordList}

Rules:
1. Grammatical & syntactic analysis: First analyze the word's gender, number, person, and tense. Determine if the word requires specific prepositions or reflexive/clitic pronouns to be grammatically natural.
2. Form fidelity with clitic allowance: Use the word in the EXACT given form whenever it is grammatically natural. If the word is a verb that natively requires a clitic pronoun (e.g. ""-me"", ""-se"", ""-nos"", ""-lhe"") to make sense, you MUST attach it appropriately rather than producing broken grammar to keep the form isolated.
3. Strict logic: Invent scenarios that natively fit the grammar. The context must make strict, real-world logical sense — do not invent illogical physical traits for objects (e.g. a painting does not have feet).
4. 2–3 short sentences per word. A brief micro-dialogue is fine. The context must read naturally to a {level}-level learner.
5. Each context is independent — do NOT carry characters or storylines between words.
6. The ""usedForm"" field must be the EXACT inflected form you wrote inside the context (including any attached clitic pronoun, hyphens, accents, and casing). It MUST appear verbatim as a substring of ""context"".
7. Return ONLY a JSON array, no markdown fences, no commentary, no trailing text. Before outputting, verify each ""usedForm"" appears verbatim in its ""context"".

Format (one object per provided word, in the same order):
[
  {{""term"": ""<exact term as given>"", ""usedForm"": ""<inflected form actually used in context>"", ""context"": ""<2–3 sentences>""}},
  ...
]";

            // CustomStoryPrompt may still be set from the old story-mode era; substitute the same
            // {language}, {level}, {wordList} placeholders so existing templates that ask for
            // micro-context output keep working. Templates written for narrative output will likely
            // produce non-JSON responses and the parser will return an empty list.
            var settingsForPrompt = settings ?? new Models.UserSettings();
            var promptVars = new Dictionary<string, string?>
            {
                ["language"] = languageName,
                ["level"] = level,
                ["wordList"] = wordList
            };
            var prompt = AiTaskConfig.ResolvePromptOrDefault(
                settingsForPrompt.CustomStoryPrompt, defaultPrompt, promptVars);

            // 5. Generate using user's configured AI provider
            var storyService = await _storyGenerationServiceFactory.GetServiceForUserAsync(userId);
            var rawResponse = await storyService.GenerateStoryAsync(prompt, maxOutputTokens: 20000);

            // 6. Parse JSON micro-context array
            var parsed = SrsStoryResponseParser.ParseMicroContexts(rawResponse);

            // Match each parsed entry back to a target card by exact term (case-insensitive).
            // GroupBy + First defends against duplicate-term rows in the user's vocab
            // (same crash class as the one CountUnknownWordsInSentence hit on /api/srs/due).
            var targetByTerm = targetWords
                .GroupBy(t => t.Term.ToLowerInvariant())
                .ToDictionary(g => g.Key, g => g.First());
            var seenWordIds = new HashSet<int>();
            var microContexts = new List<SrsMicroContextDto>();
            foreach (var mc in parsed)
            {
                if (!targetByTerm.TryGetValue(mc.Term.Trim().ToLowerInvariant(), out var tw)) continue;
                if (!seenWordIds.Add(tw.WordId)) continue;
                microContexts.Add(new SrsMicroContextDto
                {
                    SrsCardReviewId = tw.SrsCardReviewId,
                    WordId = tw.WordId,
                    Term = tw.Term,
                    Translation = tw.Translation,
                    Context = mc.Context,
                    UsedForm = string.IsNullOrWhiteSpace(mc.UsedForm) ? tw.Term : mc.UsedForm,
                    WordStatus = tw.WordStatus
                });
            }

            // 7. Save concatenated contexts as a Text record so saved-from-lookup words have a TextId.
            var combined = string.Join("\n\n", microContexts.Select(m => $"**{m.Term}** — {m.Context}"));
            var storyTextRecord = new Text
            {
                Title = $"SRS Micro-Contexts — {now:yyyy-MM-dd HH:mm}",
                Content = combined,
                LanguageId = request.LanguageId,
                UserId = userId,
                Tag = "srs-story",
                CreatedAt = now
            };
            _context.Texts.Add(storyTextRecord);
            await _context.SaveChangesAsync();

            return Ok(new SrsStoryGenerateResponse
            {
                MicroContexts = microContexts,
                TextId = storyTextRecord.TextId,
                LanguageCode = language?.Code ?? "",
                RemainingNewBudget = remainingNew,
                RemainingReviewBudget = remainingReviews
            });
        }

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                throw new UnauthorizedAccessException("User ID not found in token");
            }
            return userId;
        }

        /// <summary>Daily new-card cap: DB may store 0 from an old migration default; treat as app default.</summary>
        private static int EffectiveSrsMaxNew(int? stored) => stored is > 0 ? stored.Value : SrsSchedulerSettings.DefaultMaxNewCards;

        /// <summary>Daily review cap: same as <see cref="EffectiveSrsMaxNew"/>.</summary>
        private static int EffectiveSrsMaxReviews(int? stored) => stored is > 0 ? stored.Value : SrsSchedulerSettings.DefaultMaxReviews;

        /// <summary>Defensive normalizer for UserSettings.SrsCardType. Falls back to "translation".</summary>
        internal static string NormalizeCardType(string? value)
        {
            var normalized = (value ?? "translation").Trim().ToLowerInvariant();
            return normalized is "translation" or "cloze" or "mixed" ? normalized : "translation";
        }

        /// <summary>
        /// Replace the first whole-word, case-insensitive occurrence of
        /// <paramref name="term"/> in <paramref name="sentence"/> with "___" (3
        /// underscores). Returns null if no whole-word match exists or either
        /// argument is empty — callers should fall back to translation mode.
        ///
        /// We assert "no word character on either side" via lookbehind/lookahead
        /// rather than the simpler <c>\b...\b</c> so that terms which themselves
        /// start or end with non-word characters (e.g. abbreviations like "e.g.",
        /// French elisions like "l'") still match cleanly. <c>\w</c> follows the
        /// Unicode definition, so:
        /// <list type="bullet">
        /// <item>Latin: term "es" won't mask the "es" inside "estas".</item>
        /// <item>CJK: every ideograph is <c>\w</c>, so 猫 inside 野猫 also fails
        /// to match. The cloze view drops to translation mode for those cards
        /// rather than producing a garbled mask.</item>
        /// </list>
        /// </summary>
        internal static string? BuildClozeSentence(string? sentence, string? term)
        {
            if (string.IsNullOrEmpty(sentence) || string.IsNullOrEmpty(term)) return null;
            const string Mask = "___";
            var match = Regex.Match(
                sentence,
                $@"(?<!\w){Regex.Escape(term)}(?!\w)",
                RegexOptions.IgnoreCase);
            if (!match.Success) return null;
            return string.Concat(
                sentence.AsSpan(0, match.Index),
                Mask,
                sentence.AsSpan(match.Index + match.Length));
        }
    }

    // --- DTOs ---

    public class SrsDueCardDto
    {
        public int SrsCardReviewId { get; set; }
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public string Translation { get; set; } = string.Empty;
        public int WordStatus { get; set; }
        public int Interval { get; set; }
        public int Repetitions { get; set; }
        public bool IsLearning { get; set; }
        public int CurrentLearningStepIndex { get; set; }
        public bool HasEverGraduated { get; set; }
        public bool IsSuspended { get; set; }
        public DateTime NextReviewAt { get; set; }

        // FSRS memory state. Null for a card that has never been reviewed.
        public double? Stability { get; set; }
        public double? Difficulty { get; set; }
        public double? Retrievability { get; set; }
        public int Lapses { get; set; }

        /// <summary>Interval each grade (Again, Hard, Good, Easy) would give, in seconds.</summary>
        public List<long> NextIntervals { get; set; } = new();
        public int Flag { get; set; }
        public string? Tags { get; set; }
        public List<SrsPhraseDto> Phrases { get; set; } = new();
        public int UnknownWordsInPhrase { get; set; }

        // Null when the user's SrsCardType setting is "translation" (default), or when
        // the card has no mined phrase, or when the term doesn't appear in the chosen
        // phrase. Otherwise: the mined sentence with the first case-insensitive
        // occurrence of Term replaced by "___".
        public string? ClozeSentence { get; set; }
    }

    public class SrsPhraseDto
    {
        public int SrsPhraseId { get; set; }
        public string Sentence { get; set; } = string.Empty;
        public string? TextTitle { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class SrsReviewSubmitDto
    {
        [Required]
        public int SrsCardReviewId { get; set; }

        [Required]
        [Range(0, 3)]
        public int Grade { get; set; } // 0=Again, 1=Hard, 2=Good, 3=Easy

        /// <summary>Idempotency key; a replay with the same key returns the first result.</summary>
        [StringLength(64)]
        public string? ClientEventId { get; set; }

        /// <summary>When the review actually happened (offline replays). Defaults to now.</summary>
        public DateTime? ReviewedAt { get; set; }
    }

    public class SrsReviewResultDto
    {
        public int SrsCardReviewId { get; set; }
        public int SrsReviewLogId { get; set; }
        public int Interval { get; set; }
        public int Repetitions { get; set; }
        public DateTime NextReviewAt { get; set; }
        public bool IsLearning { get; set; }
        public int CurrentLearningStepIndex { get; set; }
        public bool HasEverGraduated { get; set; }
        public double? Stability { get; set; }
        public double? Difficulty { get; set; }
        public double? Retrievability { get; set; }
        public int Lapses { get; set; }
        public List<long> NextIntervals { get; set; } = new();

        public bool IsSuspended { get; set; }

        /// <summary>Set when this review moved the word's reader status (word-status sync).</summary>
        public SrsWordStatusChangeDto? WordStatusChange { get; set; }

        /// <summary>True when this lapse made the card a leech (tagged, and suspended if so configured).</summary>
        public bool BecameLeech { get; set; }
    }

    public class SrsWordStatusChangeDto
    {
        public int From { get; set; }
        public int To { get; set; }
    }

    public class SrsUndoDto
    {
        public int? SrsReviewLogId { get; set; }

        /// <summary>The idempotency key the review was submitted with (used when the log id is unknown).</summary>
        [StringLength(64)]
        public string? ClientEventId { get; set; }
    }

    public class SrsMineDto
    {
        [Required]
        public int WordId { get; set; }

        [Required]
        public string Sentence { get; set; } = string.Empty;

        public int? TextId { get; set; }
        public string? TextTitle { get; set; }
    }

    public class SrsStatsDto
    {
        public int DueCount { get; set; }
        public int ReviewableCount { get; set; }
        public int TotalCards { get; set; }
        public int NewCards { get; set; }
        /// <summary>Cards on a (re)learning step.</summary>
        public int LearningCards { get; set; }
        /// <summary>Graduated cards with an interval under 21 days.</summary>
        public int YoungCards { get; set; }
        public int MatureCards { get; set; }
        public int TotalPhrases { get; set; }
        public int ReviewedToday { get; set; }
        
        public int MaxNewCards { get; set; }
        public int MaxReviews { get; set; }
        public int StudiedNewCardsToday { get; set; }
        public int StudiedReviewsToday { get; set; }

        public int CurrentStreak { get; set; }
        public int LongestStreak { get; set; }
        /// <summary>True retention over 30 days: graduated cards remembered (Hard/Good/Easy) when due.</summary>
        public double RetentionRate { get; set; }
    }

    public class SrsReviewLogDto
    {
        public int SrsReviewLogId { get; set; }
        public int SrsCardReviewId { get; set; }
        public int Grade { get; set; }
        public DateTime ReviewedAt { get; set; }
    }

    public class SrsForecastDto
    {
        public string Date { get; set; } = string.Empty;
        public int Count { get; set; }
    }

    public class SrsCardPatchDto
    {
        public int? Flag { get; set; }
        public string? Tags { get; set; }
    }

    public class SrsHeatmapDto
    {
        public string Date { get; set; } = string.Empty;
        public int ReviewCount { get; set; }
    }

    // --- Analytics DTOs ---
    public class SrsAnalyticsDto
    {
        public List<RetentionByStatusDto> RetentionByStatus { get; set; } = new();
        public List<AccuracyTrendDto> AccuracyTrend { get; set; } = new();
        public List<GradeDistributionDto> GradeDistribution { get; set; } = new();
        public List<ReviewsPerDayDto> ReviewsPerDay { get; set; } = new();
        public List<LeechCardDto> LeechCards { get; set; } = new();
        /// <summary>Lapses that make a card a leech (0 = detection off).</summary>
        public int LeechThreshold { get; set; }
        public int CardsMaturedThisWeek { get; set; }
        public int TotalReviewsLast30Days { get; set; }
        public double AvgReviewsPerDay { get; set; }
    }

    public class RetentionByStatusDto
    {
        public int Status { get; set; }
        public int TotalReviews { get; set; }
        public int GoodReviews { get; set; }
        public double RetentionRate { get; set; }
    }

    public class AccuracyTrendDto
    {
        public string Date { get; set; } = string.Empty;
        public int TotalReviews { get; set; }
        public int GoodReviews { get; set; }
        public double RetentionRate { get; set; }
    }

    public class GradeDistributionDto
    {
        public int Grade { get; set; }
        public int Count { get; set; }
    }

    public class ReviewsPerDayDto
    {
        public string Date { get; set; } = string.Empty;
        public int Count { get; set; }
    }

    public class LeechCardDto
    {
        public int SrsCardReviewId { get; set; }
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public string Translation { get; set; } = string.Empty;
        public int LapseCount { get; set; }
        public int WordStatus { get; set; }
        public double? Difficulty { get; set; }
        public bool IsSuspended { get; set; }
    }

    public class SrsSuspendedCardDto
    {
        public int SrsCardReviewId { get; set; }
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public string Translation { get; set; } = string.Empty;
        public int WordStatus { get; set; }
        // "manual" or "leech" (see SrsSuspendReasons).
        public string? SuspendReason { get; set; }
        public int Lapses { get; set; }
    }

    public class SrsStoryListDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string LanguageName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public string ContentPreview { get; set; } = string.Empty;
    }

    public class SrsStoryGenerateRequest
    {
        [Required]
        public int LanguageId { get; set; }

        [Range(1, 50)]
        public int MaxWords { get; set; } = 15;

        public string? Status { get; set; }

        [StringLength(10)]
        public string? CardType { get; set; } // "new", "review", "all" (default)
    }

    public class SrsStoryGenerateResponse
    {
        public List<SrsMicroContextDto> MicroContexts { get; set; } = new();
        public int TextId { get; set; }
        public string LanguageCode { get; set; } = string.Empty;
        public int RemainingNewBudget { get; set; }
        public int RemainingReviewBudget { get; set; }
    }

    public class SrsStoryWordDto
    {
        public int SrsCardReviewId { get; set; }
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public string Translation { get; set; } = string.Empty;
        public int WordStatus { get; set; }
        public int Interval { get; set; }
        public int Repetitions { get; set; }
        public bool IsLearning { get; set; }
        public int CurrentLearningStepIndex { get; set; }
        public bool HasEverGraduated { get; set; }
    }

    public class SrsMicroContextDto
    {
        public int SrsCardReviewId { get; set; }
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public string Translation { get; set; } = string.Empty;
        public string Context { get; set; } = string.Empty;
        /// <summary>
        /// The actual inflected form the AI used inside the context (e.g. "lembrei-me" when
        /// the dictionary term is "lembrar"). Guaranteed by the parser to be a substring of
        /// <see cref="Context"/> (case-insensitive); falls back to <see cref="Term"/> when
        /// the model didn't supply one or the supplied value didn't validate.
        /// </summary>
        public string UsedForm { get; set; } = string.Empty;
        public int WordStatus { get; set; }
    }
}
