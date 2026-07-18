using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore; // Added for DbUpdateException
using System;
using System.ComponentModel.DataAnnotations; // Added for [Required] attribute
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using System.Collections.Generic; // For Dictionary, List
using System.Linq; // For LINQ methods like GroupBy, Sum
using System.Text.Json;
using LinguaReadApi.Utilities;

namespace LinguaReadApi.Controllers
{
    [ApiController]
    [Route("api/activity")]
    [Authorize] // Ensure only logged-in users can log activity
    public class UserActivityController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly UserManager<User> _userManager;
        private readonly ILogger<UserActivityController> _logger; // Add logger field

        public UserActivityController(AppDbContext context, UserManager<User> userManager, ILogger<UserActivityController> logger) // Inject logger
        {
            _context = context;
            _userManager = userManager;
            _logger = logger; // Assign logger
        }

        // DTO for the request body
        public class LogListeningRequest
        {
            public int LanguageId { get; set; }
            public int DurationSeconds { get; set; }
            // Optional client-generated idempotency key (offline replay / lost-response dedup).
            public string? ClientEventId { get; set; }
        }
[HttpPost("logListening")]
public async Task<IActionResult> LogListeningActivity([FromBody] LogListeningRequest request)
{
    _logger.LogInformation("Received request to log listening activity. LanguageId: {LanguageId}, DurationSeconds: {DurationSeconds}", request.LanguageId, request.DurationSeconds);

    if (request.DurationSeconds <= 0)
    {
        _logger.LogWarning("Invalid duration received: {DurationSeconds}. Returning BadRequest.", request.DurationSeconds);
        return BadRequest("Duration must be positive.");
    }

    // Get the current user's ID
    var userIdString = User.FindFirstValue(ClaimTypes.NameIdentifier);
    if (string.IsNullOrEmpty(userIdString) || !Guid.TryParse(userIdString, out Guid userId))
    {
         _logger.LogWarning("Could not parse UserId from token for NameIdentifier claim.");
         return Unauthorized("User ID not found in token.");
    }
    _logger.LogInformation("Attempting to log activity for UserId: {UserId}", userId);

    // Idempotency: an offline flush replayed from the client queue (or a request
    // whose response was lost on a flaky link) carries a ClientEventId. If we've
    // already recorded that event, ignore the duplicate so the additive
    // TotalSecondsListened is never double-counted.
    if (!string.IsNullOrEmpty(request.ClientEventId))
    {
        var alreadyLogged = await _context.UserActivities
            .AnyAsync(ua => ua.UserId == userId && ua.ClientEventId == request.ClientEventId);
        if (alreadyLogged)
        {
            _logger.LogInformation("Duplicate listening activity ignored for UserId: {UserId}, ClientEventId: {ClientEventId}", userId, request.ClientEventId);
            return Ok(new { message = "Listening activity already logged (duplicate ignored)." });
        }
    }

    var activity = new UserActivity
    {
        UserId = userId,
        LanguageId = request.LanguageId,
        ActivityType = "Listening", // Specific type for listening
        WordCount = 0, // Not applicable for listening
        ListeningDurationSeconds = request.DurationSeconds,
        ClientEventId = request.ClientEventId,
        Timestamp = DateTime.UtcNow
    };

    try
    {
        // Activity row + cumulative stats are committed in a single SaveChanges so
        // a partial commit can't leave the seconds counted without the dedup row
        // (or vice-versa).
        _context.UserActivities.Add(activity);

        // --- Update UserLanguageStatistics cumulative listening time ---
        var stats = await _context.UserLanguageStatistics
            .Where(uls => uls.UserId == userId && uls.LanguageId == request.LanguageId)
            .OrderBy(uls => uls.UserLanguageStatisticsId)
            .FirstOrDefaultAsync();

        if (stats == null)
        {
            stats = new UserLanguageStatistics
            {
                UserId = userId,
                LanguageId = request.LanguageId,
                TotalSecondsListened = request.DurationSeconds,
                LastUpdatedAt = DateTime.UtcNow
            };
            _context.UserLanguageStatistics.Add(stats);
        }
        else
        {
            stats.TotalSecondsListened += request.DurationSeconds;
            stats.LastUpdatedAt = DateTime.UtcNow;
        }

        await _context.SaveChangesAsync();
        _logger.LogInformation("Successfully saved listening activity for UserId: {UserId}, ActivityId: {ActivityId}", userId, activity.ActivityId);
        return Ok(new { message = "Listening activity logged successfully.", activityId = activity.ActivityId }); // Indicate success
    }
    catch (DbUpdateException dbEx) // Catch specific DB exceptions first
    {
        // Concurrent replay of the same ClientEventId loses the race on the unique
        // index (Postgres 23505 = unique_violation). That's still a successful dedup,
        // not an error. Match on SqlState rather than a message substring so the
        // check doesn't depend on the driver's message formatting.
        if (!string.IsNullOrEmpty(request.ClientEventId)
            && dbEx.InnerException is Npgsql.PostgresException pgEx && pgEx.SqlState == "23505")
        {
            _logger.LogInformation("Concurrent duplicate listening activity ignored for UserId: {UserId}, ClientEventId: {ClientEventId}", userId, request.ClientEventId);
            return Ok(new { message = "Listening activity already logged (duplicate ignored)." });
        }
        _logger.LogError(dbEx, "Database error saving listening activity for UserId: {UserId}. InnerException: {InnerMessage}", userId, dbEx.InnerException?.Message);
        return StatusCode(500, $"A database error occurred while saving the activity: {dbEx.InnerException?.Message ?? dbEx.Message}");
    }
    catch (Exception ex) // Catch general exceptions
    {
        _logger.LogError(ex, "Unexpected error saving listening activity for UserId: {UserId}", userId);
        return StatusCode(500, $"An unexpected error occurred while saving the activity: {ex.Message}");
    }
}

// DTO for manual activity logging
public class LogManualActivityRequest
{
    [Required]
    public int LanguageId { get; set; }
    public int? WordCount { get; set; } // Nullable for listening-only entries
    public int? ListeningDurationSeconds { get; set; } // Nullable for reading-only entries
}

[HttpPost("logManual")]
public async Task<IActionResult> LogManualActivity([FromBody] LogManualActivityRequest request)
{
    _logger.LogInformation("Received request to log manual activity. LanguageId: {LanguageId}, WordCount: {WordCount}, DurationSeconds: {DurationSeconds}",
        request.LanguageId, request.WordCount, request.ListeningDurationSeconds);

    // Basic Validation
    if (request.WordCount == null && request.ListeningDurationSeconds == null)
    {
        _logger.LogWarning("Manual activity log request received with no WordCount or DurationSeconds.");
        return BadRequest("Either WordCount or ListeningDurationSeconds must be provided.");
    }
    if (request.WordCount.HasValue && request.WordCount == 0)
    {
        _logger.LogWarning("Invalid manual WordCount received: {WordCount}.", request.WordCount);
        return BadRequest("WordCount must be non-zero if provided.");
    }
    if (request.ListeningDurationSeconds.HasValue && request.ListeningDurationSeconds == 0)
    {
        _logger.LogWarning("Invalid manual ListeningDurationSeconds received: {DurationSeconds}.", request.ListeningDurationSeconds);
        return BadRequest("ListeningDurationSeconds must be non-zero if provided.");
    }

    // Check if LanguageId exists (optional but good practice)
    var languageExists = await _context.Languages.AnyAsync(l => l.LanguageId == request.LanguageId);
    if (!languageExists)
    {
        _logger.LogWarning("Attempted to log manual activity for non-existent LanguageId: {LanguageId}.", request.LanguageId);
        return BadRequest($"Language with ID {request.LanguageId} not found.");
    }

    // Get User ID
    var userIdString = User.FindFirstValue(ClaimTypes.NameIdentifier);
    if (!Guid.TryParse(userIdString, out Guid userId))
    {
        _logger.LogWarning("Could not parse UserId from token for manual activity log.");
        return Unauthorized("User ID not found in token.");
    }
    _logger.LogInformation("Attempting to log manual activity for UserId: {UserId}", userId);

    var activitiesToAdd = new List<UserActivity>();
    var now = DateTime.UtcNow;

    // Create Reading Activity if WordCount provided
    if (request.WordCount.HasValue && request.WordCount != 0)
    {
        activitiesToAdd.Add(new UserActivity
        {
            UserId = userId,
            LanguageId = request.LanguageId,
            ActivityType = "ManualReading",
            WordCount = request.WordCount.Value,
            ListeningDurationSeconds = 0,
            Timestamp = now
        });
        _logger.LogInformation("Prepared ManualReading activity for UserId: {UserId}, LanguageId: {LanguageId}, WordCount: {WordCount}", userId, request.LanguageId, request.WordCount.Value);
    }

    // Create Listening Activity if Duration provided
    if (request.ListeningDurationSeconds.HasValue && request.ListeningDurationSeconds != 0)
    {
        activitiesToAdd.Add(new UserActivity
        {
            UserId = userId,
            LanguageId = request.LanguageId,
            ActivityType = "ManualListening",
            WordCount = 0,
            ListeningDurationSeconds = request.ListeningDurationSeconds.Value,
            Timestamp = now
        });
        _logger.LogInformation("Prepared ManualListening activity for UserId: {UserId}, LanguageId: {LanguageId}, Duration: {Duration}", userId, request.LanguageId, request.ListeningDurationSeconds.Value);
    }

    if (!activitiesToAdd.Any())
    {
        // Should have been caught by earlier validation, but good to double-check
        _logger.LogWarning("No valid manual activities to add for UserId: {UserId} despite passing initial validation.", userId);
        return BadRequest("No valid activity data provided.");
    }

    try
    {
        _context.UserActivities.AddRange(activitiesToAdd);
        await _context.SaveChangesAsync();
        // Update UserLanguageStatistics after manual activity save
        try
        {
            var stats = await _context.UserLanguageStatistics
                .Where(uls => uls.UserId == userId && uls.LanguageId == request.LanguageId)
                .OrderBy(uls => uls.UserLanguageStatisticsId)
                .FirstOrDefaultAsync();

            if (stats == null)
            {
                stats = new UserLanguageStatistics
                {
                    UserId = userId,
                    LanguageId = request.LanguageId,
                    TotalWordsRead = request.WordCount ?? 0,
                    TotalSecondsListened = request.ListeningDurationSeconds ?? 0,
                    LastUpdatedAt = DateTime.UtcNow
                };
                _context.UserLanguageStatistics.Add(stats);
            }
            else
            {
                if (request.WordCount.HasValue)
                    stats.TotalWordsRead += request.WordCount.Value;
                if (request.ListeningDurationSeconds.HasValue)
                    stats.TotalSecondsListened += request.ListeningDurationSeconds.Value;
                stats.LastUpdatedAt = DateTime.UtcNow;
            }

            await _context.SaveChangesAsync();
            _logger.LogInformation("Updated UserLanguageStatistics for UserId: {UserId}, LanguageId: {LanguageId}", userId, request.LanguageId);
        }
        catch (DbUpdateException dbEx)
        {
            _logger.LogError(dbEx, "Database error updating UserLanguageStatistics for UserId: {UserId}. InnerException: {InnerMessage}", userId, dbEx.InnerException?.Message);
            // Do not fail the request if stats update fails
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error updating UserLanguageStatistics for UserId: {UserId}", userId);
            // Do not fail the request if stats update fails
        }

        _logger.LogInformation("Successfully saved {Count} manual activity record(s) for UserId: {UserId}", activitiesToAdd.Count, userId);
        return Ok(new { message = "Manual activity logged successfully." });
    }
    catch (DbUpdateException dbEx)
    {
        _logger.LogError(dbEx, "Database error saving manual activity for UserId: {UserId}. InnerException: {InnerMessage}", userId, dbEx.InnerException?.Message);
        return StatusCode(500, $"A database error occurred while saving the manual activity: {dbEx.InnerException?.Message ?? dbEx.Message}");
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Unexpected error saving manual activity for UserId: {UserId}", userId);
        return StatusCode(500, $"An unexpected error occurred while saving the manual activity: {ex.Message}");
    }
}

public class SentenceSegmentDto
{
    [Required]
    public int SegmentIndex { get; set; }

    [Required]
    public string SegmentText { get; set; } = string.Empty;
}

public class LogSentenceReadRequest
{
    [Required]
    public int TextId { get; set; }

    public List<SentenceSegmentDto> Segments { get; set; } = new();

    public int? CurrentSegmentIndex { get; set; }
}

public class SentenceProgressDto
{
    public int TextId { get; set; }
    public List<int> CreditedSegmentIndices { get; set; } = new();
    public int CreditedWordCount { get; set; }
    public int? LastSegmentIndex { get; set; }
}

[HttpGet("sentenceprogress/{textId}")]
public async Task<ActionResult<SentenceProgressDto>> GetSentenceProgress(int textId)
{
    var userId = GetUserId();
    if (userId == Guid.Empty)
    {
        return Unauthorized("User ID not found in token.");
    }

    var text = await _context.Texts
        .AsNoTracking()
        .FirstOrDefaultAsync(t => t.TextId == textId && t.UserId == userId);

    if (text == null)
    {
        return NotFound("Text not found.");
    }

    var progress = await _context.UserSentenceProgresses.FindAsync(userId, textId);
    if (progress == null)
    {
        return Ok(new SentenceProgressDto
        {
            TextId = textId
        });
    }

    return Ok(ToSentenceProgressDto(progress));
}

[HttpPost("logSentenceRead")]
public async Task<ActionResult<SentenceProgressDto>> LogSentenceRead([FromBody] LogSentenceReadRequest request)
{
    if (!ModelState.IsValid)
    {
        return BadRequest(ModelState);
    }

    var userId = GetUserId();
    if (userId == Guid.Empty)
    {
        return Unauthorized("User ID not found in token.");
    }

    var text = await _context.Texts
        .AsNoTracking()
        .FirstOrDefaultAsync(t => t.TextId == request.TextId && t.UserId == userId);

    if (text == null)
    {
        return NotFound("Text not found.");
    }

    var progress = await _context.UserSentenceProgresses.FindAsync(userId, request.TextId);
    if (progress == null)
    {
        progress = new UserSentenceProgress
        {
            UserId = userId,
            TextId = request.TextId,
            UpdatedAt = DateTime.UtcNow
        };
        _context.UserSentenceProgresses.Add(progress);
    }

    var creditedIndices = ParseCreditedIndices(progress.CreditedSegmentIndicesJson);
    var distinctSegments = request.Segments
        .Where(segment => segment != null && !string.IsNullOrWhiteSpace(segment.SegmentText))
        .GroupBy(segment => segment.SegmentIndex)
        .Select(group => group.First())
        .ToList();

    var newlyCreditedWords = 0;

    foreach (var segment in distinctSegments)
    {
        if (segment.SegmentIndex < 0 || creditedIndices.Contains(segment.SegmentIndex))
        {
            continue;
        }

        creditedIndices.Add(segment.SegmentIndex);
        newlyCreditedWords += WordCountUtility.CountTotalWords(segment.SegmentText);
    }

    if (request.CurrentSegmentIndex.HasValue && request.CurrentSegmentIndex.Value >= 0)
    {
        progress.LastSegmentIndex = request.CurrentSegmentIndex.Value;
    }

    progress.CreditedSegmentIndicesJson = SerializeCreditedIndices(creditedIndices);
    progress.CreditedWordCount += newlyCreditedWords;
    progress.UpdatedAt = DateTime.UtcNow;

    if (newlyCreditedWords > 0)
    {
        _context.UserActivities.Add(new UserActivity
        {
            UserId = userId,
            LanguageId = text.LanguageId,
            ActivityType = "Reading",
            WordCount = newlyCreditedWords,
            Timestamp = DateTime.UtcNow
        });

        var stats = await _context.UserLanguageStatistics
            .Where(uls => uls.UserId == userId && uls.LanguageId == text.LanguageId)
            .OrderBy(uls => uls.UserLanguageStatisticsId)
            .FirstOrDefaultAsync();

        if (stats == null)
        {
            stats = new UserLanguageStatistics
            {
                UserId = userId,
                LanguageId = text.LanguageId,
                TotalWordsRead = newlyCreditedWords,
                LastUpdatedAt = DateTime.UtcNow
            };
            _context.UserLanguageStatistics.Add(stats);
        }
        else
        {
            stats.TotalWordsRead += newlyCreditedWords;
            stats.LastUpdatedAt = DateTime.UtcNow;
        }
    }

    await _context.SaveChangesAsync();

    return Ok(ToSentenceProgressDto(progress));
}

// --- DTOs for Statistics Endpoints ---

public class ReadingStatsDto
{
    public int TotalWordsRead { get; set; }
    public Dictionary<string, int> ActivityByDate { get; set; } = new(); // Date (YYYY-MM-DD) -> WordCount
    public List<LanguageReadingStat> ActivityByLanguage { get; set; } = new();
}

public class LanguageReadingStat
{
    public int LanguageId { get; set; }
    public string LanguageName { get; set; } = string.Empty;
    public int TotalWords { get; set; }
}

public class ListeningStatsDto
{
    public int TotalListeningSeconds { get; set; }
    public Dictionary<string, int> ListeningByDate { get; set; } = new(); // Date (YYYY-MM-DD) -> Seconds
    public List<LanguageListeningStat> ListeningByLanguage { get; set; } = new();
}

public class LanguageListeningStat
{
    public int LanguageId { get; set; }
    public string LanguageName { get; set; } = string.Empty;
    public int TotalSeconds { get; set; }
}

// --- Statistics Endpoints ---

[HttpGet("reading")]
public async Task<ActionResult<ReadingStatsDto>> GetReadingStats([FromQuery] string period = "all")
{
    var userId = GetUserId(); // Assuming GetUserId() exists and works
    var startDate = CalculateStartDate(period);

    var readingActivities = await _context.UserActivities
        .Where(ua => ua.UserId == userId &&
                     ua.Timestamp >= startDate &&
                     (ua.ActivityType == "Reading" || ua.ActivityType == "ManualReading" ||
                      ua.ActivityType == "TextCompleted" || ua.ActivityType == "LessonCompleted" ||
                      ua.ActivityType == "BookFinished")) // Include relevant types
        .ToListAsync();

    var stats = new ReadingStatsDto();
    stats.TotalWordsRead = readingActivities.Sum(ua => ua.WordCount);

    stats.ActivityByDate = readingActivities
        .GroupBy(ua => ua.Timestamp.Date)
        .ToDictionary(g => g.Key.ToString("yyyy-MM-dd"), g => g.Sum(ua => ua.WordCount));

    var readingLangIds = readingActivities.Select(ua => ua.LanguageId).Distinct().ToList();
    var readingLanguageNamesById = readingLangIds.Count == 0
        ? new Dictionary<int, string>()
        : await _context.Languages.AsNoTracking()
            .Where(l => readingLangIds.Contains(l.LanguageId))
            .ToDictionaryAsync(l => l.LanguageId, l => l.Name);

    stats.ActivityByLanguage = readingActivities
        .GroupBy(ua => ua.LanguageId)
        .Select(g => new LanguageReadingStat
        {
            LanguageId = g.Key,
            LanguageName = readingLanguageNamesById.TryGetValue(g.Key, out var n) ? n : "Unknown",
            TotalWords = g.Sum(ua => ua.WordCount)
        })
        .Where(ls => ls.LanguageId != 0)
        .OrderBy(ls => ls.LanguageName)
        .ToList();

    return Ok(stats);
}

[HttpGet("listening")]
public async Task<ActionResult<ListeningStatsDto>> GetListeningStats([FromQuery] string period = "all")
{
    var userId = GetUserId();
    var startDate = CalculateStartDate(period);

    var listeningActivities = await _context.UserActivities
        .Where(ua => ua.UserId == userId &&
                     ua.Timestamp >= startDate &&
                     (ua.ActivityType == "Listening" || ua.ActivityType == "ManualListening")) // Include relevant types
        .ToListAsync();

    var stats = new ListeningStatsDto();
    // Fix: Handle potential null values in Sum
    stats.TotalListeningSeconds = listeningActivities.Sum(ua => ua.ListeningDurationSeconds ?? 0);

    stats.ListeningByDate = listeningActivities
        .GroupBy(ua => ua.Timestamp.Date)
        // Fix: Handle potential null values in Sum
        .ToDictionary(g => g.Key.ToString("yyyy-MM-dd"), g => g.Sum(ua => ua.ListeningDurationSeconds ?? 0));

    var listeningLangIds = listeningActivities.Select(ua => ua.LanguageId).Distinct().ToList();
    var listeningLanguageNamesById = listeningLangIds.Count == 0
        ? new Dictionary<int, string>()
        : await _context.Languages.AsNoTracking()
            .Where(l => listeningLangIds.Contains(l.LanguageId))
            .ToDictionaryAsync(l => l.LanguageId, l => l.Name);

    stats.ListeningByLanguage = listeningActivities
        .GroupBy(ua => ua.LanguageId)
        .Select(g => new LanguageListeningStat
        {
            LanguageId = g.Key,
            LanguageName = listeningLanguageNamesById.TryGetValue(g.Key, out var n) ? n : "Unknown",
            TotalSeconds = g.Sum(ua => ua.ListeningDurationSeconds ?? 0)
        })
        .Where(ls => ls.LanguageId != 0)
        .OrderBy(ls => ls.LanguageName)
        .ToList();

    return Ok(stats);
}

private DateTime CalculateStartDate(string period)
{
    var now = DateTime.UtcNow.Date; // Use Date part for comparisons
    return period.ToLowerInvariant() switch
    {
        "week" => now.AddDays(-(int)now.DayOfWeek), // Start of current week (assuming Sunday as start)
        "month" => new DateTime(now.Year, now.Month, 1), // Start of current month
        "year" => new DateTime(now.Year, 1, 1), // Start of current year
        _ => DateTime.MinValue, // "all" or any other value
    };
}

// --- Existing Endpoints Below ---

        // DTO for updating audiobook progress
        public class UpdateAudiobookProgressRequest
        {
            [Required] // BookId is now required to identify the progress record
            public int BookId { get; set; }
            public int? CurrentAudiobookTrackId { get; set; }
            public double? CurrentAudiobookPosition { get; set; }
            // Client timestamp for last-write-wins; lets a late offline replay be
            // rejected when the server already holds a newer position.
            public DateTime? ClientUpdatedAt { get; set; }
        }

        [HttpPut("audiobookprogress")]
        public async Task<IActionResult> UpdateAudiobookProgress([FromBody] UpdateAudiobookProgressRequest request)
        {
            // Enhanced Logging
            _logger.LogInformation("---- BEGIN UpdateAudiobookProgress ----");
            _logger.LogInformation("Received request body: BookId={BookId}, TrackId={TrackId}, Position={Position}", request?.BookId, request?.CurrentAudiobookTrackId, request?.CurrentAudiobookPosition);

            if (request == null)
            {
                 _logger.LogWarning("Request body is null.");
                 return BadRequest("Request body cannot be null.");
            }
             if (request.CurrentAudiobookTrackId == null)
             {
                 _logger.LogWarning("CurrentAudiobookTrackId is null in the request.");
                 // Decide if this is acceptable or should be a BadRequest
             }
             if (request.CurrentAudiobookPosition == null)
             {
                 _logger.LogWarning("CurrentAudiobookPosition is null in the request.");
                 // Decide if this is acceptable or should be a BadRequest
             }


            var userIdString = User.FindFirstValue(ClaimTypes.NameIdentifier);
             _logger.LogInformation("Attempting to parse UserId from token claim: {UserIdString}", userIdString);
            if (!Guid.TryParse(userIdString, out Guid userId))
            {
                _logger.LogWarning("Failed to parse UserId from token claim '{UserIdString}'.", userIdString);
                 _logger.LogInformation("---- END UpdateAudiobookProgress (Unauthorized) ----");
                return Unauthorized("User ID not found or invalid in token.");
            }
            _logger.LogInformation("Successfully parsed UserId: {UserId}", userId);
            _logger.LogInformation("Attempting to find UserBookProgress for UserId: {UserId}, BookId: {BookId}", userId, request.BookId);

            try
            {
                // Find the most recent activity record for the user. This is flawed.
                // var latestActivity = await _context.UserActivities
                //     .Where(ua => ua.UserId == userId)
                //     .OrderByDescending(ua => ua.Timestamp)
                //     .FirstOrDefaultAsync();

                // Clamp the client timestamp to server "now" so a fast client clock
                // can't persist a future UpdatedAt (which would reject later legitimate
                // saves as "stale"). Client time is still the comparison basis below.
                var nowUtc = DateTime.UtcNow;
                var effectiveClientTs = request.ClientUpdatedAt.HasValue && request.ClientUpdatedAt.Value <= nowUtc
                    ? request.ClientUpdatedAt.Value
                    : nowUtc;

                // --- Use UserBookProgress table ---
                var progressRecord = await _context.UserBookProgresses.FindAsync(userId, request.BookId);

                if (progressRecord == null)
                {
                    _logger.LogInformation("UserBookProgress record not found for UserId: {UserId}, BookId: {BookId}. Creating new record.", userId, request.BookId);
                    progressRecord = new UserBookProgress
                    {
                        UserId = userId,
                        BookId = request.BookId,
                        CurrentAudiobookTrackId = request.CurrentAudiobookTrackId,
                        CurrentAudiobookPosition = request.CurrentAudiobookPosition,
                        UpdatedAt = effectiveClientTs
                    };
                    _context.UserBookProgresses.Add(progressRecord);
                    _logger.LogInformation("Added new UserBookProgress to context for UserId: {UserId}, BookId: {BookId}", userId, request.BookId);
                }
                else
                {
                    // Stale-replay guard: a late-draining offline save must not clobber
                    // a newer position the server already holds. Compared on client
                    // timestamps so it's robust to client/server clock skew.
                    if (request.ClientUpdatedAt.HasValue && progressRecord.UpdatedAt > effectiveClientTs)
                    {
                        _logger.LogInformation("Ignoring stale audiobook progress for UserId: {UserId}, BookId: {BookId} (client={ClientTs:o} <= stored={StoredTs:o}).", userId, request.BookId, request.ClientUpdatedAt.Value, progressRecord.UpdatedAt);
                        _logger.LogInformation("---- END UpdateAudiobookProgress (Stale, ignored) ----");
                        return Ok(new { message = "Audiobook progress is older than stored value; ignored." });
                    }

                    _logger.LogInformation("Found existing UserBookProgress for UserId: {UserId}, BookId: {BookId}. Updating.", userId, request.BookId);
                    _logger.LogInformation("Updating UserBookProgress: Old TrackId={OldTrackId}, Old Position={OldPosition}", progressRecord.CurrentAudiobookTrackId, progressRecord.CurrentAudiobookPosition);
                    progressRecord.CurrentAudiobookTrackId = request.CurrentAudiobookTrackId;
                    // Only update position if a valid position is provided in the request
                    if (request.CurrentAudiobookPosition.HasValue)
                    {
                         progressRecord.CurrentAudiobookPosition = request.CurrentAudiobookPosition;
                    }
                    // Stamp with the (clamped) client time so cross-device conflict
                    // resolution stays on a single clock basis without persisting a
                    // future timestamp.
                    progressRecord.UpdatedAt = effectiveClientTs;
                    _logger.LogInformation("Updating UserBookProgress: New TrackId={NewTrackId}, New Position={NewPosition}", progressRecord.CurrentAudiobookTrackId, progressRecord.CurrentAudiobookPosition);
                    // EF Core tracks changes on the found entity, no need for explicit Update call
                }

                _logger.LogInformation("Calling SaveChangesAsync...");
                await _context.SaveChangesAsync();
                _logger.LogInformation("SaveChangesAsync completed successfully for UserId: {UserId}, BookId: {BookId}", userId, request.BookId);
                 _logger.LogInformation("---- END UpdateAudiobookProgress (Success) ----");
                return Ok(new { message = "Audiobook progress updated successfully." });

            }
            catch (DbUpdateException dbEx) // Catch specific DB exceptions
            {
                // Check for Postgres Unique Constraint Violation (Code 23505). Match
                // on SqlState rather than a message substring so the check doesn't
                // depend on the driver's message formatting.
                if (dbEx.InnerException is Npgsql.PostgresException pgEx && pgEx.SqlState == "23505")
                {
                    _logger.LogWarning("Duplicate key error (race condition) detected for UserId: {UserId}, BookId: {BookId}. Retrying as UPDATE.", userId, request.BookId);
                    
                    try
                    {
                        // 1. Detach the failed entity
                        var entry = _context.ChangeTracker.Entries<UserBookProgress>()
                            .FirstOrDefault(e => e.Entity.UserId == userId && e.Entity.BookId == request.BookId);
                        
                        if (entry != null)
                        {
                            entry.State = EntityState.Detached;
                        }

                        // 2. Fetch the existing record
                        var existingRecord = await _context.UserBookProgresses.FindAsync(userId, request.BookId);
                        
                        if (existingRecord != null)
                        {
                            // 3. Update it
                            existingRecord.CurrentAudiobookTrackId = request.CurrentAudiobookTrackId;
                            if (request.CurrentAudiobookPosition.HasValue)
                            {
                                existingRecord.CurrentAudiobookPosition = request.CurrentAudiobookPosition;
                            }
                            existingRecord.UpdatedAt = DateTime.UtcNow;
                            
                            // 4. Save again
                            await _context.SaveChangesAsync();
                            _logger.LogInformation("Race condition resolved for audiobook progress: Successfully updated existing record.");
                            return Ok(new { message = "Audiobook progress updated successfully (recovered from race condition)." });
                        }
                    }
                    catch (Exception retryEx)
                    {
                        _logger.LogError(retryEx, "Failed to recover from race condition for UserId: {UserId}, BookId: {BookId}", userId, request.BookId);
                    }
                }

                 _logger.LogError(dbEx, "Database error updating audiobook progress for UserId: {UserId}, BookId: {BookId}. InnerException: {InnerMessage}", userId, request.BookId, dbEx.InnerException?.Message);
                 _logger.LogInformation("---- END UpdateAudiobookProgress (DB Error) ----");
                 return StatusCode(500, $"A database error occurred while updating progress: {dbEx.Message}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error updating audiobook progress for UserId: {UserId}, BookId: {BookId}", userId, request.BookId);
                 _logger.LogInformation("---- END UpdateAudiobookProgress (Error) ----");
                return StatusCode(500, $"An unexpected error occurred while updating progress: {ex.Message}");
            }
        }

        // --- Endpoint for GETTING audiobook progress ---

        // GET endpoint now requires bookId
        [HttpGet("audiobookprogress/{bookId}")]
        public async Task<IActionResult> GetAudiobookProgress(int bookId)
        {
            _logger.LogInformation("Received request to get audiobook progress for BookId: {BookId}", bookId);

            var userIdString = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!Guid.TryParse(userIdString, out Guid userId))
            {
                _logger.LogWarning("Could not parse UserId from token for getting audiobook progress for BookId: {BookId}.", bookId);
                return Unauthorized("User ID not found in token.");
            }
            _logger.LogInformation("Attempting to get progress for UserId: {UserId}, BookId: {BookId}", userId, bookId);

            try
            {
                var progressRecord = await _context.UserBookProgresses.FindAsync(userId, bookId);

                if (progressRecord == null)
                {
                    _logger.LogInformation("UserBookProgress record not found for UserId: {UserId}, BookId: {BookId}. Returning default progress.", userId, bookId);
                    // Return default/empty progress if no record found
                    return Ok(new { currentAudiobookTrackId = (int?)null, currentAudiobookPosition = (double?)null, updatedAt = (DateTime?)null });
                }

                _logger.LogInformation("Successfully retrieved audiobook progress from UserBookProgress for UserId: {UserId}, BookId: {BookId}. TrackId: {TrackId}, Position: {Position}", userId, bookId, progressRecord.CurrentAudiobookTrackId, progressRecord.CurrentAudiobookPosition);
                return Ok(new
                {
                    currentAudiobookTrackId = progressRecord.CurrentAudiobookTrackId,
                    currentAudiobookPosition = progressRecord.CurrentAudiobookPosition,
                    updatedAt = progressRecord.UpdatedAt
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving audiobook progress for UserId: {UserId}, BookId: {BookId}", userId, bookId);
                return StatusCode(500, "An error occurred while retrieving audiobook progress.");
            }
        }

        // --- Endpoints for Audio Lesson Progress ---

        // DTO for updating audio lesson progress
        public class UpdateAudioLessonProgressRequest
        {
            [Required]
            public int TextId { get; set; } // ID of the Text entity representing the lesson
            public double? CurrentPosition { get; set; } // Nullable position
            // Client timestamp for last-write-wins; see UpdateAudiobookProgressRequest.
            public DateTime? ClientUpdatedAt { get; set; }
        }

        [HttpPut("audiolessonprogress")]
        public async Task<IActionResult> UpdateAudioLessonProgress([FromBody] UpdateAudioLessonProgressRequest request)
        {
            _logger.LogInformation("---- BEGIN UpdateAudioLessonProgress ----");
            _logger.LogInformation("Received request body: TextId={TextId}, Position={Position}", request?.TextId, request?.CurrentPosition);

            if (request == null)
            {
                _logger.LogWarning("Request body is null.");
                return BadRequest("Request body cannot be null.");
            }

            var userId = GetUserId(); // Use helper method
            if (userId == Guid.Empty)
            {
                _logger.LogWarning("Failed to get UserId from token claim for UpdateAudioLessonProgress.");
                return Unauthorized("User ID not found or invalid in token.");
            }

            // --- Validate that the Text exists and belongs to the user ---
            var textExists = await _context.Texts.AnyAsync(t => t.TextId == request.TextId && t.UserId == userId);
            if (!textExists)
            {
                _logger.LogWarning("TextId {TextId} not found or doesn't belong to UserId {UserId} for UpdateAudioLessonProgress.", request.TextId, userId);
                return NotFound($"Text with ID {request.TextId} not found for this user.");
            }

            _logger.LogInformation("Attempting to find/update UserAudioLessonProgress for UserId: {UserId}, TextId: {TextId}", userId, request.TextId);

            try
            {
                // Clamp the client timestamp to server "now" (see UpdateAudiobookProgress)
                // so a fast client clock can't persist a future UpdatedAt.
                var nowUtc = DateTime.UtcNow;
                var effectiveClientTs = request.ClientUpdatedAt.HasValue && request.ClientUpdatedAt.Value <= nowUtc
                    ? request.ClientUpdatedAt.Value
                    : nowUtc;

                var progressRecord = await _context.UserAudioLessonProgresses.FindAsync(userId, request.TextId);

                if (progressRecord == null)
                {
                    _logger.LogInformation("UserAudioLessonProgress record not found for UserId: {UserId}, TextId: {TextId}. Creating new record.", userId, request.TextId);
                    progressRecord = new UserAudioLessonProgress
                    {
                        UserId = userId,
                        TextId = request.TextId,
                        CurrentPosition = request.CurrentPosition, // Can be null
                        UpdatedAt = effectiveClientTs
                    };
                    _context.UserAudioLessonProgresses.Add(progressRecord);
                    _logger.LogInformation("Added new UserAudioLessonProgress to context for UserId: {UserId}, TextId: {TextId}", userId, request.TextId);
                }
                else
                {
                    // Stale-replay guard (see UpdateAudiobookProgress).
                    if (request.ClientUpdatedAt.HasValue && progressRecord.UpdatedAt > effectiveClientTs)
                    {
                        _logger.LogInformation("Ignoring stale audio lesson progress for UserId: {UserId}, TextId: {TextId} (client={ClientTs:o} <= stored={StoredTs:o}).", userId, request.TextId, request.ClientUpdatedAt.Value, progressRecord.UpdatedAt);
                        _logger.LogInformation("---- END UpdateAudioLessonProgress (Stale, ignored) ----");
                        return Ok(new { message = "Audio lesson progress is older than stored value; ignored." });
                    }

                    _logger.LogInformation("Found existing UserAudioLessonProgress for UserId: {UserId}, TextId: {TextId}. Updating.", userId, request.TextId);
                    _logger.LogInformation("Updating UserAudioLessonProgress: Old Position={OldPosition}", progressRecord.CurrentPosition);
                    progressRecord.CurrentPosition = request.CurrentPosition; // Update position (can be null)
                    progressRecord.UpdatedAt = effectiveClientTs;
                    _logger.LogInformation("Updating UserAudioLessonProgress: New Position={NewPosition}", progressRecord.CurrentPosition);
                }

                await _context.SaveChangesAsync();
                _logger.LogInformation("SaveChangesAsync completed successfully for UserAudioLessonProgress for UserId: {UserId}, TextId: {TextId}", userId, request.TextId);
                _logger.LogInformation("---- END UpdateAudioLessonProgress (Success) ----");
                return Ok(new { message = "Audio lesson progress updated successfully." });
            }
            catch (DbUpdateException dbEx)
            {
                // Check for Postgres Unique Constraint Violation (Code 23505). Match
                // on SqlState rather than a message substring so the check doesn't
                // depend on the driver's message formatting.
                if (dbEx.InnerException is Npgsql.PostgresException pgEx && pgEx.SqlState == "23505")
                {
                    _logger.LogWarning("Duplicate key error (race condition) detected for UserId: {UserId}, TextId: {TextId}. Retrying as UPDATE.", userId, request.TextId);
                    
                    try
                    {
                        // 1. Detach the failed entity so EF Core doesn't try to insert it again
                        var entry = _context.ChangeTracker.Entries<UserAudioLessonProgress>()
                            .FirstOrDefault(e => e.Entity.UserId == userId && e.Entity.TextId == request.TextId);
                        
                        if (entry != null)
                        {
                            entry.State = EntityState.Detached;
                        }

                        // 2. Fetch the record that was committed by the other request
                        var existingRecord = await _context.UserAudioLessonProgresses.FindAsync(userId, request.TextId);
                        
                        if (existingRecord != null)
                        {
                            // 3. Update it with the current request's data
                            existingRecord.CurrentPosition = request.CurrentPosition;
                            existingRecord.UpdatedAt = DateTime.UtcNow;
                            
                            // 4. Save again
                            await _context.SaveChangesAsync();
                            _logger.LogInformation("Race condition resolved: Successfully updated existing record.");
                            return Ok(new { message = "Audio lesson progress updated successfully (recovered from race condition)." });
                        }
                    }
                    catch (Exception retryEx)
                    {
                        _logger.LogError(retryEx, "Failed to recover from race condition for UserId: {UserId}, TextId: {TextId}", userId, request.TextId);
                        // Fall through to generic 500 if retry fails
                    }
                }

                _logger.LogError(dbEx, "Database error updating audio lesson progress for UserId: {UserId}, TextId: {TextId}. InnerException: {InnerMessage}", userId, request.TextId, dbEx.InnerException?.Message);
                _logger.LogInformation("---- END UpdateAudioLessonProgress (DB Error) ----");
                return StatusCode(500, $"DB Error: {dbEx.Message} | Inner: {dbEx.InnerException?.Message}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error updating audio lesson progress for UserId: {UserId}, TextId: {TextId}", userId, request.TextId);
                _logger.LogInformation("---- END UpdateAudioLessonProgress (Error) ----");
                return StatusCode(500, $"Error: {ex.Message}");
            }
        }


        [HttpGet("audiolessonprogress/{textId}")]
        public async Task<IActionResult> GetAudioLessonProgress(int textId)
        {
            _logger.LogInformation("Received request to get audio lesson progress for TextId: {TextId}", textId);

            var userId = GetUserId();
            if (userId == Guid.Empty)
            {
                _logger.LogWarning("Could not parse UserId from token for getting audio lesson progress for TextId: {TextId}.", textId);
                return Unauthorized("User ID not found in token.");
            }
            _logger.LogInformation("Attempting to get audio lesson progress for UserId: {UserId}, TextId: {TextId}", userId, textId);

            try
            {
                var progressRecord = await _context.UserAudioLessonProgresses.FindAsync(userId, textId);

                if (progressRecord == null)
                {
                    _logger.LogInformation("UserAudioLessonProgress record not found for UserId: {UserId}, TextId: {TextId}. Returning default progress.", userId, textId);
                    return Ok(new { currentPosition = (double?)null, updatedAt = (DateTime?)null }); // Return null if no record found
                }

                _logger.LogInformation("Successfully retrieved audio lesson progress from UserAudioLessonProgress for UserId: {UserId}, TextId: {TextId}. Position: {Position}", userId, textId, progressRecord.CurrentPosition);
                return Ok(new
                {
                    currentPosition = progressRecord.CurrentPosition,
                    updatedAt = progressRecord.UpdatedAt
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving audio lesson progress for UserId: {UserId}, TextId: {TextId}", userId, textId);
                return StatusCode(500, "An error occurred while retrieving audio lesson progress.");
            }
        }

        // --- Helper Methods ---

        private static HashSet<int> ParseCreditedIndices(string? json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                return new HashSet<int>();
            }

            try
            {
                return JsonSerializer.Deserialize<HashSet<int>>(json) ?? new HashSet<int>();
            }
            catch
            {
                return new HashSet<int>();
            }
        }

        private static string SerializeCreditedIndices(HashSet<int> creditedIndices)
        {
            return JsonSerializer.Serialize(creditedIndices.OrderBy(index => index));
        }

        private static SentenceProgressDto ToSentenceProgressDto(UserSentenceProgress progress)
        {
            return new SentenceProgressDto
            {
                TextId = progress.TextId,
                CreditedSegmentIndices = ParseCreditedIndices(progress.CreditedSegmentIndicesJson)
                    .OrderBy(index => index)
                    .ToList(),
                CreditedWordCount = progress.CreditedWordCount,
                LastSegmentIndex = progress.LastSegmentIndex
            };
        }

        private Guid GetUserId()
        {
            var userIdString = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (Guid.TryParse(userIdString, out Guid userId))
            {
                return userId;
            }
            _logger.LogWarning("GetUserId: Failed to parse UserId from token claim '{UserIdString}'. Returning Guid.Empty.", userIdString);
            return Guid.Empty; // Return empty Guid if parsing fails
        }
    }
}