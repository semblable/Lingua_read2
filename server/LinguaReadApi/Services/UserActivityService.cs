using System;
using System.Threading.Tasks;
using LinguaReadApi.Data; // Add DbContext namespace
using LinguaReadApi.Models; // Add Models namespace
using Microsoft.EntityFrameworkCore; // Add EF Core namespace
using Microsoft.Extensions.Logging; // Add Logging namespace

namespace LinguaReadApi.Services
{
    public class UserActivityService : IUserActivityService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<UserActivityService> _logger;

        public UserActivityService(AppDbContext context, ILogger<UserActivityService> logger)
        {
            _context = context;
            _logger = logger;
        }

        public async Task LogTextCompletedActivity(Guid userId, int languageId, int textId, int wordCount, bool isListening)
        {
            try
            {
                wordCount = Math.Max(wordCount, 0);

                var stats = await _context.UserLanguageStatistics
                    .FirstOrDefaultAsync(uls => uls.UserId == userId && uls.LanguageId == languageId);

                if (stats == null)
                {
                    stats = new UserLanguageStatistics
                    {
                        UserId = userId,
                        LanguageId = languageId,
                        TotalWordsRead = wordCount,
                        TotalTextsCompleted = 1,
                        // Initialize other counters if needed (e.g., listening)
                        TotalSecondsListened = isListening ? 0 : 0, // Placeholder - need actual duration if isListening
                        LastUpdatedAt = DateTime.UtcNow
                    };
                    _context.UserLanguageStatistics.Add(stats);
                    _logger.LogInformation("Created new UserLanguageStatistics record for UserId {UserId}, LanguageId {LanguageId}", userId, languageId);
                }
                else
                {
                    stats.TotalWordsRead += wordCount;
                    stats.TotalTextsCompleted += 1;
                    // Update listening time if applicable and duration is available
                    // stats.TotalSecondsListened += isListening ? duration : 0;
                    stats.LastUpdatedAt = DateTime.UtcNow;
                    _logger.LogInformation("Updated UserLanguageStatistics record for UserId {UserId}, LanguageId {LanguageId}. WordsRead: +{WordCount}, TextsCompleted: +1", userId, languageId, wordCount);
                }

                // Optional: Log detailed event to UserActivities table
                var activity = new UserActivity
                {
                    UserId = userId,
                    LanguageId = languageId,
                    ActivityType = "TextCompleted", // Use string representation
                    WordCount = wordCount, // Use the correct property
                    Timestamp = DateTime.UtcNow,
                    ListeningDurationSeconds = null // Not a listening activity
                    // textId is not stored in UserActivity currently
                };
                _context.UserActivities.Add(activity);

                _logger.LogInformation("Attempting to save changes for UserLanguageStatistics (ID: {StatsId}, TextsCompleted: {TextsCompleted}, WordsRead: {WordsRead}) and UserActivity (ID: {ActivityId})", stats.UserLanguageStatisticsId, stats.TotalTextsCompleted, stats.TotalWordsRead, activity.ActivityId);
                var changesSaved = await _context.SaveChangesAsync();
                _logger.LogInformation("{ChangesCount} changes saved to the database.", changesSaved);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to log text completed activity or update stats for UserId {UserId}, LanguageId {LanguageId}, TextId {TextId}", userId, languageId, textId);
                // Do not rethrow, as logging failure shouldn't block the main operation (text completion)
            }
        }

        public Task UpdateUserLanguageStats(Guid userId, int languageId)
        {
            // TODO: Implement stats update based on word statuses or other triggers if needed
            _logger.LogWarning("UpdateUserLanguageStats method called but not fully implemented for UserId {UserId}, LanguageId {LanguageId}", userId, languageId);
            return Task.CompletedTask;
        }

        // Removed ActivityType enum definition from here.
        // It should be defined globally or constants should be used.
    }
}