using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Srs;
using LinguaReadApi.Services.Tokenization;
using LinguaReadApi.Utilities;
using System.Linq; // Required for Count() on nullable collection
using System.Collections.Generic;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class WordsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<WordsController> _logger;

        public WordsController(AppDbContext context, ILogger<WordsController> logger)
        {
            _context = context;
            _logger = logger;
        }

        private Task<UserSettings?> GetSettingsAsync(Guid userId) =>
            _context.UserSettings.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == userId);

        /// <summary>
        /// Whether <paramref name="word"/> has a mined sentence, for the "with_sentence"
        /// auto-create mode: one sent with this request, or one mined earlier. Other modes
        /// don't look at it, so the lookup is skipped for them.
        /// </summary>
        private async Task<bool> HasSentenceAsync(Word word, string? newSentence, UserSettings? settings) =>
            !string.IsNullOrEmpty(newSentence)
            || (SrsCardLifecycle.AutoCreateMode(settings) == SrsCardLifecycle.AutoCreate.WithSentence
                && await _context.SrsPhrases.AnyAsync(sp => sp.WordId == word.WordId && sp.UserId == word.UserId));

        // POST: api/words
        [HttpPost]
        [ProducesResponseType(typeof(WordResponseDto), 200)]
        [ProducesResponseType(typeof(WordResponseDto), 201)]
        [ProducesResponseType(typeof(WordEditConflictDto), 409)]
        public async Task<ActionResult<WordResponseDto>> CreateWord([FromBody] CreateWordDto createWordDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            return await CreateWordAsync(createWordDto, WordEditTime(createWordDto.ClientUpdatedAt), attempt: 1);
        }

        private async Task<ActionResult<WordResponseDto>> CreateWordAsync(CreateWordDto createWordDto, DateTime editedAt, int attempt)
        {
            var userId = GetUserId();

            // Check if the text exists and belongs to the user
            var text = await _context.Texts
                .Include(t => t.Language)
                .FirstOrDefaultAsync(t => t.TextId == createWordDto.TextId && t.UserId == userId);

            if (text == null)
            {
                return NotFound("Text not found or does not belong to the user");
            }

            // Normalize the term through the shared tokenizer helper so every
            // write path keys words the same way (locale-aware trim+lowercase).
            var normalizedTerm = Tokenizer.NormalizeKey(createWordDto.Term, text.Language);

            // [Required] lets through a term that normalizing empties (a lone soft
            // hyphen, a character the language substitutes with nothing).
            if (string.IsNullOrWhiteSpace(normalizedTerm))
            {
                return BadRequest("The term has no characters left after normalization.");
            }

            // Normalize legacy headwords through the same language-scoped table
            // as new tokens; database lower() cannot fold script variants.
            var word = (await LoadMatchingWordsAsync(userId, text.Language, [normalizedTerm]))
                .FirstOrDefault();
            var isNew = word == null;
            var status = createWordDto.TranslationOnly ? Math.Max(1, word?.Status ?? 0) : createWordDto.ReplaceExisting || isNew
                ? createWordDto.Status : Math.Max(word!.Status, createWordDto.Status);
            var translation = createWordDto.ReplaceExisting
                ? NormalizeTranslationEdit(createWordDto.Translation)
                : string.IsNullOrEmpty(createWordDto.Translation) ? null : createWordDto.Translation;
            if (word == null && createWordDto.ExpectedRevision != null) return NotFound();
            var edit = ResolveWordEdit(word, createWordDto.ExpectedRevision, editedAt, status,
                !createWordDto.TranslationOnly || isNew || word!.Status == 0,
                translation, createWordDto.StatusUpdatedAt, createWordDto.TranslationUpdatedAt);
            if (edit == null) return NewerWordConflict(word!);

            word ??= new Word
            {
                Term = normalizedTerm,
                UserId = userId,
                LanguageId = text.LanguageId,
                CreatedAt = DateTime.UtcNow
            };
            ApplyWordEdit(word, status, edit);
            if (isNew) _context.Words.Add(word);
            else _context.Entry(word).Property(w => w.LastEditedAt).IsModified = true;
            if (isNew || !await _context.TextWords.AnyAsync(tw => tw.TextId == text.TextId && tw.WordId == word.WordId))
                _context.TextWords.Add(new TextWord { TextId = text.TextId, Word = word, CreatedAt = DateTime.UtcNow });
            SetWordTranslation(word, translation);

            var capturedExample = await SrsMinedSentences.CaptureFirstAsync(_context, word, createWordDto.Sentence, text);
            var settings = await GetSettingsAsync(userId);
            await SrsCardLifecycle.ApplyStatusRulesAsync(
                _context, word, capturedExample || (!isNew && await HasSentenceAsync(word, null, settings)), settings);

            // Save the edit, relationship, and SRS changes together. An optimistic
            // concurrency loss rolls back the whole mutation before we compare it again.
            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (attempt < MaxTermWriteAttempts)
            {
                _logger.LogWarning(ex, "Word save collided with another writer (attempt {Attempt}); retrying", attempt);
                _context.ChangeTracker.Clear();
                return await CreateWordAsync(createWordDto, editedAt, attempt + 1);
            }
            catch (DbUpdateConcurrencyException)
            {
                return await ReadWordConflictAsync(userId, word.WordId);
            }

            var response = WordResponse(word, isNew);
            if (isNew) return CreatedAtAction(nameof(GetWord), new { id = word.WordId }, response);
            return Ok(response);
        }

        // GET: api/words/5
        [HttpGet("{id}")]
        public async Task<ActionResult<WordResponseDto>> GetWord(int id)
        {
            var userId = GetUserId();

            var word = await _context.Words
                .Include(w => w.Translation)
                .FirstOrDefaultAsync(w => w.WordId == id && w.UserId == userId);

            if (word == null)
            {
                return NotFound();
            }

            return new WordResponseDto
            {
                WordId = word.WordId,
                Term = word.Term,
                Status = word.Status,
                Translation = word.Translation?.Translation ?? "", // Handle null translation
                IsNew = word.Status == 1 // Or based on your definition of "New"
            };
        }

        // GET: api/words/language/5?status=1,2,3&sortBy=term_asc
        [HttpGet("language/{languageId}")]
        public async Task<ActionResult<IEnumerable<WordResponseDto>>> GetWordsByLanguage(
            int languageId,
            [FromQuery] string? status = null,     // Comma-separated list of statuses (e.g., "1,2,5")
            [FromQuery] string? sortBy = null,     // Sort criteria (e.g., "term_asc", "status_desc")
            [FromQuery] string? searchTerm = null, // Search term for Term or Translation
            [FromQuery] bool skipSort = false)      // Skip sorting for performance when caller doesn't need order
        {
            var userId = GetUserId();

            var query = _context.Words
                .AsNoTracking() // Performance improvement for read-only query
                .Where(w => w.LanguageId == languageId && w.UserId == userId)
                .Include(w => w.Translation)
                .AsQueryable(); // Use AsQueryable for building the query

            // Apply status filtering
            if (!string.IsNullOrEmpty(status))
            {
                var statusList = status.Split(',')
                                       .Select(s => s.Trim())
                                       .Where(s => int.TryParse(s, out _))
                                       .Select(int.Parse)
                                       .ToList();
                if (statusList.Any())
                {
                    query = query.Where(w => statusList.Contains(w.Status));
                }
            }

            // Apply search term filtering (case- and accent-insensitive)
            if (!string.IsNullOrWhiteSpace(searchTerm))
            {
                query = WhereTermOrTranslationContains(query, searchTerm);
            }

            // Apply sorting (skip when caller only needs unsorted data, e.g. for Map-based lookups)
            if (!skipSort)
            {
                switch (sortBy?.ToLowerInvariant())
                {
                    case "term_desc":
                        query = query.OrderByDescending(w => w.Term);
                        break;
                    case "status_asc":
                        query = query.OrderBy(w => w.Status).ThenBy(w => w.Term);
                        break;
                    case "status_desc":
                        query = query.OrderByDescending(w => w.Status).ThenBy(w => w.Term);
                        break;
                    case "created_asc":
                        query = query.OrderBy(w => w.CreatedAt);
                        break;
                    case "created_desc":
                        query = query.OrderByDescending(w => w.CreatedAt);
                        break;
                    case "term_asc":
                    default:
                        query = query.OrderBy(w => w.Term);
                        break;
                }
            }

            var words = await query
                .Select(w => new WordResponseDto
                {
                    WordId = w.WordId,
                    Term = w.Term,
                    Status = w.Status,
                    Translation = w.Translation != null ? w.Translation.Translation : "",
                    IsNew = w.Status == 1, // Or based on your definition of "New"
                    CreatedAt = w.CreatedAt
                })
                .ToListAsync();

            return words;
        }

        // GET: api/words/language/5/paginated?page=1&pageSize=20&status=1,2,3&sortBy=term_asc
        [HttpGet("language/{languageId}/paginated")]
        public async Task<ActionResult<PagedResult<WordResponseDto>>> GetPaginatedWordsByLanguage(
            int languageId,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            [FromQuery] string? status = null, // Comma-separated list of statuses (e.g., "1,2,5")
            [FromQuery] string? sortBy = null, // Sort criteria (e.g., "term_asc", "status_desc")
            [FromQuery] string? searchTerm = null,
            [FromQuery] bool includeSentences = false)
        {
            var userId = GetUserId();

            // Clamp pagination parameters
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);

            var query = _context.Words
                .AsNoTracking() // Performance improvement for read-only query
                .Where(w => w.LanguageId == languageId && w.UserId == userId)
                .Include(w => w.Translation)
                .AsQueryable();

            // Apply filters (same logic as non-paginated)
            if (!string.IsNullOrEmpty(status))
            {
                var statusList = status.Split(',')
                                       .Select(s => s.Trim())
                                       .Where(s => int.TryParse(s, out _))
                                       .Select(int.Parse)
                                       .ToList();
                if (statusList.Any())
                {
                    query = query.Where(w => statusList.Contains(w.Status));
                }
            }

            if (!string.IsNullOrWhiteSpace(searchTerm))
            {
                query = WhereTermOrTranslationContains(query, searchTerm);
            }

            // Apply sorting
            switch (sortBy?.ToLowerInvariant())
            {
                case "term_desc":
                    query = query.OrderByDescending(w => w.Term);
                    break;
                case "status_asc":
                    query = query.OrderBy(w => w.Status).ThenBy(w => w.Term);
                    break;
                case "status_desc":
                    query = query.OrderByDescending(w => w.Status).ThenBy(w => w.Term);
                    break;
                case "created_asc":
                    query = query.OrderBy(w => w.CreatedAt);
                    break;
                case "created_desc":
                    query = query.OrderByDescending(w => w.CreatedAt);
                    break;
                case "term_asc":
                default:
                    query = query.OrderBy(w => w.Term);
                    break;
            }

            // Get total count BEFORE paging
            var totalCount = await query.CountAsync();

            // Apply paging
            var items = await query
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(w => new WordResponseDto
                {
                    WordId = w.WordId,
                    Term = w.Term,
                    Status = w.Status,
                    Translation = w.Translation != null ? w.Translation.Translation : "",
                    IsNew = w.Status == 1,
                    CreatedAt = w.CreatedAt
                })
                .ToListAsync();

            if (items.Count > 0)
            {
                // Batch context for this page, rather than making a query per term.
                var wordIds = items.Select(w => w.WordId).ToList();
                var phraseQuery = _context.SrsPhrases.AsNoTracking()
                    .Where(p => p.UserId == userId && wordIds.Contains(p.WordId));
                var sourcePhrases = phraseQuery.Where(p => (p.Text != null && p.Text.UserId == userId)
                    || (p.TextTitle != null && p.TextTitle.Trim() != ""));
                if (!includeSentences)
                {
                    // One source summary per term; sentence bodies and older examples stay opt-in.
                    phraseQuery = sourcePhrases.Where(p => p.SrsPhraseId == sourcePhrases
                        .Where(other => other.WordId == p.WordId)
                        .OrderByDescending(other => other.CreatedAt).ThenByDescending(other => other.SrsPhraseId)
                        .Select(other => other.SrsPhraseId).FirstOrDefault());
                }
                var phrases = await phraseQuery
                    .OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.SrsPhraseId)
                    .Select(p => new
                    {
                        p.WordId,
                        // Avoid returning sentence bodies when only source information is needed.
                        Sentence = includeSentences ? p.Sentence : null,
                        // A deleted or inaccessible source keeps its saved title, without a link.
                        TextId = p.Text != null && p.Text.UserId == userId ? p.TextId : null,
                        TextTitle = p.Text != null && p.Text.UserId == userId ? p.Text.Title : p.TextTitle
                    })
                    .ToListAsync();
                // Database TRIM functions differ on tabs/newlines; filter the scoped results in .NET.
                var byWord = phrases.Where(p => !string.IsNullOrWhiteSpace(p.Sentence))
                    .ToLookup(p => p.WordId, p => new TermSentenceDto
                    {
                        Sentence = p.Sentence!, TextId = p.TextId, TextTitle = p.TextTitle
                    });

                // Terms without a mined sentence can still have a source in the reader's word links.
                var latestTextIds = _context.TextWords.AsNoTracking()
                    .Where(tw => wordIds.Contains(tw.WordId) && tw.Word.UserId == userId && tw.Text.UserId == userId)
                    .GroupBy(tw => tw.WordId)
                    .Select(group => new { WordId = group.Key, TextId = group.Max(tw => tw.TextId) });
                var linkedSources = await (from latest in latestTextIds
                    join text in _context.Texts.AsNoTracking().Where(t => t.UserId == userId) on latest.TextId equals text.TextId
                    select new { latest.WordId, TextId = (int?)text.TextId, TextTitle = (string?)text.Title }).ToListAsync();
                var sourcesByWord = phrases.Where(p => p.TextId.HasValue || !string.IsNullOrWhiteSpace(p.TextTitle))
                    .GroupBy(p => p.WordId).Select(group => group.First())
                    .Select(p => new { p.WordId, p.TextId, p.TextTitle })
                    .Concat(linkedSources)
                    .ToLookup(p => p.WordId, p => new TermSourceDto { TextId = p.TextId, TextTitle = p.TextTitle });
                foreach (var item in items)
                {
                    item.Sentences = byWord[item.WordId].ToList();
                    item.Sources = sourcesByWord[item.WordId].DistinctBy(s => (s.TextId, s.TextTitle)).ToList();
                }
            }

            var totalPages = (int)Math.Ceiling(totalCount / (double)pageSize);

            return new PagedResult<WordResponseDto>
            {
                Items = items,
                TotalCount = totalCount,
                PageNumber = page,
                PageSize = pageSize,
                TotalPages = totalPages
            };
        }

        // The Terms page search: the term or its translation contains the search, ignoring case and
        // accents (SearchText), so "sancao" finds "sanção".
        internal static IQueryable<Word> WhereTermOrTranslationContains(IQueryable<Word> words, string searchTerm) =>
            words.Where(w => SearchText.Fold(w.Term).Contains(SearchText.Fold(searchTerm)) ||
                             (w.Translation != null &&
                              SearchText.Fold(w.Translation.Translation).Contains(SearchText.Fold(searchTerm))));

        // PUT: api/words/5
        [HttpPut("{id}")]
        [ProducesResponseType(typeof(WordResponseDto), 200)]
        [ProducesResponseType(204)]
        [ProducesResponseType(typeof(WordEditConflictDto), 409)]
        public async Task<IActionResult> UpdateWord(int id, [FromBody] UpdateWordDto updateWordDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            return await UpdateWordAsync(id, updateWordDto, WordEditTime(updateWordDto.ClientUpdatedAt), attempt: 1);
        }

        private async Task<IActionResult> UpdateWordAsync(int id, UpdateWordDto updateWordDto, DateTime editedAt, int attempt)
        {
            var userId = GetUserId();

            var word = await _context.Words
                .Include(w => w.Translation)
                .FirstOrDefaultAsync(w => w.WordId == id && w.UserId == userId);

            if (word == null)
            {
                return NotFound();
            }

            var translation = NormalizeTranslationEdit(updateWordDto.Translation);
            var status = updateWordDto.TranslationOnly ? Math.Max(1, word.Status) : updateWordDto.Status;
            var edit = ResolveWordEdit(word, updateWordDto.ExpectedRevision, editedAt, status,
                !updateWordDto.TranslationOnly || word.Status == 0,
                translation, updateWordDto.StatusUpdatedAt, updateWordDto.TranslationUpdatedAt);
            if (edit == null) return NewerWordConflict(word);

            Text? sourceText = null;
            if (status is >= 1 and <= 4 && !string.IsNullOrWhiteSpace(updateWordDto.Sentence))
            {
                if (!updateWordDto.TextId.HasValue)
                    return BadRequest("A source text is required to save an example.");
                // A word save needs source metadata, not a second copy of a
                // potentially book-sized text on every grading request.
                sourceText = await _context.Texts.AsNoTracking()
                    .Where(t => t.TextId == updateWordDto.TextId.Value && t.UserId == userId)
                    .Select(t => new Text { TextId = t.TextId, UserId = t.UserId,
                        LanguageId = t.LanguageId, Title = t.Title, Language = t.Language })
                    .FirstOrDefaultAsync();
                if (sourceText == null) return NotFound("Source text not found.");
                if (sourceText.LanguageId != word.LanguageId)
                    return BadRequest("The example must use the word's language.");
            }

            // Update word status, then create, suspend or restore its SRS card to match
            // (Ignored always suspends; leaving Known/Ignored lifts only that suspension).
            ApplyWordEdit(word, status, edit);
            _context.Entry(word).Property(w => w.LastEditedAt).IsModified = true;
            var capturedExample = sourceText != null && await SrsMinedSentences.CaptureFirstAsync(
                _context, word, updateWordDto.Sentence, sourceText);
            var settings = await GetSettingsAsync(userId);
            await SrsCardLifecycle.ApplyStatusRulesAsync(
                _context, word, capturedExample || await HasSentenceAsync(word, newSentence: null, settings), settings);

            SetWordTranslation(word, translation);

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (attempt < MaxTermWriteAttempts)
            {
                _logger.LogWarning(ex, "Word update collided with another writer (attempt {Attempt}); retrying", attempt);
                _context.ChangeTracker.Clear();
                return await UpdateWordAsync(id, updateWordDto, editedAt, attempt + 1);
            }
            catch (DbUpdateConcurrencyException)
            {
                return await ReadWordConflictAsync(userId, id);
            }

            return updateWordDto.TranslationOnly ? Ok(WordResponse(word, false)) : NoContent();
        }

        // DELETE: api/words/5
        [HttpDelete("{id}")]
        [ProducesResponseType(204)]
        [ProducesResponseType(typeof(WordEditConflictDto), 409)]
        public async Task<IActionResult> DeleteWord(int id)
        {
            var userId = GetUserId();

            var word = await _context.Words
                .FirstOrDefaultAsync(w => w.WordId == id && w.UserId == userId);

            if (word == null)
            {
                return NotFound();
            }

            var srsCards = await _context.SrsCardReviews
                .Where(scr => scr.WordId == id && scr.UserId == userId)
                .ToListAsync();
            var srsCardIds = srsCards.Select(scr => scr.SrsCardReviewId).ToList();

            if (srsCardIds.Any())
            {
                var srsReviewLogs = await _context.SrsReviewLogs
                    .Where(log => log.UserId == userId && srsCardIds.Contains(log.SrsCardReviewId))
                    .ToListAsync();
                _context.SrsReviewLogs.RemoveRange(srsReviewLogs);
            }

            var srsPhrases = await _context.SrsPhrases
                .Where(sp => sp.WordId == id && sp.UserId == userId)
                .ToListAsync();
            var textWords = await _context.TextWords
                .Where(tw => tw.WordId == id)
                .ToListAsync();
            var translations = await _context.WordTranslations
                .Where(wt => wt.WordId == id)
                .ToListAsync();

            _context.SrsPhrases.RemoveRange(srsPhrases);
            _context.TextWords.RemoveRange(textWords);
            _context.WordTranslations.RemoveRange(translations);
            _context.SrsCardReviews.RemoveRange(srsCards);
            _context.Words.Remove(word);

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                return await ReadWordConflictAsync(userId, id);
            }

            return NoContent();
        }

        // POST: api/words/batch
        [HttpPost("batch")]
        [ProducesResponseType(typeof(AddTermsBatchResultDto), 200)]
        public async Task<IActionResult> AddTermsBatch([FromBody] AddTermBatchDto batchDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var userId = GetUserId();
            var languageId = batchDto.LanguageId;
            var termsToAdd = batchDto.Terms;

            if (termsToAdd == null || !termsToAdd.Any())
            {
                return BadRequest("Term list cannot be empty.");
            }

            // Fetch the language so terms can be normalized through the shared
            // tokenizer helper (locale-aware trim+lowercase).
            var language = await _context.Languages.FirstOrDefaultAsync(l => l.LanguageId == languageId);
            if (language == null)
            {
                return BadRequest($"Language with ID {languageId} not found.");
            }

            // Get distinct terms from the input DTO
            var termStrings = termsToAdd
                                .Where(t => !string.IsNullOrWhiteSpace(t.Term)) // Ensure term is not empty
                                .Select(t => t.Term.Trim()) // Trim whitespace
                                .Distinct()
                                .ToList();

            if (!termStrings.Any())
            {
                 return BadRequest("Term list contains no valid terms.");
            }

            try
            {
                for (var attempt = 1; ; attempt++)
                {
                    var plan = await PlanTermsBatchAsync(userId, language, termsToAdd, batchDto.KeepExistingStatus);
                    var editTime = WordEditTime(null);
                    var newWords = plan.WordsToCreate.ToHashSet();
                    foreach (var word in plan.WordsToCreate.Concat(plan.WordsWithNewStatus))
                    {
                        var statusChanged = newWords.Contains(word) || _context.Entry(word).Property(w => w.Status).OriginalValue != word.Status;
                        ApplyWordEdit(word, word.Status, new(AdvanceRevision(word.LastEditedAt, editTime), statusChanged ? editTime : null, null));
                    }
                    foreach (var (word, translation) in plan.TranslationsToUpsert)
                    {
                        ApplyWordEdit(word, word.Status, new(AdvanceRevision(word.LastEditedAt, editTime), null, editTime));
                        SetWordTranslation(word, translation);
                    }

                    // New cards can reference the added Word, so all associated writes
                    // stay in the same SaveChanges transaction.
                    var settings = await GetSettingsAsync(userId);
                    await SrsCardLifecycle.ApplyStatusRulesAsync(_context, userId,
                        plan.WordsWithNewStatus.Where(w => !newWords.Contains(w)).ToList(), settings);
                    foreach (var word in plan.WordsToCreate)
                        await SrsCardLifecycle.ApplyStatusRulesAsync(_context, word, hasSentence: false, settings);

                    try
                    {
                        var changedCount = await _context.SaveChangesAsync();
                        return Ok(new AddTermsBatchResultDto
                        {
                            Message = $"Batch processed. {changedCount} database changes saved.",
                            Words = plan.BatchWords.Select(w => WordResponse(w, w.Status == 1)).ToList()
                        });
                    }
                    catch (DbUpdateException ex) when (attempt < MaxTermWriteAttempts)
                    {
                        // The word linker and other saves can race this batch. Plan
                        // again against the committed rows rather than replaying them.
                        _logger.LogWarning(ex, "Term batch collided with another writer (attempt {Attempt}); retrying", attempt);
                        _context.ChangeTracker.Clear();
                    }
                }
            }
            catch (DbUpdateException ex)
            {
                 _logger.LogError(ex, "DbUpdateException saving batch terms ({EntryCount} entries)", ex.Entries?.Count());
                 return StatusCode(500, "An error occurred while saving the terms. Check logs for details.");
            }
        }

        // A save that loses a race with a concurrent insert of the same word is
        // re-planned; each retry reads the rows the other writer added.
        private const int MaxTermWriteAttempts = 3;

        // BatchWords: every word the batch names, found or created, once each.
        private sealed record TermsBatchPlan(
            List<Word> WordsToCreate,
            List<Word> WordsWithNewStatus,
            List<(Word Word, string Translation)> TranslationsToUpsert,
            List<Word> BatchWords);

        // Reads the batch's words and stages its changes on the context without
        // saving them: new words are added, rows the word linker made for words
        // never saved (status 0) are saved like new ones, and saved words are
        // raised to Known unless keepExistingStatus.
        private async Task<TermsBatchPlan> PlanTermsBatchAsync(Guid userId, Language language, List<NewTermDto> termsToAdd, bool keepExistingStatus)
        {
            var languageId = language.LanguageId;

            // Only the rows these terms can match, found like the word linker finds
            // them: stored terms are in NormalizeText form (RekeyLegacyTermsAsync
            // rewrites older ones), so lower(Term) equals their key, and the
            // IX_Words_UserId_LanguageId_LowerTerm index serves the lookup. Reading
            // the whole language instead made every save track all of the user's
            // words (tens of thousands) to change a few dozen.
            var keys = termsToAdd
                .Select(t => Tokenizer.NormalizeKey(t.Term ?? string.Empty, language))
                .Where(k => !string.IsNullOrWhiteSpace(k))
                .Distinct()
                .ToList();
            var existingWords = await LoadMatchingWordsAsync(userId, language, keys);

            var wordsToCreate = new List<Word>();
            var wordsWithNewStatus = new List<Word>();
            var translationsToUpsert = new List<(Word Word, string Translation)>();
            // Build a lookup for existing words keyed by the normalized term so
            // mixed-case imports collapse onto a single row. Folded reading
            // lookups must not merge distinct explicitly saved headwords.
            var existingWordsLookup = new Dictionary<string, Word>(StringComparer.Ordinal);
            foreach (var w in existingWords)
            {
                existingWordsLookup[Tokenizer.NormalizeKey(w.Term, language)] = w;
            }

            foreach (var termDto in termsToAdd)
            {
                var trimmedTerm = Tokenizer.NormalizeKey(termDto.Term ?? string.Empty, language);
                if (string.IsNullOrWhiteSpace(trimmedTerm)) continue;

                if (existingWordsLookup.TryGetValue(trimmedTerm, out var existingWord))
                {
                    existingWordsLookup[trimmedTerm] = existingWord;
                    // Word exists - update status if needed
                    if (existingWord.Status == 0 || (!keepExistingStatus && termDto.Status is >= 1 and <= 6))
                    {
                        // Imports can explicitly restore every status, including Ignored.
                        existingWord.Status = RequestedStatus(termDto);
                        wordsWithNewStatus.Add(existingWord);
                    }
                    else if (!keepExistingStatus && existingWord.Status < 5)
                    {
                        existingWord.Status = 5;
                        wordsWithNewStatus.Add(existingWord);
                    }
                    // Handle translation only if provided in the DTO
                    if (!string.IsNullOrEmpty(termDto.Translation))
                    {
                        if (existingWord.Translation == null)
                        {
                            translationsToUpsert.Add((existingWord, termDto.Translation));
                        }
                        else if (existingWord.Translation.Translation != termDto.Translation)
                        {
                            translationsToUpsert.Add((existingWord, termDto.Translation));
                        }
                    }
                }
                else
                {
                    var newWord = new Word
                    {
                        Term = trimmedTerm,
                        Status = RequestedStatus(termDto),
                        UserId = userId,
                        LanguageId = languageId,
                        CreatedAt = DateTime.UtcNow
                    };
                    wordsToCreate.Add(newWord);

                    if (!string.IsNullOrEmpty(termDto.Translation))
                    {
                        translationsToUpsert.Add((newWord, termDto.Translation));
                    }
                    // Add to lookup to prevent duplicate inserts in this batch
                    existingWordsLookup[trimmedTerm] = newWord;
                }
            }
            if (wordsToCreate.Any())
            {
                _context.Words.AddRange(wordsToCreate);
            }
            var batchWords = keys
                .Select(k => existingWordsLookup.GetValueOrDefault(k))
                .OfType<Word>()
                .ToList();
            return new TermsBatchPlan(wordsToCreate, wordsWithNewStatus, translationsToUpsert, batchWords);
        }

        private async Task<List<Word>> LoadMatchingWordsAsync(Guid userId, Language language, List<string> keys)
        {
            var query = _context.Words.Where(w => w.UserId == userId && w.LanguageId == language.LanguageId);
            if (Tokenizer.RequiresNormalizedVocabularyLookup(language.Code)
                || Tokenizer.RequiresLookupFallback(language.Code))
            {
                // Probe lightweight projections first, then track only matching words.
                // Match normalized exact terms only, including French apostrophes.
                // Writes never peel an elision to update a different headword.
                // Keep the indexed lower(Term) path for unchanged Latin languages.
                var rows = await query.AsNoTracking().Select(w => new
                    { w.WordId, w.Term, w.Status, HasTranslation = w.Translation != null }).ToListAsync();
                var byExactKey = rows.GroupBy(w => Tokenizer.NormalizeKey(w.Term, language), StringComparer.Ordinal)
                    .ToDictionary(g => g.Key, g => g.OrderByDescending(w => w.Status > 0).ThenByDescending(w => w.HasTranslation)
                        .ThenBy(w => w.Term, StringComparer.Ordinal).ThenBy(w => w.WordId).First().WordId, StringComparer.Ordinal);
                var ids = new HashSet<int>();
                foreach (var k in keys)
                {
                    if (byExactKey.TryGetValue(k, out var exactId))
                        ids.Add(exactId);
                }
                query = query.Where(w => ids.Contains(w.WordId));
            }
            else query = query.Where(w => keys.Contains(w.Term.ToLower()));
            return await query.Include(w => w.Translation).OrderBy(w => w.WordId).ToListAsync();
        }

        // The status a batch term asks for: 1-6 (including Ignored), Known when left out.
        private static int RequestedStatus(NewTermDto termDto) =>
            termDto.Status is >= 1 and <= 6 ? termDto.Status.Value : 5;

        // GET: api/words/export?languageId=5&status=1,5
        [HttpGet("export")]
        public async Task<IActionResult> ExportWordsCsv(
            [FromQuery] int? languageId = null,
            [FromQuery] string? status = null,
            [FromQuery] string format = "simple")
        {
            var userId = GetUserId();
            if (format is not ("simple" or "context" or "anki"))
                return BadRequest(new { message = "Export format must be simple, context, or anki." });

            var query = _context.Words
                .AsNoTracking()
                .Where(w => w.UserId == userId);

            // Apply language filtering
            if (languageId.HasValue)
            {
                query = query.Where(w => w.LanguageId == languageId.Value);
            }

            // Apply status filtering
            if (!string.IsNullOrEmpty(status))
            {
                var statusList = status.Split(',')
                                       .Select(s => s.Trim())
                                       .Where(s => int.TryParse(s, out _))
                                       .Select(int.Parse)
                                       .ToList();
                if (statusList.Any())
                {
                    query = query.Where(w => statusList.Contains(w.Status));
                }
            }

            if (format != "simple")
            {
                // Scope every relationship, including source metadata. Terms without a
                // sentence survive the left join; another user's context never joins.
                var rows = await (
                    from word in query
                    join phrase in _context.SrsPhrases.AsNoTracking().Where(p => p.UserId == userId)
                        on word.WordId equals phrase.WordId into phrases
                    from phrase in phrases.DefaultIfEmpty()
                    join text in _context.Texts.AsNoTracking().Where(t => t.UserId == userId)
                        on phrase.TextId equals (int?)text.TextId into texts
                    from text in texts.DefaultIfEmpty()
                    join book in _context.Books.AsNoTracking().Where(b => b.UserId == userId)
                        on text.BookId equals (int?)book.BookId into books
                    from book in books.DefaultIfEmpty()
                    orderby word.Language.Name, word.Term, word.WordId, phrase.SrsPhraseId
                    select new VocabularyExportRow
                    {
                        WordId = word.WordId, LanguageId = word.LanguageId,
                        Term = word.Term, Translation = word.Translation != null ? word.Translation.Translation : null,
                        Status = word.Status, Language = word.Language.Name,
                        ContextId = phrase != null ? phrase.SrsPhraseId : null,
                        Context = phrase != null ? phrase.Sentence : null,
                        ContextCreatedAtUtc = phrase != null ? phrase.CreatedAt : null,
                        TextId = text != null ? text.TextId : null,
                        TextTitle = phrase != null && !string.IsNullOrWhiteSpace(phrase.TextTitle) ? phrase.TextTitle : text != null ? text.Title : null,
                        BookId = book != null ? book.BookId : null,
                        BookTitle = book != null ? book.Title : null,
                        SourceUrl = text != null ? text.SourceUrl : null
                    }).ToListAsync();
                var output = format == "anki" ? VocabularyExport.Anki(rows, userId) : VocabularyExport.ContextCsv(rows);
                return File(System.Text.Encoding.UTF8.GetBytes(format == "anki" ? output : "\uFEFF" + output), format == "anki" ? "text/plain" : "text/csv",
                    $"linguaread_{format}_{DateTime.UtcNow:yyyyMMddHHmmss}.{(format == "anki" ? "txt" : "csv")}");
            }

            // Default sort by Language then Term for consistent export.
            // Only the four exported columns are read, not whole Word/Translation/Language entities.
            var wordsToExport = await query
                .OrderBy(w => w.Language.Name).ThenBy(w => w.Term)
                .Select(w => new
                {
                    w.Term,
                    Translation = w.Translation != null ? w.Translation.Translation : null,
                    w.Status,
                    LanguageName = w.Language.Name
                })
                .ToListAsync();

            // Built in memory rather than streamed on purpose: a DB error part-way through a streamed
            // response would leave a truncated file behind a 200, and this file is a terms backup.
            var csvBuilder = new System.Text.StringBuilder();
            // Add header row
            csvBuilder.AppendLine("Term,Translation,Status,Language");

            foreach (var word in wordsToExport)
            {
                var termCsv = VocabularyExport.CsvCell(word.Term);
                var translationCsv = VocabularyExport.CsvCell(word.Translation ?? "");
                var statusCsv = word.Status.ToString();
                var languageCsv = VocabularyExport.CsvCell(word.LanguageName ?? "Unknown");

                csvBuilder.AppendLine($"{termCsv},{translationCsv},{statusCsv},{languageCsv}");
            }

            var csvBytes = System.Text.Encoding.UTF8.GetBytes("\uFEFF" + csvBuilder.ToString());
            var fileName = $"linguaread_terms_{DateTime.UtcNow:yyyyMMddHHmmss}.csv";

            return File(csvBytes, "text/csv", fileName);
        }



        private static DateTime WordEditTime(DateTimeOffset? clientUpdatedAt)
        {
            var now = DateTime.UtcNow;
            var time = clientUpdatedAt is { } client && client.UtcDateTime < now ? client.UtcDateTime : now;
            // PostgreSQL stores timestamps to microsecond precision. Comparing at that
            // precision lets an identical retry match its own committed write.
            return time.AddTicks(-(time.Ticks % 10));
        }

        private static string? NormalizeTranslationEdit(string? translation) =>
            translation != null && string.IsNullOrWhiteSpace(translation) ? "" : translation;

        private static DateTime? LatestWordEdit(Word word)
        {
            // Older rows only record creation and translation edits. A status-0
            // placeholder created by the linker is not a user edit.
            if (word.LastEditedAt.HasValue) return word.LastEditedAt;
            var lastTranslation = word.Translation?.UpdatedAt ?? word.Translation?.CreatedAt;
            return word.Status != 0 && (!lastTranslation.HasValue || word.CreatedAt > lastTranslation)
                ? word.CreatedAt : lastTranslation;
        }

        private static string WordRevision(Word word, DateTime? latest) =>
            $"{word.WordId:x}-{(latest ?? word.CreatedAt).Ticks:x}";

        private sealed record WordEdit(DateTime Revision, DateTime? StatusTime, DateTime? TranslationTime);

        private static DateTime AdvanceRevision(DateTime? previous, DateTime time) =>
            previous is { } revision && revision >= time ? revision.AddMicroseconds(1) : time;

        private static DateTime? LatestStatusEdit(Word word) => word.LastStatusEditedAt ?? word.LastEditedAt
            ?? word.LastManualStatusAt ?? (word.Status > 0 ? word.CreatedAt : null);

        private static DateTime? LatestTranslationEdit(Word word) => word.LastTranslationEditedAt
            ?? word.Translation?.UpdatedAt ?? word.Translation?.CreatedAt;

        private static void ApplyWordEdit(Word word, int status, WordEdit edit)
        {
            // Preserve the effective status clock before a first definition edit advances the row revision.
            if (!edit.StatusTime.HasValue) word.LastStatusEditedAt ??= LatestStatusEdit(word);
            word.Status = status;
            word.LastEditedAt = edit.Revision;
            if (edit.TranslationTime is { } translationTime && !(word.LastTranslationEditedAt >= translationTime))
                word.LastTranslationEditedAt = translationTime;
            if (edit.StatusTime is { } statusTime)
            {
                if (!(word.LastStatusEditedAt >= statusTime)) word.LastStatusEditedAt = statusTime;
                if (!(word.LastManualStatusAt >= statusTime)) word.LastManualStatusAt = statusTime;
            }
        }

        private static WordEdit? ResolveWordEdit(Word? word, string? expectedRevision, DateTime editedAt,
            int status, bool statusSelected, string? translation, DateTimeOffset? statusUpdatedAt, DateTimeOffset? translationUpdatedAt)
        {
            var latest = word == null ? null : LatestWordEdit(word);
            if (expectedRevision != null)
            {
                // An explicit decision applies only to the exact version the reader saw.
                if (word == null || expectedRevision != WordRevision(word, latest)) return null;
                var now = AdvanceRevision(latest, WordEditTime(null));
                return new(now, statusSelected ? now : null, translation == null ? null : now);
            }

            // The revision guards the row, while conflict detection follows the fields
            // this request actually edits (including the original times in a coalesced save).
            DateTime? statusTime = statusSelected ? EditFieldTime(statusUpdatedAt, editedAt) : null;
            DateTime? translationTime = translation == null ? null : EditFieldTime(translationUpdatedAt, editedAt);
            if (word != null)
            {
                var lastStatus = LatestStatusEdit(word);
                var lastTranslation = LatestTranslationEdit(word);
                var changesStatus = status != word.Status;
                var changesTranslation = translation != (word.Translation?.Translation ?? "");
                // An older coalesced field already at its intended value is a no-op.
                if (statusUpdatedAt.HasValue && !changesStatus && statusTime < lastStatus) statusTime = null;
                if (translationUpdatedAt.HasValue && !changesTranslation && translationTime < lastTranslation) translationTime = null;
                if (IsStaleFieldEdit(statusTime, lastStatus, changesStatus)
                    || IsStaleFieldEdit(translationTime, lastTranslation, changesTranslation)) return null;
            }
            return new(AdvanceRevision(latest, editedAt), statusTime, translationTime);
        }

        private static DateTime EditFieldTime(DateTimeOffset? fieldTime, DateTime editedAt) =>
            fieldTime is { } at && at.UtcDateTime < editedAt ? WordEditTime(at) : editedAt;

        private static bool IsStaleFieldEdit(DateTime? incoming, DateTime? current, bool changesValue) =>
            incoming is { } edit && current is { } saved && (edit < saved || (edit == saved && changesValue));

        private static WordResponseDto WordResponse(Word word, bool isNew) => new()
        {
            WordId = word.WordId,
            Term = word.Term,
            Status = word.Status,
            Translation = word.Translation?.Translation ?? "",
            CreatedAt = word.CreatedAt,
            IsNew = isNew
        };

        private ConflictObjectResult NewerWordConflict(Word word) => Conflict(new WordEditConflictDto
        {
            Message = "A newer edit of this word is already saved. Review it before retrying.",
            Word = WordResponse(word, word.Status == 1),
            Revision = WordRevision(word, LatestWordEdit(word))
        });

        private async Task<ActionResult> ReadWordConflictAsync(Guid userId, int wordId)
        {
            var word = await _context.Words.AsNoTracking().Include(w => w.Translation)
                .FirstOrDefaultAsync(w => w.UserId == userId && w.WordId == wordId);
            if (word == null) return NotFound();
            return NewerWordConflict(word);
        }

        // Track the translation so it is saved atomically with the guarded word and
        // SRS effects. Omission leaves it alone and explicit blank clears it.
        private void SetWordTranslation(Word word, string? translation)
        {
            if (translation == null || translation == (word.Translation?.Translation ?? "")) return;
            if (translation.Length == 0)
            {
                if (word.Translation != null) _context.WordTranslations.Remove(word.Translation);
                word.Translation = null!;
            }
            else if (word.Translation == null)
            {
                _context.WordTranslations.Add(new WordTranslation { Word = word, Translation = translation });
            }
            else
            {
                word.Translation.Translation = translation;
                word.Translation.UpdatedAt = DateTime.UtcNow;
            }
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

    } // End of Controller class

    public class AddTermsBatchResultDto
    {
        public string Message { get; set; } = string.Empty;
        // The batch's words as now stored, shaped like GET words/language returns them, so the
        // reader can update its word list without downloading the whole language again.
        public List<WordResponseDto> Words { get; set; } = new();
    }

    // DTO for the batch request
    public class AddTermBatchDto
    {
        [Required]
        public int LanguageId { get; set; }

        [Required]
        public List<NewTermDto> Terms { get; set; } = new List<NewTermDto>();

        // Leave the status of saved words alone and only fill in their translation. Off, an explicit
        // status is restored; without one, a word below Known is raised to Known. A status-0
        // row (linked but never saved) takes the term's status, like a new word.
        public bool KeepExistingStatus { get; set; }
    }

    // DTO for each term in the batch
    public class NewTermDto
    {
        [Required]
        [StringLength(100)]
        public string Term { get; set; } = string.Empty;

        public string? Translation { get; set; } // Translation is optional

        [Range(1, 6, ErrorMessage = "Status must be between 1 and 6.")]
        public int? Status { get; set; } // Status is optional
    }


    public class CreateWordDto
    {
        // Explicit saves/replay may replace a provisional word's complete edit.
        // Omitted/false retains the existing promotion-only create semantics.
        public bool ReplaceExisting { get; set; }
        public bool TranslationOnly { get; set; }
        public DateTimeOffset? StatusUpdatedAt { get; set; }
        [Required]
        public int TextId { get; set; }

        [Required]
        [StringLength(100)]
        public string Term { get; set; } = string.Empty;

        [Required]
        [Range(1, 6)]
        public int Status { get; set; }

        // Translation is optional (can be empty or null)
        public string? Translation { get; set; }

        public string? Sentence { get; set; }
        public DateTimeOffset? ClientUpdatedAt { get; set; }
        // Present when a newer status is carrying an earlier queued translation.
        public DateTimeOffset? TranslationUpdatedAt { get; set; }
        [StringLength(64)]
        public string? ExpectedRevision { get; set; }
    }

    public class UpdateWordDto
    {
        public bool TranslationOnly { get; set; }
        public DateTimeOffset? StatusUpdatedAt { get; set; }
        [Required]
        [Range(1, 6)]
        public int Status { get; set; }

        // Translation is optional (can be empty or null)
        public string? Translation { get; set; }

        // Optional reader example. Older status/translation-only callers remain valid.
        [Range(1, int.MaxValue)]
        public int? TextId { get; set; }
        public string? Sentence { get; set; }
        public DateTimeOffset? ClientUpdatedAt { get; set; }
        // Present when a newer status is carrying an earlier queued translation.
        public DateTimeOffset? TranslationUpdatedAt { get; set; }
        [StringLength(64)]
        public string? ExpectedRevision { get; set; }
    }

    public class WordEditConflictDto
    {
        public string Message { get; set; } = string.Empty;
        public WordResponseDto Word { get; set; } = new();
        public string Revision { get; set; } = string.Empty;
    }

    public class WordResponseDto
    {
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public int Status { get; set; }
        public string Translation { get; set; } = string.Empty;
        public bool IsNew { get; set; }
        public DateTime CreatedAt { get; set; }
        public List<TermSentenceDto> Sentences { get; set; } = new();
        public List<TermSourceDto> Sources { get; set; } = new();
    }

    public class TermSourceDto
    {
        public int? TextId { get; set; }
        public string? TextTitle { get; set; }
    }

    public class TermSentenceDto : TermSourceDto
    {
        public string Sentence { get; set; } = string.Empty;
    }
} // End of namespace
