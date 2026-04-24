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
using LinguaReadApi.Utilities;
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

            // Resolve names and codes for any language id (e.g. words exist but no ULS row and no books yet)
            var languageInfoById = await _context.Languages
                .AsNoTracking()
                .Where(l => allLanguageIds.Contains(l.LanguageId))
                .ToDictionaryAsync(l => l.LanguageId, l => new { l.Name, l.Code });

            var languageStats = new List<LanguageStatisticsDto>();

            foreach(var langId in allLanguageIds)
            {
                // Try to find name in userLangStats first
                string langName = "Unknown";
                string langCode = string.Empty;
                if (userLangStats.TryGetValue(langId, out var uls) && uls.Language != null)
                {
                    langName = uls.Language.Name;
                    langCode = uls.Language.Code ?? string.Empty;
                }
                else
                {
                    // Try to find in books
                    var book = books.FirstOrDefault(b => b.LanguageId == langId);
                    if (book != null && book.Language != null)
                    {
                        langName = book.Language.Name;
                        langCode = book.Language.Code ?? string.Empty;
                    }
                }

                if (languageInfoById.TryGetValue(langId, out var info))
                {
                    if (langName == "Unknown") langName = info.Name;
                    if (string.IsNullOrEmpty(langCode)) langCode = info.Code ?? string.Empty;
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

                var (cefrLevel, nextCefrLevel, knownToNext) = CefrEstimator.Estimate(known, langCode);

                languageStats.Add(new LanguageStatisticsDto
                {
                    LanguageId = langId,
                    LanguageName = langName,
                    LanguageCode = langCode,
                    WordCount = count, // Total Encountered
                    KnownWords = known,
                    LearningWords = count - known,
                    TotalWordsRead = (int)stats.TotalWordsRead,
                    TotalTextsCompleted = stats.TotalTextsCompleted,
                    TotalSecondsListened = (int)stats.TotalSecondsListened,
                    BookCount = books.Count(b => b.LanguageId == langId),
                    FinishedBookCount = books.Count(b => b.LanguageId == langId && b.IsFinished),
                    CefrLevel = cefrLevel,
                    NextCefrLevel = nextCefrLevel,
                    KnownWordsToNextLevel = knownToNext
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
 

        // GET: api/users/dashboard
        [HttpGet("dashboard")]
        public async Task<ActionResult<DashboardDto>> GetDashboard([FromQuery] int? timezoneOffsetMinutes = null)
        {
            var userId = GetUserId();

            try
            {
                int tzOffset = timezoneOffsetMinutes.GetValueOrDefault(0);
                DateTime nowUtc = DateTime.UtcNow;
                DateTime nowLocal = nowUtc.AddMinutes(tzOffset);
                DateTime todayLocalDate = nowLocal.Date;
                DateTime todayStartUtc = todayLocalDate.AddMinutes(-tzOffset);
                DateTime weekStartUtc = todayLocalDate.AddDays(-6).AddMinutes(-tzOffset);
                DateTime sparkStartUtc = todayLocalDate.AddDays(-13).AddMinutes(-tzOffset);
                DateTime streakWindowStartUtc = todayLocalDate.AddDays(-365).AddMinutes(-tzOffset);

                // Per-language word counts (total + known)
                var wordStatsByLanguage = await _context.Words
                    .Where(w => w.UserId == userId)
                    .GroupBy(w => w.LanguageId)
                    .Select(g => new
                    {
                        LanguageId = g.Key,
                        TotalCount = g.Count(),
                        KnownCount = g.Count(w => w.Status >= 4)
                    })
                    .ToDictionaryAsync(g => g.LanguageId, g => g);

                // Pull all relevant UserActivity rows in one go (reading + listening) from the oldest
                // window we need so we can bucket for today / week / sparkline / streak client-side.
                var activityRows = await _context.UserActivities
                    .Where(a => a.UserId == userId && a.Timestamp >= streakWindowStartUtc)
                    .Select(a => new
                    {
                        a.LanguageId,
                        a.ActivityType,
                        a.WordCount,
                        a.ListeningDurationSeconds,
                        a.Timestamp
                    })
                    .ToListAsync();

                bool IsReading(string type) =>
                    type == "LessonCompleted" || type == "BookFinished" ||
                    type == "ManualReading" || type == "TextCompleted";

                bool IsListening(string type) =>
                    type == "Listening" || type == "ManualListening";

                // Precompute local-date for each row
                var rowsWithLocal = activityRows.Select(r => new
                {
                    r.LanguageId,
                    r.ActivityType,
                    r.WordCount,
                    r.ListeningDurationSeconds,
                    r.Timestamp,
                    LocalDate = r.Timestamp.AddMinutes(tzOffset).Date
                }).ToList();

                // All language ids with either words or any activity
                var allLanguageIds = wordStatsByLanguage.Keys
                    .Union(rowsWithLocal.Select(r => r.LanguageId))
                    .Distinct()
                    .ToList();

                if (!allLanguageIds.Any())
                {
                    return new DashboardDto();
                }

                var languageInfo = await _context.Languages
                    .AsNoTracking()
                    .Where(l => allLanguageIds.Contains(l.LanguageId))
                    .ToDictionaryAsync(l => l.LanguageId, l => new { l.Name, l.Code });

                // Most-recent unfinished text per language (for "Continue reading" quick link)
                var continueReading = await _context.Texts
                    .Where(t => t.UserId == userId
                             && t.LastAccessedAt != null
                             && !t.IsFinished
                             && t.Tag != "srs-story"
                             && allLanguageIds.Contains(t.LanguageId))
                    .GroupBy(t => t.LanguageId)
                    .Select(g => g
                        .OrderByDescending(t => t.LastAccessedAt)
                        .Select(t => new { t.LanguageId, t.TextId })
                        .FirstOrDefault())
                    .ToListAsync();
                var continueByLanguage = continueReading
                    .Where(x => x != null)
                    .ToDictionary(x => x!.LanguageId, x => x!.TextId);

                // Build per-language DTOs
                var languageDtos = new List<DashboardLanguageDto>();
                foreach (var langId in allLanguageIds)
                {
                    string name = "Unknown";
                    string code = string.Empty;
                    if (languageInfo.TryGetValue(langId, out var info))
                    {
                        name = info.Name;
                        code = info.Code ?? string.Empty;
                    }

                    int total = 0, known = 0;
                    if (wordStatsByLanguage.TryGetValue(langId, out var ws))
                    {
                        total = ws.TotalCount;
                        known = ws.KnownCount;
                    }

                    var (cefr, nextCefr, knownToNext) = CefrEstimator.Estimate(known, code);

                    var langRows = rowsWithLocal.Where(r => r.LanguageId == langId).ToList();

                    int todayWords = langRows
                        .Where(r => IsReading(r.ActivityType) && r.LocalDate == todayLocalDate)
                        .Sum(r => r.WordCount);

                    int todayListen = langRows
                        .Where(r => IsListening(r.ActivityType) && r.LocalDate == todayLocalDate)
                        .Sum(r => r.ListeningDurationSeconds ?? 0);

                    var weekLocalStart = todayLocalDate.AddDays(-6);
                    int weekWords = langRows
                        .Where(r => IsReading(r.ActivityType) && r.LocalDate >= weekLocalStart)
                        .Sum(r => r.WordCount);

                    int weekListen = langRows
                        .Where(r => IsListening(r.ActivityType) && r.LocalDate >= weekLocalStart)
                        .Sum(r => r.ListeningDurationSeconds ?? 0);

                    var sparkLocalStart = todayLocalDate.AddDays(-13);
                    var wordsByDate = langRows
                        .Where(r => IsReading(r.ActivityType) && r.LocalDate >= sparkLocalStart)
                        .GroupBy(r => r.LocalDate)
                        .ToDictionary(g => g.Key, g => g.Sum(r => r.WordCount));

                    var sparkline = new List<DailyCountDto>(14);
                    for (int i = 13; i >= 0; i--)
                    {
                        var d = todayLocalDate.AddDays(-i);
                        wordsByDate.TryGetValue(d, out int count);
                        sparkline.Add(new DailyCountDto
                        {
                            Date = d.ToString("yyyy-MM-dd"),
                            Count = count
                        });
                    }

                    // Reading streak: walk back from today over days with ANY reading activity.
                    var readingDays = new HashSet<DateTime>(
                        langRows
                            .Where(r => IsReading(r.ActivityType))
                            .Select(r => r.LocalDate));
                    int streak = 0;
                    var cursor = todayLocalDate;
                    // Allow today to have no reading yet without breaking yesterday's streak.
                    if (!readingDays.Contains(cursor))
                    {
                        cursor = cursor.AddDays(-1);
                    }
                    while (readingDays.Contains(cursor))
                    {
                        streak++;
                        cursor = cursor.AddDays(-1);
                    }

                    DateTime? lastActivity = langRows.Any()
                        ? langRows.Max(r => r.Timestamp)
                        : (DateTime?)null;

                    continueByLanguage.TryGetValue(langId, out int continueId);

                    languageDtos.Add(new DashboardLanguageDto
                    {
                        LanguageId = langId,
                        LanguageCode = code,
                        LanguageName = name,
                        KnownWords = known,
                        TotalWords = total,
                        CefrLevel = cefr,
                        NextCefrLevel = nextCefr,
                        KnownWordsToNextLevel = knownToNext,
                        TodayWordsRead = todayWords,
                        TodayListeningSeconds = todayListen,
                        WeekWordsRead = weekWords,
                        WeekListeningSeconds = weekListen,
                        CurrentReadingStreakDays = streak,
                        Last14DaysWords = sparkline,
                        ContinueReadingTextId = continueId == 0 ? (int?)null : continueId,
                        LastActivityAt = lastActivity
                    });
                }

                languageDtos = languageDtos
                    .OrderByDescending(l => l.LastActivityAt ?? DateTime.MinValue)
                    .ThenByDescending(l => l.KnownWords)
                    .ToList();

                var weekLocalStartTop = todayLocalDate.AddDays(-6);
                var dto = new DashboardDto
                {
                    TotalKnownWords = languageDtos.Sum(l => l.KnownWords),
                    TotalWordsReadWeek = rowsWithLocal
                        .Where(r => IsReading(r.ActivityType) && r.LocalDate >= weekLocalStartTop)
                        .Sum(r => r.WordCount),
                    TotalReadingSecondsWeek = 0, // Not tracked; word count is the primary reading metric.
                    TotalListeningSecondsWeek = rowsWithLocal
                        .Where(r => IsListening(r.ActivityType) && r.LocalDate >= weekLocalStartTop)
                        .Sum(r => (long)(r.ListeningDurationSeconds ?? 0)),
                    TotalLanguages = languageDtos.Count,
                    Languages = languageDtos
                };

                return dto;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error building dashboard for user {UserId}", userId);
                return StatusCode(500, new { message = "Error building dashboard", error = ex.Message });
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
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                throw new UnauthorizedAccessException("User ID not found in token");
            }

            return userId;
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
        public string LanguageCode { get; set; } = string.Empty;
        public int WordCount { get; set; } // Total unique words encountered for this language
        public int KnownWords { get; set; } // Added: Words with status >= 4
        public int LearningWords { get; set; } // Added: Words with status < 4
        public int TotalWordsRead { get; set; } // Cumulative words read
        public int TotalTextsCompleted { get; set; } // Cumulative texts completed
        public int TotalSecondsListened { get; set; } // Cumulative listening time
        public int BookCount { get; set; } // Total books started in this language
        public int FinishedBookCount { get; set; } // Total books finished in this language
        public string CefrLevel { get; set; } = "A1";
        public string? NextCefrLevel { get; set; }
        public int KnownWordsToNextLevel { get; set; }
    }

    public class DashboardDto
    {
        public int TotalKnownWords { get; set; }
        public long TotalReadingSecondsWeek { get; set; }
        public int TotalWordsReadWeek { get; set; }
        public long TotalListeningSecondsWeek { get; set; }
        public int TotalLanguages { get; set; }
        public List<DashboardLanguageDto> Languages { get; set; } = new List<DashboardLanguageDto>();
    }

    public class DashboardLanguageDto
    {
        public int LanguageId { get; set; }
        public string LanguageCode { get; set; } = string.Empty;
        public string LanguageName { get; set; } = string.Empty;
        public int KnownWords { get; set; }
        public int TotalWords { get; set; }
        public string CefrLevel { get; set; } = "A1";
        public string? NextCefrLevel { get; set; }
        public int KnownWordsToNextLevel { get; set; }
        public int TodayWordsRead { get; set; }
        public int TodayListeningSeconds { get; set; }
        public int WeekWordsRead { get; set; }
        public int WeekListeningSeconds { get; set; }
        public int CurrentReadingStreakDays { get; set; }
        public List<DailyCountDto> Last14DaysWords { get; set; } = new List<DailyCountDto>();
        public int? ContinueReadingTextId { get; set; }
        public DateTime? LastActivityAt { get; set; }
    }

    public class DailyCountDto
    {
        public string Date { get; set; } = string.Empty;
        public int Count { get; set; }
    }
} 