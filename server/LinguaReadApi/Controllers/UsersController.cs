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

        // Process-lifetime set of language codes already warned about (fallback CEFR
        // thresholds). Prevents log spam when a user has many texts in an unlisted language.
        private static readonly HashSet<string> _warnedFallbackLanguages =
            new(StringComparer.OrdinalIgnoreCase);
        private static readonly object _warnedFallbackLock = new();

        public UsersController(AppDbContext context, ILogger<UsersController> logger)
        {
            _context = context;
            _logger = logger;
        }

        private void WarnOnceForFallbackLanguage(string? languageCode)
        {
            if (string.IsNullOrEmpty(languageCode)) return;
            if (CefrEstimator.HasThresholdsFor(languageCode)) return;
            bool added;
            lock (_warnedFallbackLock)
            {
                added = _warnedFallbackLanguages.Add(languageCode);
            }
            if (added)
            {
                _logger.LogWarning(
                    "CEFR estimate for language '{LanguageCode}' is using fallback thresholds; results are approximate.",
                    languageCode);
            }
        }

        // GET: api/users/statistics
        [HttpGet("statistics")]
        public async Task<ActionResult<UserStatisticsDto>> GetUserStatistics()
        {
            var userId = GetUserId();
            
            // Get total word count for user across all languages (status 6 = Ignored excluded)
            var totalWords = await _context.Words
                .CountAsync(w => w.UserId == userId && w.Status != 6);
                
            // Get known word count (status 4 or 5)
            var knownWords = await _context.Words
                .CountAsync(w => w.UserId == userId && w.Status >= 4 && w.Status <= 5);

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
                    TotalCount = g.Count(w => w.Status != 6),
                    KnownCount = g.Count(w => w.Status >= 4 && w.Status <= 5)
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

                var cefr = CefrEstimator.Estimate(known, langCode);
                if (cefr.IsApproximate) WarnOnceForFallbackLanguage(langCode);

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
                    CefrLevel = cefr.Level,
                    NextCefrLevel = cefr.NextLevel,
                    KnownWordsToNextLevel = cefr.KnownToNext,
                    BandProgressPercent = cefr.BandProgressPercent,
                    IsCefrApproximate = cefr.IsApproximate
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
        public async Task<IActionResult> GetReadingActivity([FromQuery] string period = "all", [FromQuery] int? timezoneOffsetMinutes = null, [FromQuery] int? languageId = null, [FromQuery] int offset = 0)
        {
            _logger.LogInformation("Getting reading activity for period: {Period}, offset: {Offset}, timezoneOffsetMinutes: {TimezoneOffset}, languageId: {LanguageId}", period, offset, timezoneOffsetMinutes, languageId);
            var userId = GetUserId();

            try
            {
                DateTime startDate;
                DateTime endDate;
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

                int? lengthDays = PeriodLengthDays(period);
                int effectiveOffset = lengthDays.HasValue && offset > 0 ? offset : 0;

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

                if (effectiveOffset > 0 && lengthDays.HasValue)
                {
                    DateTime origStart = startDate;
                    endDate = origStart.AddDays(-lengthDays.Value * (effectiveOffset - 1));
                    startDate = endDate.AddDays(-lengthDays.Value);
                    _logger.LogDebug("Applied offset {Offset} (length {Length}d): startDate {StartDate}, endDate {EndDate}", effectiveOffset, lengthDays.Value, startDate, endDate);
                }
                else
                {
                    endDate = DateTime.MaxValue;
                }

                _logger.LogDebug("Fetching activities from {StartDate} to {EndDate} for user {UserId} (timezoneOffsetMinutes: {TimezoneOffset}, languageId: {LanguageId})", startDate, endDate, userId, timezoneOffsetMinutes, languageId);

                var query = _context.UserActivities
                    .Where(a => a.UserId == userId && a.Timestamp >= startDate &&
                                (a.ActivityType == "Reading" || a.ActivityType == "LessonCompleted" ||
                                 a.ActivityType == "BookFinished" || a.ActivityType == "ManualReading" ||
                                 a.ActivityType == "TextCompleted")); // Added TextCompleted

                if (effectiveOffset > 0)
                {
                    query = query.Where(a => a.Timestamp < endDate);
                }

                if (languageId.HasValue)
                {
                    query = query.Where(a => a.LanguageId == languageId.Value);
                }

                int tzOffset = timezoneOffsetMinutes.GetValueOrDefault(0);

                var byDate = await query
                    .GroupBy(a => a.Timestamp.AddMinutes(tzOffset).Date)
                    .Select(g => new { Date = g.Key, WordCount = g.Sum(a => a.WordCount) })
                    .ToListAsync();

                var byLanguage = await query
                    .Where(a => a.Language != null)
                    .GroupBy(a => new { a.LanguageId, a.Language!.Name })
                    .Select(g => new {
                        LanguageId = g.Key.LanguageId,
                        LanguageName = g.Key.Name,
                        TotalWords = g.Sum(a => a.WordCount)
                    })
                    .ToListAsync();

                _logger.LogInformation("Aggregated reading activity across {DateCount} dates and {LangCount} languages.", byDate.Count, byLanguage.Count);

                var activityByDate = byDate.ToDictionary(x => x.Date.ToString("yyyy-MM-dd"), x => x.WordCount);
                int totalWordsRead = byDate.Sum(x => x.WordCount);

                var result = new
                {
                    TotalWordsRead = totalWordsRead,
                    ActivityByDate = activityByDate,
                    ActivityByLanguage = byLanguage,
                    Period = period,
                    Offset = effectiveOffset,
                    StartDate = startDate == DateTime.MinValue ? "all" : startDate.ToString("yyyy-MM-dd"),
                    EndDate = effectiveOffset > 0 ? endDate.ToString("yyyy-MM-dd") : null
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
        public async Task<IActionResult> GetListeningActivity([FromQuery] string period = "all", [FromQuery] int? timezoneOffsetMinutes = null, [FromQuery] int? languageId = null, [FromQuery] int offset = 0)
        {
            _logger.LogInformation("Getting listening activity for period: {Period}, offset: {Offset}, timezoneOffsetMinutes: {TimezoneOffset}, languageId: {LanguageId}", period, offset, timezoneOffsetMinutes, languageId);
            var userId = GetUserId();

            try
            {
                DateTime startDate;
                DateTime endDate;
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

                int? lengthDays = PeriodLengthDays(period);
                int effectiveOffset = lengthDays.HasValue && offset > 0 ? offset : 0;

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

                if (effectiveOffset > 0 && lengthDays.HasValue)
                {
                    DateTime origStart = startDate;
                    endDate = origStart.AddDays(-lengthDays.Value * (effectiveOffset - 1));
                    startDate = endDate.AddDays(-lengthDays.Value);
                    _logger.LogDebug("Applied offset {Offset} (length {Length}d): startDate {StartDate}, endDate {EndDate}", effectiveOffset, lengthDays.Value, startDate, endDate);
                }
                else
                {
                    endDate = DateTime.MaxValue;
                }

                _logger.LogDebug("Fetching listening activities from {StartDate} to {EndDate} for user {UserId} (languageId: {LanguageId})", startDate, endDate, userId, languageId);

                var query = _context.UserActivities
                    .Where(a => a.UserId == userId
                                && (a.ActivityType == "Listening" || a.ActivityType == "ManualListening") // Include manual listening
                                && a.ListeningDurationSeconds.HasValue && a.ListeningDurationSeconds != 0 // Skip zero-duration noise; negatives are valid corrections
                                && a.Timestamp >= startDate);

                if (effectiveOffset > 0)
                {
                    query = query.Where(a => a.Timestamp < endDate);
                }

                if (languageId.HasValue)
                {
                    query = query.Where(a => a.LanguageId == languageId.Value);
                }

                int tzOffset = timezoneOffsetMinutes.GetValueOrDefault(0);

                var byDate = await query
                    .GroupBy(a => a.Timestamp.AddMinutes(tzOffset).Date)
                    .Select(g => new { Date = g.Key, TotalSeconds = g.Sum(a => a.ListeningDurationSeconds ?? 0) })
                    .ToListAsync();

                var activityByLanguage = await query
                    .Where(a => a.Language != null)
                    .GroupBy(a => new { a.LanguageId, a.Language!.Name })
                    .Select(g => new {
                        LanguageId = g.Key.LanguageId,
                        LanguageName = g.Key.Name,
                        TotalSeconds = g.Sum(a => a.ListeningDurationSeconds ?? 0)
                    })
                    .ToListAsync();

                _logger.LogInformation("Aggregated listening activity across {DateCount} dates and {LangCount} languages.", byDate.Count, activityByLanguage.Count);

                var activityByDate = byDate.ToDictionary(x => x.Date.ToString("yyyy-MM-dd"), x => x.TotalSeconds);
                long totalListeningSeconds = byDate.Sum(x => (long)x.TotalSeconds);

                var result = new
                {
                    TotalListeningSeconds = totalListeningSeconds,
                    ListeningByDate = activityByDate, // Renamed for clarity
                    ListeningByLanguage = activityByLanguage, // Renamed for clarity
                    Period = period,
                    Offset = effectiveOffset,
                    StartDate = startDate == DateTime.MinValue ? "all" : startDate.ToString("yyyy-MM-dd"),
                    EndDate = effectiveOffset > 0 ? endDate.ToString("yyyy-MM-dd") : null
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

        // GET: api/users/known-words-activity
        [HttpGet("known-words-activity")]
        public async Task<IActionResult> GetKnownWordsActivity([FromQuery] string period = "all", [FromQuery] int? timezoneOffsetMinutes = null, [FromQuery] int? languageId = null, [FromQuery] int offset = 0)
        {
            _logger.LogInformation("Getting known-words activity for period: {Period}, offset: {Offset}, timezoneOffsetMinutes: {TimezoneOffset}, languageId: {LanguageId}", period, offset, timezoneOffsetMinutes, languageId);
            var userId = GetUserId();

            try
            {
                DateTime startDate;
                DateTime endDate;
                DateTime nowUtc = DateTime.UtcNow;
                DateTime nowLocal = timezoneOffsetMinutes.HasValue
                    ? nowUtc.AddMinutes(timezoneOffsetMinutes.Value)
                    : nowUtc;

                int? lengthDays = PeriodLengthDays(period);
                int effectiveOffset = lengthDays.HasValue && offset > 0 ? offset : 0;

                switch (period.ToLower())
                {
                    case "last_day":
                        startDate = nowLocal.Date.AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_week":
                        startDate = nowLocal.Date.AddDays(-6).AddMinutes(-timezoneOffsetMinutes.GetValueOrDefault(0));
                        break;
                    case "last_month":
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

                if (effectiveOffset > 0 && lengthDays.HasValue)
                {
                    DateTime origStart = startDate;
                    endDate = origStart.AddDays(-lengthDays.Value * (effectiveOffset - 1));
                    startDate = endDate.AddDays(-lengthDays.Value);
                }
                else
                {
                    endDate = DateTime.MaxValue;
                }

                // Status 4-5 is treated as "known" (6 = Ignored is excluded). CreatedAt is used
                // as a proxy for the date the word entered the user's vocabulary (no history).
                var query = _context.Words
                    .Where(w => w.UserId == userId && w.Status >= 4 && w.Status <= 5 && w.CreatedAt >= startDate);

                if (effectiveOffset > 0)
                {
                    query = query.Where(w => w.CreatedAt < endDate);
                }

                if (languageId.HasValue)
                {
                    query = query.Where(w => w.LanguageId == languageId.Value);
                }

                int tzOffset = timezoneOffsetMinutes.GetValueOrDefault(0);

                var byDate = await query
                    .GroupBy(w => w.CreatedAt.AddMinutes(tzOffset).Date)
                    .Select(g => new { Date = g.Key, Count = g.Count() })
                    .ToListAsync();

                var byLanguage = await query
                    .Where(w => w.Language != null)
                    .GroupBy(w => new { w.LanguageId, w.Language!.Name })
                    .Select(g => new
                    {
                        LanguageId = g.Key.LanguageId,
                        LanguageName = g.Key.Name,
                        TotalKnown = g.Count()
                    })
                    .ToListAsync();

                var knownWordsByDate = byDate.ToDictionary(x => x.Date.ToString("yyyy-MM-dd"), x => x.Count);
                int totalKnownWords = byDate.Sum(x => x.Count);

                var result = new
                {
                    TotalKnownWords = totalKnownWords,
                    KnownWordsByDate = knownWordsByDate,
                    KnownWordsByLanguage = byLanguage,
                    Period = period,
                    Offset = effectiveOffset,
                    StartDate = startDate == DateTime.MinValue ? "all" : startDate.ToString("yyyy-MM-dd"),
                    EndDate = effectiveOffset > 0 ? endDate.ToString("yyyy-MM-dd") : null
                };

                _logger.LogInformation("Successfully retrieved known-words activity across {DateCount} dates.", byDate.Count);
                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving known-words activity for user {UserId} and period {Period}", userId, period);
                return StatusCode(500, new { message = "Error retrieving known-words activity", error = ex.Message });
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
                DateTime streakWindowStartUtc = todayLocalDate.AddDays(-365).AddMinutes(-tzOffset);

                // Per-language word counts (total + known)
                var wordStatsByLanguage = await _context.Words
                    .Where(w => w.UserId == userId)
                    .GroupBy(w => w.LanguageId)
                    .Select(g => new
                    {
                        LanguageId = g.Key,
                        TotalCount = g.Count(w => w.Status != 6),
                        KnownCount = g.Count(w => w.Status >= 4 && w.Status <= 5)
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
                    type == "Reading" || type == "LessonCompleted" || type == "BookFinished" ||
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

                // Most-recent unfinished text per language (for "Continue reading" quick link).
                // Pull the full set ordered and dedupe client-side — EF Core's translation of
                // GroupBy+FirstOrDefault against PostgreSQL is fragile.
                var candidateTexts = await _context.Texts
                    .Where(t => t.UserId == userId
                             && t.LastAccessedAt != null
                             && !t.IsFinished
                             && t.Tag != "srs-story"
                             && allLanguageIds.Contains(t.LanguageId))
                    .OrderByDescending(t => t.LastAccessedAt)
                    .Select(t => new { t.LanguageId, t.TextId })
                    .ToListAsync();
                var continueByLanguage = new Dictionary<int, int>();
                foreach (var t in candidateTexts)
                {
                    if (!continueByLanguage.ContainsKey(t.LanguageId))
                    {
                        continueByLanguage[t.LanguageId] = t.TextId;
                    }
                }

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

                    var cefr = CefrEstimator.Estimate(known, code);
                    if (cefr.IsApproximate) WarnOnceForFallbackLanguage(code);

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

                    int? continueId = continueByLanguage.TryGetValue(langId, out var cid) ? cid : (int?)null;

                    languageDtos.Add(new DashboardLanguageDto
                    {
                        LanguageId = langId,
                        LanguageCode = code,
                        LanguageName = name,
                        KnownWords = known,
                        TotalWords = total,
                        CefrLevel = cefr.Level,
                        NextCefrLevel = cefr.NextLevel,
                        KnownWordsToNextLevel = cefr.KnownToNext,
                        BandProgressPercent = cefr.BandProgressPercent,
                        IsCefrApproximate = cefr.IsApproximate,
                        TodayWordsRead = todayWords,
                        TodayListeningSeconds = todayListen,
                        WeekWordsRead = weekWords,
                        WeekListeningSeconds = weekListen,
                        CurrentReadingStreakDays = streak,
                        Last14DaysWords = sparkline,
                        ContinueReadingTextId = continueId,
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
                        stat.TotalTextCompletions = 0;
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

        private static int? PeriodLengthDays(string? period)
        {
            return period?.ToLower() switch
            {
                "last_day" => 1,
                "last_week" => 7,
                "last_month" => 30,
                "last_90" => 90,
                "last_180" => 180,
                _ => null
            };
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
        public string? CefrLevel { get; set; }
        public string? NextCefrLevel { get; set; }
        public int KnownWordsToNextLevel { get; set; }
        public int BandProgressPercent { get; set; }
        public bool IsCefrApproximate { get; set; }
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
        public string? CefrLevel { get; set; }
        public string? NextCefrLevel { get; set; }
        public int KnownWordsToNextLevel { get; set; }
        public int BandProgressPercent { get; set; }
        public bool IsCefrApproximate { get; set; }
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