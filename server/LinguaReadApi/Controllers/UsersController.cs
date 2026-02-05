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
            
            // Get total word count for user across all languages
            var totalWords = await _context.Words
                .CountAsync(w => w.UserId == userId);
                
            // Get known word count (status 4 or 5)
            var knownWords = await _context.Words
                .CountAsync(w => w.UserId == userId && w.Status >= 4);

            // Get user's books
            var books = await _context.Books
                .Where(b => b.UserId == userId)
                .Include(b => b.Language)
                .ToListAsync();
                
            // Get word counts by language from database
            // Modified to get both total count and known count
            var wordStatsByLanguage = await _context.Words
                .Where(w => w.UserId == userId)
                .GroupBy(w => w.LanguageId)
                .Select(g => new { 
                    LanguageId = g.Key, 
                    TotalCount = g.Count(),
                    KnownCount = g.Count(w => w.Status >= 4)
                })
                .ToDictionaryAsync(g => g.LanguageId, g => g);

            // Fetch Aggregated User Language Statistics
            var userLangStats = await _context.UserLanguageStatistics
                .Where(uls => uls.UserId == userId)
                .Include(uls => uls.Language) 
                .ToDictionaryAsync(uls => uls.LanguageId); 

            // Get language details
            // Merge keys from all sources to ensure we catch all languages
            var allLanguageIds = userLangStats.Keys
                .Union(wordStatsByLanguage.Keys)
                .Union(books.Select(b => b.LanguageId))
                .Distinct()
                .ToList();
                
            // We need to fetch language names for IDs that might not be in userLangStats (which included Language)
            // Ideally we'd have a separate dictionary of LanguageId -> LanguageName, but let's try to get it from available sources
            // or fetch missing ones. For now, rely on what we have or "Unknown" if missing (should be rare/impossible if FKs exist)
            
            // To be safe, let's just fetch all languages for the IDs we have if we think we might miss some names
            // But userLangStats.Include(l => l.Language) covers most.
            // If a user has words but no language stats entry (rare?), we might miss the name.
            // Let's grab names from books or handle gracefully on frontend or just do a quick lookup if needed.
            // For simplicity, let's use the sources we have.
            
            var languageStats = new List<LanguageStatisticsDto>();
            
            foreach(var langId in allLanguageIds)
            {
                // Try to find name in userLangStats first
                string langName = "Unknown";
                if (userLangStats.TryGetValue(langId, out var uls) && uls.Language != null)
                {
                    langName = uls.Language.Name;
                }
                else
                {
                    // Try to find in books
                    var book = books.FirstOrDefault(b => b.LanguageId == langId);
                    if (book != null && book.Language != null)
                    {
                        langName = book.Language.Name;
                    }
                    // Could also fetch from DB if really needed, but let's assume one of these covers it or "Unknown" is acceptable fallback
                }

                // Get word stats
                int count = 0;
                int known = 0;
                if (wordStatsByLanguage.TryGetValue(langId, out var ws))
                {
                    count = ws.TotalCount;
                    known = ws.KnownCount;
                }
                
                // Get general stats (or default)
                var stats = uls ?? new UserLanguageStatistics { LanguageId = langId };

                languageStats.Add(new LanguageStatisticsDto
                {
                    LanguageId = langId,
                    LanguageName = langName,
                    WordCount = count, // Total Encountered
                    KnownWords = known,
                    LearningWords = count - known,
                    TotalWordsRead = (int)stats.TotalWordsRead, 
                    TotalTextsCompleted = stats.TotalTextsCompleted,
                    TotalSecondsListened = (int)stats.TotalSecondsListened, 
                    BookCount = books.Count(b => b.LanguageId == langId),
                    FinishedBookCount = books.Count(b => b.LanguageId == langId && b.IsFinished) 
                });
            }
                
            var statistics = new UserStatisticsDto
            {
                TotalWords = totalWords,
                KnownWords = knownWords,
                LearningWords = totalWords - knownWords,
                TotalBooks = books.Count,
                FinishedBooks = books.Count(b => b.IsFinished),
                LastActivity = DateTime.UtcNow,
                TotalLanguages = languageStats.Count,
                LanguageStatistics = languageStats
            };
            
            // Set LastActivity safely
            if (books.Any(b => b.LastReadAt.HasValue))
            {
                var maxDate = books.Where(b => b.LastReadAt.HasValue)
                                  .Max(b => b.LastReadAt ?? DateTime.MinValue);
                if (maxDate != DateTime.MinValue)
                {
                    statistics.LastActivity = maxDate;
                }
            }

            return statistics;
        }

        [HttpGet("reading-activity")] // Corrected route to match frontend api.js
        public async Task<IActionResult> GetReadingActivity([FromQuery] string period = "all", [FromQuery] int? timezoneOffsetMinutes = null, [FromQuery] int? languageId = null)
        {
            _logger.LogInformation("Getting reading activity for period: {Period}, timezoneOffsetMinutes: {TimezoneOffset}, languageId: {LanguageId}", period, timezoneOffsetMinutes, languageId);
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

                _logger.LogDebug("Fetching activities from {StartDate} for user {UserId} (timezoneOffsetMinutes: {TimezoneOffset}, languageId: {LanguageId})", startDate, userId, timezoneOffsetMinutes, languageId);

                var query = _context.UserActivities
                    .Where(a => a.UserId == userId && a.Timestamp >= startDate &&
                                (a.ActivityType == "LessonCompleted" || a.ActivityType == "BookFinished" || a.ActivityType == "ManualReading" || a.ActivityType == "TextCompleted")); // Added TextCompleted

                if (languageId.HasValue)
                {
                    query = query.Where(a => a.LanguageId == languageId.Value);
                }

                var activities = await query
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
        public async Task<IActionResult> GetListeningActivity([FromQuery] string period = "all", [FromQuery] int? timezoneOffsetMinutes = null, [FromQuery] int? languageId = null)
        {
            _logger.LogInformation("Getting listening activity for period: {Period}, timezoneOffsetMinutes: {TimezoneOffset}, languageId: {LanguageId}", period, timezoneOffsetMinutes, languageId);
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

                _logger.LogDebug("Fetching listening activities from {StartDate} for user {UserId} (languageId: {LanguageId})", startDate, userId, languageId);

                var query = _context.UserActivities
                    .Where(a => a.UserId == userId
                                && (a.ActivityType == "Listening" || a.ActivityType == "ManualListening") // Include manual listening
                                && a.ListeningDurationSeconds.HasValue && a.ListeningDurationSeconds > 0 // Ensure we only count activities with positive duration
                                && a.Timestamp >= startDate);

                if (languageId.HasValue)
                {
                    query = query.Where(a => a.LanguageId == languageId.Value);
                }

                var activities = await query
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
        public int KnownWords { get; set; } // Added: Words with status >= 4
        public int LearningWords { get; set; } // Added: Words with status < 4
        public int TotalWordsRead { get; set; } // Cumulative words read
        public int TotalTextsCompleted { get; set; } // Cumulative texts completed
        public int TotalSecondsListened { get; set; } // Cumulative listening time
        public int BookCount { get; set; } // Total books started in this language
        public int FinishedBookCount { get; set; } // Total books finished in this language
    }
} 