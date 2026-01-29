using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    public class DiscordReportService
    {
        private const int MaxDiscordMessageLength = 1900;
        private const int MaxLanguagesPerUser = 8;

        private static readonly HashSet<string> ReadingActivityTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            "Reading",
            "ManualReading",
            "TextCompleted"
        };

        private static readonly HashSet<string> ListeningActivityTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            "Listening",
            "ManualListening"
        };

        private readonly AppDbContext _context;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<DiscordReportService> _logger;

        public DiscordReportService(
            AppDbContext context,
            IHttpClientFactory httpClientFactory,
            ILogger<DiscordReportService> logger)
        {
            _context = context;
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        public async Task<DiscordReportResult> SendDueWeeklyReportsAsync(
            DiscordReportOptions options,
            DateTime nowUtc,
            bool forceSend,
            CancellationToken cancellationToken)
        {
            var result = new DiscordReportResult();

            var targets = await _context.UserSettings
                .Where(us =>
                    us.DiscordWeeklyReportEnabled &&
                    us.DiscordWebhookUrl != null &&
                    us.DiscordWebhookUrl != string.Empty)
                .ToListAsync(cancellationToken);

            result.TargetCount = targets.Count;
            if (targets.Count == 0)
            {
                _logger.LogInformation("No Discord weekly report targets found.");
                return result;
            }

            var validTargets = new List<Models.UserSettings>();
            foreach (var target in targets)
            {
                if (TryNormalizeWebhookUrl(target.DiscordWebhookUrl!, out var normalizedUrl))
                {
                    target.DiscordWebhookUrl = normalizedUrl;
                    validTargets.Add(target);
                }
                else
                {
                    result.SkippedCount++;
                    _logger.LogWarning(
                        "Skipping Discord report for user {UserId} due to invalid webhook URL.",
                        target.UserId);
                }
            }

            if (validTargets.Count == 0)
            {
                _logger.LogInformation("No valid Discord webhook URLs found after validation.");
                return result;
            }

            foreach (var target in validTargets)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var scheduledUtc = GetScheduledUtcForWeek(nowUtc, target);
                if (!forceSend && nowUtc < scheduledUtc)
                {
                    result.SkippedCount++;
                    continue;
                }

                if (!forceSend &&
                    target.DiscordWeeklyReportLastSentAt.HasValue &&
                    target.DiscordWeeklyReportLastSentAt.Value >= scheduledUtc)
                {
                    result.SkippedCount++;
                    continue;
                }

                var startUtc = scheduledUtc.AddDays(-7);
                var endUtc = scheduledUtc;

                var userActivities = await _context.UserActivities
                    .AsNoTracking()
                    .Where(ua =>
                        ua.UserId == target.UserId &&
                        ua.Timestamp >= startUtc &&
                        ua.Timestamp < endUtc)
                    .Include(ua => ua.Language)
                    .ToListAsync(cancellationToken);

                var message = BuildWeeklyReportMessage(startUtc, endUtc, userActivities);
                result.PreparedCount++;

                if (options.DryRun)
                {
                    _logger.LogInformation(
                        "Discord report dry run for user {UserId}: {MessagePreview}",
                        target.UserId,
                        message.Length > 200 ? message[..200] + "..." : message);
                    result.SkippedCount++;
                    continue;
                }

                var sent = await PostWebhookAsync(target.DiscordWebhookUrl!, message, cancellationToken);
                if (sent)
                {
                    target.DiscordWeeklyReportLastSentAt = scheduledUtc;
                    result.SentCount++;
                }
                else
                {
                    result.FailedCount++;
                }
            }

            await _context.SaveChangesAsync(cancellationToken);
            return result;
        }

        private string BuildWeeklyReportMessage(
            DateTime startUtc,
            DateTime endUtc,
            List<Models.UserActivity> activities)
        {
            var totalWords = activities
                .Where(activity => ReadingActivityTypes.Contains(activity.ActivityType))
                .Sum(activity => activity.WordCount);

            var totalListeningSeconds = activities
                .Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                .Sum(activity => activity.ListeningDurationSeconds ?? 0);

            var languageTotals = new Dictionary<string, LanguageTotals>(StringComparer.OrdinalIgnoreCase);
            foreach (var activity in activities)
            {
                var languageName = activity.Language?.Name ?? "Unknown";
                if (!languageTotals.TryGetValue(languageName, out var totals))
                {
                    totals = new LanguageTotals();
                    languageTotals[languageName] = totals;
                }

                if (ReadingActivityTypes.Contains(activity.ActivityType))
                {
                    totals.Words += activity.WordCount;
                }

                if (ListeningActivityTypes.Contains(activity.ActivityType))
                {
                    totals.Seconds += activity.ListeningDurationSeconds ?? 0;
                }
            }

            var endDisplay = endUtc.AddSeconds(-1);
            var messageLines = new List<string>
            {
                $"**Weekly activity report** ({startUtc:yyyy-MM-dd} to {endDisplay:yyyy-MM-dd} UTC)",
                $"Total words read: {totalWords}",
                $"Total listening time: {FormatDuration(totalListeningSeconds)}"
            };

            if (activities.Count == 0)
            {
                messageLines.Add("No activity recorded this week.");
                return string.Join("\n", messageLines);
            }

            if (languageTotals.Count > 0)
            {
                messageLines.Add(string.Empty);
                messageLines.Add("By language:");
                var orderedLanguages = languageTotals
                    .OrderByDescending(entry => entry.Value.Words)
                    .ThenByDescending(entry => entry.Value.Seconds)
                    .ToList();

                var displayed = orderedLanguages.Take(MaxLanguagesPerUser).ToList();
                foreach (var entry in displayed)
                {
                    messageLines.Add(
                        $"- {entry.Key}: {entry.Value.Words} words, {FormatDuration(entry.Value.Seconds)}");
                }

                if (orderedLanguages.Count > MaxLanguagesPerUser)
                {
                    messageLines.Add($"- ...and {orderedLanguages.Count - MaxLanguagesPerUser} more");
                }
            }

            var message = string.Join("\n", messageLines);
            if (message.Length > MaxDiscordMessageLength)
            {
                message = message[..(MaxDiscordMessageLength - 3)] + "...";
            }

            return message;
        }

        private async Task<bool> PostWebhookAsync(
            string webhookUrl,
            string message,
            CancellationToken cancellationToken)
        {
            try
            {
                using var client = _httpClientFactory.CreateClient();
                var payload = JsonSerializer.Serialize(new { content = message });
                using var content = new StringContent(payload, Encoding.UTF8, "application/json");
                using var response = await client.PostAsync(webhookUrl, content, cancellationToken);

                if (response.IsSuccessStatusCode)
                {
                    return true;
                }

                var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning(
                    "Discord webhook returned {StatusCode}: {ResponseBody}",
                    response.StatusCode,
                    responseBody);
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send Discord webhook message.");
                return false;
            }
        }

        private static string FormatDuration(int totalSeconds)
        {
            if (totalSeconds <= 0)
            {
                return "0m";
            }

            var hours = totalSeconds / 3600;
            var minutes = (totalSeconds % 3600) / 60;

            if (hours > 0)
            {
                return minutes > 0 ? $"{hours}h {minutes}m" : $"{hours}h";
            }

            return $"{minutes}m";
        }

        private static bool TryNormalizeWebhookUrl(string url, out string normalizedUrl)
        {
            normalizedUrl = url.Trim();
            if (!Uri.TryCreate(normalizedUrl, UriKind.Absolute, out var uri))
            {
                return false;
            }

            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            {
                return false;
            }

            return true;
        }

        private static DateTime GetScheduledUtcForWeek(DateTime nowUtc, Models.UserSettings settings)
        {
            var scheduledHour = settings.DiscordWeeklyReportHourLocal;
            if (scheduledHour < 0 || scheduledHour > 23)
            {
                scheduledHour = 8;
            }

            if (!Enum.TryParse(settings.DiscordWeeklyReportDayOfWeek, true, out DayOfWeek scheduledDay))
            {
                scheduledDay = DayOfWeek.Monday;
            }

            var offsetMinutes = settings.DiscordTimezoneOffsetMinutes;
            if (offsetMinutes < -840 || offsetMinutes > 840)
            {
                offsetMinutes = 0;
            }

            var offset = TimeSpan.FromMinutes(offsetMinutes);
            var localNow = nowUtc.Add(offset);
            var daysSinceScheduled = ((int)localNow.DayOfWeek - (int)scheduledDay + 7) % 7;
            var scheduledLocal = localNow.Date.AddDays(-daysSinceScheduled).AddHours(scheduledHour);
            if (scheduledLocal > localNow)
            {
                scheduledLocal = scheduledLocal.AddDays(-7);
            }

            return scheduledLocal.Subtract(offset);
        }

        private class LanguageTotals
        {
            public int Words { get; set; }
            public int Seconds { get; set; }
        }
    }

    public class DiscordReportResult
    {
        public int TargetCount { get; set; }
        public int PreparedCount { get; set; }
        public int SentCount { get; set; }
        public int FailedCount { get; set; }
        public int SkippedCount { get; set; }
    }
}
