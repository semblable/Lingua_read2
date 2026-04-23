using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class UserSettingsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly DiscordReportService _discordReportService;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<UserSettingsController> _logger;

        public UserSettingsController(
            AppDbContext context, 
            DiscordReportService discordReportService,
            IHttpClientFactory httpClientFactory,
            ILogger<UserSettingsController> logger)
        {
            _context = context;
            _discordReportService = discordReportService;
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        // GET: api/usersettings
        [HttpGet]
        public async Task<ActionResult<UserSettingsDto>> GetUserSettings()
        {
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            
            var settings = await _context.UserSettings
                .FirstOrDefaultAsync(s => s.UserId == userId);
                
            if (settings == null)
            {
                // Create default settings if they don't exist
                settings = new UserSettings
                {
                    UserId = userId,
                    Theme = "light",
                    TextSize = 16,
                    TextFont = "default",
                    ReadingUiMode = "classic",
                    ReaderContentWidth = 740,
                    ReadingDensity = "balanced",
                    ShowWordInfoPanel = true,
                    TooltipOnlyForSavedWords = false,
                    ReaderParagraphIndent = true,
                    ReaderTextAlignment = "left",
                    AutoTranslateWords = true,
                    AutoTranslateOnOpen = false,
                    PauseOnWordClick = false,
                    HighlightKnownWords = true,
                    SentenceMode = false,
                    SentenceAudioRepeats = 1,
                    SentenceTtsEnabled = false,
                    SentenceTtsRate = 1.0,
                    DefaultLanguageId = 0,
                    TranslationTargetLanguageCode = "EN",
                    AutoAdvanceToNextLesson = false,
                    AutoMoveFinishedLessons = false, // Added property
                    ShowProgressStats = true,
                    CreatedAt = DateTime.UtcNow,
                    LeftPanelWidth = 85, // Set default panel width
                    DiscordWeeklyReportEnabled = false,
                    DiscordWebhookUrl = null,
                    DiscordWeeklyReportDayOfWeek = "Monday",
                    DiscordWeeklyReportHourLocal = 8,
                    DiscordTimezoneOffsetMinutes = 0,
                    UseOpenRouter = false,
                    OpenRouterApiKey = null,
                    OpenRouterModel = "google/gemini-2.5-flash-preview-05-20:free",
                    OpenRouterReasoningEnabled = false,
                    OpenRouterReasoningEffort = "medium",
                    OpenRouterStoryReasoningEnabled = false,
                    OpenRouterStoryReasoningEffort = "medium"
                };

                _context.UserSettings.Add(settings);
                await _context.SaveChangesAsync();
            }
            
            return new UserSettingsDto
            {
                Theme = settings.Theme,
                TextSize = settings.TextSize,
                TextFont = settings.TextFont,
                ReadingUiMode = settings.ReadingUiMode,
                ReaderContentWidth = settings.ReaderContentWidth,
                ReadingDensity = settings.ReadingDensity,
                ShowWordInfoPanel = settings.ShowWordInfoPanel,
                TooltipOnlyForSavedWords = settings.TooltipOnlyForSavedWords,
                ReaderParagraphIndent = settings.ReaderParagraphIndent,
                ReaderTextAlignment = settings.ReaderTextAlignment,
                AutoTranslateWords = settings.AutoTranslateWords,
                AutoTranslateOnOpen = settings.AutoTranslateOnOpen,
                PauseOnWordClick = settings.PauseOnWordClick,
                HighlightKnownWords = settings.HighlightKnownWords,
                SentenceMode = settings.SentenceMode,
                SentenceAudioRepeats = settings.SentenceAudioRepeats,
                SentenceTtsEnabled = settings.SentenceTtsEnabled,
                SentenceTtsRate = settings.SentenceTtsRate,
                DefaultLanguageId = settings.DefaultLanguageId,
                TranslationTargetLanguageCode = settings.TranslationTargetLanguageCode,
                AutoAdvanceToNextLesson = settings.AutoAdvanceToNextLesson,
                AutoMoveFinishedLessons = settings.AutoMoveFinishedLessons, // Added
                ShowProgressStats = settings.ShowProgressStats,
                ShowDesktopLessonControls = settings.ShowDesktopLessonControls,
                CurrentAudiobookTrackId = settings.CurrentAudiobookTrackId, // Added
                CurrentAudiobookPosition = settings.CurrentAudiobookPosition, // Added
                LeftPanelWidth = settings.LeftPanelWidth, // Map panel width to DTO
                DiscordWeeklyReportEnabled = settings.DiscordWeeklyReportEnabled,
                DiscordWebhookUrl = settings.DiscordWebhookUrl,
                DiscordWeeklyReportDayOfWeek = settings.DiscordWeeklyReportDayOfWeek,
                DiscordWeeklyReportHourLocal = settings.DiscordWeeklyReportHourLocal,
                DiscordTimezoneOffsetMinutes = settings.DiscordTimezoneOffsetMinutes,
                UseOpenRouter = settings.UseOpenRouter,
                OpenRouterApiKey = settings.OpenRouterApiKey,
                OpenRouterModel = settings.OpenRouterModel,
                OpenRouterReasoningEnabled = settings.OpenRouterReasoningEnabled,
                OpenRouterReasoningEffort = settings.OpenRouterReasoningEffort,
                OpenRouterStoryReasoningEnabled = settings.OpenRouterStoryReasoningEnabled,
                OpenRouterStoryReasoningEffort = settings.OpenRouterStoryReasoningEffort,
                SrsMaxNewCards = settings.SrsMaxNewCards,
                SrsMaxReviews = settings.SrsMaxReviews,
                SrsReviewOrder = settings.SrsReviewOrder ?? "mix",
                SrsLearningStepMinutes = settings.SrsLearningStepMinutes ?? "1,10",
                SrsMaxIntervalDays = settings.SrsMaxIntervalDays,
                SrsLapseMinimumIntervalDays = settings.SrsLapseMinimumIntervalDays
            };
        }

        // PUT: api/usersettings
        [HttpPut]
        public async Task<ActionResult<UserSettingsDto>> UpdateUserSettings([FromBody] UpdateUserSettingsDto updateDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }
            
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            
            var settings = await _context.UserSettings
                .FirstOrDefaultAsync(s => s.UserId == userId);
                
            if (settings == null)
            {
                // Create settings if they don't exist
                settings = new UserSettings
                {
                    UserId = userId,
                    CreatedAt = DateTime.UtcNow
                };
                _context.UserSettings.Add(settings);
            }
            
            // Update settings with provided values
            settings.Theme = updateDto.Theme ?? settings.Theme;
            settings.TextSize = updateDto.TextSize ?? settings.TextSize;
            settings.TextFont = updateDto.TextFont ?? settings.TextFont;
            if (!string.IsNullOrWhiteSpace(updateDto.ReadingUiMode))
            {
                var normalizedReadingUiMode = updateDto.ReadingUiMode.Trim().ToLowerInvariant();
                if (normalizedReadingUiMode == "classic" || normalizedReadingUiMode == "modern")
                {
                    settings.ReadingUiMode = normalizedReadingUiMode;
                }
            }
            if (updateDto.ReaderContentWidth.HasValue &&
                updateDto.ReaderContentWidth.Value >= 520 &&
                updateDto.ReaderContentWidth.Value <= 980)
            {
                settings.ReaderContentWidth = updateDto.ReaderContentWidth.Value;
            }
            if (!string.IsNullOrWhiteSpace(updateDto.ReadingDensity))
            {
                var normalizedReadingDensity = updateDto.ReadingDensity.Trim().ToLowerInvariant();
                if (normalizedReadingDensity == "compact" || normalizedReadingDensity == "balanced" || normalizedReadingDensity == "spacious")
                {
                    settings.ReadingDensity = normalizedReadingDensity;
                }
            }
            settings.ShowWordInfoPanel = updateDto.ShowWordInfoPanel ?? settings.ShowWordInfoPanel;
            settings.TooltipOnlyForSavedWords = updateDto.TooltipOnlyForSavedWords ?? settings.TooltipOnlyForSavedWords;
            settings.ReaderParagraphIndent = updateDto.ReaderParagraphIndent ?? settings.ReaderParagraphIndent;
            if (!string.IsNullOrWhiteSpace(updateDto.ReaderTextAlignment))
            {
                var normalizedReaderTextAlignment = updateDto.ReaderTextAlignment.Trim().ToLowerInvariant();
                if (normalizedReaderTextAlignment == "left" || normalizedReaderTextAlignment == "justify")
                {
                    settings.ReaderTextAlignment = normalizedReaderTextAlignment;
                }
            }
            settings.AutoTranslateWords = updateDto.AutoTranslateWords ?? settings.AutoTranslateWords;
            settings.AutoTranslateOnOpen = updateDto.AutoTranslateOnOpen ?? settings.AutoTranslateOnOpen;
            settings.PauseOnWordClick = updateDto.PauseOnWordClick ?? settings.PauseOnWordClick;
            settings.HighlightKnownWords = updateDto.HighlightKnownWords ?? settings.HighlightKnownWords;
            settings.SentenceMode = updateDto.SentenceMode ?? settings.SentenceMode;
            settings.SentenceAudioRepeats = updateDto.SentenceAudioRepeats ?? settings.SentenceAudioRepeats;
            settings.SentenceTtsEnabled = updateDto.SentenceTtsEnabled ?? settings.SentenceTtsEnabled;
            settings.SentenceTtsRate = updateDto.SentenceTtsRate ?? settings.SentenceTtsRate;
            settings.DefaultLanguageId = updateDto.DefaultLanguageId ?? settings.DefaultLanguageId;
            if (!string.IsNullOrWhiteSpace(updateDto.TranslationTargetLanguageCode))
            {
                settings.TranslationTargetLanguageCode = updateDto.TranslationTargetLanguageCode.Trim().ToUpperInvariant();
            }
            settings.AutoAdvanceToNextLesson = updateDto.AutoAdvanceToNextLesson ?? settings.AutoAdvanceToNextLesson;
            settings.AutoMoveFinishedLessons = updateDto.AutoMoveFinishedLessons ?? settings.AutoMoveFinishedLessons; // Update property
            settings.ShowProgressStats = updateDto.ShowProgressStats ?? settings.ShowProgressStats;
            settings.ShowDesktopLessonControls = updateDto.ShowDesktopLessonControls ?? settings.ShowDesktopLessonControls;
            settings.LeftPanelWidth = updateDto.LeftPanelWidth ?? settings.LeftPanelWidth; // Update panel width
            settings.DiscordWeeklyReportEnabled = updateDto.DiscordWeeklyReportEnabled ?? settings.DiscordWeeklyReportEnabled;
            if (updateDto.DiscordWebhookUrl != null)
            {
                settings.DiscordWebhookUrl = string.IsNullOrWhiteSpace(updateDto.DiscordWebhookUrl)
                    ? null
                    : updateDto.DiscordWebhookUrl.Trim();
            }
            if (!string.IsNullOrWhiteSpace(updateDto.DiscordWeeklyReportDayOfWeek) &&
                Enum.TryParse(updateDto.DiscordWeeklyReportDayOfWeek, true, out DayOfWeek dayOfWeek))
            {
                settings.DiscordWeeklyReportDayOfWeek = dayOfWeek.ToString();
            }
            if (updateDto.DiscordWeeklyReportHourLocal.HasValue &&
                updateDto.DiscordWeeklyReportHourLocal.Value >= 0 &&
                updateDto.DiscordWeeklyReportHourLocal.Value <= 23)
            {
                settings.DiscordWeeklyReportHourLocal = updateDto.DiscordWeeklyReportHourLocal.Value;
            }
            if (updateDto.DiscordTimezoneOffsetMinutes.HasValue &&
                updateDto.DiscordTimezoneOffsetMinutes.Value >= -840 &&
                updateDto.DiscordTimezoneOffsetMinutes.Value <= 840)
            {
                settings.DiscordTimezoneOffsetMinutes = updateDto.DiscordTimezoneOffsetMinutes.Value;
            }
            settings.UseOpenRouter = updateDto.UseOpenRouter ?? settings.UseOpenRouter;
            if (updateDto.OpenRouterApiKey != null)
            {
                settings.OpenRouterApiKey = string.IsNullOrWhiteSpace(updateDto.OpenRouterApiKey)
                    ? null
                    : updateDto.OpenRouterApiKey.Trim();
            }
            if (!string.IsNullOrWhiteSpace(updateDto.OpenRouterModel))
            {
                settings.OpenRouterModel = updateDto.OpenRouterModel.Trim();
            }
            settings.OpenRouterReasoningEnabled = updateDto.OpenRouterReasoningEnabled ?? settings.OpenRouterReasoningEnabled;
            if (!string.IsNullOrWhiteSpace(updateDto.OpenRouterReasoningEffort))
            {
                var normalizedEffort = updateDto.OpenRouterReasoningEffort.Trim().ToLowerInvariant();
                if (normalizedEffort is "xhigh" or "high" or "medium" or "low" or "minimal" or "none")
                {
                    settings.OpenRouterReasoningEffort = normalizedEffort;
                }
            }
            settings.OpenRouterStoryReasoningEnabled = updateDto.OpenRouterStoryReasoningEnabled ?? settings.OpenRouterStoryReasoningEnabled;
            if (!string.IsNullOrWhiteSpace(updateDto.OpenRouterStoryReasoningEffort))
            {
                var normalizedEffort = updateDto.OpenRouterStoryReasoningEffort.Trim().ToLowerInvariant();
                if (normalizedEffort is "xhigh" or "high" or "medium" or "low" or "minimal" or "none")
                {
                    settings.OpenRouterStoryReasoningEffort = normalizedEffort;
                }
            }
            settings.SrsMaxNewCards = updateDto.SrsMaxNewCards ?? settings.SrsMaxNewCards;
            settings.SrsMaxReviews = updateDto.SrsMaxReviews ?? settings.SrsMaxReviews;
            if (!string.IsNullOrWhiteSpace(updateDto.SrsReviewOrder))
            {
                var normalizedOrder = updateDto.SrsReviewOrder.Trim().ToLowerInvariant();
                if (normalizedOrder is "mix" or "new_first" or "reviews_first")
                {
                    settings.SrsReviewOrder = normalizedOrder;
                }
            }
            if (updateDto.SrsLearningStepMinutes != null)
            {
                settings.SrsLearningStepMinutes = string.IsNullOrWhiteSpace(updateDto.SrsLearningStepMinutes)
                    ? "1,10"
                    : updateDto.SrsLearningStepMinutes.Trim();
            }
            settings.SrsMaxIntervalDays = updateDto.SrsMaxIntervalDays ?? settings.SrsMaxIntervalDays;
            settings.SrsLapseMinimumIntervalDays = updateDto.SrsLapseMinimumIntervalDays ?? settings.SrsLapseMinimumIntervalDays;
            settings.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();
            
            return new UserSettingsDto
            {
                Theme = settings.Theme,
                TextSize = settings.TextSize,
                TextFont = settings.TextFont,
                ReadingUiMode = settings.ReadingUiMode,
                ReaderContentWidth = settings.ReaderContentWidth,
                ReadingDensity = settings.ReadingDensity,
                ShowWordInfoPanel = settings.ShowWordInfoPanel,
                TooltipOnlyForSavedWords = settings.TooltipOnlyForSavedWords,
                ReaderParagraphIndent = settings.ReaderParagraphIndent,
                ReaderTextAlignment = settings.ReaderTextAlignment,
                AutoTranslateWords = settings.AutoTranslateWords,
                AutoTranslateOnOpen = settings.AutoTranslateOnOpen,
                PauseOnWordClick = settings.PauseOnWordClick,
                HighlightKnownWords = settings.HighlightKnownWords,
                SentenceMode = settings.SentenceMode,
                SentenceAudioRepeats = settings.SentenceAudioRepeats,
                SentenceTtsEnabled = settings.SentenceTtsEnabled,
                SentenceTtsRate = settings.SentenceTtsRate,
                DefaultLanguageId = settings.DefaultLanguageId,
                TranslationTargetLanguageCode = settings.TranslationTargetLanguageCode,
                AutoAdvanceToNextLesson = settings.AutoAdvanceToNextLesson,
                AutoMoveFinishedLessons = settings.AutoMoveFinishedLessons, // Update property
                ShowProgressStats = settings.ShowProgressStats,
                ShowDesktopLessonControls = settings.ShowDesktopLessonControls,
                LeftPanelWidth = settings.LeftPanelWidth, // Map panel width to DTO
                DiscordWeeklyReportEnabled = settings.DiscordWeeklyReportEnabled,
                DiscordWebhookUrl = settings.DiscordWebhookUrl,
                DiscordWeeklyReportDayOfWeek = settings.DiscordWeeklyReportDayOfWeek,
                DiscordWeeklyReportHourLocal = settings.DiscordWeeklyReportHourLocal,
                DiscordTimezoneOffsetMinutes = settings.DiscordTimezoneOffsetMinutes,
                UseOpenRouter = settings.UseOpenRouter,
                OpenRouterApiKey = settings.OpenRouterApiKey,
                OpenRouterModel = settings.OpenRouterModel,
                OpenRouterReasoningEnabled = settings.OpenRouterReasoningEnabled,
                OpenRouterReasoningEffort = settings.OpenRouterReasoningEffort,
                OpenRouterStoryReasoningEnabled = settings.OpenRouterStoryReasoningEnabled,
                OpenRouterStoryReasoningEffort = settings.OpenRouterStoryReasoningEffort,
                SrsMaxNewCards = settings.SrsMaxNewCards,
                SrsMaxReviews = settings.SrsMaxReviews,
                SrsReviewOrder = settings.SrsReviewOrder ?? "mix",
                SrsLearningStepMinutes = settings.SrsLearningStepMinutes ?? "1,10",
                SrsMaxIntervalDays = settings.SrsMaxIntervalDays,
                SrsLapseMinimumIntervalDays = settings.SrsLapseMinimumIntervalDays
            };
        }

        // PUT: api/usersettings/audiobook-progress
        [HttpPut("audiobook-progress")]
        public async Task<IActionResult> UpdateAudiobookProgress([FromBody] UpdateAudiobookProgressDto updateDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            var settings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);

            if (settings == null)
            {
                // Optionally create settings if they don't exist, or return NotFound/BadRequest
                 return NotFound("User settings not found.");
                // Or create default:
                // settings = new UserSettings { UserId = userId, CreatedAt = DateTime.UtcNow };
                // _context.UserSettings.Add(settings);
            }

            // Optional: Validate if the trackId exists and belongs to the user
            if (updateDto.CurrentAudiobookTrackId.HasValue)
            {
                 var trackExists = await _context.AudiobookTracks
                     .AnyAsync(at => at.Id == updateDto.CurrentAudiobookTrackId.Value && at.Book.UserId == userId);
                 if (!trackExists)
                 {
                     return BadRequest("Invalid Audiobook Track ID or track does not belong to user.");
                 }
            }
             else // If trackId is null, position should also be null
             {
                 if (updateDto.CurrentAudiobookPosition.HasValue)
                 {
                     return BadRequest("Audiobook position cannot be set without a valid Track ID.");
                 }
             }


            settings.CurrentAudiobookTrackId = updateDto.CurrentAudiobookTrackId;
            settings.CurrentAudiobookPosition = updateDto.CurrentAudiobookPosition;
            settings.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            return NoContent(); // Indicate success without returning data
        }

        // POST: api/usersettings/discord/report
        [HttpPost("discord/report")]
        public async Task<IActionResult> SendDiscordReport([FromQuery] string period = "week", [FromQuery] int? days = null)
        {
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            var settings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
            if (settings == null)
            {
                settings = new UserSettings { UserId = userId, CreatedAt = DateTime.UtcNow };
                _context.UserSettings.Add(settings);
                await _context.SaveChangesAsync();
            }

            var nowUtc = DateTime.UtcNow;
            var range = ResolveReportRange(nowUtc, period, days);
            if (!range.IsValid)
            {
                return BadRequest(range.Error);
            }

            var sendResult = await _discordReportService.SendReportForUserAsync(
                settings,
                range.StartUtc,
                range.EndUtc,
                false,
                HttpContext.RequestAborted);

            if (sendResult.Sent)
            {
                return Ok(new { message = "Report sent successfully." });
            }

            if (sendResult.Skipped)
            {
                return Ok(new { message = sendResult.Reason ?? "Report skipped." });
            }

            return BadRequest(new { message = sendResult.Reason ?? "Unable to send report." });
        }

        // GET: api/usersettings/audio-storage-size
        [HttpGet("audio-storage-size")]
        public async Task<ActionResult<AudioStorageSizeDto>> GetAudioStorageSize()
        {
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            
            long totalSize = 0;
            int totalFiles = 0;

            try
            {
                // Get the wwwroot path
                var wwwrootPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
                
                // Calculate audiobooks size
                var audiobooksPath = Path.Combine(wwwrootPath, "audiobooks");
                if (Directory.Exists(audiobooksPath))
                {
                    var userBooks = await _context.Books
                        .Where(b => b.UserId == userId)
                        .Select(b => b.BookId)
                        .ToListAsync();

                    foreach (var bookId in userBooks)
                    {
                        var bookPath = Path.Combine(audiobooksPath, bookId.ToString());
                        if (Directory.Exists(bookPath))
                        {
                            var files = Directory.GetFiles(bookPath, "*", SearchOption.AllDirectories);
                            foreach (var file in files)
                            {
                                var fileInfo = new FileInfo(file);
                                totalSize += fileInfo.Length;
                                totalFiles++;
                            }
                        }
                    }
                }

                // Calculate audio lessons size
                var audioLessonsPath = Path.Combine(wwwrootPath, "audio_lessons");
                if (Directory.Exists(audioLessonsPath))
                {
                    var userTexts = await _context.Texts
                        .Where(t => t.UserId == userId && t.IsAudioLesson && !string.IsNullOrEmpty(t.AudioFilePath))
                        .Select(t => t.AudioFilePath)
                        .ToListAsync();

                    foreach (var audioPath in userTexts)
                    {
                        var fullPath = Path.Combine(wwwrootPath, audioPath!.TrimStart('/'));
                        if (System.IO.File.Exists(fullPath))
                        {
                            var fileInfo = new FileInfo(fullPath);
                            totalSize += fileInfo.Length;
                            totalFiles++;
                        }
                    }
                }

                return new AudioStorageSizeDto
                {
                    TotalSizeBytes = totalSize,
                    TotalSizeMB = Math.Round(totalSize / (1024.0 * 1024.0), 2),
                    TotalSizeGB = Math.Round(totalSize / (1024.0 * 1024.0 * 1024.0), 2),
                    TotalFiles = totalFiles
                };
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = $"Failed to calculate storage size: {ex.Message}" });
            }
        }

        private static ReportRange ResolveReportRange(DateTime nowUtc, string period, int? days)
        {
            var normalized = (period ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized == "days")
            {
                if (!days.HasValue || days.Value <= 0)
                {
                    return ReportRange.Invalid("Days must be a positive number when period=days.");
                }

                var cappedDays = Math.Min(days.Value, 3650);
                return ReportRange.Valid(nowUtc.AddDays(-cappedDays), nowUtc);
            }

            return normalized switch
            {
                "week" => ReportRange.Valid(nowUtc.AddDays(-7), nowUtc),
                "month" => ReportRange.Valid(nowUtc.AddDays(-30), nowUtc),
                "year" => ReportRange.Valid(nowUtc.AddDays(-365), nowUtc),
                "all" => ReportRange.Valid(DateTime.MinValue, nowUtc),
                _ => ReportRange.Invalid("Unsupported period. Use week, month, year, all, or days.")
            };
        }

        private readonly record struct ReportRange(DateTime StartUtc, DateTime EndUtc, bool IsValid, string? Error)
        {
            public static ReportRange Valid(DateTime startUtc, DateTime endUtc) =>
                new(startUtc, endUtc, true, null);

            public static ReportRange Invalid(string error) =>
                new(DateTime.MinValue, DateTime.MinValue, false, error);
        }

        /// <summary>Returns false if NameIdentifier is missing or not a valid GUID.</summary>
        private bool TryGetUserIdFromClaims(out Guid userId, out object unauthorizedBody)
        {
            userId = default;
            unauthorizedBody = new { message = "User ID not found in token" };
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim))
                return false;
            if (!Guid.TryParse(userIdClaim, out userId))
            {
                unauthorizedBody = new { message = "Invalid user identifier in token" };
                return false;
            }

            return true;
        }

        // POST: api/usersettings/test-openrouter
        [HttpPost("test-openrouter")]
        public async Task<ActionResult<OpenRouterTestResultDto>> TestOpenRouterConnection()
        {
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            var settings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
            
            if (settings == null || string.IsNullOrWhiteSpace(settings.OpenRouterApiKey))
            {
                return BadRequest(new OpenRouterTestResultDto 
                { 
                    Success = false, 
                    Message = "OpenRouter API key not configured" 
                });
            }

            try
            {
                var httpClient = _httpClientFactory.CreateClient();
                httpClient.Timeout = TimeSpan.FromSeconds(30);
                
                var request = new HttpRequestMessage(HttpMethod.Post, "https://openrouter.ai/api/v1/chat/completions");
                request.Headers.Add("Authorization", $"Bearer {settings.OpenRouterApiKey}");
                request.Headers.Add("HTTP-Referer", "https://lingua-read.app");
                request.Headers.Add("X-Title", "Lingua-Read");
                
                var payload = new
                {
                    model = settings.OpenRouterModel,
                    messages = new[]
                    {
                        new { role = "user", content = "Reply with only the word 'OK'" }
                    },
                    max_tokens = 10
                };
                
                var jsonOptions = new JsonSerializerOptions 
                { 
                    PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower 
                };
                var json = JsonSerializer.Serialize(payload, jsonOptions);
                request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                
                _logger.LogInformation("Testing OpenRouter with model: {Model}", settings.OpenRouterModel);
                
                var response = await httpClient.SendAsync(request);
                var responseContent = await response.Content.ReadAsStringAsync();
                
                _logger.LogInformation("OpenRouter test response: {StatusCode} - {Content}", 
                    response.StatusCode, responseContent.Substring(0, Math.Min(500, responseContent.Length)));
                
                if (!response.IsSuccessStatusCode)
                {
                    return Ok(new OpenRouterTestResultDto
                    {
                        Success = false,
                        Message = $"API Error: {response.StatusCode}",
                        Details = responseContent
                    });
                }
                
                // Parse response to check for API-level errors
                using var doc = JsonDocument.Parse(responseContent);
                if (doc.RootElement.TryGetProperty("error", out var errorElement))
                {
                    var errorMessage = errorElement.TryGetProperty("message", out var msgProp) 
                        ? msgProp.GetString() 
                        : "Unknown error";
                    return Ok(new OpenRouterTestResultDto
                    {
                        Success = false,
                        Message = $"OpenRouter Error: {errorMessage}",
                        Details = responseContent
                    });
                }
                
                // Success - extract the response
                var reply = "";
                if (doc.RootElement.TryGetProperty("choices", out var choices) && 
                    choices.GetArrayLength() > 0)
                {
                    var firstChoice = choices[0];
                    if (firstChoice.TryGetProperty("message", out var message) &&
                        message.TryGetProperty("content", out var content))
                    {
                        reply = content.GetString() ?? "";
                    }
                }
                
                return Ok(new OpenRouterTestResultDto
                {
                    Success = true,
                    Message = $"Connection successful! Model '{settings.OpenRouterModel}' responded.",
                    Details = reply
                });
            }
            catch (TaskCanceledException)
            {
                return Ok(new OpenRouterTestResultDto
                {
                    Success = false,
                    Message = "Request timed out after 30 seconds"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "OpenRouter test failed");
                return Ok(new OpenRouterTestResultDto
                {
                    Success = false,
                    Message = $"Error: {ex.Message}"
                });
            }
        }
    }

    public class UserSettingsDto
    {
        public string Theme { get; set; } = "light";
        public int TextSize { get; set; } = 16;
        public string TextFont { get; set; } = "default";
        public string ReadingUiMode { get; set; } = "classic";
        public int ReaderContentWidth { get; set; } = 740;
        public string ReadingDensity { get; set; } = "balanced";
        public bool ShowWordInfoPanel { get; set; } = true;
        public bool TooltipOnlyForSavedWords { get; set; } = false;
        public bool ReaderParagraphIndent { get; set; } = true;
        public string ReaderTextAlignment { get; set; } = "left";
        public int LeftPanelWidth { get; set; } // Already added in previous step, ensure it's correct
        public bool AutoTranslateWords { get; set; } = true;
        public bool AutoTranslateOnOpen { get; set; } = false;
        public bool PauseOnWordClick { get; set; } = false;
        public bool HighlightKnownWords { get; set; } = true;
        public bool SentenceMode { get; set; } = false;
        public int SentenceAudioRepeats { get; set; } = 1;
        public bool SentenceTtsEnabled { get; set; } = false;
        public double SentenceTtsRate { get; set; } = 1.0;
        public int DefaultLanguageId { get; set; } = 0;
        public string TranslationTargetLanguageCode { get; set; } = "EN";
        public bool AutoAdvanceToNextLesson { get; set; } = false;
        public bool AutoMoveFinishedLessons { get; set; } = false; // Added property
        public bool ShowProgressStats { get; set; } = true;
        public bool ShowDesktopLessonControls { get; set; } = true;
        public int? CurrentAudiobookTrackId { get; set; } // Added
        public double? CurrentAudiobookPosition { get; set; } // Added
        public bool DiscordWeeklyReportEnabled { get; set; } = false;
        public string? DiscordWebhookUrl { get; set; }
        public string DiscordWeeklyReportDayOfWeek { get; set; } = "Monday";
        public int DiscordWeeklyReportHourLocal { get; set; } = 8;
        public int DiscordTimezoneOffsetMinutes { get; set; } = 0;
        public bool UseOpenRouter { get; set; } = false;
        public string? OpenRouterApiKey { get; set; }
        public string OpenRouterModel { get; set; } = "google/gemini-2.5-flash-preview-05-20:free";
        public bool OpenRouterReasoningEnabled { get; set; } = false;
        public string OpenRouterReasoningEffort { get; set; } = "medium";
        public bool OpenRouterStoryReasoningEnabled { get; set; } = false;
        public string OpenRouterStoryReasoningEffort { get; set; } = "medium";

        // SRS Settings
        public int SrsMaxNewCards { get; set; } = 20;
        public int SrsMaxReviews { get; set; } = 200;
        public string SrsReviewOrder { get; set; } = "mix";
        public string? SrsLearningStepMinutes { get; set; } = "1,10";
        public int SrsMaxIntervalDays { get; set; } = 36500;
        public int SrsLapseMinimumIntervalDays { get; set; } = 1;
    }

    public class UpdateUserSettingsDto
    {
        public string? Theme { get; set; }
        
        [Range(10, 36)]
        public int? TextSize { get; set; }
        
        public string? TextFont { get; set; }
        [StringLength(20)]
        public string? ReadingUiMode { get; set; }
        [Range(520, 980)]
        public int? ReaderContentWidth { get; set; }
        [StringLength(20)]
        public string? ReadingDensity { get; set; }
        public bool? ShowWordInfoPanel { get; set; }
        public bool? TooltipOnlyForSavedWords { get; set; }
        public bool? ReaderParagraphIndent { get; set; }
        [StringLength(20)]
        public string? ReaderTextAlignment { get; set; }

        [Range(10, 100)] // Widen range to accept broader values
        public int? LeftPanelWidth { get; set; } // Already added in previous step, ensure it's correct
        public bool? AutoTranslateWords { get; set; }
        public bool? AutoTranslateOnOpen { get; set; }
        public bool? PauseOnWordClick { get; set; }
        public bool? HighlightKnownWords { get; set; }
        public bool? SentenceMode { get; set; }
        [Range(1, 10)]
        public int? SentenceAudioRepeats { get; set; }
        public bool? SentenceTtsEnabled { get; set; }
        [Range(0.5, 1.5)]
        public double? SentenceTtsRate { get; set; }
        public int? DefaultLanguageId { get; set; }
        [StringLength(20)]
        public string? TranslationTargetLanguageCode { get; set; }
        public bool? AutoAdvanceToNextLesson { get; set; }
        public bool? AutoMoveFinishedLessons { get; set; } // Added property
        public bool? ShowProgressStats { get; set; }
        public bool? ShowDesktopLessonControls { get; set; }

        public bool? DiscordWeeklyReportEnabled { get; set; }

        [StringLength(2048)]
        public string? DiscordWebhookUrl { get; set; }

        [StringLength(20)]
        public string? DiscordWeeklyReportDayOfWeek { get; set; }

        [Range(0, 23)]
        public int? DiscordWeeklyReportHourLocal { get; set; }

        [Range(-840, 840)]
        public int? DiscordTimezoneOffsetMinutes { get; set; }

        // OpenRouter Settings
        public bool? UseOpenRouter { get; set; }

        [StringLength(256)]
        public string? OpenRouterApiKey { get; set; }

        [StringLength(100)]
        public string? OpenRouterModel { get; set; }

        public bool? OpenRouterReasoningEnabled { get; set; }

        [StringLength(20)]
        public string? OpenRouterReasoningEffort { get; set; }

        public bool? OpenRouterStoryReasoningEnabled { get; set; }

        [StringLength(20)]
        public string? OpenRouterStoryReasoningEffort { get; set; }

        // SRS Settings
        [Range(1, 9999)]
        public int? SrsMaxNewCards { get; set; }

        [Range(1, 9999)]
        public int? SrsMaxReviews { get; set; }

        [StringLength(20)]
        public string? SrsReviewOrder { get; set; }

        [StringLength(50)]
        public string? SrsLearningStepMinutes { get; set; }

        [Range(1, 36500)]
        public int? SrsMaxIntervalDays { get; set; }

        [Range(1, 365)]
        public int? SrsLapseMinimumIntervalDays { get; set; }
    }

    public class UpdateAudiobookProgressDto
    {
        // Nullable to allow clearing the current track
        public int? CurrentAudiobookTrackId { get; set; }

        // Nullable, should only be non-null if TrackId is non-null
        [Range(0, double.MaxValue)]
        public double? CurrentAudiobookPosition { get; set; } // Position in seconds
    }

    public class AudioStorageSizeDto
    {
        public long TotalSizeBytes { get; set; }
        public double TotalSizeMB { get; set; }
        public double TotalSizeGB { get; set; }
        public int TotalFiles { get; set; }
    }

    public class OpenRouterTestResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public string? Details { get; set; }
    }
} 