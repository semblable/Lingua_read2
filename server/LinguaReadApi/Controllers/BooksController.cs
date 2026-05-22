using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using System.ComponentModel.DataAnnotations;
using System.IO; // Added for file streams
using System.Globalization;
using System.Net;
using System.Data;
using System.Text; // Added for StreamReader encoding
using System.Text.Json;
using System.Text.RegularExpressions; // Added for Regex HTML stripping
using VersOne.Epub; // Added for EPUB parsing
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Utilities;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize] // Restore authorization
    public class BooksController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<BooksController> _logger;
        private readonly IHardcoverService? _hardcoverService;
        private readonly WordLinkingChannel? _wordLinkingChannel;
        private static readonly JsonSerializerOptions StructuredContentJsonOptions = new(JsonSerializerDefaults.Web)
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        public BooksController(AppDbContext context, ILogger<BooksController> logger, IHardcoverService? hardcoverService = null, WordLinkingChannel? wordLinkingChannel = null)
        {
            _context = context;
            _logger = logger;
            _hardcoverService = hardcoverService;
            _wordLinkingChannel = wordLinkingChannel;
        }

        /// <summary>
        /// Queue every text in <paramref name="texts"/> for background
        /// word-linking. Matches the pattern TextsController uses for
        /// audio lessons. Without this, new books wait until the next
        /// app restart for WordLinkingMigrationService to catch them —
        /// which is why imported books showed no "% new" indicator
        /// until the service was restarted.
        /// </summary>
        private async Task QueueWordLinking(IEnumerable<Text> texts, Guid userId)
        {
            if (_wordLinkingChannel == null) return;
            foreach (var text in texts)
            {
                if (string.IsNullOrWhiteSpace(text.Content)) continue;
                text.WordLinkingStatus = "processing";
                await _wordLinkingChannel.Writer.WriteAsync(
                    new WordLinkingRequest(text.TextId, text.Content, text.LanguageId, userId));
            }
            await _context.SaveChangesAsync();
        }

        // GET: api/books
        [HttpGet]
        public async Task<ActionResult<IEnumerable<BookDto>>> GetBooks()
        {
            var userId = GetUserId();
            
            var books = await _context.Books
                .Where(b => b.UserId == userId)
                .Include(b => b.Language)
                .Include(b => b.BookTags) // Include BookTags join entities
                    .ThenInclude(bt => bt.Tag) // Then include the actual Tag entities
                .Select(b => new BookDto
                {
                    BookId = b.BookId,
                    Title = b.Title,
                    Description = b.Description,
                    Author = b.Author,
                    Isbn13 = b.Isbn13,
                    Publisher = b.Publisher,
                    ReleaseDate = b.ReleaseDate,
                    PageCount = b.PageCount,
                    LanguageName = b.Language.Name,
                    CreatedAt = b.CreatedAt,
                    PartCount = b.Texts.Count,
                    FinishedPartCount = b.Texts.Count(t => t.IsFinished),
                    LastReadTextId = b.LastReadTextId,
                    LastReadAt = b.LastReadAt,
                    TotalWords = b.TotalWords,
                    KnownWords = b.KnownWords,
                    LearningWords = b.LearningWords,
                    StatsUpdatedAt = b.StatsUpdatedAt,
                    IsFinished = b.IsFinished,
                    CoverImagePath = b.CoverImagePath,
                    HardcoverBookId = b.HardcoverBookId,
                    HardcoverEditionId = b.HardcoverEditionId,
                    HardcoverSlug = b.HardcoverSlug,
                    HardcoverUserBookId = b.HardcoverUserBookId,
                    HardcoverMatchedAt = b.HardcoverMatchedAt,
                    HardcoverLastSyncedAt = b.HardcoverLastSyncedAt,
                    Tags = b.BookTags.Select(bt => bt.Tag.Name).ToList(), // Map Tag names
                    FolderId = b.FolderId,
                    SortOrder = b.SortOrder
                })
                .ToListAsync();
                
            return books;
        }

        // GET: api/books/5
        [HttpGet("{id}")]
        public async Task<ActionResult<BookDetailDto>> GetBook(int id)
        {
            var userId = GetUserId();
            
            var book = await _context.Books
                .Where(b => b.BookId == id && b.UserId == userId)
                .Include(b => b.Language)
                .Include(b => b.Texts)
                .Include(b => b.BookTags) // Include BookTags
                    .ThenInclude(bt => bt.Tag) // Then include Tags
                .Include(b => b.AudiobookTracks) // Include AudiobookTracks
                .AsSplitQuery()
                .FirstOrDefaultAsync();
                
            if (book == null)
            {
                return NotFound();
            }
            
            var bookDetail = new BookDetailDto
            {
                BookId = book.BookId,
                Title = book.Title,
                Description = book.Description,
                Author = book.Author,
                Isbn13 = book.Isbn13,
                Publisher = book.Publisher,
                ReleaseDate = book.ReleaseDate,
                PageCount = book.PageCount,
                LanguageName = book.Language.Name,
                LanguageId = book.LanguageId,
                CreatedAt = book.CreatedAt,
                LastReadTextId = book.LastReadTextId,
                CoverImagePath = book.CoverImagePath,
                HardcoverBookId = book.HardcoverBookId,
                HardcoverEditionId = book.HardcoverEditionId,
                HardcoverSlug = book.HardcoverSlug,
                HardcoverUserBookId = book.HardcoverUserBookId,
                HardcoverMatchedAt = book.HardcoverMatchedAt,
                HardcoverLastSyncedAt = book.HardcoverLastSyncedAt,
                TotalWords = book.TotalWords,
                KnownWords = book.KnownWords,
                LearningWords = book.LearningWords,
                StatsUpdatedAt = book.StatsUpdatedAt,
                Parts = book.Texts.OrderBy(t => t.PartNumber).Select(t => new TextPartDto
                {
                    TextId = t.TextId,
                    Title = t.Title,
                    PartNumber = t.PartNumber ?? 0,
                    CreatedAt = t.CreatedAt,
                    IsFinished = t.IsFinished,
                    TotalWords = t.TotalWords,
                    KnownWords = t.KnownWords,
                    StatsUpdatedAt = t.StatsUpdatedAt
                }).ToList(),
                Tags = book.BookTags.Select(bt => new TagDto // Map Tags to TagDto
                {
                    TagId = bt.TagId,
                    Name = bt.Tag.Name
                }).ToList(),
                AudiobookTracks = book.AudiobookTracks.OrderBy(at => at.TrackNumber).Select(at => new AudiobookTrackDto
                {
                    TrackId = at.Id,
                    FilePath = at.FilePath, // Assuming FilePath is relative and web-accessible
                    TrackNumber = at.TrackNumber,
                    Duration = at.Duration
                }).ToList()
            };
            
            return bookDetail;
        }

        // POST: api/books
        [HttpPost]
        public async Task<ActionResult<BookDto>> CreateBook([FromBody] CreateBookDto createBookDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var userId = GetUserId();

            // Check if language exists
            var languageExists = await _context.Languages.AnyAsync(l => l.LanguageId == createBookDto.LanguageId);
            if (!languageExists)
            {
                return BadRequest("Invalid language ID");
            }

            // 1. Create Book entity (don't save yet)
            var book = new Book
            {
                Title = createBookDto.Title,
                Description = createBookDto.Description,
                LanguageId = createBookDto.LanguageId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow
            };

            // 2. Process Tags
            var tagsToAssociate = new List<Tag>();
            var newTagsToCreate = new List<Tag>();
            if (createBookDto.Tags != null && createBookDto.Tags.Any())
            {
                var distinctNormalizedTags = createBookDto.Tags
                    .Select(t => t.Trim().ToLowerInvariant()) // Normalize: trim, lowercase
                    .Where(t => !string.IsNullOrEmpty(t))    // Filter out empty tags
                    .Distinct()                              // Ensure uniqueness
                    .ToList();

                if (distinctNormalizedTags.Any())
                {
                    var existingTags = await _context.Tags
                        .Where(t => distinctNormalizedTags.Contains(t.Name.ToLower()))
                        .ToListAsync();

                    tagsToAssociate.AddRange(existingTags);

                    var existingTagNames = existingTags.Select(t => t.Name.ToLowerInvariant()).ToList();
                    var tagsToCreateNames = distinctNormalizedTags.Except(existingTagNames).ToList();

                    foreach (var tagName in tagsToCreateNames)
                    {
                        // Check length constraint before creating
                        if (tagName.Length <= 50) // Match StringLength(50) in Tag model
                        {
                            var newTag = new Tag { Name = tagName }; // Store original casing or decide on a standard
                            newTagsToCreate.Add(newTag);
                            tagsToAssociate.Add(newTag); // Add to the list for association
                        }
                        else
                        {
                            // Optionally handle tags that are too long (e.g., log, skip, return error)
                            // For now, we'll just skip them to avoid database errors
                            _logger.LogWarning("Skipping tag '{TagName}' because it exceeds the maximum length of 50 characters.", tagName);
                        }
                    }
                }
            }

            // 3. Add Book and New Tags to Context
            await using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                _context.Books.Add(book);
                if (newTagsToCreate.Any())
                {
                    _context.Tags.AddRange(newTagsToCreate);
                }

                // 4. Save Book and New Tags (Gets BookId and TagIds)
                await _context.SaveChangesAsync();

                // 5. Create BookTag Associations
                if (tagsToAssociate.Any())
                {
                    foreach (var tag in tagsToAssociate)
                    {
                        // Ensure the tag has an ID (it should after the previous SaveChanges)
                        if (tag.TagId > 0)
                        {
                             _context.BookTags.Add(new BookTag { BookId = book.BookId, TagId = tag.TagId });
                        }
                        else
                        {
                            _logger.LogWarning("Could not associate tag '{TagName}' as it might have been skipped or failed to save.", tag.Name);
                        }
                    }
                    // 6. Save Associations
                    await _context.SaveChangesAsync();
                }

                // 7. Create initial text parts (Existing Logic)
                var createdTexts = new List<Text>();
                if (!string.IsNullOrEmpty(createBookDto.Content))
                {
                    var textParts = SplitContent(createBookDto.Content, createBookDto.SplitMethod, createBookDto.MaxSegmentSize);
                    for (int i = 0; i < textParts.Count; i++)
                    {
                        var text = new Text
                        {
                            Title = $"{book.Title} - Part {i + 1}",
                            Content = textParts[i],
                            LanguageId = book.LanguageId,
                            UserId = userId,
                            BookId = book.BookId,
                            PartNumber = i + 1,
                            CreatedAt = DateTime.UtcNow
                        };
                        _context.Texts.Add(text);
                        createdTexts.Add(text);
                    }
                    await _context.SaveChangesAsync(); // Save Texts
                }

                await transaction.CommitAsync();

                // Kick off background word-linking now that TextIds exist.
                // WordLinkingBackgroundService pulses StatsRecomputeService
                // ~15s after the last text finishes, so the % indicator
                // appears without waiting for the nightly sweep or a restart.
                await QueueWordLinking(createdTexts, userId);
            }
            catch (DbUpdateException ex)
            {
                _logger.LogError(ex, "Database error creating book '{Title}' for user {UserId}", createBookDto.Title, userId);
                return StatusCode(500, "A database error occurred while creating the book.");
            }

            // 8. Prepare Response DTO
            var language = await _context.Languages.FindAsync(book.LanguageId);
            var bookDto = new BookDto
            {
                BookId = book.BookId,
                Title = book.Title,
                Description = book.Description,
                LanguageName = language?.Name ?? "Unknown",
                CreatedAt = book.CreatedAt,
                PartCount = await _context.Texts.CountAsync(t => t.BookId == book.BookId), // Recalculate or use count from loop
                LastReadTextId = null,
                LastReadAt = null,
                TotalWords = 0, // Stats will be calculated later
                KnownWords = 0,
                LearningWords = 0,
                Tags = tagsToAssociate.Select(t => t.Name).ToList() // Populate Tags for response
            };

            // 9. Return Response
            return CreatedAtAction(nameof(GetBook), new { id = book.BookId }, bookDto);
        }

        // POST: api/books/upload
        [HttpPost("upload")]
        [RequestSizeLimit(500L * 1024 * 1024)] // Increased to 500MB
        [RequestFormLimits(MultipartBodyLengthLimit = 500L * 1024 * 1024)]
        public async Task<ActionResult<BookDto>> UploadBook([FromForm] UploadBookDto uploadDto)
        {
            if (uploadDto.File == null || uploadDto.File.Length == 0)
            {
                return BadRequest("No file uploaded.");
            }
            // Basic check for allowed extensions
            var allowedExtensions = new[] { ".txt", ".epub" };
            var fileExtension = Path.GetExtension(uploadDto.File.FileName)?.ToLowerInvariant();
            if (string.IsNullOrEmpty(fileExtension) || !allowedExtensions.Contains(fileExtension))
            {
                 return BadRequest("Unsupported file type. Please upload .epub or .txt files.");
            }


            var userId = GetUserId();

            // Check if language exists
            var languageExists = await _context.Languages.AnyAsync(l => l.LanguageId == uploadDto.LanguageId);
            if (!languageExists)
            {
                return BadRequest("Invalid language ID.");
            }

            string bookTitle = uploadDto.TitleOverride ?? "Untitled Upload";
            string bookContent = string.Empty;
            string? bookDescription = null;
            EpubBook? epubBook = null;
            string sourceFileStem = Path.GetFileNameWithoutExtension(uploadDto.File.FileName);

            // --- File Processing ---
            try
            {
                using var stream = uploadDto.File.OpenReadStream();

                if (fileExtension == ".epub")
                {
                    epubBook = await VersOne.Epub.EpubReader.ReadBookAsync(stream);
                    bookTitle = uploadDto.TitleOverride ?? epubBook.Title ?? sourceFileStem;
                    var normalizedDescription = NormalizeEpubHtmlToText(epubBook.Description ?? string.Empty);
                    bookDescription = string.IsNullOrWhiteSpace(normalizedDescription)
                        ? $"Uploaded from {uploadDto.File.FileName}"
                        : normalizedDescription;
                }
                else
                {
                    bookTitle = uploadDto.TitleOverride ?? sourceFileStem;
                    using (var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
                    {
                        bookContent = await reader.ReadToEndAsync();
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing uploaded file '{FileName}'", uploadDto.File.FileName);
                return StatusCode(StatusCodes.Status500InternalServerError, "Error processing uploaded file.");
            }

            if (fileExtension != ".epub" && string.IsNullOrWhiteSpace(bookContent))
            {
                 return BadRequest("Could not extract readable content from the uploaded file.");
            }

            // --- Book and Tag Creation (Similar to CreateBook) ---

            // 1. Create Book entity
            var book = new Book
            {
                Title = bookTitle.Length > 200 ? bookTitle.Substring(0, 200) : bookTitle, // Ensure title fits DB constraint
                Description = (bookDescription ?? $"Uploaded from {uploadDto.File.FileName}").Length > 1000
                    ? (bookDescription ?? $"Uploaded from {uploadDto.File.FileName}").Substring(0, 1000)
                    : (bookDescription ?? $"Uploaded from {uploadDto.File.FileName}"),
                LanguageId = uploadDto.LanguageId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow
            };

            // 2. Process Tags
            var tagsToAssociate = new List<Tag>();
            var newTagsToCreate = new List<Tag>();
            if (uploadDto.Tags != null && uploadDto.Tags.Any())
            {
                var distinctNormalizedTags = uploadDto.Tags
                    .Select(t => t.Trim().ToLowerInvariant())
                    .Where(t => !string.IsNullOrEmpty(t))
                    .Distinct()
                    .ToList();

                if (distinctNormalizedTags.Any())
                {
                    var existingTags = await _context.Tags
                        .Where(t => distinctNormalizedTags.Contains(t.Name.ToLower()))
                        .ToListAsync();
                    tagsToAssociate.AddRange(existingTags);

                    var existingTagNames = existingTags.Select(t => t.Name.ToLowerInvariant()).ToList();
                    var tagsToCreateNames = distinctNormalizedTags.Except(existingTagNames).ToList();

                    foreach (var tagName in tagsToCreateNames)
                    {
                        if (tagName.Length <= 50)
                        {
                            var newTag = new Tag { Name = tagName };
                            newTagsToCreate.Add(newTag);
                            tagsToAssociate.Add(newTag);
                        } else {
                             _logger.LogWarning("Skipping tag '{TagName}' during upload because it exceeds the maximum length of 50 characters.", tagName);
                             // Optionally add to ModelState or return BadRequest
                        }
                    }
                }
            }

            // 3. Add Book and New Tags
            _context.Books.Add(book);
            if (newTagsToCreate.Any())
            {
                _context.Tags.AddRange(newTagsToCreate);
            }

            // 4. Save Book and New Tags (Gets IDs)
            try
            {
                await _context.SaveChangesAsync();
                CleanupBookAssets(userId, book.BookId);
            }
            catch (DbUpdateException ex)
            {
                 _logger.LogError(ex, "Error saving book/new tags during upload");
                 return StatusCode(StatusCodes.Status500InternalServerError, "Error saving book metadata.");
            }


            // 5. Create BookTag Associations
            if (tagsToAssociate.Any())
            {
                foreach (var tag in tagsToAssociate)
                {
                     // Ensure tag has an ID (it should have one after the save above)
                     if (tag.TagId > 0) {
                         _context.BookTags.Add(new BookTag { BookId = book.BookId, TagId = tag.TagId });
                     } else {
                         // This might happen if a new tag failed to save for some reason
                         _logger.LogWarning("Could not associate tag '{TagName}' during upload as it lacks an ID.", tag.Name);
                     }
                }
                // 6. Save Associations
                 try
                 {
                    await _context.SaveChangesAsync();
                 }
                 catch (DbUpdateException ex)
                 {
                     _logger.LogError(ex, "Error saving book tag associations during upload");
                     // Consider if this error is critical enough to stop; maybe just log and continue
                 }
            }

            // --- Text Splitting and Creation ---
            int partCount = 0;
            var createdTexts = new List<Text>();
            try
            {
                if (epubBook != null)
                {
                    var importResult = BuildStructuredEpubImport(
                        epubBook,
                        book.Title,
                        sourceFileStem,
                        userId,
                        book.BookId,
                        uploadDto.SplitMethod,
                        uploadDto.MaxSegmentSize);

                    if (string.IsNullOrWhiteSpace(importResult.PlainText))
                    {
                        CleanupBookAssets(userId, book.BookId);
                        _context.Books.Remove(book);
                        await _context.SaveChangesAsync();
                        return BadRequest("Could not extract readable content from the uploaded EPUB.");
                    }

                    book.CoverImagePath = importResult.CoverImagePath;
                    partCount = importResult.Parts.Count;

                    for (int i = 0; i < importResult.Parts.Count; i++)
                    {
                        var part = importResult.Parts[i];
                        var text = new Text
                        {
                            Title = $"{book.Title} - Part {i + 1}",
                            Content = part.PlainText,
                            StructuredContent = JsonSerializer.Serialize(part.Blocks, StructuredContentJsonOptions),
                            LanguageId = book.LanguageId,
                            UserId = userId,
                            BookId = book.BookId,
                            PartNumber = i + 1,
                            CreatedAt = DateTime.UtcNow
                        };
                        _context.Texts.Add(text);
                        createdTexts.Add(text);
                    }
                }
                else
                {
                    var textParts = SplitContent(bookContent, uploadDto.SplitMethod, uploadDto.MaxSegmentSize);
                    partCount = textParts.Count;
                    for (int i = 0; i < textParts.Count; i++)
                    {
                        var text = new Text
                        {
                            Title = $"{book.Title} - Part {i + 1}",
                            Content = textParts[i],
                            StructuredContent = null,
                            LanguageId = book.LanguageId,
                            UserId = userId,
                            BookId = book.BookId,
                            PartNumber = i + 1,
                            CreatedAt = DateTime.UtcNow
                        };
                        _context.Texts.Add(text);
                        createdTexts.Add(text);
                    }
                }
                await _context.SaveChangesAsync(); // Save Texts

                // Kick off background word-linking now that TextIds exist.
                // WordLinkingBackgroundService pulses StatsRecomputeService
                // ~15s after the last text finishes, so the % indicator
                // appears without waiting for the nightly sweep or a restart.
                await QueueWordLinking(createdTexts, userId);
            }
            catch (Exception ex)
            {
                 _logger.LogError(ex, "Error splitting or saving text parts during upload");
                 CleanupBookAssets(userId, book.BookId);
                 _context.Books.Remove(book); // Attempt to clean up book if text splitting fails
                 await _context.SaveChangesAsync();
                 return StatusCode(StatusCodes.Status500InternalServerError, "Book metadata created, but failed to process and save text content.");
            }


            // --- Prepare Response ---
            var language = await _context.Languages.FindAsync(book.LanguageId); // Re-fetch language just in case
            var bookDto = new BookDto
            {
                BookId = book.BookId,
                Title = book.Title,
                Description = book.Description,
                LanguageName = language?.Name ?? "Unknown",
                CreatedAt = book.CreatedAt,
                PartCount = partCount, // Use calculated part count
                LastReadTextId = null,
                LastReadAt = null,
                TotalWords = 0, // Stats calculated later
                KnownWords = 0,
                LearningWords = 0,
                CoverImagePath = book.CoverImagePath,
                Tags = tagsToAssociate.Select(t => t.Name).ToList() // Use names from processed tags
            };

            return CreatedAtAction(nameof(GetBook), new { id = book.BookId }, bookDto);
        }

        // Explicit OPTIONS handler for CORS preflight debugging
        [HttpOptions("{bookId}/audiobook")]
        [AllowAnonymous] // Allow preflight requests without authentication
        public IActionResult UploadAudiobookOptions(int bookId)
        {
            // The CORS middleware should add the necessary headers.
            // This action just needs to return Ok() to signal the OPTIONS request is allowed.
            return Ok();
        }

        // POST: api/books/{bookId}/audiobook
        [HttpPost("{bookId}/audiobook")]
        [RequestSizeLimit(5120L * 1024 * 1024)] // Increased to 5GB
        [RequestFormLimits(MultipartBodyLengthLimit = 5120L * 1024 * 1024)] // Increased to 5GB
        public async Task<IActionResult> UploadAudiobook(int bookId, [FromForm] UploadAudiobookDto uploadDto)
        {
            if (uploadDto.Files == null || !uploadDto.Files.Any())
            {
                return BadRequest("No audio files uploaded.");
            }

            var userId = GetUserId();

            // 1. Verify book exists and belongs to user
            var book = await _context.Books
                                     .Include(b => b.AudiobookTracks) // Include existing tracks
                                     .FirstOrDefaultAsync(b => b.BookId == bookId && b.UserId == userId);
            if (book == null)
            {
                return NotFound("Book not found or access denied.");
            }

            // 2. Define storage path
            // Use a subfolder within wwwroot, e.g., wwwroot/audiobooks/{bookId}
            // Ensure IWebHostEnvironment is injected if needed for path resolution, or construct path manually.
            // For simplicity here, assuming relative path from wwwroot. Needs refinement for production.
            var relativeBookAudioPath = Path.Combine("audiobooks", bookId.ToString());
            var absoluteBookAudioPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", relativeBookAudioPath); // Adjust if wwwroot isn't the base

            // Ensure the directory exists
            Directory.CreateDirectory(absoluteBookAudioPath);

            // 3. Process uploaded files
            var addedTracks = new List<AudiobookTrack>();
            var savedFilePaths = new List<string>();
            int currentMaxTrackNumber = book.AudiobookTracks.Any() ? book.AudiobookTracks.Max(t => t.TrackNumber) : 0;
            var allowedAudioExtensions = new HashSet<string> { ".mp3", ".m4b", ".m4a", ".ogg", ".flac", ".wav" };

            try
            {
                foreach (var file in uploadDto.Files)
                {
                    if (file.Length == 0) continue;

                    var fileExtension = Path.GetExtension(file.FileName)?.ToLowerInvariant();
                    if (string.IsNullOrEmpty(fileExtension) || !allowedAudioExtensions.Contains(fileExtension))
                    {
                        _logger.LogWarning("Skipping unsupported audio file: {FileName}", file.FileName);
                        continue;
                    }

                    currentMaxTrackNumber++;
                    var trackNumber = currentMaxTrackNumber;
                    var safeFileName = $"track_{trackNumber}{fileExtension}";
                    var relativeFilePath = Path.Combine(relativeBookAudioPath, safeFileName);
                    var absoluteFilePath = Path.Combine(absoluteBookAudioPath, safeFileName);

                    savedFilePaths.Add(absoluteFilePath);
                    using (var stream = new FileStream(absoluteFilePath, FileMode.Create))
                    {
                        await file.CopyToAsync(stream);
                    }

                    var newTrack = new AudiobookTrack
                    {
                        BookId = bookId,
                        FilePath = relativeFilePath.Replace('\\', '/'),
                        TrackNumber = trackNumber,
                        Duration = null
                    };
                    addedTracks.Add(newTrack);
                }

                if (!addedTracks.Any())
                {
                    return BadRequest("No valid audio files were processed. Supported formats: MP3, M4B, M4A, OGG, FLAC, WAV.");
                }

                // 4. Add new tracks to context and save
                _context.AudiobookTracks.AddRange(addedTracks);
                await _context.SaveChangesAsync();

                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during audiobook upload for book {BookId}. Cleaning up {FileCount} saved files.", bookId, savedFilePaths.Count);

                // Clean up any files written during this request
                foreach (var filePath in savedFilePaths)
                {
                    try { System.IO.File.Delete(filePath); }
                    catch (Exception deleteEx) { _logger.LogWarning(deleteEx, "Failed to clean up file: {FilePath}", filePath); }
                }

                return StatusCode(StatusCodes.Status500InternalServerError, "Failed to save audiobook tracks. Please try again.");
            }
        }

        // Helper method to split content into parts
        private static List<string> SplitContent(string content, string splitMethod, int maxSegmentSize)
        {
            var result = new List<string>();
            
            switch (splitMethod.ToLower())
            {
                case "paragraph":
                    // Split by paragraphs
                    var paragraphs = Regex.Split(content, @"\r?\n\s*\r?\n+")
                        .Where(p => !string.IsNullOrWhiteSpace(p))
                        .ToArray();
                    
                    // Group paragraphs to respect max size
                    var currentPart = new List<string>();
                    int currentCharCount = 0;
                    
                    foreach (var para in paragraphs)
                    {
                        if (currentCharCount + para.Length > maxSegmentSize && currentPart.Count > 0)
                        {
                            // This paragraph would exceed max size, save current part and start a new one
                            result.Add(string.Join("\n\n", currentPart));
                            currentPart.Clear();
                            currentCharCount = 0;
                        }
                        
                        currentPart.Add(para);
                        currentCharCount += para.Length + 2; // +2 for newlines
                    }
                    
                    // Add the last part if it contains paragraphs
                    if (currentPart.Count > 0)
                    {
                        result.Add(string.Join("\n\n", currentPart));
                    }
                    break;
                    
                case "sentence":
                    // Split by sentences (roughly)
                    var sentences = System.Text.RegularExpressions.Regex.Split(content, @"(?<=[.!?])\s+")
                        .Where(s => !string.IsNullOrWhiteSpace(s))
                        .ToList();
                    
                    // Group sentences to respect max size
                    currentPart = new List<string>();
                    currentCharCount = 0;
                    
                    foreach (var sentence in sentences)
                    {
                        if (currentCharCount + sentence.Length > maxSegmentSize && currentPart.Count > 0)
                        {
                            // This sentence would exceed max size, save current part and start a new one
                            result.Add(string.Join(" ", currentPart));
                            currentPart.Clear();
                            currentCharCount = 0;
                        }
                        
                        currentPart.Add(sentence);
                        currentCharCount += sentence.Length + 1; // +1 for space
                    }
                    
                    // Add the last part if it contains sentences
                    if (currentPart.Count > 0)
                    {
                        result.Add(string.Join(" ", currentPart));
                    }
                    break;
                    
                case "length":
                default:
                    // Split by fixed character length
                    for (int i = 0; i < content.Length; i += maxSegmentSize)
                    {
                        var length = Math.Min(maxSegmentSize, content.Length - i);
                        
                        // Try to find a good breaking point (space, punctuation)
                        if (i + length < content.Length)
                        {
                            // Look for a space or punctuation within the last 20% of the segment
                            int searchStart = i + (int)(length * 0.8);
                            int searchEnd = i + length - 1;
                            int searchLength = searchEnd - searchStart + 1;
                            int breakPoint = searchLength > 0
                                ? content.LastIndexOfAny(new[] { ' ', '.', '!', '?', '\n' }, searchEnd, searchLength)
                                : -1;

                            if (breakPoint >= searchStart)
                            {
                                length = breakPoint - i + 1;
                            }
                        }
                        
                        result.Add(content.Substring(i, length));
                    }
                    break;
            }
            
            return result;
        }

        private static StructuredEpubImportResult BuildStructuredEpubImport(
            EpubBook epubBook,
            string? bookTitle,
            string? sourceFileStem,
            Guid userId,
            int bookId,
            string splitMethod,
            int maxSegmentSize)
        {
            var artifactKeys = BuildEpubArtifactKeys(bookTitle, sourceFileStem);
            var relativeAssetRoot = Path.Combine("epub_assets", userId.ToString(), bookId.ToString()).Replace('\\', '/');
            var absoluteAssetRoot = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "epub_assets", userId.ToString(), bookId.ToString());
            Directory.CreateDirectory(absoluteAssetRoot);

            var extractionContext = new EpubExtractionContext(epubBook, absoluteAssetRoot, relativeAssetRoot);
            var extractedBlocks = new List<ReaderContentBlock>();
            string? coverImagePath = SaveEpubCoverImage(extractionContext);

            foreach (EpubLocalTextContentFile textFile in epubBook.ReadingOrder)
            {
                extractedBlocks.AddRange(ExtractStructuredBlocksFromHtml(textFile, artifactKeys, extractionContext));
            }

            var filteredBlocks = FilterIgnorableArtifactBlocks(extractedBlocks, artifactKeys);
            if (string.IsNullOrWhiteSpace(coverImagePath))
            {
                coverImagePath = filteredBlocks
                    .FirstOrDefault(block => string.Equals(block.Type, ReaderContentBlockTypes.Image, StringComparison.OrdinalIgnoreCase))
                    ?.ImageUrl;
            }

            var parts = SplitStructuredContent(filteredBlocks, splitMethod, maxSegmentSize);
            var plainText = string.Join("\n\n", parts.Select(part => part.PlainText).Where(part => !string.IsNullOrWhiteSpace(part)));
            return new StructuredEpubImportResult(parts, plainText, coverImagePath);
        }

        private static IEnumerable<ReaderContentBlock> ExtractStructuredBlocksFromHtml(
            EpubLocalTextContentFile textFile,
            HashSet<string> artifactKeys,
            EpubExtractionContext extractionContext)
        {
            if (string.IsNullOrWhiteSpace(textFile.Content))
            {
                return Enumerable.Empty<ReaderContentBlock>();
            }

            var normalizedHtml = textFile.Content;
            normalizedHtml = Regex.Replace(normalizedHtml, @"<!--.*?-->", string.Empty, RegexOptions.Singleline);
            normalizedHtml = Regex.Replace(normalizedHtml, @"<(script|style)\b[^>]*>.*?</\1>", string.Empty, RegexOptions.Singleline | RegexOptions.IgnoreCase);

            var blocks = new List<ReaderContentBlock>();
            var textBuffer = new StringBuilder();
            var tokenMatches = Regex.Matches(normalizedHtml, @"<img\b[^>]*>|</?[^>]+>|[^<]+", RegexOptions.IgnoreCase);
            bool inHeading = false;
            bool inCaption = false;

            foreach (Match match in tokenMatches)
            {
                var token = match.Value;
                if (string.IsNullOrEmpty(token))
                {
                    continue;
                }

                if (token[0] != '<')
                {
                    textBuffer.Append(WebUtility.HtmlDecode(token));
                    continue;
                }

                if (Regex.IsMatch(token, @"^<br\s*/?>$", RegexOptions.IgnoreCase))
                {
                    textBuffer.Append('\n');
                    continue;
                }

                if (Regex.IsMatch(token, @"^<img\b", RegexOptions.IgnoreCase))
                {
                    FlushBufferedText(blocks, textBuffer, inHeading ? ReaderContentBlockTypes.Title : ReaderContentBlockTypes.Paragraph);
                    var imageBlock = TryCreateImageBlock(token, textFile, extractionContext);
                    if (imageBlock != null)
                    {
                        blocks.Add(imageBlock);
                    }
                    continue;
                }

                if (Regex.IsMatch(token, @"^<h[1-6]\b", RegexOptions.IgnoreCase))
                {
                    FlushBufferedText(blocks, textBuffer, ReaderContentBlockTypes.Paragraph);
                    inHeading = true;
                    continue;
                }

                if (Regex.IsMatch(token, @"^</h[1-6]\s*>$", RegexOptions.IgnoreCase))
                {
                    FlushBufferedText(blocks, textBuffer, ReaderContentBlockTypes.Title);
                    inHeading = false;
                    continue;
                }

                if (Regex.IsMatch(token, @"^<figcaption\b", RegexOptions.IgnoreCase))
                {
                    FlushBufferedText(blocks, textBuffer, inHeading ? ReaderContentBlockTypes.Title : ReaderContentBlockTypes.Paragraph);
                    inCaption = true;
                    continue;
                }

                if (Regex.IsMatch(token, @"^</figcaption\s*>$", RegexOptions.IgnoreCase))
                {
                    var caption = NormalizeTextFragment(textBuffer.ToString());
                    textBuffer.Clear();
                    if (!string.IsNullOrWhiteSpace(caption))
                    {
                        var lastImageBlock = blocks.LastOrDefault(block => string.Equals(block.Type, ReaderContentBlockTypes.Image, StringComparison.OrdinalIgnoreCase));
                        if (lastImageBlock != null && string.IsNullOrWhiteSpace(lastImageBlock.Caption))
                        {
                            lastImageBlock.Caption = caption;
                        }
                        else
                        {
                            blocks.Add(new ReaderContentBlock
                            {
                                Type = ReaderContentBlockTypes.Paragraph,
                                Text = caption,
                                Meta = new Dictionary<string, string> { ["variant"] = "caption" }
                            });
                        }
                    }
                    inCaption = false;
                    continue;
                }

                if (Regex.IsMatch(token, @"^<(p|div|section|article|aside|header|footer|nav|figure|blockquote|pre|li|tr)\b", RegexOptions.IgnoreCase) ||
                    Regex.IsMatch(token, @"^</(p|div|section|article|aside|header|footer|nav|figure|blockquote|pre|li|tr)\s*>$", RegexOptions.IgnoreCase) ||
                    Regex.IsMatch(token, @"^<hr\b", RegexOptions.IgnoreCase))
                {
                    FlushBufferedText(blocks, textBuffer, inHeading ? ReaderContentBlockTypes.Title : ReaderContentBlockTypes.Paragraph);
                    continue;
                }

                if (Regex.IsMatch(token, @"^<(td|th)\b", RegexOptions.IgnoreCase) ||
                    Regex.IsMatch(token, @"^</(td|th)\s*>$", RegexOptions.IgnoreCase))
                {
                    textBuffer.Append(' ');
                    continue;
                }

                if (inCaption && Regex.IsMatch(token, @"^</?(span|em|strong|b|i|small|a)\b", RegexOptions.IgnoreCase))
                {
                    continue;
                }
            }

            FlushBufferedText(blocks, textBuffer, inHeading ? ReaderContentBlockTypes.Title : ReaderContentBlockTypes.Paragraph);
            return blocks;
        }

        private static ReaderContentBlock? TryCreateImageBlock(string imageTag, EpubLocalTextContentFile textFile, EpubExtractionContext extractionContext)
        {
            var source = ExtractHtmlAttribute(imageTag, "src");
            if (string.IsNullOrWhiteSpace(source))
            {
                return null;
            }

            var imageUrl = PersistReferencedEpubImage(source, textFile, extractionContext);
            if (string.IsNullOrWhiteSpace(imageUrl))
            {
                return null;
            }

            var altText = ExtractHtmlAttribute(imageTag, "alt");
            return new ReaderContentBlock
            {
                Type = ReaderContentBlockTypes.Image,
                ImageUrl = imageUrl,
                AltText = string.IsNullOrWhiteSpace(altText) ? null : WebUtility.HtmlDecode(altText).Trim()
            };
        }

        private static string? PersistReferencedEpubImage(string source, EpubLocalTextContentFile textFile, EpubExtractionContext extractionContext)
        {
            var normalizedSource = source.Trim();
            if (normalizedSource.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ||
                normalizedSource.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                normalizedSource.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            normalizedSource = WebUtility.HtmlDecode(normalizedSource.Split('#')[0].Split('?')[0]);
            var candidatePaths = BuildEpubImageLookupCandidates(textFile.FilePath, normalizedSource);
            var cacheKey = candidatePaths.First();
            if (extractionContext.SavedImages.TryGetValue(cacheKey, out var existingPath))
            {
                return existingPath;
            }

            var imageFile = FindReferencedEpubImage(candidatePaths, extractionContext);

            if (imageFile == null || imageFile.Content.Length == 0)
            {
                return null;
            }

            var extension = GetImageExtension(imageFile.ContentMimeType, imageFile.FilePath);
            var fileName = $"img_{extractionContext.NextImageIndex:D4}{extension}";
            extractionContext.NextImageIndex++;

            var absolutePath = Path.Combine(extractionContext.AbsoluteAssetRoot, fileName);
            System.IO.File.WriteAllBytes(absolutePath, imageFile.Content);

            var relativePath = $"{extractionContext.RelativeAssetRoot}/{fileName}";
            extractionContext.SavedImages[cacheKey] = relativePath;
            return relativePath;
        }

        private static EpubLocalByteContentFile? FindReferencedEpubImage(IEnumerable<string> candidatePaths, EpubExtractionContext extractionContext)
        {
            foreach (var candidatePath in candidatePaths)
            {
                if (extractionContext.Book.Content.Images.TryGetLocalFileByFilePath(candidatePath, out var fileByPath))
                {
                    return fileByPath;
                }

                if (extractionContext.Book.Content.Images.TryGetLocalFileByKey(candidatePath, out var fileByKey))
                {
                    return fileByKey;
                }

                if (extractionContext.Book.Content.AllFiles.TryGetLocalFileByFilePath(candidatePath, out var generalFile) && generalFile is EpubLocalByteContentFile byteFile)
                {
                    return byteFile;
                }

                var normalizedCandidate = NormalizeArchiveLookupValue(candidatePath);
                var imageMatch = extractionContext.Book.Content.Images.Local.FirstOrDefault(image =>
                    NormalizeArchiveLookupValue(image.FilePath) == normalizedCandidate ||
                    NormalizeArchiveLookupValue(image.Key) == normalizedCandidate);
                if (imageMatch != null)
                {
                    return imageMatch;
                }

                var allFilesMatch = extractionContext.Book.Content.AllFiles.Local
                    .OfType<EpubLocalByteContentFile>()
                    .FirstOrDefault(file =>
                        NormalizeArchiveLookupValue(file.FilePath) == normalizedCandidate ||
                        NormalizeArchiveLookupValue(file.Key) == normalizedCandidate);
                if (allFilesMatch != null)
                {
                    return allFilesMatch;
                }
            }

            return null;
        }

        private static List<string> BuildEpubImageLookupCandidates(string baseFilePath, string sourcePath)
        {
            var candidates = new List<string>();
            void AddCandidate(string value)
            {
                if (string.IsNullOrWhiteSpace(value))
                {
                    return;
                }

                var normalizedValue = value.Replace('\\', '/');
                if (!candidates.Contains(normalizedValue, StringComparer.OrdinalIgnoreCase))
                {
                    candidates.Add(normalizedValue);
                }
            }

            var resolvedPath = ResolveEpubArchivePath(baseFilePath, sourcePath);
            AddCandidate(resolvedPath);
            AddCandidate(resolvedPath.TrimStart('/'));
            AddCandidate(sourcePath.Trim());
            AddCandidate(sourcePath.Trim().TrimStart('/'));

            return candidates;
        }

        private static string? SaveEpubCoverImage(EpubExtractionContext extractionContext)
        {
            if (extractionContext.Book.Content.Cover != null && extractionContext.Book.Content.Cover.Content.Length > 0)
            {
                var extension = GetImageExtension(extractionContext.Book.Content.Cover.ContentMimeType, extractionContext.Book.Content.Cover.FilePath);
                var relativePath = $"{extractionContext.RelativeAssetRoot}/cover{extension}";
                var absolutePath = Path.Combine(extractionContext.AbsoluteAssetRoot, $"cover{extension}");
                System.IO.File.WriteAllBytes(absolutePath, extractionContext.Book.Content.Cover.Content);
                return relativePath;
            }

            if (extractionContext.Book.CoverImage != null && extractionContext.Book.CoverImage.Length > 0)
            {
                var extension = GetImageExtension(null, "cover");
                var relativePath = $"{extractionContext.RelativeAssetRoot}/cover{extension}";
                var absolutePath = Path.Combine(extractionContext.AbsoluteAssetRoot, $"cover{extension}");
                System.IO.File.WriteAllBytes(absolutePath, extractionContext.Book.CoverImage);
                return relativePath;
            }

            return null;
        }

        private static List<ReaderContentBlock> FilterIgnorableArtifactBlocks(IEnumerable<ReaderContentBlock> blocks, HashSet<string> artifactKeys)
        {
            var filteredBlocks = new List<ReaderContentBlock>();
            var textBlockIndex = 0;

            foreach (var block in blocks)
            {
                if (string.Equals(block.Type, ReaderContentBlockTypes.Image, StringComparison.OrdinalIgnoreCase))
                {
                    filteredBlocks.Add(block);
                    continue;
                }

                var candidateText = GetBlockPlainText(block);
                if (IsIgnorableEpubArtifactBlock(candidateText, artifactKeys, textBlockIndex))
                {
                    textBlockIndex++;
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(candidateText) || !string.IsNullOrWhiteSpace(block.ImageUrl))
                {
                    filteredBlocks.Add(block);
                }
                textBlockIndex++;
            }

            return filteredBlocks;
        }

        private static List<StructuredTextPart> SplitStructuredContent(IEnumerable<ReaderContentBlock> blocks, string splitMethod, int maxSegmentSize)
        {
            var expandedBlocks = ExpandStructuredBlocksForSplit(blocks, splitMethod, maxSegmentSize);
            var parts = new List<StructuredTextPart>();
            var currentBlocks = new List<ReaderContentBlock>();
            var currentCharCount = 0;

            foreach (var block in expandedBlocks)
            {
                var blockText = GetBlockPlainText(block);
                var blockLength = blockText.Length;

                if (blockLength > 0 && currentCharCount > 0 && currentCharCount + blockLength > maxSegmentSize)
                {
                    parts.Add(new StructuredTextPart(CloneBlocks(currentBlocks), BuildPlainTextFromBlocks(currentBlocks)));
                    currentBlocks.Clear();
                    currentCharCount = 0;
                }

                currentBlocks.Add(CloneBlock(block));
                currentCharCount += Math.Max(0, blockLength) + 2;
            }

            if (currentBlocks.Count > 0)
            {
                parts.Add(new StructuredTextPart(CloneBlocks(currentBlocks), BuildPlainTextFromBlocks(currentBlocks)));
            }

            if (parts.Count == 0)
            {
                parts.Add(new StructuredTextPart(new List<ReaderContentBlock>(), string.Empty));
            }

            return parts;
        }

        private static List<ReaderContentBlock> ExpandStructuredBlocksForSplit(IEnumerable<ReaderContentBlock> blocks, string splitMethod, int maxSegmentSize)
        {
            var expandedBlocks = new List<ReaderContentBlock>();
            foreach (var block in blocks)
            {
                if (string.Equals(block.Type, ReaderContentBlockTypes.Image, StringComparison.OrdinalIgnoreCase))
                {
                    expandedBlocks.Add(CloneBlock(block));
                    continue;
                }

                var blockText = block.Text?.Trim();
                if (string.IsNullOrWhiteSpace(blockText))
                {
                    continue;
                }

                if (string.Equals(block.Type, ReaderContentBlockTypes.Title, StringComparison.OrdinalIgnoreCase))
                {
                    expandedBlocks.Add(CloneBlock(block));
                    continue;
                }

                IEnumerable<string> chunks = splitMethod.ToLowerInvariant() switch
                {
                    "sentence" => Regex.Matches(blockText, @"[^.!?…]+(?:[.!?…]+(?:""|”|'|’)?|$)")
                        .Select(match => match.Value.Trim())
                        .Where(chunk => !string.IsNullOrWhiteSpace(chunk))
                        .DefaultIfEmpty(blockText),
                    "length" => SplitContent(blockText, "length", maxSegmentSize)
                        .Select(chunk => chunk.Trim())
                        .Where(chunk => !string.IsNullOrWhiteSpace(chunk))
                        .DefaultIfEmpty(blockText),
                    _ => new[] { blockText }
                };

                foreach (var chunk in chunks)
                {
                    expandedBlocks.Add(new ReaderContentBlock
                    {
                        Type = block.Type,
                        Text = chunk,
                        Caption = block.Caption,
                        AltText = block.AltText,
                        ImageUrl = block.ImageUrl,
                        Meta = block.Meta != null ? new Dictionary<string, string>(block.Meta) : null
                    });
                }
            }

            return expandedBlocks;
        }

        private static string BuildPlainTextFromBlocks(IEnumerable<ReaderContentBlock> blocks)
        {
            return string.Join(
                "\n\n",
                blocks
                    .Select(GetBlockPlainText)
                    .Where(text => !string.IsNullOrWhiteSpace(text))
                    .Select(text => text.Trim()));
        }

        private static string GetBlockPlainText(ReaderContentBlock block)
        {
            if (string.Equals(block.Type, ReaderContentBlockTypes.Image, StringComparison.OrdinalIgnoreCase))
            {
                return NormalizeTextFragment(block.Caption);
            }

            return NormalizeTextFragment(block.Text);
        }

        private static ReaderContentBlock CloneBlock(ReaderContentBlock block)
        {
            return new ReaderContentBlock
            {
                Type = block.Type,
                Text = block.Text,
                ImageUrl = block.ImageUrl,
                AltText = block.AltText,
                Caption = block.Caption,
                Meta = block.Meta != null ? new Dictionary<string, string>(block.Meta) : null
            };
        }

        private static List<ReaderContentBlock> CloneBlocks(IEnumerable<ReaderContentBlock> blocks)
        {
            return blocks.Select(CloneBlock).ToList();
        }

        private static void FlushBufferedText(List<ReaderContentBlock> blocks, StringBuilder textBuffer, string blockType)
        {
            var normalizedText = NormalizeTextFragment(textBuffer.ToString());
            textBuffer.Clear();

            if (string.IsNullOrWhiteSpace(normalizedText))
            {
                return;
            }

            blocks.Add(new ReaderContentBlock
            {
                Type = blockType,
                Text = normalizedText
            });
        }

        private static string NormalizeTextFragment(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            var text = WebUtility.HtmlDecode(value)
                .Replace("\r\n", "\n")
                .Replace('\r', '\n')
                .Replace('\u00A0', ' ');

            text = Regex.Replace(text, @"[ \t\f\v]+", " ");
            text = Regex.Replace(text, @" *\n *", "\n");
            text = Regex.Replace(text, @"\n{3,}", "\n\n");
            return text.Trim();
        }

        private static string ExtractHtmlAttribute(string tag, string attributeName)
        {
            var match = Regex.Match(tag, $@"\b{attributeName}\s*=\s*(?:""(?<value>[^""]*)""|'(?<value>[^']*)'|(?<value>[^\s>]+))", RegexOptions.IgnoreCase);
            return match.Success ? match.Groups["value"].Value : string.Empty;
        }

        private static string ResolveEpubArchivePath(string baseFilePath, string relativePath)
        {
            var sanitizedRelativePath = relativePath.Replace('\\', '/');
            if (sanitizedRelativePath.StartsWith("/"))
            {
                return NormalizeArchivePath(sanitizedRelativePath);
            }

            var baseDirectory = NormalizeArchivePath(Path.GetDirectoryName(baseFilePath)?.Replace('\\', '/') ?? string.Empty);
            var combinedPath = $"{baseDirectory}/{sanitizedRelativePath}";
            return NormalizeArchivePath(combinedPath);
        }

        private static string NormalizeArchivePath(string path)
        {
            var sanitized = path.Replace('\\', '/');
            var segments = new List<string>();
            foreach (var segment in sanitized.Split('/', StringSplitOptions.RemoveEmptyEntries))
            {
                if (segment == ".")
                {
                    continue;
                }

                if (segment == "..")
                {
                    if (segments.Count > 0)
                    {
                        segments.RemoveAt(segments.Count - 1);
                    }
                    continue;
                }

                segments.Add(segment);
            }

            return "/" + string.Join("/", segments);
        }

        private static string NormalizeArchiveLookupValue(string? path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return string.Empty;
            }

            return NormalizeArchivePath(WebUtility.UrlDecode(path) ?? path).TrimStart('/');
        }

        private static string GetImageExtension(string? mimeType, string? filePath)
        {
            var extension = Path.GetExtension(filePath ?? string.Empty);
            if (!string.IsNullOrWhiteSpace(extension))
            {
                return extension.StartsWith('.') ? extension.ToLowerInvariant() : "." + extension.ToLowerInvariant();
            }

            return mimeType?.ToLowerInvariant() switch
            {
                "image/png" => ".png",
                "image/gif" => ".gif",
                "image/webp" => ".webp",
                "image/svg+xml" => ".svg",
                _ => ".jpg"
            };
        }

        private static void CleanupBookAssets(Guid userId, int bookId)
        {
            var assetDirectory = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "epub_assets", userId.ToString(), bookId.ToString());
            if (Directory.Exists(assetDirectory))
            {
                Directory.Delete(assetDirectory, recursive: true);
            }
        }

        private static string NormalizeEpubHtmlToText(string htmlContent)
        {
            if (string.IsNullOrWhiteSpace(htmlContent))
            {
                return string.Empty;
            }

            var normalizedHtml = htmlContent;

            normalizedHtml = Regex.Replace(normalizedHtml, @"<!--.*?-->", string.Empty, RegexOptions.Singleline);
            normalizedHtml = Regex.Replace(normalizedHtml, @"<(script|style)\b[^>]*>.*?</\1>", string.Empty, RegexOptions.Singleline | RegexOptions.IgnoreCase);
            normalizedHtml = Regex.Replace(normalizedHtml, @"<br\s*/?>", "\n", RegexOptions.IgnoreCase);
            normalizedHtml = Regex.Replace(
                normalizedHtml,
                @"</(p|div|section|article|aside|header|footer|nav|figure|figcaption|blockquote|pre|li|h[1-6])\s*>",
                "\n\n",
                RegexOptions.IgnoreCase);
            normalizedHtml = Regex.Replace(normalizedHtml, @"</(tr)\s*>", "\n", RegexOptions.IgnoreCase);
            normalizedHtml = Regex.Replace(normalizedHtml, @"<(hr)\b[^>]*>", "\n\n", RegexOptions.IgnoreCase);
            normalizedHtml = Regex.Replace(normalizedHtml, @"<(td|th)\b[^>]*>", " ", RegexOptions.IgnoreCase);
            normalizedHtml = Regex.Replace(normalizedHtml, @"</(td|th)\s*>", " ", RegexOptions.IgnoreCase);
            normalizedHtml = Regex.Replace(normalizedHtml, @"<[^>]*>", string.Empty);

            var plainText = WebUtility.HtmlDecode(normalizedHtml)
                .Replace("\r\n", "\n")
                .Replace('\r', '\n');

            plainText = Regex.Replace(plainText, @"[ \t\f\v]+", " ");
            plainText = Regex.Replace(plainText, @" *\n *", "\n");
            plainText = Regex.Replace(plainText, @"\n{3,}", "\n\n");

            return plainText.Trim();
        }

        private static HashSet<string> BuildEpubArtifactKeys(string? bookTitle, string? sourceFileStem)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            AddArtifactKeyVariants(keys, bookTitle);
            AddArtifactKeyVariants(keys, sourceFileStem);
            return keys;
        }

        private static void AddArtifactKeyVariants(HashSet<string> keys, string? value)
        {
            var normalized = NormalizeArtifactKey(value);
            if (string.IsNullOrWhiteSpace(normalized))
            {
                return;
            }

            foreach (var variant in GetArtifactKeyVariants(normalized))
            {
                keys.Add(variant);
            }
        }

        private static IEnumerable<string> GetArtifactKeyVariants(string normalized)
        {
            var pending = new Queue<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);

            pending.Enqueue(normalized);

            while (pending.Count > 0)
            {
                var current = pending.Dequeue().Trim('_', '-');
                if (string.IsNullOrWhiteSpace(current) || !seen.Add(current))
                {
                    continue;
                }

                yield return current;

                var withoutTrailingSuffix = Regex.Replace(current, @"(?:_|-)(?:\d+|[a-f0-9]{6,}|part\d+|page\d+|copy)$", string.Empty).Trim('_', '-');
                if (!string.IsNullOrWhiteSpace(withoutTrailingSuffix) && !string.Equals(withoutTrailingSuffix, current, StringComparison.Ordinal))
                {
                    pending.Enqueue(withoutTrailingSuffix);
                }

                var truncatedAfterFormatToken = Regex.Replace(
                    current,
                    @"^(.+?_(?:epub|pdf|mobi|azw3))(?:_.+)$",
                    "$1");
                if (!string.IsNullOrWhiteSpace(truncatedAfterFormatToken) && !string.Equals(truncatedAfterFormatToken, current, StringComparison.Ordinal))
                {
                    pending.Enqueue(truncatedAfterFormatToken);
                }

                var withoutCommonSuffix = Regex.Replace(current, @"(?:_|-)?(?:epub|pdf|mobi|azw3|book|novel)$", string.Empty).Trim('_', '-');
                if (!string.IsNullOrWhiteSpace(withoutCommonSuffix) && !string.Equals(withoutCommonSuffix, current, StringComparison.Ordinal))
                {
                    pending.Enqueue(withoutCommonSuffix);
                }
            }
        }

        private static bool IsIgnorableEpubArtifactBlock(string block, HashSet<string> artifactKeys, int blockIndex)
        {
            if (blockIndex > 12 || string.IsNullOrWhiteSpace(block))
            {
                return false;
            }

            var lines = block
                .Split('\n')
                .Select(line => line.Trim())
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .ToList();

            if (lines.Count == 0 || lines.Count > 2)
            {
                return false;
            }

            return lines.All(line => IsIgnorableEpubArtifactLine(line, artifactKeys));
        }

        private static bool IsIgnorableEpubArtifactLine(string line, HashSet<string> artifactKeys)
        {
            var normalizedLine = NormalizeArtifactKey(line);
            if (string.IsNullOrWhiteSpace(normalizedLine) || normalizedLine.Length > 80)
            {
                return false;
            }

            var genericArtifacts = new HashSet<string>(StringComparer.Ordinal)
            {
                "cover",
                "titlepage",
                "title_page",
                "half_title",
                "halftitle",
                "copyright",
                "toc",
                "table_of_contents",
                "contents"
            };

            if (genericArtifacts.Contains(normalizedLine))
            {
                return true;
            }

            if (LooksLikeFilenameArtifact(normalizedLine))
            {
                return true;
            }

            return artifactKeys.Any(key =>
                normalizedLine == key ||
                Regex.IsMatch(normalizedLine, $"^{Regex.Escape(key)}(?:[_-]?\\d+)?$"));
        }

        private static bool LooksLikeFilenameArtifact(string normalizedLine)
        {
            if (!normalizedLine.Contains('_'))
            {
                return false;
            }

            var parts = normalizedLine
                .Split('_', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (parts.Length < 3)
            {
                return false;
            }

            var hasFormatMarker = parts.Any(part =>
                part == "epub" ||
                part == "pdf" ||
                part == "mobi" ||
                part == "azw3");

            if (!hasFormatMarker)
            {
                return false;
            }

            return parts.All(part =>
                part.All(char.IsLetterOrDigit) &&
                part.Length <= 24);
        }

        private static string NormalizeArtifactKey(string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            var normalized = value.Normalize(NormalizationForm.FormD);
            var builder = new StringBuilder();

            foreach (var character in normalized)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
                {
                    continue;
                }

                if (char.IsLetterOrDigit(character))
                {
                    builder.Append(char.ToLowerInvariant(character));
                }
                else if (character == '_' || character == '-' || char.IsWhiteSpace(character))
                {
                    builder.Append('_');
                }
            }

            return Regex.Replace(builder.ToString(), @"_+", "_").Trim('_');
        }

        // PUT: api/books/5/lastread
        [HttpPut("{id}/lastread")]
        public async Task<IActionResult> UpdateLastRead(int id, [FromBody] UpdateLastReadDto updateDto)
        {
            var userId = GetUserId();
            
            var book = await _context.Books
                .Where(b => b.BookId == id && b.UserId == userId)
                .FirstOrDefaultAsync();
                
            if (book == null)
            {
                return NotFound();
            }
            
            // Verify the text belongs to this book
            var text = await _context.Texts
                .Where(t => t.TextId == updateDto.TextId && t.BookId == id)
                .FirstOrDefaultAsync();
                
            if (text == null) 
            {
                return BadRequest("The specified text does not belong to this book");
            }
            
            book.LastReadTextId = updateDto.TextId;
            book.LastReadAt = DateTime.UtcNow;
            
            await _context.SaveChangesAsync();
            
            return NoContent();
        }

        // PUT: api/books/5/complete-lesson
        [HttpPut("{id}/complete-lesson")]
        public async Task<ActionResult<BookStatsDto>> CompleteLesson(int id, [FromBody] CompleteLessonDto lessonDto)
        {
            var userId = GetUserId();

            // Retry dedup: a completion of the same text within this window is treated as the
            // same logical action (double-click, connection retry, page reload on a flaky link)
            // and must not double-count. 10s is short enough that a deliberate re-read cannot
            // realistically fit inside it, even for very short texts.
            var retryWindow = TimeSpan.FromSeconds(10);

            try
            {
                var strategy = _context.Database.CreateExecutionStrategy();

                return await strategy.ExecuteAsync<ActionResult<BookStatsDto>>(async () =>
                {
                    _context.ChangeTracker.Clear();
                    var now = DateTime.UtcNow;
                    double completionPercentage;

                    await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);

                    var book = await _context.Books
                        .Where(b => b.BookId == id && b.UserId == userId)
                        .Include(b => b.Language)
                        .FirstOrDefaultAsync();

                    if (book == null)
                    {
                        return NotFound();
                    }

                    if (book.Language == null)
                    {
                        return BadRequest("Book language not found");
                    }

                    // Verify the text belongs to this book
                    var text = await _context.Texts
                        .Include(t => t.TextWords)
                        .ThenInclude(tw => tw.Word)
                        .Where(t => t.TextId == lessonDto.TextId && t.BookId == id)
                        .FirstOrDefaultAsync();

                    if (text == null)
                    {
                        return NotFound("Text not found or does not belong to this book");
                    }

                    bool isRetry = text.LastCompletedAt.HasValue
                        && now - text.LastCompletedAt.Value < retryWindow;

                    if (isRetry)
                    {
                        var retryCounts = await _context.Texts
                            .Where(t => t.BookId == id)
                            .GroupBy(t => 1)
                            .Select(g => new { Total = g.Count(), Finished = g.Count(t => t.IsFinished) })
                            .FirstOrDefaultAsync();
                        int totalTextsRetry = retryCounts?.Total ?? 0;
                        int finishedTextsRetry = retryCounts?.Finished ?? 0;
                        double pctRetry = totalTextsRetry > 0
                            ? Math.Round((double)finishedTextsRetry / totalTextsRetry * 100, 2)
                            : 0;

                        return new BookStatsDto
                        {
                            TotalWords = book.TotalWords,
                            KnownWords = book.KnownWords,
                            LearningWords = book.LearningWords,
                            CompletionPercentage = pctRetry,
                            IsFinished = book.IsFinished
                        };
                    }

                    // First-time completion increments the "unique texts finished" counter.
                    // A re-read (past the retry window, already finished) only bumps the "total completions"
                    // counter and credits reading volume/activity — not TotalTextsCompleted.
                    bool isFirstCompletion = !text.IsFinished;

                    // Count all words in the text (not just unique words)
                    int totalWordCount = WordCountUtility.CountTotalWords(text.Content);

                    // book.Language was eager-loaded above; mutate it in place rather than refetching.
                    var language = book.Language;
                    if (language != null)
                    {
                        language.WordsRead += totalWordCount;

                        _context.UserActivities.Add(new UserActivity
                        {
                            UserId = userId,
                            LanguageId = language.LanguageId,
                            ActivityType = "TextCompleted",
                            WordCount = totalWordCount,
                            Timestamp = now
                        });
                    }

                    // Update UserLanguageStatistics for completed lesson
                    var stats = await _context.UserLanguageStatistics
                        .FirstOrDefaultAsync(uls => uls.UserId == userId && uls.LanguageId == book.LanguageId);
                    if (stats == null)
                    {
                        stats = new UserLanguageStatistics
                        {
                            UserId = userId,
                            LanguageId = book.LanguageId,
                            TotalWordsRead = totalWordCount,
                            TotalTextsCompleted = isFirstCompletion ? 1 : 0,
                            TotalTextCompletions = 1,
                            LastUpdatedAt = now
                        };
                        _context.UserLanguageStatistics.Add(stats);
                    }
                    else
                    {
                        stats.TotalWordsRead += totalWordCount;
                        if (isFirstCompletion)
                        {
                            stats.TotalTextsCompleted += 1;
                        }
                        stats.TotalTextCompletions += 1;
                        stats.LastUpdatedAt = now;
                    }

                    // Pre-count texts once; the only IsFinished flip in this request is the current
                    // text when isFirstCompletion is true, so the post-update count is derivable.
                    var textCounts = await _context.Texts
                        .Where(t => t.BookId == id)
                        .GroupBy(t => 1)
                        .Select(g => new { Total = g.Count(), Finished = g.Count(t => t.IsFinished) })
                        .FirstOrDefaultAsync();
                    int totalTexts = textCounts?.Total ?? 0;
                    int existingFinished = textCounts?.Finished ?? 0;

                    // Sum running-token occurrences grouped by status across the book's
                    // texts. Running counts (not unique-word distinct counts) keep the
                    // book percentage consistent with per-text percentages — a long
                    // tail of rare unknown words no longer inflates the book number.
                    var bookStatusCounts = await _context.TextWords
                        .Where(tw => tw.Text.BookId == id)
                        .GroupBy(tw => tw.Word.Status)
                        .Select(g => new { Status = g.Key, Count = g.Sum(x => x.OccurrenceCount) })
                        .ToListAsync();

                    int bookTotal = 0, bookKnown = 0, bookLearning = 0;
                    foreach (var s in bookStatusCounts)
                    {
                        if (s.Status == 6) continue; // Ignored words are excluded from all book stats
                        bookTotal += s.Count;
                        if (s.Status >= 4) bookKnown += s.Count;
                        else if (s.Status >= 2) bookLearning += s.Count;
                    }
                    book.TotalWords = bookTotal;
                    book.KnownWords = bookKnown;
                    book.LearningWords = bookLearning;
                    book.StatsUpdatedAt = now;

                    book.LastReadAt = now;
                    book.LastReadTextId = text.TextId;
                    book.LastReadPartId = text.PartNumber;

                    // Mark the text/part as finished so FinishedPartCount updates in library
                    if (!text.IsFinished)
                    {
                        text.IsFinished = true;
                    }
                    text.LastCompletedAt = now;

                    int finishedTexts = existingFinished + (isFirstCompletion ? 1 : 0);
                    if (totalTexts > 0 && finishedTexts >= totalTexts)
                    {
                        book.IsFinished = true;
                        completionPercentage = 100.0;
                    }
                    else
                    {
                        book.IsFinished = false;
                        completionPercentage = totalTexts > 0
                            ? Math.Round((double)finishedTexts / totalTexts * 100, 2)
                            : 0;
                    }

                    await _context.SaveChangesAsync();
                    await transaction.CommitAsync();

                    var result = new BookStatsDto
                    {
                        TotalWords = book.TotalWords,
                        KnownWords = book.KnownWords,
                        LearningWords = book.LearningWords,
                        CompletionPercentage = completionPercentage,
                        IsFinished = book.IsFinished
                    };

                    await TriggerHardcoverProgressSyncAsync(userId, id);
                    return result;
                });
            }
            catch (DbUpdateException ex)
            {
                _logger.LogError(ex, "Failed to complete lesson for book {BookId}, text {TextId}", id, lessonDto.TextId);
                return StatusCode(500, "Failed to record lesson completion.");
            }
        }

        // PUT: api/books/5/finish
        [HttpPut("{id}/finish")]
        public async Task<IActionResult> FinishBook(int id, [FromBody] FinishBookRequest? request)
        {
            var userId = GetUserId();
            var now = DateTime.UtcNow;

            var book = await _context.Books
                .Where(b => b.BookId == id && b.UserId == userId)
                .Include(b => b.Texts)
                .FirstOrDefaultAsync();

            if (book == null)
            {
                return NotFound("Book not found");
            }

            // Validate / normalize rating: must be in [0.5, 5.0] in 0.5 increments.
            decimal? rating = null;
            if (request?.Rating.HasValue == true)
            {
                var raw = request.Rating.Value;
                if (raw < 0.5m || raw > 5.0m)
                {
                    return BadRequest("Rating must be between 0.5 and 5.0.");
                }

                // Snap to nearest 0.5
                rating = Math.Round(raw * 2m, MidpointRounding.AwayFromZero) / 2m;
            }

            // Mark unfinished child texts as finished — child-text completion is part of
            // "book is done" semantics, not a stat. We deliberately do NOT touch word
            // statuses, language counters, or UserActivity.
            foreach (var text in book.Texts.Where(t => !t.IsFinished))
            {
                text.IsFinished = true;
                text.LastCompletedAt = now;
            }

            book.LastReadAt = now;
            book.IsFinished = true;

            await _context.SaveChangesAsync();
            await TriggerHardcoverProgressSyncAsync(userId, id, rating);

            return NoContent();
        }

        // GET: api/books/5/next-lesson
        [HttpGet("{id}/next-lesson")]
        public async Task<ActionResult<NextLessonDto>> GetNextLesson(int id, [FromQuery] int currentTextId)
        {
            var userId = GetUserId();
            
            // Retrieve the book and ensure it belongs to the user
            var book = await _context.Books
                .Include(b => b.Texts)
                .Where(b => b.BookId == id && b.UserId == userId)
                .FirstOrDefaultAsync();
                
            if (book == null)
            {
                return NotFound("Book not found");
            }
            
            // Order texts by their part number
            var orderedTexts = book.Texts.OrderBy(t => t.PartNumber).ToList();
            
            // Find the current text index
            var currentIndex = orderedTexts.FindIndex(t => t.TextId == currentTextId);
            
            if (currentIndex == -1)
            {
                return NotFound("Current text not found in this book");
            }
            
            // Check if this is the last text
            if (currentIndex >= orderedTexts.Count - 1)
            {
                return Ok(new NextLessonDto { TextId = null });
            }
            
            // Return the next text
            var nextText = orderedTexts[currentIndex + 1];
            return Ok(new NextLessonDto { TextId = nextText.TextId });
        }

        // PUT: api/books/5
        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateBook(int id, [FromBody] UpdateBookDto updateBookDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var userId = GetUserId();
            // 1. Fetch Book with current Tags
            var book = await _context.Books
                .Include(b => b.BookTags) // Include existing tags
                    .ThenInclude(bt => bt.Tag)
                .Where(b => b.BookId == id && b.UserId == userId)
                .FirstOrDefaultAsync();

            if (book == null)
            {
                return NotFound();
            }

            // 2. Update basic properties
            book.Title = updateBookDto.Title;
            book.Description = updateBookDto.Description ?? book.Description; // Update description if provided

            // 3. Process Incoming Tags
            var desiredTags = new List<Tag>();
            var newTagsToCreate = new List<Tag>();
            var desiredTagNamesLower = new List<string>();

            if (updateBookDto.Tags != null) // Allow clearing tags if Tags is null or empty
            {
                desiredTagNamesLower = updateBookDto.Tags
                    .Select(t => t.Trim().ToLowerInvariant())
                    .Where(t => !string.IsNullOrEmpty(t))
                    .Distinct()
                    .ToList();

                if (desiredTagNamesLower.Any())
                {
                    var existingTags = await _context.Tags
                        .Where(t => desiredTagNamesLower.Contains(t.Name.ToLower()))
                        .ToListAsync();

                    desiredTags.AddRange(existingTags);

                    var existingTagNamesLower = existingTags.Select(t => t.Name.ToLowerInvariant()).ToList();
                    var tagsToCreateNames = desiredTagNamesLower.Except(existingTagNamesLower).ToList();

                    foreach (var tagName in tagsToCreateNames)
                    {
                        if (tagName.Length <= 50) // Check length constraint
                        {
                            var newTag = new Tag { Name = tagName }; // Consider casing strategy
                            newTagsToCreate.Add(newTag);
                            desiredTags.Add(newTag); // Add to list for association later
                        }
                        else
                        {
                            _logger.LogWarning("Skipping tag '{TagName}' during update because it exceeds the maximum length of 50 characters.", tagName);
                            // Optionally add to ModelState or return BadRequest
                        }
                    }
                }
            }

            // Add newly identified tags to the context
            if (newTagsToCreate.Any())
            {
                _context.Tags.AddRange(newTagsToCreate);
                // Note: We rely on SaveChangesAsync later to get IDs for these new tags
            }

            // 4. Synchronize BookTag Associations

            // Get IDs of tags that *should* be associated (after potential creation)
            // We need to handle the case where new tags haven't been saved yet.
            // Let's refine this: compare based on names first.

            var currentTagsLower = book.BookTags.Select(bt => bt.Tag.Name.ToLowerInvariant()).ToList();

            // Associations to remove: Current tags not in the desired list
            var tagsToRemove = book.BookTags
                .Where(bt => !desiredTagNamesLower.Contains(bt.Tag.Name.ToLowerInvariant()))
                .ToList();

            if (tagsToRemove.Any())
            {
                _context.BookTags.RemoveRange(tagsToRemove);
            }

            // Names of tags to add: Desired tags not currently associated
            var tagNamesToAdd = desiredTagNamesLower.Except(currentTagsLower).ToList();

            // We need the Tag entities (existing or newly created) for these names
            // var tagsToAdd = desiredTags.Where(t => tagNamesToAdd.Contains(t.Name.ToLowerInvariant())).ToList();


            // 5. Save Changes (Gets IDs for new Tags, applies removals)
            try
            {
                // Save changes including new Tags before creating new BookTags
                await _context.SaveChangesAsync();

                // Now create new BookTag associations using the potentially newly generated TagIds
                if (tagNamesToAdd.Any())
                {
                     // Re-fetch the desired tags now that they have IDs
                     var finalTagsToAdd = await _context.Tags
                         .Where(t => tagNamesToAdd.Contains(t.Name.ToLower()))
                         .ToListAsync();

                     foreach (var tag in finalTagsToAdd)
                     {
                         // Double-check if association already exists (shouldn't due to prior removal logic, but safe)
                         if (!book.BookTags.Any(bt => bt.TagId == tag.TagId))
                         {
                              _context.BookTags.Add(new BookTag { BookId = book.BookId, TagId = tag.TagId });
                         }
                     }
                     // Save the new associations
                     await _context.SaveChangesAsync();
                }

            }
            catch (DbUpdateConcurrencyException)
            {
                if (!await BookExists(id, userId))
                {
                    return NotFound();
                }
                else
                {
                    throw;
                }
            }
            catch (DbUpdateException ex) // Catch potential issues during save
            {
                // Log error, return appropriate status code
                _logger.LogError(ex, "Error updating book tags");
                return StatusCode(StatusCodes.Status500InternalServerError, "An error occurred while updating tags.");
            }


            return NoContent();
        }

        // DELETE: api/books/5
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteBook(int id)
        {
            var userId = GetUserId();
            var book = await _context.Books
                .Where(b => b.BookId == id && b.UserId == userId)
                .FirstOrDefaultAsync();

            if (book == null)
            {
                return NotFound();
            }

            _context.Books.Remove(book);

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex) // Catches errors like constraint violations
            {
                // Check if the error is due to the Restrict constraint
                // This check might need refinement based on the specific database provider (e.g., PostgreSQL error codes)
                if (ex.InnerException?.Message.Contains("constraint") ?? false)
                {
                     return BadRequest("Cannot delete book. Ensure all associated texts/lessons are removed first.");
                }
                return StatusCode(StatusCodes.Status500InternalServerError, "Error deleting book.");
            }

            // Clean up audiobook files from disk
            try
            {
                var audiobookDir = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "audiobooks", id.ToString());
                if (Directory.Exists(audiobookDir))
                {
                    Directory.Delete(audiobookDir, recursive: true);
                }
            }
            catch (Exception)
            {
                // Log but don't fail the delete — DB record is already gone
            }

            return NoContent();
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

        private async Task<bool> BookExists(int id, Guid userId)
        {
            return await _context.Books.AnyAsync(e => e.BookId == id && e.UserId == userId);
        }

        private async Task TriggerHardcoverProgressSyncAsync(Guid userId, int bookId, decimal? rating = null)
        {
            if (_hardcoverService == null)
            {
                return;
            }

            try
            {
                await _hardcoverService.SyncProgressAsync(userId, bookId, requireSyncEnabled: true, rating, HttpContext.RequestAborted);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Hardcover progress sync failed for book {BookId}", bookId);
            }
        }

        private sealed class StructuredEpubImportResult
        {
            public StructuredEpubImportResult(List<StructuredTextPart> parts, string plainText, string? coverImagePath)
            {
                Parts = parts;
                PlainText = plainText;
                CoverImagePath = coverImagePath;
            }

            public List<StructuredTextPart> Parts { get; }
            public string PlainText { get; }
            public string? CoverImagePath { get; }
        }

        private sealed class StructuredTextPart
        {
            public StructuredTextPart(List<ReaderContentBlock> blocks, string plainText)
            {
                Blocks = blocks;
                PlainText = plainText;
            }

            public List<ReaderContentBlock> Blocks { get; }
            public string PlainText { get; }
        }

        private sealed class EpubExtractionContext
        {
            public EpubExtractionContext(EpubBook book, string absoluteAssetRoot, string relativeAssetRoot)
            {
                Book = book;
                AbsoluteAssetRoot = absoluteAssetRoot;
                RelativeAssetRoot = relativeAssetRoot;
            }

            public EpubBook Book { get; }
            public string AbsoluteAssetRoot { get; }
            public string RelativeAssetRoot { get; }
            public int NextImageIndex { get; set; } = 1;
            public Dictionary<string, string> SavedImages { get; } = new(StringComparer.OrdinalIgnoreCase);
        }
    }

    // DTO for Tag information
    public class TagDto
    {
        public int TagId { get; set; }
        public string Name { get; set; } = string.Empty;
    }

    public class BookDto
    {
        public int BookId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string? CoverImagePath { get; set; }
        public string? Author { get; set; }
        public string? Isbn13 { get; set; }
        public string? Publisher { get; set; }
        public DateTime? ReleaseDate { get; set; }
        public int? PageCount { get; set; }
        public string LanguageName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public int PartCount { get; set; }
        public int FinishedPartCount { get; set; }
        public int? LastReadTextId { get; set; }
        public DateTime? LastReadAt { get; set; }
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public int LearningWords { get; set; }
        public DateTime? StatsUpdatedAt { get; set; }
        public int UnknownWords => Math.Max(TotalWords - KnownWords, 0);
        public double? UnknownWordPercentage =>
            TotalWords > 0 ? Math.Round((double)(TotalWords - KnownWords) / TotalWords * 100, 1) : (double?)null;
        public bool IsFinished { get; set; }
        public int? HardcoverBookId { get; set; }
        public int? HardcoverEditionId { get; set; }
        public string? HardcoverSlug { get; set; }
        public int? HardcoverUserBookId { get; set; }
        public DateTime? HardcoverMatchedAt { get; set; }
        public DateTime? HardcoverLastSyncedAt { get; set; }
        public double CompletionPercentage => PartCount > 0 ?
            Math.Round((double)FinishedPartCount / PartCount * 100, 1) : (IsFinished ? 100 : 0);
        public List<string> Tags { get; set; } = new List<string>(); // Added Tags
        public int? FolderId { get; set; }
        public int SortOrder { get; set; }
    }

    public class BookDetailDto
    {
        public int BookId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string? CoverImagePath { get; set; }
        public string? Author { get; set; }
        public string? Isbn13 { get; set; }
        public string? Publisher { get; set; }
        public DateTime? ReleaseDate { get; set; }
        public int? PageCount { get; set; }
        public string LanguageName { get; set; } = string.Empty;
        public int LanguageId { get; set; }
        public DateTime CreatedAt { get; set; }
        public int? LastReadTextId { get; set; }
        public int? HardcoverBookId { get; set; }
        public int? HardcoverEditionId { get; set; }
        public string? HardcoverSlug { get; set; }
        public int? HardcoverUserBookId { get; set; }
        public DateTime? HardcoverMatchedAt { get; set; }
        public DateTime? HardcoverLastSyncedAt { get; set; }
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public int LearningWords { get; set; }
        public DateTime? StatsUpdatedAt { get; set; }
        public int UnknownWords => Math.Max(TotalWords - KnownWords, 0);
        public double? UnknownWordPercentage =>
            TotalWords > 0 ? Math.Round((double)(TotalWords - KnownWords) / TotalWords * 100, 1) : (double?)null;
        public List<TextPartDto> Parts { get; set; } = new List<TextPartDto>();
        public List<TagDto> Tags { get; set; } = new List<TagDto>();
        public List<AudiobookTrackDto> AudiobookTracks { get; set; } = new List<AudiobookTrackDto>(); // Added for Audiobook feature
    }

    // DTO for Audiobook Track details
    public class AudiobookTrackDto
    {
        public int TrackId { get; set; }
        public string FilePath { get; set; } = string.Empty;
        public int TrackNumber { get; set; }
        public double? Duration { get; set; }
    }

    public class TextPartDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public int PartNumber { get; set; }
        public DateTime CreatedAt { get; set; }
        public bool IsFinished { get; set; }
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public DateTime? StatsUpdatedAt { get; set; }
        public int UnknownWords => Math.Max(TotalWords - KnownWords, 0);
        public double? UnknownWordPercentage =>
            TotalWords > 0 ? Math.Round((double)(TotalWords - KnownWords) / TotalWords * 100, 1) : (double?)null;
    }

    public class CreateBookDto
    {
        [Required]
        [StringLength(200)]
        public string Title { get; set; } = string.Empty;
        
        [StringLength(1000)]
        public string Description { get; set; } = string.Empty;
        
        [Required]
        public int LanguageId { get; set; }
        
        public string Content { get; set; } = string.Empty;
        
        [Required]
        public string SplitMethod { get; set; } = "paragraph"; // paragraph, sentence, length
        
        [Required]
        [Range(500, 50000)]
        public int MaxSegmentSize { get; set; } = 3000; // Default max characters per segment
        public List<string> Tags { get; set; } = new List<string>(); // Added Tags
    }

    public class UpdateLastReadDto
    {
        [Required]
        public int TextId { get; set; }
    }

    public class CompleteLessonDto
    {
        [Required]
        public int TextId { get; set; }
    }

    public class BookStatsDto
    {
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public int LearningWords { get; set; }
        public double CompletionPercentage { get; set; }
        public bool IsFinished { get; set; }
    }

    public sealed class FinishBookRequest
    {
        public decimal? Rating { get; set; }
    }

    public class NextLessonDto
    {
        public int? TextId { get; set; }
    }

    public class UpdateBookDto
    {
        [Required]
        [StringLength(200)]
        public string Title { get; set; } = string.Empty;

        // Add other fields if they should be updatable, e.g.:
        [StringLength(1000)]
        public string? Description { get; set; } // Uncommented Description
        public List<string> Tags { get; set; } = new List<string>(); // Added Tags
    }

    // DTO for Book Upload Request
    public class UploadBookDto
    {
        [Required]
        public int LanguageId { get; set; }

        public List<string>? Tags { get; set; } // Optional tags

        [Required]
        public IFormFile File { get; set; } = null!; // The uploaded file

        // Optional: Allow overriding title extracted from file
        [StringLength(200)]
        public string? TitleOverride { get; set; }

        // Optional: Allow specifying split method and size for upload
        [Required]
        public string SplitMethod { get; set; } = "paragraph"; // Default

        [Required]
        [Range(500, 50000)]
        public int MaxSegmentSize { get; set; } = 3000; // Default
    }

    // DTO for Audiobook Upload
    public class UploadAudiobookDto
    {
        [Required]
        public List<IFormFile> Files { get; set; } = new List<IFormFile>();
    }
}