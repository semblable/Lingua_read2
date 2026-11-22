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
using LinguaReadApi.Services.Tokenization;
using LinguaReadApi.Utilities;
using Npgsql;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class SrsController : ControllerBase
    {
        // Controls whether cloze and mixed review modes populate ClozeSentence on due cards.
        private static readonly bool ClozeReviewEnabled = true;
        private const int ReviewSaveAttempts = 3;
        private readonly AppDbContext _context;
        private readonly IStoryGenerationServiceFactory _storyGenerationServiceFactory;
        private readonly TimeProvider _clock;

        public SrsController(AppDbContext context, IStoryGenerationServiceFactory storyGenerationServiceFactory,
            TimeProvider? clock = null)
        {
            _context = context;
            _storyGenerationServiceFactory = storyGenerationServiceFactory;
            _clock = clock ?? TimeProvider.System;
        }

        private DateTime UtcNow => _clock.GetUtcNow().UtcDateTime;

        [HttpGet("decks/{languageId}/settings")]
        public async Task<ActionResult<SrsDeckSettingsDto>> GetDeckSettings(int languageId,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            var userId = GetUserId();
            if (!await _context.Languages.AnyAsync(language => language.LanguageId == languageId)) return NotFound();

            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == userId);
            var deck = await _context.SrsDeckSettings.AsNoTracking()
                .FirstOrDefaultAsync(s => s.UserId == userId && s.LanguageId == languageId);
            var day = DayContext(settings, timezoneOffsetMinutes, UtcNow);
            return DeckSettingsDto(settings, deck, day);
        }

        [HttpPut("decks/{languageId}/settings")]
        public async Task<ActionResult<SrsDeckSettingsDto>> UpdateDeckSettings(int languageId,
            [FromBody] SrsDeckSettingsUpdateDto dto, [FromQuery] int timezoneOffsetMinutes = 0)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            var userId = GetUserId();
            if (!await _context.Languages.AnyAsync(language => language.LanguageId == languageId)) return NotFound();

            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, UtcNow);
            bool hasTodayLimit = dto.TodayMaxNewCards.HasValue || dto.TodayMaxReviews.HasValue;
            if (hasTodayLimit && dto.StudyDay != day.Today)
                return Conflict(new { message = "A new SRS day has started. Reopen deck limits to set today's limits." });

            var deck = await _context.SrsDeckSettings.FindAsync(userId, languageId);
            if (deck == null)
            {
                deck = new SrsDeckSettings { UserId = userId, LanguageId = languageId };
                _context.SrsDeckSettings.Add(deck);
            }
            else
            {
                _context.Entry(deck).State = EntityState.Modified;
            }

            deck.MaxNewCards = dto.MaxNewCards;
            deck.MaxReviews = dto.MaxReviews;
            deck.NewCardsIgnoreReviewLimit = dto.NewCardsIgnoreReviewLimit;
            deck.TodayStudyDay = hasTodayLimit ? day.Today : null;
            deck.TodayExpiresAt = hasTodayLimit ? day.TomorrowStartUtc : null;
            deck.TodayMaxNewCards = dto.TodayMaxNewCards;
            deck.TodayMaxReviews = dto.TodayMaxReviews;

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException
                { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                return Conflict(new { message = "Deck limits were saved in another session. Reopen them to make changes." });
            }

            return DeckSettingsDto(settings, deck, day);
        }

        private static SrsDeckSettingsDto DeckSettingsDto(UserSettings? settings, SrsDeckSettings? deck, SrsDayContext day)
        {
            var defaults = SrsDeckLimits.FromDefaults(settings);
            bool today = deck?.HasTodayLimits(day.Today, day.NowUtc) == true;
            return new SrsDeckSettingsDto
            {
                StudyDay = day.Today,
                DefaultMaxNewCards = defaults.MaxNewCards,
                DefaultMaxReviews = defaults.MaxReviews,
                DefaultNewCardsIgnoreReviewLimit = defaults.NewCardsIgnoreReviewLimit,
                MaxNewCards = deck?.MaxNewCards,
                MaxReviews = deck?.MaxReviews,
                NewCardsIgnoreReviewLimit = deck?.NewCardsIgnoreReviewLimit,
                TodayMaxNewCards = today ? deck?.TodayMaxNewCards : null,
                TodayMaxReviews = today ? deck?.TodayMaxReviews : null,
            };
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
            var now = UtcNow;
            limit = Math.Clamp(limit, 1, 200);

            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);
            string reviewOrder = string.IsNullOrWhiteSpace(settings?.SrsReviewOrder)
                ? "mix"
                : settings!.SrsReviewOrder;
            string newCardOrder = SrsQueuePolicy.NormalizeNewCardOrder(settings?.SrsNewCardOrder);

            // Card style: translation (default), cloze (mask term in mined sentence), or mixed.
            // Cloze/mixed populate ClozeSentence; translation leaves it null.
            string cardType = NormalizeCardType(settings?.SrsCardType);
            bool emitClozeSentence = ClozeReviewEnabled && (cardType is "cloze" or "mixed");

            // Reserve review slots in each deck before applying session filters.
            var query = AvailableCards(userId, now, languageId).Where(IsDue(now, day.TomorrowStartUtc));
            var budgets = await LoadDeckBudgetsAsync(userId, languageId, settings, day, query);
            var newLimits = budgets.Where(b => b.Value.ReviewableNew > 0)
                .ToDictionary(b => b.Key, b => b.Value.RemainingNew);
            var reviewLimits = budgets.Where(b => b.Value.ReviewableReviews > 0)
                .ToDictionary(b => b.Key, b => b.Value.RemainingReviews);

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

            // 1T requires a saved sentence containing the card's word; pre-filter phraseless cards in SQL
            // so high-frequency words without examples don't exhaust the over-fetch window.
            if (onlyOneTarget)
                query = query.Where(scr => _context.SrsPhrases.Any(sp => sp.UserId == userId && sp.WordId == scr.WordId));

            // The 1T filter drops multi-unknown sentences after fetching, so over-fetch when it's on.
            int overFetch = onlyOneTarget ? 4 : 1;
            int PoolSize(int remaining) => onlyOneTarget
                ? Math.Max(Math.Min(remaining, limit) * overFetch, Math.Min(limit * overFetch, 200))
                : Math.Min(remaining, limit);

            var learningCardsPool = await SelectLearningCardsAsync(query, limit * overFetch);
            var newPoolLimits = newLimits.ToDictionary(entry => entry.Key, entry => PoolSize(entry.Value));
            var newCardsPool = await SelectNewCardsAsync(query, userId, newCardOrder, now, limit * overFetch, newPoolLimits);
            var reviewCardsPool = new List<SrsCardReview>();
            foreach (var (deckId, remaining) in reviewLimits)
                reviewCardsPool.AddRange(await SelectReviewCardsAsync(
                    query.Where(card => card.Word.LanguageId == deckId), PoolSize(remaining)));

            var allFetchedCards = learningCardsPool.Concat(newCardsPool).Concat(reviewCardsPool).ToList();
            if (!allFetchedCards.Any()) return new List<SrsDueCardDto>();

            // Select each card's displayed example before counting its unknown words (1T).
            var cardWordIds = allFetchedCards.Select(c => c.WordId).Distinct().ToList();
            var phrases = await _context.SrsPhrases
                .AsNoTracking()
                .Where(sp => sp.UserId == userId && cardWordIds.Contains(sp.WordId))
                .ToListAsync();
            var phrasesByWordId = phrases
                .GroupBy(p => p.WordId)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(p => p.CreatedAt).ToList());

            // Read the source profile without loading the lesson body. Manual phrases and
            // examples without their original source can still use the card's language.
            var cardLanguageIds = allFetchedCards.Select(c => c.Word.LanguageId).Distinct().ToList();
            var cardLanguages = await _context.Languages.AsNoTracking()
                .Where(l => cardLanguageIds.Contains(l.LanguageId))
                .ToDictionaryAsync(l => l.LanguageId);
            var sourceIds = phrases.Where(p => p.TextId.HasValue).Select(p => p.TextId.GetValueOrDefault()).Distinct().ToList();
            var sources = await _context.Texts.AsNoTracking()
                .Where(t => t.UserId == userId && sourceIds.Contains(t.TextId))
                .Select(t => new { t.TextId, t.LanguageId, t.SegmentationProfile })
                .ToDictionaryAsync(t => t.TextId);

            Language? MinedSourceLanguage(SrsPhrase phrase, int languageId)
            {
                if (phrase.TextId is not int id || !sources.TryGetValue(id, out var source) || source.LanguageId != languageId)
                    return null;
                return Tokenizer.ForTextProfile(cardLanguages.GetValueOrDefault(languageId), source.SegmentationProfile);
            }

            var examples = new List<SrsUnknownWordCounter.Sentence>();
            var clozes = new Dictionary<int, string>();
            foreach (var card in allFetchedCards)
            {
                if (!phrasesByWordId.TryGetValue(card.WordId, out var cardPhrases)) continue;
                var languageIdForCard = card.Word.LanguageId;
                var cardLanguage = cardLanguages.GetValueOrDefault(languageIdForCard);
                var primaryIndex = -1;
                for (var i = 0; i < cardPhrases.Count; i++)
                {
                    var phrase = cardPhrases[i];
                    var source = MinedSourceLanguage(phrase, languageIdForCard);
                    if (emitClozeSentence && BuildClozeSentence(phrase.Sentence, card.Word.Term, source ?? cardLanguage,
                        useReaderSpans: source != null) is { } cloze)
                    {
                        clozes[card.SrsCardReviewId] = cloze;
                        primaryIndex = i;
                        break;
                    }
                    if (primaryIndex < 0 && SrsMinedSentences.ContainsTerm(phrase.Sentence, card.Word.Term, source ?? cardLanguage))
                    {
                        primaryIndex = i;
                        if (!emitClozeSentence) break;
                    }
                }
                if (primaryIndex < 0) continue;
                var primary = cardPhrases[primaryIndex];
                if (primaryIndex > 0)
                {
                    cardPhrases.RemoveAt(primaryIndex);
                    cardPhrases.Insert(0, primary);
                }
                examples.Add(new SrsUnknownWordCounter.Sentence(card.SrsCardReviewId, card.WordId, languageIdForCard,
                    primary.Sentence, MinedSourceLanguage(primary, languageIdForCard)));
            }
            var unknownCounts = await SrsUnknownWordCounter.CountAsync(_context, userId, examples, cardLanguages);

            var scheduler = new SrsScheduler(day.Options);
            bool IsEligible(SrsCardReview card) => !onlyOneTarget || unknownCounts.GetValueOrDefault(card.SrsCardReviewId) == 1;
            SrsDueCardDto MapCard(SrsCardReview card)
            {
                var cardPhrases = phrasesByWordId.GetValueOrDefault(card.WordId) ?? new List<SrsPhrase>();
                int unknownWordsInBestPhrase = unknownCounts.GetValueOrDefault(card.SrsCardReviewId);
                return ToDueCardDto(card, cardPhrases, unknownWordsInBestPhrase,
                    clozes.GetValueOrDefault(card.SrsCardReviewId), scheduler, now);
            }

            var validLearningCards = learningCardsPool.Where(IsEligible).ToList();
            var validNewCards = TakeWithinDeckLimits(newCardsPool.Where(IsEligible), card => card.Word.LanguageId, newLimits)
                .Take(limit).ToList();
            var reviewCandidates = reviewCardsPool.Where(IsEligible).OrderBy(card => card.NextReviewAt)
                .ThenBy(card => card.SrsCardReviewId);
            var validReviewCards = TakeWithinDeckLimits(reviewCandidates, card => card.Word.LanguageId, reviewLimits)
                .Take(limit).ToList();

            // Learning cards ignore daily limits and sort first.
            return MergeByReviewOrder(reviewOrder, validLearningCards, validNewCards, validReviewCards)
                .Take(limit)
                .Select(MapCard)
                .ToList();
        }

        // POST: api/srs/review?timezoneOffsetMinutes=120
        [HttpPost("review")]
        public async Task<ActionResult<SrsReviewResultDto>> SubmitReview(
            [FromBody] SrsReviewSubmitDto dto,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            return await SubmitReviewAsync(dto, timezoneOffsetMinutes, UtcNow, attempt: 1);
        }

        private async Task<ActionResult<SrsReviewResultDto>> SubmitReviewAsync(
            SrsReviewSubmitDto dto, int timezoneOffsetMinutes, DateTime now, int attempt)
        {
            var userId = GetUserId();

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

            var reviewCard = await _context.SrsCardReviews
                .Where(scr => scr.SrsCardReviewId == dto.SrsCardReviewId && scr.UserId == userId)
                .Select(scr => new { Card = scr, scr.Word.LanguageId })
                .FirstOrDefaultAsync();

            if (reviewCard == null)
                return NotFound("Card not found.");

            var card = reviewCard.Card;
            if (card.IsSuspended)
                return BadRequest(new { Message = "Card is suspended." });

            if (card.BuriedUntil.HasValue && card.BuriedUntil.Value > now)
                return BadRequest(new { Message = "Card is buried." });

            // The input time orders the review against explicit word edits. FSRS
            // also needs to keep the card's existing review history in order.
            var requestedReviewAt = dto.ReviewedAt is { } at ? SrsDay.AsUtc(at) : now;
            if (requestedReviewAt > now) requestedReviewAt = now;
            var reviewedAt = requestedReviewAt;
            if (card.LastReviewedAt is { } lastReviewed && reviewedAt < lastReviewed) reviewedAt = lastReviewed;

            // SM-2-era cards the backfill hasn't reached yet get their FSRS state from history first.
            await SrsMemoryStateInitializer.EnsureAsync(_context, card, scheduler.Algorithm);
            var before = card.ToSnapshot();
            var outcome = scheduler.Review(before, dto.Grade, reviewedAt);

            var studyDay = SrsDay.UserDay(reviewedAt, day.Options.TimezoneOffsetMinutes, day.Options.DayStartHour);
            if (settings != null)
                AdvanceStreak(settings, studyDay);

            var reviewLog = NewReviewLog(userId, card, dto.Grade, reviewedAt, outcome);
            reviewLog.ClientEventId = string.IsNullOrEmpty(dto.ClientEventId) ? null : dto.ClientEventId;
            reviewLog.StudyDay = studyDay;
            if (before.State is SrsCardState.New or SrsCardState.Review &&
                !await ReviewedOnStudyDayAsync(card, studyDay, day.Options))
            {
                reviewLog.DeckStudyEntry = new SrsDeckStudyEntry
                {
                    UserId = userId,
                    LanguageId = reviewCard.LanguageId,
                    StudyDay = studyDay,
                    IsNewCard = before.State == SrsCardState.New
                };
            }
            _context.SrsReviewLogs.Add(reviewLog);

            card.Apply(outcome.Card);
            bool becameLeech = outcome.IsLapse && SrsLeeches.OnLapse(card, settings);

            // The word's reader status follows the card (word-status sync settings).
            var statusChange = await SyncWordStatusAsync(userId, card, outcome, settings, reviewLog, requestedReviewAt);

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                // The whole SaveChanges rolled back. Recompute the grade from
                // committed state, including its log and daily limits.
                _context.ChangeTracker.Clear();
                if (attempt < ReviewSaveAttempts)
                    return await SubmitReviewAsync(dto, timezoneOffsetMinutes, now, attempt + 1);
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    new { Message = "Vocabulary changed while saving this review. Try again." });
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
            var language = await _context.Languages.AsNoTracking()
                .FirstOrDefaultAsync(l => l.LanguageId == word.LanguageId);
            if (await SrsMinedSentences.ExistsAsync(_context, dto.WordId, userId, dto.Sentence, language))
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
                CreatedAt = UtcNow
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
            var cutoffTime = UtcNow.AddMinutes(-15);
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
            return await UndoLastReviewAsync(dto, timezoneOffsetMinutes, UtcNow, attempt: 1);
        }

        private async Task<IActionResult> UndoLastReviewAsync(SrsUndoDto? dto, int timezoneOffsetMinutes, DateTime now, int attempt)
        {
            var userId = GetUserId();
            var cutoffTime = now.AddMinutes(-15);

            var clientEventId = dto?.ClientEventId;
            var logs = _context.SrsReviewLogs.Include(log => log.DeckStudyEntry).Where(log => log.UserId == userId);
            var lastLog = dto?.SrsReviewLogId is { } logId
                ? await logs.FirstOrDefaultAsync(log => log.SrsReviewLogId == logId)
                : !string.IsNullOrEmpty(clientEventId)
                ? await logs.FirstOrDefaultAsync(log => log.ClientEventId == clientEventId)
                : await logs
                    .Where(log => log.ReviewedAt >= cutoffTime && log.Kind != (int)SrsReviewKind.Reading)
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

            // A manual save can choose the same status a review assigned. Preserve that
            // decision while still allowing successive undos of review-driven changes.
            int? restoredWordStatus = null;
            if (lastLog.WordStatusBefore is { } statusBefore)
            {
                var word = await _context.Words.FirstOrDefaultAsync(w => w.WordId == card.WordId && w.UserId == userId);
                var statusIntentAt = lastLog.WordStatusIntentAt ?? lastLog.ReviewedAt;
                if (word != null && !((word.LastStatusEditedAt ?? word.LastEditedAt) > now) && !(word.LastManualStatusAt >= statusIntentAt)
                    && (lastLog.WordStatusAfter is not { } statusAfter || word.Status == statusAfter))
                {
                    word.Status = statusBefore;
                    RecordSrsStatusTime(word, now);
                    restoredWordStatus = statusBefore;
                    if (statusBefore != SrsCardLifecycle.StatusKnown) SrsCardLifecycle.LiftStatusSuspension(card);
                }
            }

            // Reading credit never counted toward the streak.
            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            SrsLeeches.OnUndo(card, lapsesAfterReview, settings);
            if (settings != null && lastLog.Kind != (int)SrsReviewKind.Reading)
            {
                var day = DayContext(settings, timezoneOffsetMinutes, now);
                await RevertStreakAsync(settings, lastLog, day.Options);
            }

            if (lastLog.DeckStudyEntry is { } entry)
                _context.SrsDeckStudyEntries.Remove(entry);
            _context.SrsReviewLogs.Remove(lastLog);

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                _context.ChangeTracker.Clear();
                if (attempt < ReviewSaveAttempts)
                {
                    // A bodyless request may have selected the latest log. A
                    // retry must keep that identity even if a new review exists.
                    return await UndoLastReviewAsync(
                        new SrsUndoDto { SrsReviewLogId = lastLog.SrsReviewLogId }, timezoneOffsetMinutes, now, attempt + 1);
                }
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    new { Message = "Vocabulary changed while undoing this review. Try again." });
            }
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
            var now = UtcNow;
            days = Math.Clamp(days, 1, 366);

            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);
            var end = SrsDay.DayStartUtc(day.Today.AddDays(days), day.Options.TimezoneOffsetMinutes, day.Options.DayStartHour);

            // Future Due projects scheduled reviews and (re)learning cards only — untouched new cards
            // are not scheduled yet and would flatten the 14-day chart onto Today.
            var query = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId
                           && !scr.IsSuspended
                           && (scr.IsLearning || scr.LastReviewedAt != null)
                           && scr.NextReviewAt < end);

            if (languageId.HasValue)
            {
                query = query.Where(scr => scr.Word.LanguageId == languageId.Value);
            }

            var scheduledCards = await query
                .Select(scr => new { scr.NextReviewAt, scr.BuriedUntil })
                .ToListAsync();

            // Group by user day in memory; past-due cards land on today, and buried cards
            // shift onto the day they unbury (dropped if unburied past the forecast horizon).
            var countsByDay = scheduledCards
                .Select(c => c.BuriedUntil is { } buried && buried > now && buried > c.NextReviewAt ? buried : c.NextReviewAt)
                .Where(t => t < end)
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
            var now = UtcNow;

            // Fetch settings for limit info, streak and the user's day boundary
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);

            var cardQuery = AvailableCards(userId, now, languageId);
            var cardCounts = await cardQuery
                .GroupBy(card => card.Word.LanguageId)
                .Select(g => new
                {
                    LanguageId = g.Key,
                    Total = g.Count(),
                    Learning = g.Count(card => card.IsLearning),
                    New = g.Count(card => !card.IsLearning && card.LastReviewedAt == null),
                    Young = g.Count(card => !card.IsLearning && card.LastReviewedAt != null &&
                        card.Interval < SrsSchedulerSettings.MatureIntervalDays),
                    Mature = g.Count(card => !card.IsLearning && card.LastReviewedAt != null &&
                        card.Interval >= SrsSchedulerSettings.MatureIntervalDays),
                    ReviewedToday = g.Count(card => card.LastReviewedAt >= day.TodayStartUtc)
                })
                .ToListAsync();

            var budgetsByDeck = await LoadDeckBudgetsAsync(userId, languageId, settings, day,
                cardQuery.Where(IsDue(now, day.TomorrowStartUtc)), cardCounts.Select(c => c.LanguageId));
            var budgets = budgetsByDeck.Values;
            int dueLearnCount = budgets.Sum(budget => budget.Due.Learning);
            int dueNewCount = budgets.Sum(budget => budget.Due.NewCards);
            int dueReviewCount = budgets.Sum(budget => budget.Due.Reviews);
            int reviewableNewCount = budgets.Sum(budget => budget.ReviewableNew);
            int reviewableReviewCount = budgets.Sum(budget => budget.ReviewableReviews);

            var totalPhrases = await _context.SrsPhrases
                .AsNoTracking()
                .CountAsync(sp => sp.UserId == userId);

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
                ReviewableCount = dueLearnCount + reviewableReviewCount + reviewableNewCount,
                DueLearningCount = dueLearnCount,
                DueReviewCount = dueReviewCount,
                DueNewCount = dueNewCount,
                ReviewableReviewCount = reviewableReviewCount,
                ReviewableNewCount = reviewableNewCount,
                NewCardsPausedByReviewLimit = budgets.Any(budget => budget.NewCardsPausedByReviewLimit),
                TotalCards = cardCounts.Sum(c => c.Total),
                NewCards = cardCounts.Sum(c => c.New),
                LearningCards = cardCounts.Sum(c => c.Learning),
                YoungCards = cardCounts.Sum(c => c.Young),
                MatureCards = cardCounts.Sum(c => c.Mature),
                TotalPhrases = totalPhrases,
                ReviewedToday = cardCounts.Sum(c => c.ReviewedToday),
                MaxNewCards = budgets.Sum(budget => budget.Limits.MaxNewCards),
                MaxReviews = budgets.Sum(budget => budget.Limits.MaxReviews),
                StudiedNewCardsToday = budgets.Sum(budget => budget.Studied.NewCards),
                StudiedReviewsToday = budgets.Sum(budget => budget.Studied.Reviews),
                CurrentStreak = StudyDay(settings) is { } lastStudyDay &&
                    lastStudyDay >= day.Today.AddDays(-1)
                    ? settings?.SrsCurrentStreak ?? 0 : 0,
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
            card.BuriedUntil = DayContext(settings, timezoneOffsetMinutes, UtcNow).TomorrowStartUtc;
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
            var day = DayContext(settings, timezoneOffsetMinutes, UtcNow);
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
            var now = UtcNow;
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

        private sealed record SrsDayContext(SrsSchedulerOptions Options, DateOnly Today, DateTime NowUtc,
            DateTime TodayStartUtc, DateTime TomorrowStartUtc);

        private static SrsDayContext DayContext(UserSettings? settings, int timezoneOffsetMinutes, DateTime now)
        {
            var options = SrsSchedulerSettings.FromUserSettings(settings, timezoneOffsetMinutes);
            var tz = options.TimezoneOffsetMinutes;
            var today = SrsDay.UserDay(now, tz, options.DayStartHour);
            return new SrsDayContext(
                options,
                today,
                now,
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

        private IQueryable<SrsCardReview> AvailableCards(Guid userId, DateTime now, int? languageId)
        {
            var cards = _context.SrsCardReviews.AsNoTracking()
                .Where(card => card.UserId == userId && !card.IsSuspended)
                .Where(card => card.BuriedUntil == null || card.BuriedUntil <= now);
            return languageId is int id ? cards.Where(card => card.Word.LanguageId == id) : cards;
        }

        private async Task<Dictionary<int, SrsDeckBudget>> LoadDeckBudgetsAsync(Guid userId, int? languageId,
            UserSettings? settings, SrsDayContext day, IQueryable<SrsCardReview> dueCards,
            IEnumerable<int>? otherDeckIds = null)
        {
            var due = await dueCards.GroupBy(card => card.Word.LanguageId)
                .Select(g => new
                {
                    LanguageId = g.Key,
                    Learning = g.Count(card => card.IsLearning),
                    NewCards = g.Count(card => !card.IsLearning && card.LastReviewedAt == null),
                    Reviews = g.Count(card => !card.IsLearning && card.LastReviewedAt != null)
                })
                .ToDictionaryAsync(g => g.LanguageId, g => new SrsDueCounts(g.Learning, g.NewCards, g.Reviews));

            // Older reviews predate recorded study days. Use their timestamps and
            // pre-review states to carry existing usage into the deck budgets.
            var legacyUsage = _context.SrsReviewLogs.AsNoTracking()
                .Where(log => log.UserId == userId && log.StudyDay == null
                    && log.ReviewedAt >= day.TodayStartUtc && log.ReviewedAt < day.TomorrowStartUtc
                    && log.Kind != (int)SrsReviewKind.Reading && !log.OldIsLearning
                    && (log.OldLastReviewedAt == null || log.OldLastReviewedAt < day.TodayStartUtc))
                .Select(log => new { log.SrsCardReview.Word.LanguageId, IsNewCard = log.OldLastReviewedAt == null });
            var currentUsage = _context.SrsDeckStudyEntries.AsNoTracking()
                .Where(entry => entry.UserId == userId && entry.StudyDay == day.Today)
                .Select(entry => new { entry.LanguageId, entry.IsNewCard });
            var usage = legacyUsage.Concat(currentUsage);
            if (languageId is int requestedDeck)
                usage = usage.Where(entry => entry.LanguageId == requestedDeck);
            var studied = await usage.GroupBy(entry => entry.LanguageId)
                .Select(g => new
                {
                    LanguageId = g.Key,
                    NewCards = g.Count(entry => entry.IsNewCard),
                    Reviews = g.Count(entry => !entry.IsNewCard)
                })
                .ToDictionaryAsync(g => g.LanguageId, g => new SrsStudyCounts(g.NewCards, g.Reviews));

            var deckIds = languageId is int deckId ? new[] { deckId }
                : due.Keys.Concat(studied.Keys).Concat(otherDeckIds ?? []).Distinct().ToArray();
            if (deckIds.Length == 0) return new();

            var decks = await _context.SrsDeckSettings.AsNoTracking()
                .Where(deck => deck.UserId == userId && deckIds.Contains(deck.LanguageId))
                .ToDictionaryAsync(deck => deck.LanguageId);
            var defaults = SrsDeckLimits.FromDefaults(settings);
            return deckIds.ToDictionary(id => id, id => new SrsDeckBudget(
                defaults.WithOverrides(decks.GetValueOrDefault(id), day.Today, day.NowUtc),
                studied.GetValueOrDefault(id), due.GetValueOrDefault(id)));
        }

        private static DateOnly? StudyDay(UserSettings? settings) =>
            settings?.SrsDailyStudyDate is { } date ? DateOnly.FromDateTime(date) : null;

        private static DateTime AsStudyDate(DateOnly day) =>
            DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);

        private async Task<bool> ReviewedOnStudyDayAsync(SrsCardReview card, DateOnly studyDay, SrsSchedulerOptions options)
        {
            if (card.LastReviewedAt is not { } lastReviewedAt) return false;

            var start = SrsDay.DayStartUtc(studyDay, options.TimezoneOffsetMinutes, options.DayStartHour);
            var end = SrsDay.DayStartUtc(studyDay.AddDays(1), options.TimezoneOffsetMinutes, options.DayStartHour);
            var recordedDays = await _context.SrsReviewLogs.AsNoTracking()
                .Where(log => log.SrsCardReviewId == card.SrsCardReviewId &&
                    (log.StudyDay == studyDay || (log.ReviewedAt >= start && log.ReviewedAt < end
                        && (log.StudyDay == null || log.ReviewedAt == lastReviewedAt))))
                .Select(log => log.StudyDay)
                .ToListAsync();

            // A legacy/imported card can have a last review timestamp without a log.
            // A stamped log wins over the timestamp when the reviewing device changes zones.
            return recordedDays.Any(day => day == studyDay || day == null)
                || (recordedDays.Count == 0 && lastReviewedAt >= start && lastReviewedAt < end);
        }

        private static void AdvanceStreak(UserSettings settings, DateOnly reviewDay)
        {
            var studyDay = StudyDay(settings);

            // A late offline replay can fill older history without moving today's streak backwards.
            if (studyDay is { } current && reviewDay < current) return;

            if (studyDay != reviewDay)
            {
                settings.SrsCurrentStreak = studyDay == reviewDay.AddDays(-1) ? settings.SrsCurrentStreak + 1 : 1;
                settings.SrsLongestStreak = Math.Max(settings.SrsLongestStreak, settings.SrsCurrentStreak);
                settings.SrsDailyStudyDate = AsStudyDate(reviewDay);
            }
            else if (settings.SrsCurrentStreak == 0)
            {
                // Edge case: manual reset or starting today
                settings.SrsCurrentStreak = 1;
                settings.SrsLongestStreak = Math.Max(settings.SrsLongestStreak, 1);
            }
        }

        private async Task RevertStreakAsync(UserSettings settings, SrsReviewLog log, SrsSchedulerOptions options)
        {
            var tz = options.TimezoneOffsetMinutes;
            var reviewDay = log.StudyDay ?? SrsDay.UserDay(log.ReviewedAt, tz, options.DayStartHour);
            if (StudyDay(settings) != reviewDay) return;

            // Revert the streak if this undo leaves no other reviews that day
            var dayStartUtc = SrsDay.DayStartUtc(reviewDay, tz, options.DayStartHour);
            var nextDayStartUtc = SrsDay.DayStartUtc(reviewDay.AddDays(1), tz, options.DayStartHour);
            bool hasOtherReviewsThatDay = await _context.SrsReviewLogs.AnyAsync(l =>
                l.UserId == log.UserId
                && l.SrsReviewLogId != log.SrsReviewLogId
                && l.Kind != (int)SrsReviewKind.Reading
                && (l.StudyDay == reviewDay ||
                    (l.StudyDay == null && l.ReviewedAt >= dayStartUtc && l.ReviewedAt < nextDayStartUtc)));
            if (hasOtherReviewsThatDay) return;

            var previous = await _context.SrsReviewLogs
                .AsNoTracking()
                .Where(l => l.UserId == log.UserId && l.Kind != (int)SrsReviewKind.Reading
                    && (l.StudyDay < reviewDay || (l.StudyDay == null && l.ReviewedAt < dayStartUtc)))
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    RecordedDay = g.Max(l => l.StudyDay),
                    LegacyReviewedAt = g.Max(l => l.StudyDay == null ? l.ReviewedAt : (DateTime?)null)
                })
                .FirstOrDefaultAsync();
            var previousDay = previous?.RecordedDay;
            if (previous?.LegacyReviewedAt is { } legacyReviewedAt)
            {
                var legacyDay = SrsDay.UserDay(legacyReviewedAt, tz, options.DayStartHour);
                if (previousDay == null || legacyDay > previousDay) previousDay = legacyDay;
            }

            // Had a streak going before that day: just decrement. Otherwise it started that day.
            settings.SrsCurrentStreak = previousDay == reviewDay.AddDays(-1)
                ? Math.Max(0, settings.SrsCurrentStreak - 1)
                : 0;
            settings.SrsDailyStudyDate = previousDay is { } p ? AsStudyDate(p) : null;
        }

        /// <summary>
        /// Moves the reviewed word's status per the word-status sync settings (records the old
        /// one on <paramref name="log"/> for undo) and applies the Known card rule. Returns the
        /// change, or null if the status stays.
        /// </summary>
        private async Task<SrsWordStatusChangeDto?> SyncWordStatusAsync(
            Guid userId, SrsCardReview card, SrsReviewOutcome outcome, UserSettings? settings, SrsReviewLog log,
            DateTime requestedReviewAt)
        {
            var word = await _context.Words.FirstOrDefaultAsync(w => w.WordId == card.WordId && w.UserId == userId);
            if (word == null || (word.LastStatusEditedAt ?? word.LastEditedAt) >= requestedReviewAt) return null;

            if (SrsCardLifecycle.StatusAfterReview(word.Status, outcome, settings) is not { } newStatus)
                return null;

            var change = new SrsWordStatusChangeDto { From = word.Status, To = newStatus };
            log.WordStatusBefore = word.Status;
            log.WordStatusAfter = newStatus;
            log.WordStatusIntentAt = requestedReviewAt;
            word.Status = newStatus;
            RecordSrsStatusTime(word, requestedReviewAt);
            SrsCardLifecycle.ApplyStatusRules(word, card, hasSentence: true, settings);
            return change;
        }

        private static void RecordSrsStatusTime(Word word, DateTime intentAt)
        {
            word.LastStatusEditedAt = intentAt;
            // An offline grade can update the status after a newer gloss was saved.
            // Advancing the row revision invalidates that previous conflict snapshot.
            word.LastEditedAt = word.LastEditedAt is { } previous && previous >= intentAt
                ? previous.AddMicroseconds(1) : intentAt;
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
            var now = UtcNow;
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
            var now = UtcNow;

            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            var day = DayContext(settings, timezoneOffsetMinutes, now);
            string reviewOrder = string.IsNullOrWhiteSpace(settings?.SrsReviewOrder)
                ? "mix"
                : settings!.SrsReviewOrder;
            string newCardOrder = SrsQueuePolicy.NormalizeNewCardOrder(settings?.SrsNewCardOrder);

            var baseQuery = AvailableCards(userId, now, request.LanguageId).Where(IsDue(now, day.TomorrowStartUtc));
            var budgets = await LoadDeckBudgetsAsync(userId, request.LanguageId, settings, day, baseQuery);
            var budget = budgets[request.LanguageId];
            int remainingNew = budget.RemainingNew;
            int remainingReviews = budget.RemainingReviews;

            if (!string.IsNullOrEmpty(request.Status))
            {
                var statusList = request.Status.Split(',').Select(s => s.Trim()).Where(s => int.TryParse(s, out _)).Select(int.Parse).ToList();
                if (statusList.Any()) baseQuery = baseQuery.Where(scr => statusList.Contains(scr.Word.Status));
            }

            var cardType = (request.CardType ?? "all").Trim().ToLowerInvariant();

            // One micro-context per due card; cap directly at MaxWords (no pool/AI selection step).
            int poolSize = request.MaxWords;

            List<SrsCardReview> newCards = cardType == "review" || budget.ReviewableNew == 0 ? []
                : await SelectNewCardsAsync(baseQuery, userId, newCardOrder, now, Math.Min(poolSize, remainingNew));
            List<SrsCardReview> learningCards = cardType == "new" || budget.Due.Learning == 0 ? []
                : await SelectLearningCardsAsync(baseQuery, poolSize);
            List<SrsCardReview> reviewCards = cardType == "new" || budget.ReviewableReviews == 0 ? []
                : await SelectReviewCardsAsync(baseQuery, Math.Min(poolSize, remainingReviews));
            var allDueCards = MergeByReviewOrder(reviewOrder, learningCards, newCards, reviewCards)
                .Take(poolSize).ToList();

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

            // Existing vocabulary prompts use {wordList} to receive the due words.
            var customPrompt = settings?.CustomStoryPrompt;
            var vocabularyPrompt = customPrompt?.Contains("{wordList}", StringComparison.Ordinal) == true
                ? customPrompt
                : null;
            var promptVars = new Dictionary<string, string?>
            {
                ["language"] = languageName,
                ["level"] = level,
                ["wordList"] = wordList
            };
            var prompt = AiTaskConfig.ResolvePromptOrDefault(
                vocabularyPrompt, AiPromptTemplates.VocabularyPractice, promptVars);

            // 5. Generate using user's configured AI provider
            string rawResponse;
            try
            {
                var storyService = await _storyGenerationServiceFactory.GetServiceForUserAsync(userId);
                rawResponse = await storyService.GenerateStoryAsync(prompt, maxOutputTokens: 20000);
            }
            catch (TranslationProviderNotConfiguredException ex)
            {
                return BadRequest(new { message = ex.Message });
            }

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

            // Nothing usable: the reply wasn't a JSON array of contexts (a provider error, a custom
            // prompt asking for prose), or none of its terms is a due word. Saving it anyway left an
            // empty srs-story text behind, and the empty list didn't tell the user what went wrong.
            if (microContexts.Count == 0)
                return MicroContextFailure(rawResponse);

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

        /// <summary>
        /// The error for a micro-context reply with nothing usable in it. Story services return
        /// provider failures as text ("Story generation error: ...") instead of throwing; those
        /// map to 429/502 as in SummarizationController. Anything else is a reply we couldn't read.
        /// </summary>
        private ObjectResult MicroContextFailure(string? rawResponse)
        {
            var reply = rawResponse?.Trim() ?? "";
            if (reply.StartsWith("Story generation error:", StringComparison.Ordinal)
                || reply.StartsWith("Story generation failed:", StringComparison.Ordinal))
            {
                if (reply.Contains("TooManyRequests", StringComparison.Ordinal))
                    return StatusCode(StatusCodes.Status429TooManyRequests, new { Message = "Provider rate limit reached. Try again in a few seconds." });
                return StatusCode(StatusCodes.Status502BadGateway, new { Message = reply });
            }

            return StatusCode(StatusCodes.Status502BadGateway, new
            {
                Message = "The AI reply couldn't be read as micro-contexts for your due words. " +
                          "Try again, or check your AI provider and its story generation prompt in Settings."
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

        private const int TextWordStatsChunkSizeDefault = 500;
        private const int TextWordStatsChunkSizePostgres = 5000;

        private static Task<List<SrsCardReview>> SelectLearningCardsAsync(IQueryable<SrsCardReview> query, int take) =>
            SelectCardsByDueDateAsync(query.Where(card => card.IsLearning), take);

        private static Task<List<SrsCardReview>> SelectReviewCardsAsync(IQueryable<SrsCardReview> query, int take) =>
            SelectCardsByDueDateAsync(query.Where(card => !card.IsLearning && card.LastReviewedAt != null), take);

        private static Task<List<SrsCardReview>> SelectCardsByDueDateAsync(IQueryable<SrsCardReview> query, int take) =>
            query.OrderBy(card => card.NextReviewAt)
                .ThenBy(card => card.SrsCardReviewId)
                .Take(take)
                .Include(card => card.Word)
                    .ThenInclude(word => word.Translation)
                .ToListAsync();

        private static IEnumerable<T> TakeWithinDeckLimits<T>(IEnumerable<T> candidates,
            Func<T, int> languageId, IReadOnlyDictionary<int, int> limits)
        {
            var taken = new Dictionary<int, int>();
            foreach (var card in candidates)
            {
                int deck = languageId(card);
                int count = taken.GetValueOrDefault(deck);
                if (count >= limits.GetValueOrDefault(deck)) continue;
                taken[deck] = count + 1;
                yield return card;
            }
        }

        /// <summary>
        /// Selects up to <paramref name="take"/> untouched new cards from <paramref name="filteredQuery"/>
        /// ordered by <paramref name="newCardOrder"/> (defaulting to frequent words from recent reading).
        /// </summary>
        private async Task<List<SrsCardReview>> SelectNewCardsAsync(
            IQueryable<SrsCardReview> filteredQuery,
            Guid userId,
            string newCardOrder,
            DateTime now,
            int take,
            IReadOnlyDictionary<int, int>? deckLimits = null)
        {
            if (take <= 0 || deckLimits is { Count: 0 }) return [];

            var newOnly = filteredQuery
                .Where(scr => !scr.IsLearning && scr.LastReviewedAt == null);
            if (deckLimits != null)
            {
                var allowedDecks = deckLimits.Keys.ToArray();
                newOnly = newOnly.Where(card => allowedDecks.Contains(card.Word.LanguageId));
                if (allowedDecks.Length == 1)
                {
                    take = Math.Min(take, deckLimits[allowedDecks[0]]);
                    deckLimits = null;
                }
            }

            var normalizedOrder = SrsQueuePolicy.NormalizeNewCardOrder(newCardOrder);
            if (normalizedOrder == SrsQueuePolicy.NewCardOrder.Oldest && deckLimits == null)
            {
                return await newOnly
                    .OrderBy(scr => scr.CreatedAt)
                    .ThenBy(scr => scr.SrsCardReviewId)
                    .Take(take)
                    .Include(scr => scr.Word)
                        .ThenInclude(w => w.Translation)
                    .ToListAsync();
            }

            var rawCandidates = await newOnly
                .Select(scr => new
                {
                    scr.SrsCardReviewId,
                    scr.WordId,
                    scr.CreatedAt,
                    scr.Word.LanguageId,
                    WordLastManualStatusAt = scr.Word.LastManualStatusAt
                })
                .ToListAsync();

            if (rawCandidates.Count == 0) return new List<SrsCardReview>();

            // Aggregate running-token occurrences and most recent reading access across the
            // user's real texts (excluding AI-generated srs-story practice texts and unread
            // auto-imported RSS news articles). On PostgreSQL, Contains() compiles to a single
            // ANY(@array) parameter so large batches run in one round-trip.
            int chunkSize = _context.Database.IsNpgsql()
                ? TextWordStatsChunkSizePostgres
                : TextWordStatsChunkSizeDefault;
            var textStats = new Dictionary<int, (int Occurrences, DateTime? LastAccessedAt)>();
            var wordsToRank = normalizedOrder == SrsQueuePolicy.NewCardOrder.Oldest
                ? Enumerable.Empty<int>() : rawCandidates.Select(c => c.WordId).Distinct();
            foreach (var chunk in wordsToRank.Chunk(chunkSize))
            {
                var wordIdBatch = chunk.ToList();
                var batchStats = await _context.TextWords
                    .AsNoTracking()
                    .Where(tw => wordIdBatch.Contains(tw.WordId)
                              && tw.Text != null
                              && tw.Text.UserId == userId
                              && tw.Text.Tag != "srs-story"
                              && !(tw.Text.NewsFeedId != null && tw.Text.LastAccessedAt == null))
                    .GroupBy(tw => tw.WordId)
                    .Select(g => new
                    {
                        WordId = g.Key,
                        Occurrences = g.Sum(tw => tw.OccurrenceCount),
                        LastAccessedAt = g.Max(tw => tw.Text.LastAccessedAt)
                    })
                    .ToListAsync();

                foreach (var row in batchStats)
                    textStats[row.WordId] = (row.Occurrences, row.LastAccessedAt);
            }

            var candidates = rawCandidates.Select(c =>
            {
                textStats.TryGetValue(c.WordId, out var stat);
                return new SrsQueuePolicy.NewCardCandidate(
                    c.SrsCardReviewId,
                    c.WordId,
                    c.CreatedAt,
                    c.WordLastManualStatusAt,
                    stat.Occurrences,
                    stat.LastAccessedAt);
            });

            var selectedIds = SrsQueuePolicy.OrderNewCardIds(
                candidates, normalizedOrder, now, deckLimits == null ? take : rawCandidates.Count);
            if (deckLimits != null)
            {
                var languageByCard = rawCandidates.ToDictionary(card => card.SrsCardReviewId, card => card.LanguageId);
                selectedIds = TakeWithinDeckLimits(selectedIds, id => languageByCard[id], deckLimits).Take(take).ToList();
            }
            if (selectedIds.Count == 0) return new List<SrsCardReview>();

            // A card may have changed while its occurrence counts were being gathered.
            var selectedCards = await newOnly
                .Where(scr => selectedIds.Contains(scr.SrsCardReviewId))
                .Include(scr => scr.Word)
                    .ThenInclude(w => w.Translation)
                .ToDictionaryAsync(scr => scr.SrsCardReviewId);

            var ordered = new List<SrsCardReview>(selectedIds.Count);
            foreach (var id in selectedIds)
            {
                if (selectedCards.TryGetValue(id, out var card))
                    ordered.Add(card);
            }
            return ordered;
        }

        private static List<T> MergeByReviewOrder<T>(
            string reviewOrder,
            IReadOnlyList<T> learning,
            IReadOnlyList<T> newCards,
            IReadOnlyList<T> reviews)
        {
            var result = new List<T>(learning.Count + newCards.Count + reviews.Count);
            result.AddRange(learning);
            if (reviewOrder == "new_first")
            {
                result.AddRange(newCards);
                result.AddRange(reviews);
            }
            else if (reviewOrder == "reviews_first")
            {
                result.AddRange(reviews);
                result.AddRange(newCards);
            }
            else // "mix"
            {
                int mixMax = Math.Max(newCards.Count, reviews.Count);
                for (int i = 0; i < mixMax; i++)
                {
                    if (i < newCards.Count) result.Add(newCards[i]);
                    if (i < reviews.Count) result.Add(reviews[i]);
                }
            }
            return result;
        }

        /// <summary>Defensive normalizer for UserSettings.SrsCardType. Falls back to "translation".</summary>
        internal static string NormalizeCardType(string? value)
        {
            var normalized = (value ?? "translation").Trim().ToLowerInvariant();
            return normalized is "translation" or "cloze" or "mixed" ? normalized : "translation";
        }

        /// <summary>
        /// Mask an occurrence of the answer using the vocabulary keys for the card's language.
        /// Mined examples use their source's word boundaries. Manual examples and terms
        /// containing punctuation can match at Unicode word boundaries. Return the reader's
        /// normalized display text, or null when the card needs a translation prompt.
        /// </summary>
        internal static string? BuildClozeSentence(string? sentence, string? term, Language? language = null,
            bool useReaderSpans = false)
        {
            if (string.IsNullOrEmpty(sentence) || string.IsNullOrEmpty(term)) return null;
            const string Mask = "___";
            Tokenizer.TokenizationResult? readerText = useReaderSpans ? Tokenizer.Tokenize(sentence, language) : null;
            sentence = readerText?.Processed ?? Tokenizer.NormalizeText(sentence, language);
            term = Tokenizer.NormalizeText(term, language).Trim();
            var termKey = Tokenizer.KeyFromNormalizedText(term, language);
            if (sentence.Length == 0 || termKey.Length == 0) return null;

            var range = readerText is { } parsed ? FindReaderClozeRange(parsed, term, termKey, language) : null;
            if (range == null)
            {
                // Punctuation such as "e.g." is part of some answers. Match candidates with
                // those same separators, then compare their vocabulary keys in the card's
                // language. The candidate's display length can include vocalization marks.
                var shape = string.Concat(Regex.Matches(term, @"(\w+)|\W+")
                    .Select(part => part.Groups[1].Success ? @"\w+" : Regex.Escape(part.Value)));
                foreach (Match match in Regex.Matches(sentence, $@"(?<!\w)(?=({shape})(?!\w))"))
                {
                    var candidate = match.Groups[1];
                    if (Tokenizer.KeyFromNormalizedText(candidate.Value, language) != termKey) continue;
                    range = (candidate.Index, candidate.Length);
                    break;
                }
            }
            return range is { } found ? string.Concat(sentence.AsSpan(0, found.Start), Mask,
                sentence.AsSpan(found.Start + found.Length)) : null;
        }

        private static (int Start, int Length)? FindReaderClozeRange(Tokenizer.TokenizationResult readerText,
            string term, string termKey, Language? language)
        {
            var words = readerText.Tokens.Where(token => token.IsWord).ToArray();
            var wordEnds = words.Select(word => word.End).ToHashSet();
            var korean = KoreanLookup.IsKoreanLanguageCode(language?.Code);
            foreach (var word in words)
            {
                if (Tokenizer.KeyFromNormalizedText(word.Text, language) == termKey)
                    return (word.Start, word.End - word.Start);
                var end = word.Start + term.Length;
                if (end > readerText.Processed.Length ||
                    Tokenizer.KeyFromNormalizedText(readerText.Processed[word.Start..end], language) != termKey)
                    continue;
                if (wordEnds.Contains(end)) return (word.Start, term.Length);

                // Leave an attached particle visible if the saved answer is literally
                // the start of that Korean word. Different conjugations need a different answer.
                if (korean && end < word.End && KoreanLookup.AnalyzeKoreanCandidates(word.Text)
                    .Any(candidate => candidate.DictionaryValidated && candidate.Lemma == term))
                    return (word.Start, term.Length);
            }
            return null;
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

    public class SrsDeckSettingsUpdateDto
    {
        [Range(0, 9999)]
        public int? MaxNewCards { get; set; }

        [Range(1, 9999)]
        public int? MaxReviews { get; set; }

        public bool? NewCardsIgnoreReviewLimit { get; set; }

        [Range(0, 9999)]
        public int? TodayMaxNewCards { get; set; }

        [Range(1, 9999)]
        public int? TodayMaxReviews { get; set; }

        /// <summary>The SRS day returned by GET, required when saving a today-only limit.</summary>
        public DateOnly? StudyDay { get; set; }
    }

    public class SrsDeckSettingsDto
    {
        public DateOnly StudyDay { get; set; }
        public int DefaultMaxNewCards { get; set; }
        public int DefaultMaxReviews { get; set; }
        public bool DefaultNewCardsIgnoreReviewLimit { get; set; }
        public int? MaxNewCards { get; set; }
        public int? MaxReviews { get; set; }
        public bool? NewCardsIgnoreReviewLimit { get; set; }
        public int? TodayMaxNewCards { get; set; }
        public int? TodayMaxReviews { get; set; }
    }

    public class SrsStatsDto
    {
        public int DueCount { get; set; }
        public int ReviewableCount { get; set; }
        /// <summary>Learning and relearning cards due now or within the learn-ahead window.</summary>
        public int DueLearningCount { get; set; }
        /// <summary>Total graduated review cards due today before applying the daily review cap.</summary>
        public int DueReviewCount { get; set; }
        /// <summary>Total untouched new cards waiting in the backlog.</summary>
        public int DueNewCount { get; set; }
        /// <summary>Scheduled reviews available today after applying the daily review cap.</summary>
        public int ReviewableReviewCount { get; set; }
        /// <summary>New cards available to introduce today after daily limits and review-limit guardrails.</summary>
        public int ReviewableNewCount { get; set; }
        /// <summary>True when at least one included deck has new cards paused by its review limit.</summary>
        public bool NewCardsPausedByReviewLimit { get; set; }
        public int TotalCards { get; set; }
        public int NewCards { get; set; }
        /// <summary>Cards on a (re)learning step.</summary>
        public int LearningCards { get; set; }
        /// <summary>Graduated cards with an interval under 21 days.</summary>
        public int YoungCards { get; set; }
        public int MatureCards { get; set; }
        public int TotalPhrases { get; set; }
        public int ReviewedToday { get; set; }
        
        /// <summary>Effective new-card limit, summed across included decks when no language is selected.</summary>
        public int MaxNewCards { get; set; }
        /// <summary>Effective review limit, summed across included decks when no language is selected.</summary>
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
