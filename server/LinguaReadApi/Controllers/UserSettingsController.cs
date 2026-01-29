using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using System.ComponentModel.DataAnnotations;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class UserSettingsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly DiscordReportService _discordReportService;

        public UserSettingsController(AppDbContext context, DiscordReportService discordReportService)
        {
            _context = context;
            _discordReportService = discordReportService;
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
                    DiscordTimezoneOffsetMinutes = 0
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
                DiscordTimezoneOffsetMinutes = settings.DiscordTimezoneOffsetMinutes
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
                DiscordTimezoneOffsetMinutes = settings.DiscordTimezoneOffsetMinutes
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
    }

    public class UpdateAudiobookProgressDto
    {
        // Nullable to allow clearing the current track
        public int? CurrentAudiobookTrackId { get; set; }

        // Nullable, should only be non-null if TrackId is non-null
        [Range(0, double.MaxValue)]
        public double? CurrentAudiobookPosition { get; set; } // Position in seconds
    }
} 