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
            var userId = GetUserId();
            
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
                    AutoTranslateWords = true,
                    HighlightKnownWords = true,
                    DefaultLanguageId = 0,
                    AutoAdvanceToNextLesson = false,
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
                    OpenRouterModel = "google/gemini-2.5-flash-preview-05-20:free"
                };
                
                _context.UserSettings.Add(settings);
                await _context.SaveChangesAsync();
            }
            
            return new UserSettingsDto
            {
                Theme = settings.Theme,
                TextSize = settings.TextSize,
                TextFont = settings.TextFont,
                AutoTranslateWords = settings.AutoTranslateWords,
                HighlightKnownWords = settings.HighlightKnownWords,
                DefaultLanguageId = settings.DefaultLanguageId,
                AutoAdvanceToNextLesson = settings.AutoAdvanceToNextLesson,
                ShowProgressStats = settings.ShowProgressStats,
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
                OpenRouterModel = settings.OpenRouterModel
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
            
            var userId = GetUserId();
            
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
            settings.AutoTranslateWords = updateDto.AutoTranslateWords ?? settings.AutoTranslateWords;
            settings.HighlightKnownWords = updateDto.HighlightKnownWords ?? settings.HighlightKnownWords;
            settings.DefaultLanguageId = updateDto.DefaultLanguageId ?? settings.DefaultLanguageId;
            settings.AutoAdvanceToNextLesson = updateDto.AutoAdvanceToNextLesson ?? settings.AutoAdvanceToNextLesson;
            settings.ShowProgressStats = updateDto.ShowProgressStats ?? settings.ShowProgressStats;
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
            settings.UpdatedAt = DateTime.UtcNow;
            
            await _context.SaveChangesAsync();
            
            return new UserSettingsDto
            {
                Theme = settings.Theme,
                TextSize = settings.TextSize,
                TextFont = settings.TextFont,
                AutoTranslateWords = settings.AutoTranslateWords,
                HighlightKnownWords = settings.HighlightKnownWords,
                DefaultLanguageId = settings.DefaultLanguageId,
                AutoAdvanceToNextLesson = settings.AutoAdvanceToNextLesson,
                ShowProgressStats = settings.ShowProgressStats,
                LeftPanelWidth = settings.LeftPanelWidth, // Map panel width to DTO
                DiscordWeeklyReportEnabled = settings.DiscordWeeklyReportEnabled,
                DiscordWebhookUrl = settings.DiscordWebhookUrl,
                DiscordWeeklyReportDayOfWeek = settings.DiscordWeeklyReportDayOfWeek,
                DiscordWeeklyReportHourLocal = settings.DiscordWeeklyReportHourLocal,
                DiscordTimezoneOffsetMinutes = settings.DiscordTimezoneOffsetMinutes,
                UseOpenRouter = settings.UseOpenRouter,
                OpenRouterApiKey = settings.OpenRouterApiKey,
                OpenRouterModel = settings.OpenRouterModel
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

            var userId = GetUserId();
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
            var userId = GetUserId();
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
            var userId = GetUserId();
            
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

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim))
            {
                throw new UnauthorizedAccessException("User ID not found in token");
            }
            
            return Guid.Parse(userIdClaim);
        }

        // POST: api/usersettings/test-openrouter
        [HttpPost("test-openrouter")]
        public async Task<ActionResult<OpenRouterTestResultDto>> TestOpenRouterConnection()
        {
            var userId = GetUserId();
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
        public int LeftPanelWidth { get; set; } // Already added in previous step, ensure it's correct
        public bool AutoTranslateWords { get; set; } = true;
        public bool HighlightKnownWords { get; set; } = true;
        public int DefaultLanguageId { get; set; } = 0;
        public bool AutoAdvanceToNextLesson { get; set; } = false;
        public bool ShowProgressStats { get; set; } = true;
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
    }

    public class UpdateUserSettingsDto
    {
        public string? Theme { get; set; }
        
        [Range(10, 36)]
        public int? TextSize { get; set; }
        
        public string? TextFont { get; set; }

        [Range(20, 85)] // Increased max width to 85%
        public int? LeftPanelWidth { get; set; } // Already added in previous step, ensure it's correct
        public bool? AutoTranslateWords { get; set; }
        public bool? HighlightKnownWords { get; set; }
        public int? DefaultLanguageId { get; set; }
        public bool? AutoAdvanceToNextLesson { get; set; }
        public bool? ShowProgressStats { get; set; }

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