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
using System.Text; // Added for StreamReader encoding
using System.Text.RegularExpressions; // Added for Regex HTML stripping
using VersOne.Epub; // Added for EPUB parsing
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Utilities;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize] // Restore authorization
    public class BooksController : ControllerBase
    {
        private readonly AppDbContext _context;

        public BooksController(AppDbContext context)
        {
            _context = context;
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
                    LanguageName = b.Language.Name,
                    CreatedAt = b.CreatedAt,
                    PartCount = b.Texts.Count,
                    LastReadTextId = b.LastReadTextId,
                    LastReadAt = b.LastReadAt,
                    TotalWords = b.TotalWords,
                    KnownWords = b.KnownWords,
                    LearningWords = b.LearningWords,
                    IsFinished = b.IsFinished,
                    Tags = b.BookTags.Select(bt => bt.Tag.Name).ToList() // Map Tag names
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
                LanguageName = book.Language.Name,
                LanguageId = book.LanguageId,
                CreatedAt = book.CreatedAt,
                Parts = book.Texts.OrderBy(t => t.PartNumber).Select(t => new TextPartDto
                {
                    TextId = t.TextId,
                    Title = t.Title,
                    PartNumber = t.PartNumber ?? 0,
                    CreatedAt = t.CreatedAt
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
                    // Fetch all tags into memory first to perform case-insensitive comparison client-side
                    var allTags = await _context.Tags.ToListAsync();
                    var existingTags = allTags
                        .Where(t => distinctNormalizedTags.Contains(t.Name.ToLowerInvariant()))
                        .ToList();

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
                            Console.WriteLine($"Skipping tag '{tagName}' because it exceeds the maximum length of 50 characters.");
                        }
                    }
                }
            }

            // 3. Add Book and New Tags to Context
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
                        // This case might happen if a tag was skipped due to length
                        Console.WriteLine($"Warning: Could not associate tag '{tag.Name}' as it might have been skipped or failed to save.");
                    }
                }
                // 6. Save Associations
                await _context.SaveChangesAsync();
            }


            // 7. Create initial text parts (Existing Logic)
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
                }
                await _context.SaveChangesAsync(); // Save Texts
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

            string bookTitle = uploadDto.TitleOverride ?? "Untitled Upload"; // Default title
            string bookContent = string.Empty;

            // --- File Processing ---
            try
            {
                using var stream = uploadDto.File.OpenReadStream();

                if (fileExtension == ".epub")
                {
                    // Use VersOne.Epub library
                    var epubBook = await VersOne.Epub.EpubReader.ReadBookAsync(stream);
                    bookTitle = uploadDto.TitleOverride ?? epubBook.Title ?? Path.GetFileNameWithoutExtension(uploadDto.File.FileName); // Use EPUB title or filename if override not provided

                    // Concatenate content from reading order, attempting to get text
                    var contentParts = new List<string>();
                    var contentBuilder = new StringBuilder();
                    // Iterate directly through the HTML content files
                    // Iterate through the reading order (EpubNavigationItem) to maintain sequence
                    // Iterate through the reading order, which contains EpubLocalTextContentFile objects
                    foreach (EpubLocalTextContentFile textFile in epubBook.ReadingOrder)
                    {
                        // Access the raw HTML content directly from the Content property
                        string htmlContent = textFile.Content ?? string.Empty;

                        // 1. Replace paragraph endings with double newlines
                        htmlContent = Regex.Replace(htmlContent, @"</p>", "\n\n", RegexOptions.IgnoreCase);
                        // 2. Replace <br> tags with single newlines
                        htmlContent = Regex.Replace(htmlContent, @"<br\s*/?>", "\n", RegexOptions.IgnoreCase);
                        // 3. Strip remaining HTML tags
                        string plainText = Regex.Replace(htmlContent, "<[^>]*>", string.Empty);
                        // 4. Decode HTML entities
                        plainText = System.Net.WebUtility.HtmlDecode(plainText);

                        // 5. Trim and add to list if not empty
                        string trimmedText = plainText.Trim();
                        if (!string.IsNullOrWhiteSpace(trimmedText))
                        {
                            contentParts.Add(trimmedText); // Add processed part to the list
                        }
                    }
                     // 6. Join the processed parts with double newlines
                    bookContent = string.Join("\n\n", contentParts);
                }
                else // Must be .txt based on earlier check
                {
                     bookTitle = uploadDto.TitleOverride ?? Path.GetFileNameWithoutExtension(uploadDto.File.FileName);
                     // Use StreamReader with encoding detection
                     using (var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
                     {
                         bookContent = await reader.ReadToEndAsync();
                     }
                }
            }
            catch (Exception ex)
            {
                // Log the exception (replace Console.WriteLine with proper logging in production)
                Console.WriteLine($"Error processing uploaded file '{uploadDto.File.FileName}': {ex.ToString()}");
                return StatusCode(StatusCodes.Status500InternalServerError, $"Error processing uploaded file: {ex.Message}");
            }

            if (string.IsNullOrWhiteSpace(bookContent))
            {
                 return BadRequest("Could not extract readable content from the uploaded file.");
            }

            // --- Book and Tag Creation (Similar to CreateBook) ---

            // 1. Create Book entity
            var book = new Book
            {
                Title = bookTitle.Length > 200 ? bookTitle.Substring(0, 200) : bookTitle, // Ensure title fits DB constraint
                Description = $"Uploaded from {uploadDto.File.FileName}", // Simple description
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
                    // Fetch all tags into memory first to perform case-insensitive comparison client-side
                    var allTagsUpload = await _context.Tags.ToListAsync();
                    var existingTags = allTagsUpload
                        .Where(t => distinctNormalizedTags.Contains(t.Name.ToLowerInvariant()))
                        .ToList();
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
                             Console.WriteLine($"Skipping tag '{tagName}' during upload because it exceeds the maximum length of 50 characters.");
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
            }
            catch (DbUpdateException ex)
            {
                 Console.WriteLine($"Error saving book/new tags during upload: {ex.ToString()}");
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
                         Console.WriteLine($"Warning: Could not associate tag '{tag.Name}' during upload as it lacks an ID.");
                     }
                }
                // 6. Save Associations
                 try
                 {
                    await _context.SaveChangesAsync();
                 }
                 catch (DbUpdateException ex)
                 {
                     Console.WriteLine($"Error saving book tag associations during upload: {ex.ToString()}");
                     // Consider if this error is critical enough to stop; maybe just log and continue
                 }
            }

            // --- Text Splitting and Creation ---
            int partCount = 0;
            try
            {
                var textParts = SplitContent(bookContent, uploadDto.SplitMethod, uploadDto.MaxSegmentSize);
                partCount = textParts.Count;
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
                }
                await _context.SaveChangesAsync(); // Save Texts
            }
            catch (Exception ex)
            {
                 Console.WriteLine($"Error splitting or saving text parts during upload: {ex.ToString()}");
                 // Decide how to handle: Maybe delete the book created earlier? Or return error?
                 // For now, return an error indicating partial success/failure.
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
            int currentMaxTrackNumber = book.AudiobookTracks.Any() ? book.AudiobookTracks.Max(t => t.TrackNumber) : 0;

            foreach (var file in uploadDto.Files)
            {
                if (file.Length == 0) continue;

                // Basic check for MP3 extension (can be improved with MIME type checking)
                var fileExtension = Path.GetExtension(file.FileName)?.ToLowerInvariant();
                if (fileExtension != ".mp3")
                {
                    // Log or return specific error for non-mp3 files? For now, skip.
                    Console.WriteLine($"Skipping non-MP3 file: {file.FileName}");
                    continue;
                }

                currentMaxTrackNumber++;
                var trackNumber = currentMaxTrackNumber;
                // Sanitize filename or create a structured one
                var safeFileName = $"track_{trackNumber}{fileExtension}"; // Example: track_1.mp3
                var relativeFilePath = Path.Combine(relativeBookAudioPath, safeFileName);
                var absoluteFilePath = Path.Combine(absoluteBookAudioPath, safeFileName);

                try
                {
                    // Save the file
                    using (var stream = new FileStream(absoluteFilePath, FileMode.Create))
                    {
                        await file.CopyToAsync(stream);
                    }

                    // Create AudiobookTrack entity
                    var newTrack = new AudiobookTrack
                    {
                        BookId = bookId,
                        FilePath = relativeFilePath.Replace('\\', '/'), // Store with forward slashes for web compatibility
                        TrackNumber = trackNumber,
                        Duration = null // TODO: Optionally add duration extraction later
                    };
                    addedTracks.Add(newTrack);
                }
                catch (Exception ex)
                {
                    // Log error saving file
                    Console.WriteLine($"Error saving audiobook file '{file.FileName}' for book {bookId}: {ex.Message}");
                    // Consider how to handle partial failures - rollback? return error?
                    // For now, continue processing other files but maybe return a specific status code later.
                }
            }

            if (!addedTracks.Any())
            {
                return BadRequest("No valid MP3 files were processed.");
            }

            // 4. Add new tracks to context and save
            _context.AudiobookTracks.AddRange(addedTracks);
            await _context.SaveChangesAsync();

            // 5. Return success response (e.g., list of created track info or just Ok)
            // Returning NoContent for simplicity
            return NoContent();
        }

        // Helper method to split content into parts
        private List<string> SplitContent(string content, string splitMethod, int maxSegmentSize)
        {
            var result = new List<string>();
            
            switch (splitMethod.ToLower())
            {
                case "paragraph":
                    // Split by paragraphs
                    var paragraphs = content.Split(new[] { "\r\n\r\n", "\n\n" }, StringSplitOptions.RemoveEmptyEntries);
                    
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
            
            var book = await _context.Books
                .Where(b => b.BookId == id && b.UserId == userId)
                .Include(b => b.Language)  // Include the language
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
            
            // Count all words in the text (not just unique words)
            int totalWordCount = WordCountUtility.CountTotalWords(text.Content);
            
            // Get the language directly from the database to update it
            var language = await _context.Languages.FindAsync(book.LanguageId);
            if (language != null)
            {
                // Update the language WordsRead counter
                language.WordsRead += totalWordCount;
                
                // Explicitly mark the language entity as modified
                _context.Entry(language).State = EntityState.Modified;
                
                // Track this reading activity for statistics
                var activity = new UserActivity
                {
                    UserId = userId,
                    LanguageId = language.LanguageId,
                    ActivityType = "TextCompleted",
                    WordCount = totalWordCount,
                    Timestamp = DateTime.UtcNow
                };
                _context.UserActivities.Add(activity);
                
                // Save the change immediately
                await _context.SaveChangesAsync();
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
                    TotalTextsCompleted = 1,
                    LastUpdatedAt = DateTime.UtcNow
                };
                _context.UserLanguageStatistics.Add(stats);
            }
            else
            {
                stats.TotalWordsRead += totalWordCount;
                stats.TotalTextsCompleted += 1;
                stats.LastUpdatedAt = DateTime.UtcNow;
            }
            await _context.SaveChangesAsync();
            
            // Get unique words from this text
            var textWords = text.TextWords.Select(tw => tw.Word).ToList();
            var knownWords = textWords.Count(w => w.Status >= 4);
            var learningWords = textWords.Count(w => w.Status >= 2 && w.Status < 4);
            
            // Update user's words
            var userWords = await _context.Words
                .Where(w => w.UserId == userId && textWords.Select(tw => tw.Term.ToLower()).Contains(w.Term.ToLower()))
                .ToListAsync();
            
            foreach (var word in textWords)
            {
                var userWord = userWords.FirstOrDefault(w => w.Term.ToLower() == word.Term.ToLower());
                if (userWord != null)
                {
                    if (userWord.Status < 5) // Only update if not mastered
                    {
                        userWord.Status = Math.Min(userWord.Status + 1, 5);
                    }
                }
            }
            
            // Update book stats
            book.TotalWords = await _context.TextWords
                .Where(tw => tw.Text.BookId == id)
                .Select(tw => tw.Word)
                .Distinct()
                .CountAsync();
            
            book.KnownWords = await _context.TextWords
                .Where(tw => tw.Text.BookId == id)
                .Select(tw => tw.Word)
                .Where(w => w.Status >= 4)
                .Distinct()
                .CountAsync();
            
            book.LearningWords = await _context.TextWords
                .Where(tw => tw.Text.BookId == id)
                .Select(tw => tw.Word)
                .Where(w => w.Status >= 2 && w.Status < 4)
                .Distinct()
                .CountAsync();
            
            book.LastReadAt = DateTime.UtcNow;
            book.LastReadTextId = text.TextId;
            book.LastReadPartId = text.PartNumber;
            
            await _context.SaveChangesAsync();
            
            // Calculate completion percentage based on text position
            // Get total number of texts/parts in this book
            int totalTexts = await _context.Texts
                .Where(t => t.BookId == id)
                .CountAsync();

            double completionPercentage;
            // Check if this is the last lesson
            if (totalTexts > 0 && text.PartNumber == totalTexts)
            {
                book.IsFinished = true;
                completionPercentage = 100.0;
            }
            else
            {
                // Calculate progress based on current part number and format to 2 decimal places
                // Use ?? 0 to handle potential (though unlikely) null PartNumber
                completionPercentage = totalTexts > 0
                    ? Math.Round(((double)(text.PartNumber ?? 0) / totalTexts) * 100, 2)
                    : 0;
            }
            // Save changes again to persist IsFinished if updated
            await _context.SaveChangesAsync();
            
            return new BookStatsDto
            {
                TotalWords = book.TotalWords,
                KnownWords = book.KnownWords,
                LearningWords = book.LearningWords,
                CompletionPercentage = completionPercentage,
                IsFinished = book.IsFinished
            };
        }

        // PUT: api/books/5/finish
        [HttpPut("{id}/finish")]
        public async Task<ActionResult<BookStatsDto>> FinishBook(int id)
        {
            var userId = GetUserId();
            
            var book = await _context.Books
                .Where(b => b.BookId == id && b.UserId == userId)
                .Include(b => b.Language)  // Include the language
                .Include(b => b.Texts)
                .FirstOrDefaultAsync();
                
            if (book == null)
            {
                return NotFound("Book not found");
            }
            
            if (book.Language == null)
            {
                return BadRequest("Book language not found");
            }
            
            // Count all words in all texts of the book
            int totalWordCount = WordCountUtility.CountWordsInTexts(book.Texts);
            
            // Update the language WordsRead counter
            WordCountUtility.UpdateLanguageWordCount(book.Language, totalWordCount);
            // Explicitly mark the language entity as modified
            _context.Entry(book.Language).State = EntityState.Modified;
            
            // Track this reading activity for statistics
            var activity = new UserActivity
            {
                UserId = userId,
                LanguageId = book.LanguageId,
                ActivityType = "BookFinished",
                WordCount = totalWordCount,
                Timestamp = DateTime.UtcNow
            };
            _context.UserActivities.Add(activity);
            
            // Get all unique words from all texts in the book
            var textWords = await _context.TextWords
                .Where(tw => tw.Text.BookId == id)
                .Include(tw => tw.Word)
                .ToListAsync();
            
            var uniqueWords = textWords.Select(tw => tw.Word).GroupBy(w => w.Term.ToLower()).Select(g => g.First()).ToList();
            
            // Mark all words as known
            foreach (var word in uniqueWords)
            {
                word.Status = 5; // Mastered
            }
            
            // Update book stats
            book.TotalWords = uniqueWords.Count;
            book.KnownWords = uniqueWords.Count; // All words are now known
            book.LearningWords = 0;
            book.LastReadAt = DateTime.UtcNow;
            book.IsFinished = true;
            
            await _context.SaveChangesAsync();
            
            return new BookStatsDto
            {
                TotalWords = book.TotalWords,
                KnownWords = book.KnownWords,
                LearningWords = book.LearningWords,
                CompletionPercentage = 100,
                IsFinished = true
            };
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
                    // Fetch all tags into memory first to perform case-insensitive comparison client-side
                    var allTagsUpdate = await _context.Tags.ToListAsync();
                    var existingTags = allTagsUpdate
                        .Where(t => desiredTagNamesLower.Contains(t.Name.ToLowerInvariant()))
                        .ToList();

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
                            Console.WriteLine($"Skipping tag '{tagName}' during update because it exceeds the maximum length of 50 characters.");
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
                         .Where(t => tagNamesToAdd.Contains(t.Name.ToLowerInvariant()))
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
                Console.WriteLine($"Error updating book tags: {ex.Message}"); // Basic logging
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
                // Log the exception details for debugging
                // logger.LogError(ex, "Error deleting book with ID {BookId}", id);
                return StatusCode(StatusCodes.Status500InternalServerError, "Error deleting book.");
            }


            return NoContent();
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

        private async Task<bool> BookExists(int id, Guid userId)
        {
            return await _context.Books.AnyAsync(e => e.BookId == id && e.UserId == userId);
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
        public string LanguageName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public int PartCount { get; set; }
        public int? LastReadTextId { get; set; }
        public DateTime? LastReadAt { get; set; }
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public int LearningWords { get; set; }
        public bool IsFinished { get; set; }
        public double CompletionPercentage => TotalWords > 0 ? 
            Math.Round((double)(KnownWords + LearningWords) / TotalWords * 100, 1) : 0;
        public List<string> Tags { get; set; } = new List<string>(); // Added Tags
    }

    public class BookDetailDto
    {
        public int BookId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string LanguageName { get; set; } = string.Empty;
        public int LanguageId { get; set; }
        public DateTime CreatedAt { get; set; }
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