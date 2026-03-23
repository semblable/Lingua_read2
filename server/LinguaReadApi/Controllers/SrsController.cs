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
            [FromQuery] int limit = 50)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;
            var today = now.Date;

            // 1. Get User Limits
            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            int maxNew = settings?.SrsMaxNewCards ?? 20;
            int maxReviews = settings?.SrsMaxReviews ?? 100;
            string reviewOrder = settings?.SrsReviewOrder ?? "mix";

            int studiedNew = (settings?.SrsDailyStudyDate?.Date == today) ? settings.SrsDailyNewCardsStudied : 0;
            int studiedReviews = (settings?.SrsDailyStudyDate?.Date == today) ? settings.SrsDailyReviewsStudied : 0;
            
            int remainingNew = Math.Max(0, maxNew - studiedNew);
            int remainingReviews = Math.Max(0, maxReviews - studiedReviews);

            if (remainingNew == 0 && remainingReviews == 0)
            {
                return new List<SrsDueCardDto>(); // Limits reached for today
            }

            // 2. Base query for due cards
            var query = _context.SrsCardReviews
                .AsNoTracking()
                .Where(scr => scr.UserId == userId && scr.NextReviewAt <= now)
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

            // 3. Separate Queries & Over-fetch
            var newCardsQuery = query.Where(scr => scr.Repetitions == 0).OrderBy(scr => scr.NextReviewAt);
            var reviewCardsQuery = query.Where(scr => scr.Repetitions > 0).OrderBy(scr => scr.NextReviewAt);

            var newCardsPool = await newCardsQuery.Take(Math.Max(limit * 2, remainingNew * 2)).ToListAsync();
            var reviewCardsPool = await reviewCardsQuery.Take(Math.Max(limit * 2, remainingReviews * 2)).ToListAsync();

            var allFetchedCards = newCardsPool.Concat(reviewCardsPool).ToList();
            if (!allFetchedCards.Any()) return new List<SrsDueCardDto>();

            // 4. Fetch Phrases for 1T validation
            var cardWordIds = allFetchedCards.Select(c => c.WordId).Distinct().ToList();
            var phrases = await _context.SrsPhrases
                .AsNoTracking()
                .Where(sp => sp.UserId == userId && cardWordIds.Contains(sp.WordId))
                .ToListAsync();
            var phrasesByWordId = phrases.GroupBy(p => p.WordId).ToDictionary(g => g.Key, g => g.ToList());

            // 5. Apply 1T filter to build lists
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
                    Phrases = cardPhrases.Select(p => new SrsPhraseDto
                    {
                        SrsPhraseId = p.SrsPhraseId,
                        Sentence = p.Sentence,
                        TextTitle = p.TextTitle,
                        CreatedAt = p.CreatedAt
                    }).ToList(),
                    UnknownWordsInPhrase = unknownWordsInBestPhrase
                };

                if (card.Repetitions == 0) validNewCards.Add(dto);
                else validReviewCards.Add(dto);
            }

            // 6. Enforce remaining limits
            validNewCards = validNewCards.Take(remainingNew).ToList();
            validReviewCards = validReviewCards.Take(remainingReviews).ToList();

            // 7. Apply Order
            var rawResult = new List<SrsDueCardDto>();
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

            // Update daily limit tracking before SM2 alters repetitions
            var settings = await _context.UserSettings.FirstOrDefaultAsync(u => u.UserId == userId);
            var today = DateTime.UtcNow.Date;
            if (settings != null)
            {
                if (settings.SrsDailyStudyDate?.Date != today)
                {
                    settings.SrsDailyStudyDate = today;
                    settings.SrsDailyNewCardsStudied = 0;
                    settings.SrsDailyReviewsStudied = 0;
                }
                
                if (card.Repetitions == 0) settings.SrsDailyNewCardsStudied++;
                else settings.SrsDailyReviewsStudied++;
            }

            // Apply SM-2 algorithm
            ApplySm2(card, dto.Grade);

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
                .Where(scr => scr.UserId == userId);

            if (languageId.HasValue)
            {
                cardQuery = cardQuery.Where(scr => scr.Word.LanguageId == languageId.Value);
            }

            var allCards = await cardQuery
                .Include(scr => scr.Word)
                .ToListAsync();

            var dueCount = allCards.Count(c => c.NextReviewAt <= now);
            var totalCards = allCards.Count;
            var newCards = allCards.Count(c => c.Repetitions == 0);
            var learningCards = allCards.Count(c => c.Repetitions > 0 && c.Interval < 21);
            var matureCards = allCards.Count(c => c.Interval >= 21);

            var totalPhrases = await _context.SrsPhrases
                .AsNoTracking()
                .CountAsync(sp => sp.UserId == userId);

            var reviewedToday = allCards.Count(c =>
                c.LastReviewedAt.HasValue &&
                c.LastReviewedAt.Value.Date == now.Date);

            // Fetch settings for limit info
            var settings = await _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(u => u.UserId == userId);
            
            int studiedNew = (settings?.SrsDailyStudyDate?.Date == now.Date) ? settings.SrsDailyNewCardsStudied : 0;
            int studiedReviews = (settings?.SrsDailyStudyDate?.Date == now.Date) ? settings.SrsDailyReviewsStudied : 0;

            return new SrsStatsDto
            {
                DueCount = dueCount,
                TotalCards = totalCards,
                NewCards = newCards,
                LearningCards = learningCards,
                MatureCards = matureCards,
                TotalPhrases = totalPhrases,
                ReviewedToday = reviewedToday,
                MaxNewCards = settings?.SrsMaxNewCards ?? 20,
                MaxReviews = settings?.SrsMaxReviews ?? 100,
                StudiedNewCardsToday = studiedNew,
                StudiedReviewsToday = studiedReviews
            };
        }

        // --- SM-2 Algorithm ---
        private void ApplySm2(SrsCardReview card, int grade)
        {
            // grade: 0=Again, 1=Hard, 2=Good, 3=Easy

            if (grade < 2)
            {
                // Failed: reset repetitions, review again soon
                card.Repetitions = 0;
                card.Interval = grade == 0 ? 0 : 1; // Again = today, Hard = tomorrow
            }
            else
            {
                // Passed
                if (card.Repetitions == 0)
                    card.Interval = 1;
                else if (card.Repetitions == 1)
                    card.Interval = 6;
                else
                    card.Interval = (int)Math.Round(card.Interval * card.EaseFactor);

                card.Repetitions++;

                // Easy bonus
                if (grade == 3)
                    card.Interval = (int)Math.Round(card.Interval * 1.3);
            }

            // Update ease factor
            card.EaseFactor = Math.Max(1.3,
                card.EaseFactor + 0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02));

            card.LastReviewedAt = DateTime.UtcNow;
            card.NextReviewAt = DateTime.UtcNow.AddDays(Math.Max(card.Interval, 0));

            // If interval is 0 (Again), schedule for 10 minutes from now instead of right now
            if (card.Interval == 0)
            {
                card.NextReviewAt = DateTime.UtcNow.AddMinutes(10);
            }
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
    }
}
