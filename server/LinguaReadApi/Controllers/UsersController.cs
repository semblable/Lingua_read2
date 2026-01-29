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
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class UsersController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<UsersController> _logger;

        public UsersController(AppDbContext context, ILogger<UsersController> logger)
        {
            _context = context;
            _logger = logger;
        }

        // GET: api/users/statistics
        [HttpGet("statistics")]
        public async Task<ActionResult<UserStatisticsDto>> GetUserStatistics()
        {
            var userId = GetUserId();
            
            // Get all user's words
            var words = await _context.Words
                .Where(w => w.UserId == userId)
                .ToListAsync();
                
            // Get user's books
            var books = await _context.Books
                .Where(b => b.UserId == userId)
                .Include(b => b.Language)
                .ToListAsync();
                
            // Get word counts by status and language
            var wordsByStatus = words
                .GroupBy(w => w.Status)
                .ToDictionary(g => g.Key, g => g.Count());
                
            var wordsByLanguage = words
                .GroupBy(w => w.LanguageId)
                .ToDictionary(g => g.Key, g => g.Count());

            // --- Fetch Aggregated User Language Statistics ---
            var userLangStats = await _context.UserLanguageStatistics
                .Where(uls => uls.UserId == userId)
                .Include(uls => uls.Language) // Include Language for name
                .ToDictionaryAsync(uls => uls.LanguageId); // Dictionary for easy lookup

            // Get language details for languages the user has stats for
            var languages = userLangStats.Values
                .Select(uls => uls.Language)
                .Where(language => language != null)
                .Distinct()
                .ToList();
                
            // --- Create LanguageStatisticsDto using UserLanguageStatistics ---
            var languageStats = languages.Select(l =>
            {
                // Get stats from the fetched dictionary, or default if none exist yet
                var stats = userLangStats.TryGetValue(l.LanguageId, out var uls)
                    ? uls
                    : new UserLanguageStatistics { LanguageId = l.LanguageId }; // Default empty stats

                return new LanguageStatisticsDto
                {
                    LanguageId = l.LanguageId,
                    LanguageName = l.Name,
                    // WordCount (total unique terms known/learning) might still come from 'words' collection
                    WordCount = wordsByLanguage.ContainsKey(l.LanguageId) ? wordsByLanguage[l.LanguageId] : 0,
                    // Use cumulative stats from UserLanguageStatistics
                    TotalWordsRead = (int)stats.TotalWordsRead, // Cast long to int for DTO
                    TotalTextsCompleted = stats.TotalTextsCompleted,
                    TotalSecondsListened = (int)stats.TotalSecondsListened, // Cast long to int for DTO
                    // Book counts can still be calculated from the 'books' collection
                    BookCount = books.Count(b => b.LanguageId == l.LanguageId),
                    FinishedBookCount = books.Count(b => b.LanguageId == l.LanguageId && b.IsFinished) // Assuming IsFinished exists on Book model
                    // Note: UserLanguageStatistics also has TotalBooksCompleted, could use that instead if Book model doesn't have IsFinished
                };
            }).ToList();
                
            // Calculate total statistics
            var statistics = new UserStatisticsDto
            {
                TotalWords = words.Count,
                KnownWords = wordsByStatus.ContainsKey(5) ? wordsByStatus[5] : 0,
                LearningWords = words.Count - (wordsByStatus.ContainsKey(5) ? wordsByStatus[5] : 0),
                TotalBooks = books.Count,
                FinishedBooks = books.Count(b => b.IsFinished),
                LastActivity = DateTime.UtcNow, // Default to current time to avoid Invalid Date
                TotalLanguages = languageStats.Count,
                LanguageStatistics = languageStats
            };
            
            // Set LastActivity safely
            if (books.Any(b => b.LastReadAt.HasValue))
            {
                // Provide a default value for Max in case the filtered list is empty (though Any check prevents this)
                // or to satisfy the compiler about nullability.
                var maxDate = books.Where(b => b.LastReadAt.HasValue)
                                  .Max(b => b.LastReadAt ?? DateTime.MinValue);
                // Ensure we don't assign MinValue if no valid dates were found
                if (maxDate != DateTime.MinValue)
                {
                    statistics.LastActivity = maxDate;
                }
            }

            return statistics;
        }

        [HttpGet("reading-activity")] // Corrected route to match frontend api.js
        public async Task<IActionResult> GetReadingActivity([FromQuery] string period = "all", [FromQuery] int? timezoneOffsetMinutes = null)
        {
            _logger.LogInformation("Getting reading activity for period: {Period}, timezoneOffsetMinutes: {TimezoneOffset}", period, timezoneOffsetMinutes);
            var userId = GetUserId();

            try
            {
                DateTime startDate;
                DateTime nowUtc = DateTime.UtcNow;
                DateTime nowLocal;

                if (timezoneOffsetMinutes.HasValue)
                {
                    nowLocal = nowUtc.AddMinutes(timezoneOffsetMinutes.Value);
                }
                else
                {
                    nowLocal = nowUtc;
                }

                switch (period.ToLower())
                {
                    case "last_day":
                        // Start of today in user's local time, converted to UTC
                        startDate = nowLocal.Date.AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_week":
                        // Start of 7-day period in user's local time, converted to UTC
                        startDate = nowLocal.Date.AddDays(-6).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_month":
                        // Start of 30-day period in user's local time, converted to UTC
                        startDate = nowLocal.Date.AddDays(-29).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_90":
                        startDate = nowLocal.Date.AddDays(-89).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_180":
                        startDate = nowLocal.Date.AddDays(-179).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "all":
                    default:
                        startDate = DateTime.MinValue; // Get all activities
                        break;
                }

                _logger.LogDebug("Fetching activities from {StartDate} for user {UserId} (timezoneOffsetMinutes: {TimezoneOffset})", startDate, userId, timezoneOffsetMinutes);

                var activities = await _context.UserActivities
                    .Where(a => a.UserId == userId && a.Timestamp >= startDate &&
                                (a.ActivityType == "LessonCompleted" || a.ActivityType == "BookFinished" || a.ActivityType == "ManualReading" || a.ActivityType == "TextCompleted")) // Added TextCompleted
                    .Include(a => a.Language) // Include Language for grouping
                    .OrderBy(a => a.Timestamp)
                    .ToListAsync();

                _logger.LogInformation("Found {ActivityCount} activities for the period.", activities.Count);

                // Aggregate by date
                var activityByDate = activities
                    .GroupBy(a => a.Timestamp.Date)
                    .ToDictionary(
                        g => g.Key.ToString("yyyy-MM-dd"),
                        g => g.Sum(a => a.WordCount)
                    );

                // Aggregate by language
                var activityByLanguage = activities
                    .Where(a => a.Language != null) // Ensure language is loaded
                    .GroupBy(a => a.Language!.Name) // Group by language name
                    .ToDictionary(
                        g => g.Key,
                        g => g.Sum(a => a.WordCount)
                    );
                    
                // Calculate total words read in the period
                int totalWordsRead = activities.Sum(a => a.WordCount);

                var result = new
                {
                    TotalWordsRead = totalWordsRead,
                    ActivityByDate = activityByDate,
                    ActivityByLanguage = activityByLanguage,
                    Period = period,
                    StartDate = startDate == DateTime.MinValue ? "all" : startDate.ToString("yyyy-MM-dd")
                };

                _logger.LogInformation("Successfully retrieved and aggregated reading activity data.");
                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving reading activity data for user {UserId} and period {Period}", userId, period);
                return StatusCode(500, new { message = "Error retrieving reading activity data", error = ex.Message });
            }
        }

        // GET: api/users/listening-activity
        [HttpGet("listening-activity")]
        public async Task<IActionResult> GetListeningActivity([FromQuery] string period = "all", [FromQuery] int? timezoneOffsetMinutes = null)
        {
            _logger.LogInformation("Getting listening activity for period: {Period}, timezoneOffsetMinutes: {TimezoneOffset}", period, timezoneOffsetMinutes);
            var userId = GetUserId();

            try
            {
                DateTime startDate;
                DateTime nowUtc = DateTime.UtcNow;
                DateTime nowLocal;

                if (timezoneOffsetMinutes.HasValue)
                {
                    nowLocal = nowUtc.AddMinutes(timezoneOffsetMinutes.Value);
                }
                else
                {
                    nowLocal = nowUtc;
                }

                switch (period.ToLower())
                {
                    case "last_day":
                        // Start of today in user's local time, converted to UTC
                        startDate = nowLocal.Date.AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_week":
                        // Start of 7-day period in user's local time, converted to UTC
                        startDate = nowLocal.Date.AddDays(-6).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_month":
                        // Start of 30-day period in user's local time, converted to UTC
                        startDate = nowLocal.Date.AddDays(-29).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_90":
                        startDate = nowLocal.Date.AddDays(-89).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_180":
                        startDate = nowLocal.Date.AddDays(-179).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "all":
                    default:
                        startDate = DateTime.MinValue;
                        break;
                }

                _logger.LogDebug("Fetching listening activities from {StartDate} for user {UserId}", startDate, userId);

                var activities = await _context.UserActivities
                    .Where(a => a.UserId == userId
                                && (a.ActivityType == "Listening" || a.ActivityType == "ManualListening") // Include manual listening
                                && a.ListeningDurationSeconds.HasValue && a.ListeningDurationSeconds > 0 // Ensure we only count activities with positive duration
                                && a.Timestamp >= startDate)
                    .Include(a => a.Language) // Include Language for grouping by name
                    .OrderBy(a => a.Timestamp)
                    .ToListAsync();

                _logger.LogInformation("Found {ActivityCount} listening activities for the period.", activities.Count);

                // Aggregate by date
                var activityByDate = activities
                    .GroupBy(a => a.Timestamp.Date)
                    .Select(g => new {
                        Date = g.Key.ToString("yyyy-MM-dd"),
                        TotalSeconds = g.Sum(a => a.ListeningDurationSeconds ?? 0) // Sum duration
                    })
                    .ToDictionary(g => g.Date, g => g.TotalSeconds);

                // Aggregate by language
                var activityByLanguage = activities
                    .Where(a => a.Language != null) // Ensure language is loaded
                    .GroupBy(a => new { a.LanguageId, a.Language!.Name }) // Group by language ID and name
                    .Select(g => new {
                        LanguageId = g.Key.LanguageId,
                        LanguageName = g.Key.Name,
                        TotalSeconds = g.Sum(a => a.ListeningDurationSeconds ?? 0) // Sum duration
                    })
                    .ToList(); // Keep as a list as requested in the plan

                // Calculate total listening time in the period
                long totalListeningSeconds = activities.Sum(a => a.ListeningDurationSeconds ?? 0);

                var result = new
                {
                    TotalListeningSeconds = totalListeningSeconds,
                    ListeningByDate = activityByDate, // Renamed for clarity
                    ListeningByLanguage = activityByLanguage, // Renamed for clarity
                    Period = period,
                    StartDate = startDate == DateTime.MinValue ? "all" : startDate.ToString("yyyy-MM-dd")
                };

                _logger.LogInformation("Successfully retrieved and aggregated listening activity data.");
                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving listening activity data for user {UserId} and period {Period}", userId, period);
                return StatusCode(500, new { message = "Error retrieving listening activity data", error = ex.Message });
            }
        }
 

        // POST: api/users/reset-statistics
        [HttpPost("reset-statistics")]
        public async Task<IActionResult> ResetStatistics()
        {
            var userId = GetUserId();
            _logger.LogInformation("Attempting to reset statistics for user {UserId}", userId);

            try
            {
                // 1. Find and remove UserActivities
                var activities = await _context.UserActivities
                    .Where(a => a.UserId == userId)
                    .ToListAsync();

                if (activities.Any())
                {
                    _logger.LogInformation("Found {ActivityCount} UserActivity records to remove for user {UserId}", activities.Count, userId);
                    _context.UserActivities.RemoveRange(activities);
                }
                else
                {
                    _logger.LogInformation("No UserActivity records found for user {UserId}", userId);
                }

                // 2. Find and reset UserLanguageStatistics
                var langStats = await _context.UserLanguageStatistics
                    .Where(uls => uls.UserId == userId)
                    .ToListAsync();

                if (langStats.Any())
                {
                    _logger.LogInformation("Found {StatCount} UserLanguageStatistics records to reset for user {UserId}", langStats.Count, userId);
                    foreach (var stat in langStats)
                    {
                        stat.TotalWordsRead = 0;
                        stat.TotalSecondsListened = 0;
                        stat.TotalTextsCompleted = 0;
                        stat.TotalBooksCompleted = 0;
                        // Add any other relevant aggregate fields from UserLanguageStatistics model here if needed
                        _context.Entry(stat).State = EntityState.Modified;
                    }
                }
                 else
                {
                    _logger.LogInformation("No UserLanguageStatistics records found for user {UserId}", userId);
                }

                // 3. Save changes
                await _context.SaveChangesAsync();
                _logger.LogInformation("Successfully reset statistics for user {UserId}", userId);

                return Ok(new { message = "Statistics reset successfully." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error resetting statistics for user {UserId}", userId);
                return StatusCode(500, new { message = "An error occurred while resetting statistics.", error = ex.Message });
            }
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

    public class UserStatisticsDto
    {
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public int LearningWords { get; set; }
        public int TotalBooks { get; set; }
        public int FinishedBooks { get; set; }
        public DateTime LastActivity { get; set; }
        public int TotalLanguages { get; set; }
        public List<LanguageStatisticsDto> LanguageStatistics { get; set; } = new List<LanguageStatisticsDto>();
    }

    public class LanguageStatisticsDto
    {
        public int LanguageId { get; set; }
        public string LanguageName { get; set; } = string.Empty;
        public int WordCount { get; set; } // Total unique words encountered for this language
        public int TotalWordsRead { get; set; } // Cumulative words read
        public int TotalTextsCompleted { get; set; } // Cumulative texts completed
        public int TotalSecondsListened { get; set; } // Cumulative listening time
        public int BookCount { get; set; } // Total books started in this language
        public int FinishedBookCount { get; set; } // Total books finished in this language
    }
} 