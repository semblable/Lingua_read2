using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Threading.Tasks;
using System.Linq;
using System.Collections.Generic;
using LinguaReadApi.Data;
using LinguaReadApi.Models;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class SrsController : ControllerBase
    {
        private readonly AppDbContext _context;

        public SrsController(AppDbContext context)
        {
            _context = context;
        }

        // GET: api/srs/due?languageId=1&status=1,2&onlyOneTarget=false&limit=20
        [HttpGet("due")]
        public async Task<ActionResult<List<SrsDueCardDto>>> GetDueCards(
            [FromQuery] int? languageId = null,
            [FromQuery] string? status = null,
            [FromQuery] bool onlyOneTarget = false,
            [FromQuery] int? flag = null,
            [FromQuery] string? tags = null,
            [FromQuery] int limit = 50)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;
            var today = now.Date;

            // 1. Get User Limits
            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            // Migration AddAnkiSrsSettings defaulted these columns to 0; 0 is not a valid cap (pools stay empty).
            int maxNew = EffectiveSrsMaxNew(settings?.SrsMaxNewCards);
            int maxReviews = EffectiveSrsMaxReviews(settings?.SrsMaxReviews);
            string reviewOrder = string.IsNullOrWhiteSpace(settings?.SrsReviewOrder)
                ? "mix"
                : settings!.SrsReviewOrder;

            int studiedNew = (settings?.SrsDailyStudyDate?.Date == today) ? settings.SrsDailyNewCardsStudied : 0;
            int studiedReviews = (settings?.SrsDailyStudyDate?.Date == today) ? settings.SrsDailyReviewsStudied : 0;
            
            int remainingNew = Math.Max(0, maxNew - studiedNew);
            int remainingReviews = Math.Max(0, maxReviews - studiedReviews);

            // Do not short-circuit when both daily quotas are exhausted: learning-phase
            // cards still apply (see validLearningCards below, which ignores these limits).

            // 2. Base query for due cards
            var query = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId && scr.NextReviewAt <= now)
                .Where(scr => !scr.IsSuspended)
                .Where(scr => scr.BuriedUntil == null || scr.BuriedUntil <= now)
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
                    query = query.Where(scr => scr.Tags != null && tagList.Any(t => scr.Tags.ToLower().Contains(t)));
            }

            // 3. Separate Queries & Over-fetch
            var learningCardsPool = await query.Where(scr => scr.IsLearning).OrderBy(scr => scr.NextReviewAt).ToListAsync();
            
            var newCardsPool = new List<SrsCardReview>();
            if (remainingNew > 0)
            {
                var newCardsQuery = query
                    .Where(scr => !scr.IsLearning && scr.Repetitions == 0 && scr.LastReviewedAt == null)
                    .OrderByDescending(scr => _context.TextWords.Count(tw => tw.WordId == scr.WordId)) // Safe EF Core explicit subquery
                    .ThenBy(scr => scr.CreatedAt);
                newCardsPool = await newCardsQuery.Take(Math.Max(limit * 2, remainingNew * 2)).ToListAsync();
            }

            var reviewCardsPool = new List<SrsCardReview>();
            if (remainingReviews > 0)
            {
                var reviewCardsQuery = query.Where(scr => !scr.IsLearning && (scr.Repetitions > 0 || scr.LastReviewedAt != null)).OrderBy(scr => scr.NextReviewAt);
                reviewCardsPool = await reviewCardsQuery.Take(Math.Max(limit * 2, remainingReviews * 2)).ToListAsync();
            }

            var allFetchedCards = learningCardsPool.Concat(newCardsPool).Concat(reviewCardsPool).ToList();
            if (!allFetchedCards.Any()) return new List<SrsDueCardDto>();

            // 4. Fetch Phrases for 1T validation
            var cardWordIds = allFetchedCards.Select(c => c.WordId).Distinct().ToList();
            var phrases = await _context.SrsPhrases
                .AsNoTracking()
                .Where(sp => sp.UserId == userId && cardWordIds.Contains(sp.WordId))
                .ToListAsync();
            var phrasesByWordId = phrases.GroupBy(p => p.WordId).ToDictionary(g => g.Key, g => g.ToList());

            // 5. Apply 1T filter to build lists
            var validLearningCards = new List<SrsDueCardDto>();
            var validNewCards = new List<SrsDueCardDto>();
            var validReviewCards = new List<SrsDueCardDto>();

            foreach (var card in allFetchedCards)
            {
                var cardPhrases = phrasesByWordId.GetValueOrDefault(card.WordId, new List<SrsPhrase>());
                int unknownWordsInBestPhrase = 0;

                if (cardPhrases.Any())
                {
                    var bestPhrase = cardPhrases.OrderByDescending(p => p.CreatedAt).First();
                    unknownWordsInBestPhrase = await CountUnknownWordsInSentence(
                        bestPhrase.Sentence, userId, card.Word.LanguageId, card.WordId);

                    if (onlyOneTarget && unknownWordsInBestPhrase != 1) continue; // Skip non-1T
                }
                else if (onlyOneTarget)
                {
                    continue; // No phrases for 1T
                }

                var dto = new SrsDueCardDto
                {
                    SrsCardReviewId = card.SrsCardReviewId,
                    WordId = card.WordId,
                    Term = card.Word.Term,
                    Translation = card.Word.Translation?.Translation ?? "",
                    WordStatus = card.Word.Status,
                    EaseFactor = card.EaseFactor,
                    Interval = card.Interval,
                    Repetitions = card.Repetitions,
                    IsLearning = card.IsLearning,
                    CurrentLearningStepIndex = card.CurrentLearningStepIndex,
                    IsSuspended = card.IsSuspended,
                    Flag = card.Flag,
                    Tags = card.Tags,
                    Phrases = cardPhrases
                    .OrderByDescending(p => p.CreatedAt)
                    .Select(p => new SrsPhraseDto
                    {
                        SrsPhraseId = p.SrsPhraseId,
                        Sentence = p.Sentence,
                        TextTitle = p.TextTitle,
                        CreatedAt = p.CreatedAt
                    }).ToList(),
                    UnknownWordsInPhrase = unknownWordsInBestPhrase
                };

                if (card.IsLearning) validLearningCards.Add(dto);
                else if (card.Repetitions == 0 && card.LastReviewedAt == null) validNewCards.Add(dto);
                else validReviewCards.Add(dto);
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

        // POST: api/srs/review
        [HttpPost("review")]
        public async Task<IActionResult> SubmitReview([FromBody] SrsReviewSubmitDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var userId = GetUserId();

            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == dto.SrsCardReviewId && scr.UserId == userId);

            if (card == null)
                return NotFound("Card not found.");

            // 1. Streak Tracking
            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            var today = DateTime.UtcNow.Date;
            if (settings != null)
            {
                var lastStudyDate = settings.SrsDailyStudyDate?.Date;
                if (lastStudyDate != today)
                {
                    // Update streak
                    if (lastStudyDate == today.AddDays(-1))
                    {
                        settings.SrsCurrentStreak += 1; // Continued streak
                    }
                    else
                    {
                        settings.SrsCurrentStreak = 1; // Reset or slow-started streak
                    }

                    settings.SrsLongestStreak = Math.Max(settings.SrsLongestStreak, settings.SrsCurrentStreak);

                    // Reset daily limits
                    settings.SrsDailyStudyDate = today;
                    settings.SrsDailyNewCardsStudied = 0;
                    settings.SrsDailyReviewsStudied = 0;
                }
                else if (settings.SrsCurrentStreak == 0)
                {
                    // Edge case: manual reset or starting today
                    settings.SrsCurrentStreak = 1;
                    settings.SrsLongestStreak = Math.Max(settings.SrsLongestStreak, 1);
                }
                
                // Only increment limits if this is the FIRST review of this card today
                bool isFirstReviewToday = card.LastReviewedAt == null || card.LastReviewedAt.Value.Date != today;
                if (isFirstReviewToday)
                {
                    bool wasBrandNew = card.Repetitions == 0 && card.LastReviewedAt == null;
                    if (wasBrandNew) settings.SrsDailyNewCardsStudied++;
                    else settings.SrsDailyReviewsStudied++;
                }
            }

            // 2. Logging for Undo & Retention
            var reviewLog = new SrsReviewLog
            {
                UserId = userId,
                SrsCardReviewId = dto.SrsCardReviewId,
                Grade = dto.Grade,
                OldInterval = card.Interval,
                OldEaseFactor = card.EaseFactor,
                OldRepetitions = card.Repetitions,
                OldNextReviewAt = card.NextReviewAt,
                OldIsLearning = card.IsLearning,
                OldCurrentLearningStepIndex = card.CurrentLearningStepIndex,
                OldLastReviewedAt = card.LastReviewedAt,
                ReviewedAt = DateTime.UtcNow
            };
            _context.SrsReviewLogs.Add(reviewLog);

            // Parse learning steps from user settings
            var learningSteps = ParseLearningSteps(settings?.SrsLearningStepMinutes);

            // Apply SM-2 algorithm with learning steps
            ApplySm2(card, dto.Grade, learningSteps);

            await _context.SaveChangesAsync();

            return Ok(new
            {
                card.SrsCardReviewId,
                card.Interval,
                card.EaseFactor,
                card.Repetitions,
                card.NextReviewAt
            });
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

            // Auto-create SRS card if not already tracking this word
            var existingCard = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.WordId == dto.WordId && scr.UserId == userId);

            if (existingCard == null)
            {
                var card = new SrsCardReview
                {
                    WordId = dto.WordId,
                    UserId = userId,
                    NextReviewAt = DateTime.UtcNow,
                    CreatedAt = DateTime.UtcNow
                };
                _context.SrsCardReviews.Add(card);
            }

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

        // POST: api/srs/undo
        [HttpPost("undo")]
        public async Task<IActionResult> UndoLastReview()
        {
            var userId = GetUserId();
            var cutoffTime = DateTime.UtcNow.AddMinutes(-15);
            
            var lastLog = await _context.SrsReviewLogs
                .Where(log => log.UserId == userId && log.ReviewedAt >= cutoffTime)
                .OrderByDescending(log => log.ReviewedAt)
                .FirstOrDefaultAsync();

            if (lastLog == null) return NotFound(new { Message = "No recent review found to undo." });

            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == lastLog.SrsCardReviewId && scr.UserId == userId);

            if (card == null) return NotFound();

            // Restore state
            card.Interval = lastLog.OldInterval;
            card.EaseFactor = lastLog.OldEaseFactor;
            card.Repetitions = lastLog.OldRepetitions;
            card.NextReviewAt = lastLog.OldNextReviewAt;
            card.IsLearning = lastLog.OldIsLearning;
            card.CurrentLearningStepIndex = lastLog.OldCurrentLearningStepIndex;
            card.LastReviewedAt = lastLog.OldLastReviewedAt;

            // Revert daily limits
            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            var today = DateTime.UtcNow.Date;
            bool wasFirstReviewToday = lastLog.OldLastReviewedAt == null || lastLog.OldLastReviewedAt.Value.Date != today;

            if (settings != null && settings.SrsDailyStudyDate?.Date == today && wasFirstReviewToday && lastLog.ReviewedAt.Date == today)
            {
                bool wasBrandNewBefore = lastLog.OldRepetitions == 0 && lastLog.OldLastReviewedAt == null;
                if (wasBrandNewBefore) 
                {
                    settings.SrsDailyNewCardsStudied = Math.Max(0, settings.SrsDailyNewCardsStudied - 1);
                } 
                else 
                {
                    settings.SrsDailyReviewsStudied = Math.Max(0, settings.SrsDailyReviewsStudied - 1);
                }
            }

            // Revert streak if this undo leaves no other reviews today
            if (settings != null && settings.SrsDailyStudyDate?.Date == today)
            {
                bool hasOtherReviewsToday = await _context.SrsReviewLogs
                    .AnyAsync(log => log.UserId == userId
                        && log.SrsCardReviewId != lastLog.SrsCardReviewId
                        && log.ReviewedAt.Date == today);

                if (!hasOtherReviewsToday)
                {
                    // This was the only review today — revert the streak increment
                    var yesterday = today.AddDays(-1);
                    var previousLog = await _context.SrsReviewLogs
                        .AsNoTracking()
                        .Where(log => log.UserId == userId && log.ReviewedAt.Date < today)
                        .OrderByDescending(log => log.ReviewedAt)
                        .FirstOrDefaultAsync();

                    if (previousLog != null && previousLog.ReviewedAt.Date == yesterday)
                    {
                        // Had a streak going before today — just decrement
                        settings.SrsCurrentStreak = Math.Max(0, settings.SrsCurrentStreak - 1);
                    }
                    else
                    {
                        // No review yesterday — streak was started fresh today, reset to 0
                        settings.SrsCurrentStreak = 0;
                    }
                    settings.SrsDailyStudyDate = previousLog?.ReviewedAt.Date;
                    settings.SrsDailyNewCardsStudied = 0;
                    settings.SrsDailyReviewsStudied = 0;
                }
            }

            // Remove the log
            _context.SrsReviewLogs.Remove(lastLog);

            await _context.SaveChangesAsync();
            return Ok(new { Message = "Undo successful." });
        }

        // GET: api/srs/forecast?languageId=1&days=14
        [HttpGet("forecast")]
        public async Task<ActionResult<List<SrsForecastDto>>> GetForecast([FromQuery] int? languageId = null, [FromQuery] int days = 14)
        {
            var userId = GetUserId();
            var today = DateTime.UtcNow.Date;
            var endDate = today.AddDays(days);

            var query = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId && scr.NextReviewAt < endDate);

            if (languageId.HasValue)
            {
                query = query.Where(scr => scr.Word.LanguageId == languageId.Value);
            }

            // Grouping by Date locally as Date property translations can be tricky in EF depending on DB provider
            var cards = await query
                .Select(scr => new { scr.NextReviewAt })
                .ToListAsync();

            var grouped = cards
                .Select(c => c.NextReviewAt < today ? today : c.NextReviewAt.Date) // Compress past-due into today
                .GroupBy(d => d)
                .Select(g => new SrsForecastDto
                {
                    Date = g.Key.ToString("yyyy-MM-dd"),
                    Count = g.Count()
                })
                .OrderBy(f => f.Date)
                .ToList();

            // Fill empty days for charting consistency
            var forecastList = new List<SrsForecastDto>();
            for(int i = 0; i < days; i++)
            {
                var targetDateStr = today.AddDays(i).ToString("yyyy-MM-dd");
                var dayData = grouped.FirstOrDefault(g => g.Date == targetDateStr);
                forecastList.Add(dayData ?? new SrsForecastDto { Date = targetDateStr, Count = 0 });
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

        // GET: api/srs/stats?languageId=1
        [HttpGet("stats")]
        public async Task<ActionResult<SrsStatsDto>> GetStats([FromQuery] int? languageId = null)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;

            var cardQuery = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId)
                .Where(scr => !scr.IsSuspended)
                .Where(scr => scr.BuriedUntil == null || scr.BuriedUntil <= now);

            if (languageId.HasValue)
            {
                cardQuery = cardQuery.Where(scr => scr.Word.LanguageId == languageId.Value);
            }

            var allCards = await cardQuery
                .Include(scr => scr.Word)
                .ToListAsync();

            var dueCount = allCards.Count(c => c.NextReviewAt <= now);
            var totalCards = allCards.Count;
            var newCards = allCards.Count(c => c.Repetitions == 0 && c.LastReviewedAt == null);
            var learningCards = allCards.Count(c => c.IsLearning || ((c.Repetitions > 0 || c.LastReviewedAt != null) && c.Interval < 21));
            var matureCards = allCards.Count(c => c.Interval >= 21);

            var totalPhrases = await _context.SrsPhrases
                .AsNoTracking()
                .CountAsync(sp => sp.UserId == userId);

            var reviewedToday = allCards.Count(c =>
                c.LastReviewedAt.HasValue &&
                c.LastReviewedAt.Value.Date == now.Date);

            // Fetch settings for limit info and streak
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            
            int studiedNew = (settings?.SrsDailyStudyDate?.Date == now.Date) ? settings.SrsDailyNewCardsStudied : 0;
            int studiedReviews = (settings?.SrsDailyStudyDate?.Date == now.Date) ? settings.SrsDailyReviewsStudied : 0;

            // Calculate Retention Rate (Last 30 Days)
            var thirtyDaysAgo = now.AddDays(-30);
            var recentLogs = await _context.SrsReviewLogs
                .AsNoTracking()
                .Where(log => log.UserId == userId && log.ReviewedAt >= thirtyDaysAgo)
                .ToListAsync();

            int totalRecentReviews = recentLogs.Count;
            int goodRecentReviews = recentLogs.Count(log => log.Grade >= 2);
            double retentionRate = totalRecentReviews > 0 
                ? Math.Round((double)goodRecentReviews / totalRecentReviews * 100, 1) 
                : 0;

            return new SrsStatsDto
            {
                DueCount = dueCount,
                TotalCards = totalCards,
                NewCards = newCards,
                LearningCards = learningCards,
                MatureCards = matureCards,
                TotalPhrases = totalPhrases,
                ReviewedToday = reviewedToday,
                MaxNewCards = EffectiveSrsMaxNew(settings?.SrsMaxNewCards),
                MaxReviews = EffectiveSrsMaxReviews(settings?.SrsMaxReviews),
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
            await _context.SaveChangesAsync();
            return Ok(new { Message = "Card suspended." });
        }

        // POST: api/srs/unsuspend/{cardId}
        [HttpPost("unsuspend/{cardId}")]
        public async Task<IActionResult> UnsuspendCard(int cardId)
        {
            var userId = GetUserId();
            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == cardId && scr.UserId == userId);
            if (card == null) return NotFound();
            card.IsSuspended = false;
            await _context.SaveChangesAsync();
            return Ok(new { Message = "Card unsuspended." });
        }

        // POST: api/srs/bury/{cardId}
        [HttpPost("bury/{cardId}")]
        public async Task<IActionResult> BuryCard(int cardId)
        {
            var userId = GetUserId();
            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.SrsCardReviewId == cardId && scr.UserId == userId);
            if (card == null) return NotFound();
            card.BuriedUntil = DateTime.UtcNow.Date.AddDays(1);
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

        // GET: api/srs/heatmap?days=365
        [HttpGet("heatmap")]
        public async Task<ActionResult<List<SrsHeatmapDto>>> GetHeatmap([FromQuery] int days = 365)
        {
            var userId = GetUserId();
            var startDate = DateTime.UtcNow.Date.AddDays(-days);

            var logs = await _context.SrsReviewLogs
                .AsNoTracking()
                .Where(log => log.UserId == userId && log.ReviewedAt >= startDate)
                .Select(log => new { log.ReviewedAt })
                .ToListAsync();

            var grouped = logs
                .GroupBy(l => l.ReviewedAt.Date)
                .Select(g => new SrsHeatmapDto
                {
                    Date = g.Key.ToString("yyyy-MM-dd"),
                    ReviewCount = g.Count()
                })
                .OrderBy(h => h.Date)
                .ToList();

            return grouped;
        }

        // POST: api/srs/reading-credit/{wordId}
        [HttpPost("reading-credit/{wordId}")]
        public async Task<IActionResult> ApplyReadingCredit(int wordId)
        {
            var userId = GetUserId();
            var card = await _context.SrsCardReviews
                .FirstOrDefaultAsync(scr => scr.WordId == wordId && scr.UserId == userId);

            if (card == null) return NotFound(new { Message = "No SRS card found for this word." });

            // Only apply if card has graduated and has some history
            if (card.IsLearning || card.Repetitions <= 2)
                return Ok(new { Message = "Card too new for reading credit.", Applied = false });

            // Boost: multiply interval by 1.1, cap at current next review + 2 days
            var boostedInterval = (int)Math.Round(card.Interval * 1.1);
            var maxInterval = card.Interval + 2;
            card.Interval = Math.Min(boostedInterval, maxInterval);
            card.NextReviewAt = DateTime.UtcNow.AddDays(card.Interval);

            await _context.SaveChangesAsync();
            return Ok(new { Message = "Reading credit applied.", Applied = true, card.Interval, card.NextReviewAt });
        }

        // --- SM-2 Algorithm with Learning Steps ---
        private void ApplySm2(SrsCardReview card, int grade, List<int> learningSteps)
        {
            // grade: 0=Again, 1=Hard, 2=Good, 3=Easy

            if (card.IsLearning)
            {
                // Card is in learning phase
                if (grade < 2)
                {
                    // Again/Hard: reset to first learning step
                    card.CurrentLearningStepIndex = 0;
                    int stepMinutes = learningSteps.Count > 0 ? learningSteps[0] : 1;
                    card.Interval = 0;
                    card.NextReviewAt = DateTime.UtcNow.AddMinutes(stepMinutes);
                    card.LastReviewedAt = DateTime.UtcNow;
                    // Update ease factor for lapse
                    card.EaseFactor = Math.Max(1.3,
                        card.EaseFactor + 0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02));
                    return;
                }
                else
                {
                    // Good/Easy: advance to next step
                    card.CurrentLearningStepIndex++;
                    if (card.CurrentLearningStepIndex >= learningSteps.Count)
                    {
                        // Graduate: exit learning phase
                        card.IsLearning = false;
                        card.CurrentLearningStepIndex = 0;
                        card.Interval = 1;
                        if (card.Repetitions == 0 && card.LastReviewedAt == null) card.Repetitions = 1;
                        if (grade == 3) card.Interval = (int)Math.Round(card.Interval * 1.3);
                        card.NextReviewAt = DateTime.UtcNow.AddDays(card.Interval);
                    }
                    else
                    {
                        // Next learning step
                        int stepMinutes = learningSteps[card.CurrentLearningStepIndex];
                        card.Interval = 0;
                        card.NextReviewAt = DateTime.UtcNow.AddMinutes(stepMinutes);
                    }
                    card.LastReviewedAt = DateTime.UtcNow;
                    card.EaseFactor = Math.Max(1.3,
                        card.EaseFactor + 0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02));
                    return;
                }
            }

            // Card is NOT in learning phase
            if (grade < 2)
            {
                // Lapse: enter learning phase
                card.IsLearning = true;
                card.CurrentLearningStepIndex = 0;
                // Retain Repetitions for lapse differentiation
                int stepMinutes = learningSteps.Count > 0 ? learningSteps[0] : 1;
                card.Interval = 0;
                card.NextReviewAt = DateTime.UtcNow.AddMinutes(stepMinutes);
            }
            else
            {
                // Passed (normal SM-2 flow)
                if (card.Repetitions == 0 && card.LastReviewedAt == null)
                    card.Interval = 1;
                else if (card.Repetitions == 1 || (card.Repetitions == 0 && card.LastReviewedAt != null))
                    card.Interval = 6;
                else
                    card.Interval = (int)Math.Round(card.Interval * card.EaseFactor);

                card.Repetitions++;

                // Easy bonus
                if (grade == 3)
                    card.Interval = (int)Math.Round(card.Interval * 1.3);

                card.NextReviewAt = DateTime.UtcNow.AddDays(Math.Max(card.Interval, 0));
            }

            // Update ease factor
            card.EaseFactor = Math.Max(1.3,
                card.EaseFactor + 0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02));

            card.LastReviewedAt = DateTime.UtcNow;
        }

        // Parse learning step minutes from comma-separated string
        private List<int> ParseLearningSteps(string? stepsString)
        {
            if (string.IsNullOrWhiteSpace(stepsString))
                return new List<int> { 1, 10 }; // default

            var steps = stepsString.Split(',')
                .Select(s => s.Trim())
                .Where(s => int.TryParse(s, out _))
                .Select(int.Parse)
                .Where(s => s > 0)
                .ToList();

            return steps.Count > 0 ? steps : new List<int> { 1, 10 };
        }

        // --- Helper: Count unknown words in a sentence ---
        private async Task<int> CountUnknownWordsInSentence(string sentence, Guid userId, int languageId, int targetWordId)
        {
            if (string.IsNullOrWhiteSpace(sentence))
                return 0;

            // Tokenize sentence into words (simple split, lowercase)
            var sentenceWords = sentence
                .Split(new[] { ' ', ',', '.', '!', '?', ';', ':', '"', '\'', '(', ')', '[', ']', '{', '}', '—', '–', '-', '…' },
                    StringSplitOptions.RemoveEmptyEntries)
                .Select(w => w.Trim().ToLowerInvariant())
                .Where(w => w.Length > 0)
                .Distinct()
                .ToList();

            if (!sentenceWords.Any()) return 0;

            // Get known words (status 5) for this user & language
            var knownWords = await _context.Words
                .AsNoTracking()
                .Where(w => w.UserId == userId && w.LanguageId == languageId &&
                            sentenceWords.Contains(w.Term.ToLower()))
                .Select(w => new { w.Term, w.Status, w.WordId })
                .ToListAsync();

            var knownLookup = knownWords.ToDictionary(w => w.Term.ToLowerInvariant());

            int unknownCount = 0;
            foreach (var word in sentenceWords)
            {
                if (knownLookup.TryGetValue(word, out var known))
                {
                    // If it's the target word, always count it as unknown
                    if (known.WordId == targetWordId)
                    {
                        unknownCount++;
                    }
                    else if (known.Status < 5)
                    {
                        unknownCount++;
                    }
                    // Status 5 = known, don't count
                }
                else
                {
                    // Word not in database at all — treat as unknown only if it looks like a real word
                    if (word.Length > 1)
                    {
                        unknownCount++;
                    }
                }
            }

            return unknownCount;
        }

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim))
            {
                throw new UnauthorizedAccessException("User ID not found in token");
            }
            return Guid.Parse(userIdClaim);
        }

        /// <summary>Daily new-card cap: DB may store 0 from an old migration default; treat as app default.</summary>
        private static int EffectiveSrsMaxNew(int? stored) => stored is > 0 ? stored.Value : 20;

        /// <summary>Daily review cap: same as <see cref="EffectiveSrsMaxNew"/>.</summary>
        private static int EffectiveSrsMaxReviews(int? stored) => stored is > 0 ? stored.Value : 100;
    }

    // --- DTOs ---

    public class SrsDueCardDto
    {
        public int SrsCardReviewId { get; set; }
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public string Translation { get; set; } = string.Empty;
        public int WordStatus { get; set; }
        public double EaseFactor { get; set; }
        public int Interval { get; set; }
        public int Repetitions { get; set; }
        public bool IsLearning { get; set; }
        public int CurrentLearningStepIndex { get; set; }
        public bool IsSuspended { get; set; }
        public int Flag { get; set; }
        public string? Tags { get; set; }
        public List<SrsPhraseDto> Phrases { get; set; } = new();
        public int UnknownWordsInPhrase { get; set; }
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
        public int TotalCards { get; set; }
        public int NewCards { get; set; }
        public int LearningCards { get; set; }
        public int MatureCards { get; set; }
        public int TotalPhrases { get; set; }
        public int ReviewedToday { get; set; }
        
        public int MaxNewCards { get; set; }
        public int MaxReviews { get; set; }
        public int StudiedNewCardsToday { get; set; }
        public int StudiedReviewsToday { get; set; }

        public int CurrentStreak { get; set; }
        public int LongestStreak { get; set; }
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
}
