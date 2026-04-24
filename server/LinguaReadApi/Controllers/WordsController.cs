using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using System.Linq; // Required for Count() on nullable collection
using System.Collections.Generic;
// using Microsoft.Extensions.Logging; // TODO: Inject ILogger later

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class WordsController : ControllerBase
    {
        private readonly AppDbContext _context;
        // private readonly ILogger<WordsController> _logger; // TODO: Inject ILogger later

        // TODO: Inject ILogger later
        public WordsController(AppDbContext context /*, ILogger<WordsController> logger*/)
        {
            _context = context;
            // _logger = logger;
        }

        // POST: api/words
        [HttpPost]
        public async Task<ActionResult<WordResponseDto>> CreateWord([FromBody] CreateWordDto createWordDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var userId = GetUserId();

            // Check if the text exists and belongs to the user
            var text = await _context.Texts
                .Include(t => t.Language)
                .FirstOrDefaultAsync(t => t.TextId == createWordDto.TextId && t.UserId == userId);

            if (text == null)
            {
                return NotFound("Text not found or does not belong to the user");
            }

            // Check if the word already exists for this user and language
            var existingWord = await _context.Words
                .Include(w => w.Translation)
                .FirstOrDefaultAsync(w =>
                    w.Term == createWordDto.Term &&
                    w.UserId == userId &&
                    w.LanguageId == text.LanguageId);

            if (existingWord != null)
            {
                // Create text-word relationship if it doesn't exist
                var existingTextWord = await _context.Set<TextWord>()
                    .FirstOrDefaultAsync(tw => tw.TextId == text.TextId && tw.WordId == existingWord.WordId);

                if (existingTextWord == null)
                {
                    _context.Set<TextWord>().Add(new TextWord
                    {
                        TextId = text.TextId,
                        WordId = existingWord.WordId,
                        CreatedAt = DateTime.UtcNow
                    });
                }

                // Update status if the new status is higher
                if (createWordDto.Status > existingWord.Status)
                {
                    existingWord.Status = createWordDto.Status;
                }

                var responseTranslation = existingWord.Translation?.Translation ?? "";

                // Update translation if provided and different or missing
                if (!string.IsNullOrEmpty(createWordDto.Translation))
                {
                    if (existingWord.Translation == null ||
                        createWordDto.Translation != existingWord.Translation.Translation)
                    {
                        await UpsertWordTranslationAsync(existingWord.WordId, createWordDto.Translation);
                        responseTranslation = createWordDto.Translation;
                    }
                }

                // Auto-mine sentence if provided
                if (!string.IsNullOrEmpty(createWordDto.Sentence))
                {
                    var existingPhrase = await _context.SrsPhrases
                        .FirstOrDefaultAsync(p => p.WordId == existingWord.WordId && p.Sentence == createWordDto.Sentence);
                    if (existingPhrase == null)
                    {
                        _context.SrsPhrases.Add(new SrsPhrase
                        {
                            WordId = existingWord.WordId,
                            UserId = userId,
                            Sentence = createWordDto.Sentence,
                            TextId = text.TextId,
                            TextTitle = text.Title,
                            CreatedAt = DateTime.UtcNow
                        });
                    }
                    if (createWordDto.Status < 5)
                    {
                        var existingCard = await _context.SrsCardReviews
                            .FirstOrDefaultAsync(scr => scr.WordId == existingWord.WordId && scr.UserId == userId);
                        if (existingCard == null)
                        {
                            _context.SrsCardReviews.Add(new SrsCardReview { WordId = existingWord.WordId, UserId = userId });
                        }
                    }
                }

                await _context.SaveChangesAsync();

                return Ok(new WordResponseDto
                {
                    WordId = existingWord.WordId,
                    Term = existingWord.Term,
                    Status = existingWord.Status,
                    Translation = responseTranslation,
                    IsNew = false
                });
            }

            // Create new word
            var word = new Word
            {
                Term = createWordDto.Term,
                Status = createWordDto.Status,
                UserId = userId,
                LanguageId = text.LanguageId,
                CreatedAt = DateTime.UtcNow
            };

            _context.Words.Add(word);
            // Save here to get the WordId for relationships
            await _context.SaveChangesAsync();

            // Create text-word relationship
            var textWord = new TextWord
            {
                TextId = text.TextId,
                WordId = word.WordId,
                CreatedAt = DateTime.UtcNow
            };
            _context.Set<TextWord>().Add(textWord);

            var responseTranslationForNewWord = "";
            // Create translation only if provided
            if (!string.IsNullOrEmpty(createWordDto.Translation))
            {
                await UpsertWordTranslationAsync(word.WordId, createWordDto.Translation);
                responseTranslationForNewWord = createWordDto.Translation;
            }

            // Auto-mine sentence if provided
            if (!string.IsNullOrEmpty(createWordDto.Sentence))
            {
                _context.SrsPhrases.Add(new SrsPhrase
                {
                    WordId = word.WordId,
                    UserId = userId,
                    Sentence = createWordDto.Sentence,
                    TextId = text.TextId,
                    TextTitle = text.Title,
                    CreatedAt = DateTime.UtcNow
                });

                if (createWordDto.Status < 5)
                {
                    _context.SrsCardReviews.Add(new SrsCardReview { WordId = word.WordId, UserId = userId });
                }
            }

            // Save relationships and potentially translation and SRS data
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetWord), new { id = word.WordId }, new WordResponseDto
            {
                WordId = word.WordId,
                Term = word.Term,
                Status = word.Status,
                Translation = responseTranslationForNewWord,
                IsNew = true
            });
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

            // Apply search term filtering (case-insensitive)
            if (!string.IsNullOrWhiteSpace(searchTerm))
            {
                var termLower = searchTerm.ToLower();
                query = query.Where(w => w.Term.ToLower().Contains(termLower) ||
                                       (w.Translation != null && w.Translation.Translation.ToLower().Contains(termLower)));
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
            [FromQuery] string? searchTerm = null) // Search term
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
                var termLower = searchTerm.ToLower();
                query = query.Where(w => w.Term.ToLower().Contains(termLower) ||
                                       (w.Translation != null && w.Translation.Translation.ToLower().Contains(termLower)));
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

        // PUT: api/words/5
        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateWord(int id, [FromBody] UpdateWordDto updateWordDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var userId = GetUserId();

            var word = await _context.Words
                .Include(w => w.Translation)
                .FirstOrDefaultAsync(w => w.WordId == id && w.UserId == userId);

            if (word == null)
            {
                return NotFound();
            }

            // Update word status
            word.Status = updateWordDto.Status;

            if (word.Status < 5)
            {
                var existingCard = await _context.SrsCardReviews
                    .FirstOrDefaultAsync(scr => scr.WordId == word.WordId && scr.UserId == userId);
                if (existingCard == null)
                {
                    _context.SrsCardReviews.Add(new SrsCardReview { WordId = word.WordId, UserId = userId });
                }
            }

            // Update translation only if provided
            if (updateWordDto.Translation != null) // Check if translation was provided in the request
            {
                await UpsertWordTranslationAsync(word.WordId, updateWordDto.Translation);
            }

            await _context.SaveChangesAsync();

            return NoContent();
        }

        // POST: api/words/batch
        [HttpPost("batch")]
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

            // Basic check if language exists
            var languageExists = await _context.Languages.AnyAsync(l => l.LanguageId == languageId);
            if (!languageExists)
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

            // Fetch existing words for this user and language efficiently
            var existingWords = await _context.Words
                .Include(w => w.Translation)
                .Where(w => w.UserId == userId && w.LanguageId == languageId)
                .ToListAsync();

            var wordsToCreate = new List<Word>();
            var translationsToUpsert = new List<(Word Word, string Translation)>();
            // Build a case-insensitive lookup for existing words
            var existingWordsLookup = new Dictionary<string, Word>(StringComparer.OrdinalIgnoreCase);
            foreach (var w in existingWords)
            {
                existingWordsLookup[w.Term.Trim()] = w;
            }

            foreach (var termDto in termsToAdd)
            {
                var trimmedTerm = termDto.Term?.Trim();
                if (string.IsNullOrWhiteSpace(trimmedTerm)) continue;

                if (existingWordsLookup.TryGetValue(trimmedTerm, out var existingWord))
                {
                    // Word exists - update status if needed
                    if (existingWord.Status < 5)
                    {
                        existingWord.Status = 5;
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
                    int initialStatus = (termDto.Status.HasValue && termDto.Status.Value >= 1 && termDto.Status.Value <= 5)
                        ? termDto.Status.Value
                        : 5;

                    var newWord = new Word
                    {
                        Term = trimmedTerm,
                        Status = initialStatus,
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
            try
            {
                var changedCount = await _context.SaveChangesAsync();
                foreach (var translationToUpsert in translationsToUpsert)
                {
                    await UpsertWordTranslationAsync(translationToUpsert.Word.WordId, translationToUpsert.Translation);
                }
                if (translationsToUpsert.Any() && !_context.Database.IsRelational())
                {
                    changedCount += await _context.SaveChangesAsync();
                }
                // Return a summary of actions or just success
                return Ok(new { Message = $"Batch processed. {changedCount} database changes saved." });
            }
            catch (DbUpdateException ex)
            {
                 // Log the detailed exception (Inject ILogger<WordsController> later)
                 // For now, using Console.WriteLine for immediate visibility
                 Console.WriteLine($"DbUpdateException saving batch terms: {ex.Message}");
                 if (ex.InnerException != null)
                 {
                    Console.WriteLine($"Inner Exception: {ex.InnerException.Message}");
                 }
                 // Log entries that might have caused the issue (if possible)
                 Console.WriteLine($"Entries involved: {ex.Entries?.Count()}");
                 return StatusCode(500, "An error occurred while saving the terms. Check logs for details.");
            }
            // Removed extra brace here if present
        }

        // GET: api/words/export?languageId=5&status=1,5
        [HttpGet("export")]
        public async Task<IActionResult> ExportWordsCsv(
            [FromQuery] int? languageId = null,
            [FromQuery] string? status = null) // Comma-separated list of statuses (e.g., "1,2,5")
        {
            var userId = GetUserId();

            var query = _context.Words
                .AsNoTracking() // Add AsNoTracking here
                .Where(w => w.UserId == userId)
                .Include(w => w.Translation)
                .Include(w => w.Language) // Include Language for the name
                .AsQueryable();

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

            // Default sort by Language then Term for consistent export
            query = query.OrderBy(w => w.Language.Name).ThenBy(w => w.Term);

            var wordsToExport = await query.ToListAsync();

            // Generate CSV content
            var csvBuilder = new System.Text.StringBuilder();
            // Add header row
            csvBuilder.AppendLine("Term,Translation,Status,Language");

            foreach (var word in wordsToExport)
            {
                var termCsv = EscapeCsvField(word.Term);
                var translationCsv = EscapeCsvField(word.Translation?.Translation ?? "");
                var statusCsv = word.Status.ToString();
                var languageCsv = EscapeCsvField(word.Language?.Name ?? "Unknown"); // Handle potential null language if needed

                csvBuilder.AppendLine($"{termCsv},{translationCsv},{statusCsv},{languageCsv}");
            }

            var csvBytes = System.Text.Encoding.UTF8.GetBytes(csvBuilder.ToString());
            var fileName = $"linguaread_terms_{DateTime.UtcNow:yyyyMMddHHmmss}.csv";

            return File(csvBytes, "text/csv", fileName);
        }

        // Helper method to escape CSV fields containing commas or quotes
        private string EscapeCsvField(string field)
        {
            if (string.IsNullOrEmpty(field)) return "";

            // If the field contains a comma, double quote, or newline, enclose it in double quotes
            if (field.Contains(',') || field.Contains('"') || field.Contains('\n') || field.Contains('\r'))
            {
                // Escape existing double quotes by doubling them
                var escapedField = field.Replace("\"", "\"\"");
                return $"\"{escapedField}\"";
            }
            return field;
        }

        private async Task UpsertWordTranslationAsync(int wordId, string translation)
        {
            var now = DateTime.UtcNow;

            if (_context.Database.IsRelational())
            {
                await _context.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO ""WordTranslations"" (""WordId"", ""Translation"", ""CreatedAt"", ""UpdatedAt"")
VALUES ({wordId}, {translation}, {now}, NULL)
ON CONFLICT (""WordId"") DO UPDATE
SET ""Translation"" = EXCLUDED.""Translation"",
    ""UpdatedAt"" = {now}");
                return;
            }

            var existingTranslation = await _context.WordTranslations.FindAsync(wordId);
            if (existingTranslation == null)
            {
                _context.WordTranslations.Add(new WordTranslation
                {
                    WordId = wordId,
                    Translation = translation,
                    CreatedAt = now
                });
                return;
            }

            existingTranslation.Translation = translation;
            existingTranslation.UpdatedAt = now;
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

    // DTO for the batch request
    public class AddTermBatchDto
    {
        [Required]
        public int LanguageId { get; set; }

        [Required]
        public List<NewTermDto> Terms { get; set; } = new List<NewTermDto>();
    }

    // DTO for each term in the batch
    public class NewTermDto
    {
        [Required]
        [StringLength(100)]
        public string Term { get; set; } = string.Empty;

        public string? Translation { get; set; } // Translation is optional

        [Range(1, 5, ErrorMessage = "Status must be between 1 and 5.")] // Add validation if status is provided
        public int? Status { get; set; } // Status is optional
    }


    public class CreateWordDto
    {
        [Required]
        public int TextId { get; set; }

        [Required]
        [StringLength(100)]
        public string Term { get; set; } = string.Empty;

        [Required]
        [Range(1, 5)]
        public int Status { get; set; }

        // Translation is optional (can be empty or null)
        public string? Translation { get; set; }

        public string? Sentence { get; set; }
    }

    public class UpdateWordDto
    {
        [Required]
        [Range(1, 5)]
        public int Status { get; set; }

        // Translation is optional (can be empty or null)
        public string? Translation { get; set; }
    }

    public class WordResponseDto
    {
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public int Status { get; set; }
        public string Translation { get; set; } = string.Empty;
        public bool IsNew { get; set; }
        public DateTime CreatedAt { get; set; }
    }
} // End of namespace