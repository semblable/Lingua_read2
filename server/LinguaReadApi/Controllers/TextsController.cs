using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Logging;
using System.IO;
using LinguaReadApi.Services;
namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class TextsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<TextsController> _logger;
        private readonly IUserActivityService _userActivityService; // Inject activity service
        private const int MaxRecentTexts = 5;

        public TextsController(AppDbContext context, ILogger<TextsController> logger, IUserActivityService userActivityService) // Inject services
        {
            _context = context;
            _logger = logger;
            _userActivityService = userActivityService; // Assign service
        }

        // GET: api/texts
        [HttpGet]
        public async Task<ActionResult<IEnumerable<TextDto>>> GetTexts()
        {
            var userId = GetUserId();

            var texts = await _context.Texts
                .Where(t => t.UserId == userId)
                .Include(t => t.Language)
                .Include(t => t.Book) // Include Book for BookTitle
                .OrderByDescending(t => t.CreatedAt) // Order by creation date by default
                .Select(t => new TextDto
                {
                    TextId = t.TextId,
                    Title = t.Title,
                    LanguageName = t.Language.Name,
                    CreatedAt = t.CreatedAt,
                    Tag = t.Tag,
                    IsAudioLesson = t.IsAudioLesson,
                    BookId = t.BookId,
                    BookTitle = t.Book != null ? t.Book.Title : null // Include BookTitle
                })
                .ToListAsync();

            return texts;
        }

        // GET: api/texts/5
        [HttpGet("{id}")]
        public async Task<ActionResult<TextDetailDto>> GetText(int id)
        {
            var userId = GetUserId();

            // --- Step 1: Fetch data without tracking ---
            var textDto = await _context.Texts
                .AsNoTracking() // Fetch without tracking to avoid change detection issues
                .Where(t => t.TextId == id && t.UserId == userId)
                .Include(t => t.Language)
                .Include(t => t.Book)
                .Include(t => t.TextWords)
                    .ThenInclude(tw => tw.Word)
                        .ThenInclude(w => w.Translation)
                .Select(text => new TextDetailDto // Project directly to DTO
                {
                     TextId = text.TextId,
                     Title = text.Title,
                     Content = text.Content,
                     LanguageId = text.LanguageId,
                     LanguageCode = text.Language.Code, // Assuming Language is always loaded
                     LanguageName = text.Language.Name,
                     BookId = text.BookId,
                     BookTitle = text.Book != null ? text.Book.Title : null,
                     IsAudioLesson = text.IsAudioLesson, // Include audio lesson fields
                     AudioFilePath = text.AudioFilePath,
                     SrtContent = text.SrtContent,
                     CreatedAt = text.CreatedAt,
                     Words = text.TextWords.Select(tw => new WordDto
                     {
                         WordId = tw.Word.WordId,
                         Term = tw.Word.Term,
                         Status = tw.Word.Status,
                         Translation = tw.Word.Translation != null ? tw.Word.Translation.Translation : null
                     }).ToList()
                })
                .FirstOrDefaultAsync();

            if (textDto == null)
            {
                return NotFound();
            }

            // --- Step 2: Perform separate update for LastAccessedAt ---
            try
            {
                var textToUpdate = new Text { TextId = id, UserId = userId }; // Create minimal entity stub
                _context.Texts.Attach(textToUpdate); // Attach the stub
                textToUpdate.LastAccessedAt = DateTime.UtcNow; // Mark only LastAccessedAt as modified
                 _context.Entry(textToUpdate).Property(x => x.LastAccessedAt).IsModified = true;

                await _context.SaveChangesAsync(); // Save only the timestamp change
                // Removed reference to LastAccessedAt on textDto (does not exist in DTO)
            }
            catch (DbUpdateConcurrencyException ex)
            {
                 _logger.LogWarning(ex, "Concurrency error updating LastAccessedAt for TextId {TextId}", id);
                 // Non-critical, proceed with returning potentially slightly stale LastAccessedAt in DTO
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error saving LastAccessedAt for TextId {TextId}", id);
                // Non-critical, proceed with returning potentially slightly stale LastAccessedAt in DTO
            }
            // --- End Update ---

            // --- Step 3: Return the DTO ---
            // Mapping is already done via .Select()
            var textDetail = textDto; // Assign the created DTO

            // Removed legacy mapping code. Use the projected DTO directly.
            return textDto;
        }

        // GET: api/texts/recent
        [HttpGet("recent")]
        public async Task<ActionResult<IEnumerable<RecentTextDto>>> GetRecentTexts()
        {
            var userId = GetUserId();

            var recentTexts = await _context.Texts
                .Where(t => t.UserId == userId && t.LastAccessedAt != null)
                .OrderByDescending(t => t.LastAccessedAt)
                .Take(MaxRecentTexts)
                .Include(t => t.Language)
                .Include(t => t.Book) // Include Book for title and context
                .Select(t => new RecentTextDto // Use a specific DTO for recent texts
                {
                    TextId = t.TextId,
                    Title = t.Title,
                    LanguageName = t.Language.Name,
                    LastAccessedAt = t.LastAccessedAt ?? DateTime.MinValue, // Use default if somehow null despite Where clause
                    IsAudioLesson = t.IsAudioLesson,
                    BookId = t.BookId,
                    BookTitle = t.Book != null ? t.Book.Title : null,
                    PartNumber = t.PartNumber
                })
                .ToListAsync();

            return recentTexts;
        }


        // POST: api/texts
        [HttpPost]
        public async Task<ActionResult<TextDto>> CreateText([FromBody] CreateTextDto createTextDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            var userId = GetUserId();

            // Check if language exists
            var languageExists = await _context.Languages.AnyAsync(l => l.LanguageId == createTextDto.LanguageId);
            if (!languageExists)
            {
                return BadRequest("Invalid language ID");
            }

            var text = new Text
            {
                Title = createTextDto.Title,
                Content = createTextDto.Content,
                LanguageId = createTextDto.LanguageId,
                UserId = userId,
                Tag = createTextDto.Tag, // Assign the tag
                CreatedAt = DateTime.UtcNow,
                LastAccessedAt = null // Explicitly null on creation
            };

            _context.Texts.Add(text);
            await _context.SaveChangesAsync();

            // --- Parse and link words ---
            var content = text.Content;
            var languageId = text.LanguageId;

            // Basic word parsing: split on whitespace and punctuation
            var separators = new char[] { ' ', '\t', '\r', '\n', '.', ',', ';', ':', '!', '?', '\"', '\'', '(', ')', '[', ']', '{', '}', '-', '_', '/', '\\', '|', '@', '#', '$', '%', '^', '&', '*', '+', '=', '<', '>', '`', '~' };
            var wordsInText = content.Split(separators, StringSplitOptions.RemoveEmptyEntries)
                                     .Select(w => w.Trim().ToLowerInvariant())
                                     .Where(w => !string.IsNullOrWhiteSpace(w))
                                     .ToList();

            var uniqueWords = wordsInText.Distinct().ToList();

            // Fetch existing words for this user and language without tracking to improve performance
            var existingWords = await _context.Words
                .AsNoTracking() // Prevent tracking related entities like Language
                .Where(w => w.UserId == userId && w.LanguageId == languageId && uniqueWords.Contains(w.Term.ToLower()))
                .ToDictionaryAsync(w => w.Term.ToLower());

            var newWords = new List<Word>();

            foreach (var wordTerm in uniqueWords)
            {
                if (!existingWords.ContainsKey(wordTerm))
                {
                    var newWord = new Word
                    {
                        UserId = userId,
                        LanguageId = languageId,
                        Term = wordTerm,
                        Status = 0, // Default status (unknown/learning)
                        CreatedAt = DateTime.UtcNow
                    };
                    _context.Words.Add(newWord);
                    newWords.Add(newWord);
                    existingWords[wordTerm] = newWord; // Add to dictionary for linking
                }
            }

            await _context.SaveChangesAsync(); // Save new words to get their IDs

            // Link all word occurrences in the text using bulk insert
            var textWordsToAdd = new List<TextWord>();
            foreach (var wordTerm in wordsInText)
            {
                if (existingWords.TryGetValue(wordTerm, out var word))
                {
                    var textWord = new TextWord
                    {
                        TextId = text.TextId,
                        WordId = word.WordId,
                        CreatedAt = DateTime.UtcNow
                    };
                    textWordsToAdd.Add(textWord); // Add to list instead of context directly
                }
            }

            if (textWordsToAdd.Any())
            {
                await _context.TextWords.AddRangeAsync(textWordsToAdd); // Add the whole batch
                await _context.SaveChangesAsync(); // Save all TextWord links in one go
            }

            var language = await _context.Languages.FindAsync(text.LanguageId);

            var textDto = new TextDto
            {
                TextId = text.TextId,
                Title = text.Title,
                LanguageName = language?.Name ?? "Unknown", // Handle potential null
                CreatedAt = text.CreatedAt,
                Tag = text.Tag,
                IsAudioLesson = text.IsAudioLesson,
                BookId = text.BookId,
                BookTitle = null // No book on direct text creation
            };

            return CreatedAtAction(nameof(GetText), new { id = text.TextId }, textDto);
        }

        // POST: api/texts/audio
        [HttpPost("audio")]
        [Consumes("multipart/form-data")] // Specify content type
        [RequestSizeLimit(100 * 1024 * 1024)] // 100 MB limit, match Program.cs
        [RequestFormLimits(MultipartBodyLengthLimit = 100 * 1024 * 1024, ValueLengthLimit = int.MaxValue)] // Match Program.cs
        public async Task<ActionResult<TextDto>> CreateAudioLesson([FromForm] CreateAudioLessonDto createAudioLessonDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            if (createAudioLessonDto.AudioFile == null || createAudioLessonDto.AudioFile.Length == 0)
            {
                return BadRequest("Audio file is required.");
            }

            if (createAudioLessonDto.SrtFile == null || createAudioLessonDto.SrtFile.Length == 0)
            {
                return BadRequest("SRT file is required.");
            }

            // Basic validation for file types (can be improved)
            if (!createAudioLessonDto.AudioFile.ContentType.StartsWith("audio/"))
            {
                return BadRequest("Invalid audio file type.");
            }
            // SRT files often don't have a standard MIME type, check extension
            if (!createAudioLessonDto.SrtFile.FileName.EndsWith(".srt", StringComparison.OrdinalIgnoreCase))
            {
                 return BadRequest("Invalid SRT file type. Must be .srt");
            }


            var userId = GetUserId();

            // Check if language exists
            var languageExists = await _context.Languages.AnyAsync(l => l.LanguageId == createAudioLessonDto.LanguageId);
            if (!languageExists)
            {
                return BadRequest("Invalid language ID");
            }

            string? audioFilePath = null;
            string? srtContent = null;
            string? transcript = null;

            try
            {
                // --- 1. Save Audio File ---
                var audioFileName = $"{Guid.NewGuid()}_{Path.GetFileName(createAudioLessonDto.AudioFile.FileName)}";
                var userAudioDir = Path.Combine("wwwroot", "audio_lessons", userId.ToString()); // Consider configuration for base path
                Directory.CreateDirectory(userAudioDir); // Ensure directory exists
                var fullAudioPath = Path.Combine(userAudioDir, audioFileName);

                using (var stream = new FileStream(fullAudioPath, FileMode.Create))
                {
                    await createAudioLessonDto.AudioFile.CopyToAsync(stream);
                }
                // Store relative path for access via web server
                audioFilePath = Path.Combine("audio_lessons", userId.ToString(), audioFileName).Replace("\\", "/");


                // --- 2. Read and Parse SRT File ---
                using (var reader = new StreamReader(createAudioLessonDto.SrtFile.OpenReadStream()))
                {
                    srtContent = await reader.ReadToEndAsync();
                }
                transcript = ParseSrt(srtContent); // Placeholder for SRT parsing function

                if (string.IsNullOrWhiteSpace(transcript))
                {
                    return BadRequest("Could not parse transcript from SRT file.");
                }

                // --- 3. Create Text Entity ---
                var text = new Text
                {
                    Title = createAudioLessonDto.Title,
                    Content = transcript, // Use parsed transcript as main content
                    LanguageId = createAudioLessonDto.LanguageId,
                    UserId = userId,
                    CreatedAt = DateTime.UtcNow,
                    IsAudioLesson = true,
                    AudioFilePath = audioFilePath,
                    SrtContent = srtContent,
                    Tag = createAudioLessonDto.Tag, // Assign the tag
                    LastAccessedAt = null // Explicitly null on creation
                };

                _context.Texts.Add(text);
                await _context.SaveChangesAsync();

                // --- Parse and link words from transcript ---
                var content = transcript;
                var languageId = text.LanguageId;

                // Basic word parsing: split on whitespace and punctuation
                var separators = new char[] { ' ', '\t', '\r', '\n', '.', ',', ';', ':', '!', '?', '\"', '\'', '(', ')', '[', ']', '{', '}', '-', '_', '/', '\\', '|', '@', '#', '$', '%', '^', '&', '*', '+', '=', '<', '>', '`', '~' };
                var wordsInText = content.Split(separators, StringSplitOptions.RemoveEmptyEntries)
                                         .Select(w => w.Trim().ToLowerInvariant())
                                         .Where(w => !string.IsNullOrWhiteSpace(w))
                                         .ToList();

                var uniqueWords = wordsInText.Distinct().ToList();

                // Fetch existing words for this user and language without tracking
                var existingWordsQuery = _context.Words
                    .AsNoTracking() // Prevent tracking related entities like Language
                    .Where(w => w.UserId == userId && w.LanguageId == languageId && uniqueWords.Contains(w.Term.ToLower()));

                // --- DEBUG LOGGING START ---
                var wordsBeforeDict = await existingWordsQuery.ToListAsync(); // Fetch results first
                _logger.LogInformation("User {UserId}, Language {LanguageId}: Found {Count} existing words matching terms from the text.", userId, languageId, wordsBeforeDict.Count);

                var wordsGroupedByLowerTerm = wordsBeforeDict
                    .GroupBy(w => w.Term.ToLowerInvariant())
                    .Where(g => g.Count() > 1) // Find terms that appear more than once after lowercasing
                    .ToList();

                if (wordsGroupedByLowerTerm.Any())
                {
                    foreach (var group in wordsGroupedByLowerTerm)
                    {
                        _logger.LogWarning("User {UserId}, Language {LanguageId}: Duplicate key potential for term '{Term}'. Found {Count} entries: {WordIds}",
                            userId, languageId, group.Key, group.Count(), string.Join(", ", group.Select(w => w.Term)));
                    }
                    // Log all fetched terms for broader context if duplicates found
                     _logger.LogInformation("User {UserId}, Language {LanguageId}: All fetched terms before dictionary creation: {Terms}", userId, languageId, string.Join(", ", wordsBeforeDict.Select(w => $"'{w.Term}'")));
                }
                // --- DEBUG LOGGING END ---

                // Create dictionary safely even if duplicates exist (lowercased)
                var existingWords = wordsBeforeDict
                    .GroupBy(w => w.Term.ToLowerInvariant())
                    .ToDictionary(g => g.Key, g => g.First());

                var newWords = new List<Word>();

                foreach (var wordTerm in uniqueWords)
                {
                    if (!existingWords.ContainsKey(wordTerm))
                    {
                        var newWord = new Word
                        {
                            UserId = userId,
                            LanguageId = languageId,
                            Term = wordTerm,
                            Status = 0, // Default status (unknown/learning)
                            CreatedAt = DateTime.UtcNow
                        };
                        _context.Words.Add(newWord);
                        newWords.Add(newWord);
                        existingWords[wordTerm] = newWord; // Add to dictionary for linking
                    }
                }

                await _context.SaveChangesAsync(); // Save new words to get their IDs

                // Link all word occurrences in the transcript using bulk insert
                // Note: This currently links only *unique* words. If you need to link every occurrence,
                // the loop should iterate over 'wordsInText' instead of 'uniqueWords'.
                var textWordsToAdd = new List<TextWord>();
                foreach (var wordTerm in uniqueWords) // Iterating unique words as per original logic
                {
                    if (existingWords.TryGetValue(wordTerm, out var word))
                    {
                        var textWord = new TextWord
                        {
                            TextId = text.TextId,
                            WordId = word.WordId,
                            CreatedAt = DateTime.UtcNow
                        };
                        textWordsToAdd.Add(textWord); // Add to list instead of context directly
                    }
                }
    
                 if (textWordsToAdd.Any())
                {
                    await _context.TextWords.AddRangeAsync(textWordsToAdd); // Add the whole batch
                    await _context.SaveChangesAsync(); // Save all TextWord links in one go
                }

                // --- 4. Return Response ---
                var language = await _context.Languages.FindAsync(text.LanguageId);
                var textDto = new TextDto
                {
                    TextId = text.TextId,
                    Title = text.Title,
                    LanguageName = language?.Name ?? "Unknown", // Handle potential null language
                    CreatedAt = text.CreatedAt,
                    Tag = text.Tag,
                    IsAudioLesson = text.IsAudioLesson,
                    BookId = text.BookId,
                    BookTitle = null // No book context here
                };

                return CreatedAtAction(nameof(GetText), new { id = text.TextId }, textDto);
            }
            catch (Exception ex) // Basic error handling
            {
                _logger.LogError(ex, "Error creating audio lesson for user {UserId}", userId); // Use structured logging
                // Consider cleanup: delete saved audio file if creation fails halfway
                if (!string.IsNullOrEmpty(audioFilePath))
                {
                     // Attempt to delete saved file on error
                    var fullPathToDelete = Path.Combine("wwwroot", audioFilePath.Replace("/", "\\"));
                     if(System.IO.File.Exists(fullPathToDelete)) {
                         try { System.IO.File.Delete(fullPathToDelete); } catch (IOException ioEx) { _logger.LogWarning(ioEx, "Failed to delete audio file during cleanup: {FilePath}", fullPathToDelete); }
                     }
                }
                return StatusCode(500, $"Internal server error: {ex.Message}");
            }
        }

        // Placeholder for SRT parsing logic
        private string ParseSrt(string srtContent)
        {
            // Simple SRT parser: Extracts lines that don't contain '-->' and aren't sequence numbers
            var lines = srtContent.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);
            var transcriptLines = new List<string>();
            foreach (var line in lines)
            {
                if (!string.IsNullOrWhiteSpace(line) && !line.Contains("-->") && !int.TryParse(line, out _))
                {
                    transcriptLines.Add(line.Trim());
                }
            }
            return string.Join(" ", transcriptLines); // Join lines into a single transcript string
        }


        // POST: api/texts/audio/batch
        [HttpPost("audio/batch")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(500 * 1024 * 1024)] // Increase limit for batch uploads (e.g., 500MB) - Adjust as needed
        [RequestFormLimits(MultipartBodyLengthLimit = 500 * 1024 * 1024, ValueLengthLimit = int.MaxValue)]
        public async Task<ActionResult> CreateAudioLessonsBatch([FromForm] CreateAudioLessonsBatchDto dto, List<IFormFile> files)
        {
            if (files == null || files.Count == 0)
            {
                return BadRequest("No files uploaded.");
            }
             if (!ModelState.IsValid) // Validate DTO
            {
                return BadRequest(ModelState);
            }

            var userId = GetUserId();
            _logger.LogInformation("Starting batch audio lesson creation for user {UserId}. Files received: {FileCount}", userId, files.Count);

            // Check language exists
            var languageExists = await _context.Languages.AnyAsync(l => l.LanguageId == dto.LanguageId);
            if (!languageExists)
            {
                return BadRequest("Invalid language ID provided for the batch.");
            }

            var createdCount = 0;
            var skippedFiles = new List<string>();
            var processedBaseNames = new HashSet<string>(); // To track processed pairs

            // --- Start: Fuzzy Pairing Logic ---
            var fileInfos = files.Select(f => ParseFileInfo(f)).ToList();

            var mp3Infos = fileInfos.Where(fi => fi.Type == FileType.MP3 && !fi.HasError).ToList();
            var srtInfos = fileInfos.Where(fi => fi.Type == FileType.SRT && !fi.HasError).ToList();
            var availableSrts = new List<FileInfoResult>(srtInfos); // Track unmatched SRTs

            var processedFiles = new HashSet<string>(); // Track original filenames that have been processed (paired or skipped)

            _logger.LogInformation("Attempting fuzzy pairing. MP3s found: {Mp3Count}, SRTs found: {SrtCount}", mp3Infos.Count, srtInfos.Count);

            // Process each MP3 individually and find the best matching SRT
            foreach (var mp3Info in mp3Infos)
            {
                if (processedFiles.Contains(mp3Info.OriginalName))
                    continue;

                processedFiles.Add(mp3Info.OriginalName);

                // Find best matching SRT using longest common prefix
                var bestMatch = FindBestSrtMatch(mp3Info, availableSrts);

                if (bestMatch != null)
                {
                    var srtInfo = bestMatch;
                    availableSrts.Remove(srtInfo); // Remove from available pool
                    processedFiles.Add(srtInfo.OriginalName); // Mark SRT as processed

                    _logger.LogInformation("Processing pair: MP3 '{Mp3Name}' matched with SRT '{SrtName}'",
                        mp3Info.OriginalName, srtInfo.OriginalName);

                    string? audioFilePath = null;
                    try
                    {
                        // --- 1. Save Audio File ---
                        var audioFileName = $"{Guid.NewGuid()}_{Path.GetFileName(mp3Info.File.FileName)}";
                        var userAudioDir = Path.Combine("wwwroot", "audio_lessons", userId.ToString());
                        Directory.CreateDirectory(userAudioDir);
                        var fullAudioPath = Path.Combine(userAudioDir, audioFileName);

                        using (var stream = new FileStream(fullAudioPath, FileMode.Create))
                        {
                            await mp3Info.File.CopyToAsync(stream);
                        }
                        audioFilePath = Path.Combine("audio_lessons", userId.ToString(), audioFileName).Replace("\\", "/");

                        // --- 2. Read and Parse SRT File ---
                        string srtContent;
                        using (var reader = new StreamReader(srtInfo.File.OpenReadStream()))
                        {
                            srtContent = await reader.ReadToEndAsync();
                        }
                        string transcript = ParseSrt(srtContent);

                        if (string.IsNullOrWhiteSpace(transcript))
                        {
                            _logger.LogWarning("Could not parse transcript from SRT file: {SrtFileName}. Skipping.", srtInfo.OriginalName);
                            skippedFiles.Add($"{mp3Info.OriginalName} / {srtInfo.OriginalName} (Transcript parsing failed)");
                            if (!string.IsNullOrEmpty(audioFilePath)) {
                                 var fullPathToDelete = Path.Combine("wwwroot", audioFilePath.Replace("/", "\\"));
                                 if(System.IO.File.Exists(fullPathToDelete)) try { System.IO.File.Delete(fullPathToDelete); } catch (IOException ioEx) { _logger.LogWarning(ioEx, "Failed to delete audio file during cleanup: {FilePath}", fullPathToDelete); }
                            }
                            continue;
                        }

                        // --- 3. Create Text Entity ---
                        var text = new Text
                        {
                            Title = mp3Info.BaseName, // Use MP3's original base name for title
                            Content = transcript,
                            LanguageId = dto.LanguageId,
                            UserId = userId,
                            CreatedAt = DateTime.UtcNow,
                            IsAudioLesson = true,
                            AudioFilePath = audioFilePath,
                            SrtContent = srtContent,
                            Tag = dto.Tag,
                            LastAccessedAt = null // Explicitly null on creation
                        };
                        _context.Texts.Add(text);
                        createdCount++;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error processing pair. MP3: {Mp3Name}, SRT: {SrtName}. Skipping.", mp3Info.OriginalName, srtInfo.OriginalName);
                        skippedFiles.Add($"{mp3Info.OriginalName} / {srtInfo.OriginalName} (Error: {ex.Message})");
                        if (!string.IsNullOrEmpty(audioFilePath)) {
                            var fullPathToDelete = Path.Combine("wwwroot", audioFilePath.Replace("/", "\\"));
                            if(System.IO.File.Exists(fullPathToDelete)) try { System.IO.File.Delete(fullPathToDelete); } catch (IOException ioEx) { _logger.LogWarning(ioEx, "Failed to delete audio file during cleanup: {FilePath}", fullPathToDelete); }
                        }
                    }
                }
                else // No matching SRT found
                {
                    _logger.LogWarning("No SRT match found for MP3: {Mp3Name}", mp3Info.OriginalName);
                    skippedFiles.Add($"{mp3Info.OriginalName} (Missing SRT Pair)");
                }
            }

            // Identify any remaining SRTs that weren't processed (missing MP3 pair or format error)
            var unprocessedSrtInfos = fileInfos.Where(fi => fi.Type == FileType.SRT && !processedFiles.Contains(fi.OriginalName)).ToList();
            foreach (var srtInfo in unprocessedSrtInfos)
            {
                 if (srtInfo.HasError)
                 {
                     skippedFiles.Add($"{srtInfo.OriginalName} ({srtInfo.ErrorMessage})");
                 }
                 else
                 {
                     skippedFiles.Add($"{srtInfo.OriginalName} (Missing MP3 Pair)");
                 }
                 processedFiles.Add(srtInfo.OriginalName); // Ensure it's marked processed
            }

             // Add any remaining MP3s (should only be those with format errors, if any added later)
             var unprocessedMp3Infos = fileInfos.Where(fi => fi.Type == FileType.MP3 && !processedFiles.Contains(fi.OriginalName)).ToList();
             foreach (var mp3Info in unprocessedMp3Infos)
             {
                  skippedFiles.Add($"{mp3Info.OriginalName} ({mp3Info.ErrorMessage ?? "Unknown Error"})");
                  processedFiles.Add(mp3Info.OriginalName);
             }


            // --- End: Fuzzy Pairing Logic ---


            // Save all successfully created Text entities at once
            try
            {
                 await _context.SaveChangesAsync();
                 _logger.LogInformation("Attempted to save {CreatedCount} new audio lessons for user {UserId}.", createdCount, userId);
            }
            catch (Exception ex)
            {
                 _logger.LogError(ex, "Failed to save batch created audio lessons to database for user {UserId}.", userId);
                 // Note: At this point, files might be saved but DB entries failed. Manual cleanup might be needed.
                 return StatusCode(500, "Failed to save created lessons to the database.");
            }


            return Ok(new {
                message = $"Batch processing complete. Created {createdCount} lessons.",
                createdCount = createdCount,
                skippedFiles = skippedFiles
             });
        }

        // --- Start: Fuzzy Parsing Helper ---

        private enum FileType { MP3, SRT, Unknown }

        private class FileInfoResult
        {
            public IFormFile File { get; set; } = null!;
            public string OriginalName { get; set; } = string.Empty;
            public string BaseName { get; set; } = string.Empty;
            public string NormalizedBaseName { get; set; } = string.Empty;
            public FileType Type { get; set; } = FileType.Unknown;
            public bool HasError { get; set; } = false;
            public string? ErrorMessage { get; set; }
        }

        private FileInfoResult ParseFileInfo(IFormFile file)
        {
            var result = new FileInfoResult { File = file, OriginalName = file.FileName };
            try
            {
                result.BaseName = Path.GetFileNameWithoutExtension(file.FileName);
                result.NormalizedBaseName = NormalizeBaseName(result.BaseName);
                var extension = Path.GetExtension(file.FileName).ToLowerInvariant();

                if (extension == ".mp3") result.Type = FileType.MP3;
                else if (extension == ".srt") result.Type = FileType.SRT;
                else
                {
                    result.Type = FileType.Unknown;
                    result.HasError = true;
                    result.ErrorMessage = "Unsupported file type";
                    _logger.LogWarning("Unsupported file type encountered in batch upload: {FileName}", file.FileName);
                }
            }
            catch (ArgumentException ex) // Handle invalid characters in path/filename
            {
                 _logger.LogWarning(ex, "Invalid file name encountered in batch upload: {FileName}", file.FileName);
                 result.HasError = true;
                 result.ErrorMessage = "Invalid file name";
                 result.BaseName = file.FileName; // Use original name if parsing fails
                 result.NormalizedBaseName = NormalizeBaseName(result.BaseName); // Still try to normalize
                 result.Type = FileType.Unknown;
            }
             catch (Exception ex) // Catch unexpected errors during parsing
            {
                 _logger.LogError(ex, "Unexpected error parsing file info for: {FileName}", file.FileName);
                 result.HasError = true;
                 result.ErrorMessage = "Unexpected parsing error";
                 result.BaseName = file.FileName;
                 result.NormalizedBaseName = NormalizeBaseName(result.BaseName);
                 result.Type = FileType.Unknown;
            }
            return result;
        }

        // Normalizes the base name for better matching (lowercase, remove language suffixes and trailing punctuation)
        private string NormalizeBaseName(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return string.Empty;

            // 1. Get filename without extension and normalize unicode
            string stem = Path.GetFileNameWithoutExtension(name);
            if (string.IsNullOrWhiteSpace(stem)) return string.Empty;
            
            stem = stem.Normalize(System.Text.NormalizationForm.FormKC);

            // 2. Define known language/variant suffixes with flexible separators (longest patterns first)
            var suffixes = new List<string> {
                "__fr", "__en", "__es", "__de", "__it", "__pt", "__ru", "__zh", "__ja", "__ko", // Double underscore
                "_fr", "_en", "_es", "_de", "_it", "_pt", "_ru", "_zh", "_ja", "_ko", // Single underscore
                "-fr", "-en", "-es", "-de", "-it", "-pt", "-ru", "-zh", "-ja", "-ko", // Hyphen
                ".fr", ".en", ".es", ".de", ".it", ".pt", ".ru", ".zh", ".ja", ".ko", // Dot
                " fr", " en", " es", " de", " it", " pt", " ru", " zh", " ja", " ko" // Space
            };

            // 3. Find and remove the longest matching suffix at the end (case-insensitive)
            string? longestMatch = suffixes
                                    .Where(suffix => stem.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
                                    .OrderByDescending(suffix => suffix.Length)
                                    .FirstOrDefault();

            if (longestMatch != null)
            {
                stem = stem.Substring(0, stem.Length - longestMatch.Length);
            }

            // 4. Trim whitespace, collapse repeated spaces, and remove trailing punctuation/whitespace
            stem = stem.Trim();
            stem = System.Text.RegularExpressions.Regex.Replace(stem, @"\s+", " "); // Collapse spaces
            
            // Remove trailing punctuation and spaces iteratively (to handle mixed cases like "name_ ")
            while (System.Text.RegularExpressions.Regex.IsMatch(stem, @"[._\-\s]+$"))
            {
                stem = System.Text.RegularExpressions.Regex.Replace(stem, @"[._\-\s]+$", "");
            }

            // 5. Convert to lowercase
            return stem.ToLowerInvariant();
        }

        // Finds the best matching SRT for an MP3 file using longest common prefix matching
        private FileInfoResult? FindBestSrtMatch(FileInfoResult mp3Info, List<FileInfoResult> availableSrts)
        {
            if (availableSrts == null || availableSrts.Count == 0)
                return null;

            var mp3Normalized = mp3Info.NormalizedBaseName;
            if (string.IsNullOrEmpty(mp3Normalized))
                return null;

            FileInfoResult? bestMatch = null;
            int bestScore = 0;
            
            foreach (var srt in availableSrts)
            {
                var srtNormalized = srt.NormalizedBaseName;
                if (string.IsNullOrEmpty(srtNormalized))
                    continue;

                // Calculate longest common prefix length
                int commonPrefixLength = GetLongestCommonPrefixLength(mp3Normalized, srtNormalized);
                
                // Use score that considers both prefix match and overall similarity
                // Prioritize exact matches or very close matches
                int score = commonPrefixLength;
                
                // Bonus for exact normalized name match
                if (mp3Normalized == srtNormalized)
                {
                    score += 1000;
                }
                
                // Update best match if this is better
                if (score > bestScore)
                {
                    bestScore = score;
                    bestMatch = srt;
                }
            }

            // Only return a match if we have a reasonable match (at least 5 characters or the mp3 name is shorter)
            int minMatchThreshold = Math.Min(5, mp3Normalized.Length);
            if (bestScore < minMatchThreshold)
            {
                _logger.LogDebug("No good SRT match found for MP3 '{Mp3Name}'. Best score was {BestScore}, threshold is {Threshold}",
                    mp3Info.OriginalName, bestScore, minMatchThreshold);
                return null;
            }

            return bestMatch;
        }

        // Helper method to calculate the longest common prefix length between two strings
        private int GetLongestCommonPrefixLength(string a, string b)
        {
            int minLength = Math.Min(a.Length, b.Length);
            int commonLength = 0;
            
            for (int i = 0; i < minLength; i++)
            {
                if (a[i] == b[i])
                    commonLength++;
                else
                    break;
            }
            
            return commonLength;
        }

        // --- End: Fuzzy Parsing Helper ---


        // PUT: api/texts/5
        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateText(int id, [FromBody] UpdateTextDto updateTextDto)
        {
            if (id != updateTextDto.TextId)
            {
                return BadRequest("ID mismatch");
            }

            var userId = GetUserId();
            var text = await _context.Texts.FirstOrDefaultAsync(t => t.TextId == id && t.UserId == userId);

            if (text == null)
            {
                return NotFound();
            }

            // Update only allowed fields
            text.Title = updateTextDto.Title;
            text.Content = updateTextDto.Content;
            text.Tag = updateTextDto.Tag; // Update tag

            // If LanguageId is provided and different, update it
            if (updateTextDto.LanguageId.HasValue && updateTextDto.LanguageId.Value != text.LanguageId)
            {
                 var languageExists = await _context.Languages.AnyAsync(l => l.LanguageId == updateTextDto.LanguageId.Value);
                 if (!languageExists)
                 {
                     return BadRequest("Invalid LanguageId provided for update.");
                 }
                 text.LanguageId = updateTextDto.LanguageId.Value;
            }


            _context.Entry(text).State = EntityState.Modified;

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                if (!await TextExists(id, userId))
                {
                    return NotFound();
                }
                else
                {
                    throw;
                }
            }

            return NoContent(); // Standard response for successful PUT
        }


        // DELETE: api/texts/5
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteText(int id)
        {
            var userId = GetUserId();
            var text = await _context.Texts.FirstOrDefaultAsync(t => t.TextId == id && t.UserId == userId);
            if (text == null)
            {
                return NotFound();
            }

            // Optionally: Add logic to delete associated audio files if it's an audio lesson
            if (text.IsAudioLesson && !string.IsNullOrEmpty(text.AudioFilePath))
            {
                 var fullPathToDelete = Path.Combine("wwwroot", text.AudioFilePath.Replace("/", "\\"));
                 if(System.IO.File.Exists(fullPathToDelete)) {
                     try { System.IO.File.Delete(fullPathToDelete); } catch (IOException ex) { _logger.LogWarning(ex, "Could not delete associated audio file during text deletion: {FilePath}", fullPathToDelete); }
                 }
            }


            _context.Texts.Remove(text);
            await _context.SaveChangesAsync();

            return NoContent(); // Standard response for successful DELETE
        }

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                throw new UnauthorizedAccessException("User ID not found or invalid in token.");
            }
            return userId;
        }

        private async Task<bool> TextExists(int id, Guid userId)
        {
            return await _context.Texts.AnyAsync(e => e.TextId == id && e.UserId == userId);
        }

        // PUT: api/texts/{textId}/complete
        [HttpPut("{textId}/complete")] // Corrected route: combines with controller route "/api/texts"
        public async Task<ActionResult<TextStatsDto>> CompleteText(int textId)
        {
            var userId = GetUserId();

            var text = await _context.Texts
                .AsNoTracking() // Add AsNoTracking here
                .Include(t => t.TextWords)
                    .ThenInclude(tw => tw.Word)
                .FirstOrDefaultAsync(t => t.TextId == textId && t.UserId == userId);

            if (text == null)
            {
                return NotFound("Text not found.");
            }

            // --- 1. Calculate Stats from existing links ---
            // Ensure TextWords and Words were loaded in the initial query (Lines 888-891)
            if (text.TextWords == null)
            {
                 // This shouldn't happen if the Include was correct, but handle defensively
                 await _context.Entry(text).Collection(t => t.TextWords).Query().Include(tw => tw.Word).LoadAsync();
                 if (text.TextWords == null)
                 {
                      _logger.LogError("Failed to load TextWords for TextId {TextId} during completion.", textId);
                      return StatusCode(500, "Failed to load word data for statistics.");
                 }
            }

            var totalWords = text.TextWords.Count; // Calculate stats from already loaded data
            var knownWords = text.TextWords.Count(tw => tw.Word.Status == 5); // Status 5 = Known
            var learningWords = text.TextWords.Count(tw => tw.Word.Status > 0 && tw.Word.Status < 5); // Status 1-4 = Learning

            // --- 2. Log Activity ---
            try
            {
                // Log completion activity (TODO: Implement the service method fully)
                await _userActivityService.LogTextCompletedActivity(userId, text.LanguageId, textId, totalWords, text.IsAudioLesson);
                // TODO: Optionally call UpdateUserLanguageStats here or within LogTextCompletedActivity
                // await _userActivityService.UpdateUserLanguageStats(userId, text.LanguageId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to log TextCompleted activity or update stats for UserId {UserId}, TextId {TextId}", userId, textId);
                // Decide if this should prevent completion - likely not critical, just log.
            }

            // --- 3. Update Text Status (If applicable) ---
            // If a 'IsCompleted' or similar status exists on the Text model, update it here.
            // text.IsCompleted = true;
            // await _context.SaveChangesAsync(); // Save if status updated

            // --- 4. Return Stats ---
            var stats = new TextStatsDto
            {
                TotalWords = totalWords,
                KnownWords = knownWords,
                LearningWords = learningWords,
                CompletionPercentage = totalWords > 0 ? (double)knownWords / totalWords * 100 : 0
            };

            // Use Ok() as we are returning stats. Use NoContent() if not returning anything.
            return Ok(stats);
        }

    } // End of Controller Class (Ensure this closing brace exists)

    // DTO Definitions (Place outside or inside controller class as preferred)

    public class TextStatsDto
    {
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public int LearningWords { get; set; }
        public double CompletionPercentage { get; set; }
    }

    // DTOs (Data Transfer Objects)

    public class TextDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string? LanguageName { get; set; } // Language name - Can be null if language is missing
        public DateTime CreatedAt { get; set; }
        public string? Tag { get; set; }
        public bool IsAudioLesson { get; set; }
        public int? BookId { get; set; } // Include BookId
        public string? BookTitle { get; set; } // Include BookTitle
    }

    public class TextDetailDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;
        public string LanguageName { get; set; } = string.Empty;
        public string LanguageCode { get; set; } = string.Empty; // Added LanguageCode
        public int LanguageId { get; set; }
        public int? BookId { get; set; }
        public string? BookTitle { get; set; } // Added BookTitle
        public DateTime CreatedAt { get; set; }
        public bool IsAudioLesson { get; set; }
        public string? AudioFilePath { get; set; }
        public string? SrtContent { get; set; }
        public List<WordDto> Words { get; set; } = new List<WordDto>();
    }

    public class WordDto
    {
        public int WordId { get; set; }
        public string Term { get; set; } = string.Empty;
        public int Status { get; set; }
        public string? Translation { get; set; }
        public bool IsNew { get; set; }
    }

    public class CreateTextDto
    {
        [Required]
        [StringLength(200)]
        public string Title { get; set; } = string.Empty;
        [Required]
        public string Content { get; set; } = string.Empty;
        [Required]
        public int LanguageId { get; set; }
        [StringLength(100)]
        public string? Tag { get; set; } // Add Tag property
    }

    public class CreateAudioLessonDto
    {
        [Required]
        [StringLength(200)]
        public string Title { get; set; } = string.Empty;
        [Required]
        public int LanguageId { get; set; }
        [Required]
        public IFormFile AudioFile { get; set; } = null!;
        [Required]
        public IFormFile SrtFile { get; set; } = null!;
        [StringLength(100)]
        public string? Tag { get; set; } // Add Tag property
    }

    public class UpdateTextDto
    {
        [Required]
        public int TextId { get; set; }
        [Required]
        [StringLength(200)]
        public string Title { get; set; } = string.Empty;
        [Required]
        public string Content { get; set; } = string.Empty;
        public int? LanguageId { get; set; } // Allow updating language
        [StringLength(100)]
        public string? Tag { get; set; } // Allow updating tag
    }

    // DTO for the new recent texts endpoint
    public class RecentTextDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string LanguageName { get; set; } = string.Empty;
        public DateTime LastAccessedAt { get; set; }
        public bool IsAudioLesson { get; set; }
        public int? BookId { get; set; }
        public string? BookTitle { get; set; }
        public int? PartNumber { get; set; } // Include PartNumber for book context
    }

    public class CreateAudioLessonsBatchDto
    {
        [Required]
        public int LanguageId { get; set; }

        [StringLength(100)]
        public string? Tag { get; set; } // Optional tag for the whole batch
    }
}