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
        private const int MaxLanguagesPerUser = 8;
        private const int MaxEmbedFieldLength = 1024;
        private const int EmbedColor = 0x6366F1; // indigo-500
        private static readonly TimeSpan ListeningSessionGraceGap = TimeSpan.FromMinutes(5);

        private static readonly HashSet<string> ReadingActivityTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            "Reading",
            "ManualReading",
            "TextCompleted",
            "LessonCompleted",
            "BookFinished"
        };

        private static readonly HashSet<string> ListeningActivityTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            "Listening",
            "ManualListening"
        };

        private readonly AppDbContext _context;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<DiscordReportService> _logger;
        private readonly IDatabaseAdminService _databaseAdminService;

        public DiscordReportService(
            AppDbContext context,
            IHttpClientFactory httpClientFactory,
            ILogger<DiscordReportService> logger,
            IDatabaseAdminService databaseAdminService)
        {
            _context = context;
            _httpClientFactory = httpClientFactory;
            _logger = logger;
            _databaseAdminService = databaseAdminService;
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
                if (TryNormalizeWebhookUrl(target.DiscordWebhookUrl!, out var normalizedUrl, out _))
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

            _logger.LogDebug(
                "Processing {Count} valid Discord report targets at {NowUtc}",
                validTargets.Count, nowUtc);

            foreach (var target in validTargets)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var scheduledUtc = GetScheduledUtcForWeek(nowUtc, target);
                _logger.LogDebug(
                    "User {UserId}: scheduledUtc={ScheduledUtc}, nowUtc={NowUtc}, lastSentAt={LastSentAt}, day={Day}, hour={Hour}, offset={Offset}",
                    target.UserId, scheduledUtc, nowUtc, target.DiscordWeeklyReportLastSentAt,
                    target.DiscordWeeklyReportDayOfWeek, target.DiscordWeeklyReportHourLocal,
                    target.DiscordTimezoneOffsetMinutes);

                if (!forceSend && nowUtc < scheduledUtc)
                {
                    _logger.LogDebug(
                        "User {UserId}: skipped, not yet due (nowUtc={NowUtc} < scheduledUtc={ScheduledUtc})",
                        target.UserId, nowUtc, scheduledUtc);
                    result.SkippedCount++;
                    continue;
                }

                if (!forceSend &&
                    target.DiscordWeeklyReportLastSentAt.HasValue &&
                    target.DiscordWeeklyReportLastSentAt.Value >= scheduledUtc)
                {
                    _logger.LogDebug(
                        "User {UserId}: skipped, already sent (lastSentAt={LastSentAt} >= scheduledUtc={ScheduledUtc})",
                        target.UserId, target.DiscordWeeklyReportLastSentAt, scheduledUtc);
                    result.SkippedCount++;
                    continue;
                }

                var startUtc = scheduledUtc.AddDays(-7);
                var endUtc = scheduledUtc;

                var sendResult = await SendReportForUserAsync(
                    target,
                    startUtc,
                    endUtc,
                    options.DryRun,
                    cancellationToken);

                result.PreparedCount++;
                if (sendResult.Sent)
                {
                    target.DiscordWeeklyReportLastSentAt = scheduledUtc;
                    result.SentCount++;
                    _logger.LogInformation(
                        "User {UserId}: report sent, updated lastSentAt to {ScheduledUtc}",
                        target.UserId, scheduledUtc);
                }
                else if (sendResult.Skipped)
                {
                    result.SkippedCount++;
                }
                else
                {
                    result.FailedCount++;
                }
            }

            await _context.SaveChangesAsync(cancellationToken);
            return result;
        }

        public async Task<DiscordReportSendResult> SendReportForUserAsync(
            Models.UserSettings settings,
            DateTime startUtc,
            DateTime endUtc,
            bool dryRun,
            CancellationToken cancellationToken)
        {
            if (endUtc <= startUtc)
            {
                return DiscordReportSendResult.Failed("Invalid date range.");
            }

            if (string.IsNullOrWhiteSpace(settings.DiscordWebhookUrl))
            {
                return DiscordReportSendResult.Failed("Discord webhook URL is missing.");
            }

            if (!TryNormalizeWebhookUrl(settings.DiscordWebhookUrl, out var normalizedUrl, out var endpointKind))
            {
                return DiscordReportSendResult.Failed("Discord webhook URL is invalid.");
            }

            settings.DiscordWebhookUrl = normalizedUrl;

            var userActivities = await _context.UserActivities
                .AsNoTracking()
                .Where(ua =>
                    ua.UserId == settings.UserId &&
                    ua.Timestamp >= startUtc &&
                    ua.Timestamp < endUtc)
                .Include(ua => ua.Language)
                .ToListAsync(cancellationToken);

            var jsonPayload = BuildReportPayload(startUtc, endUtc, userActivities, endpointKind);

            if (dryRun)
            {
                _logger.LogInformation(
                    "Discord report dry run for user {UserId}: {PayloadPreview}",
                    settings.UserId,
                    jsonPayload.Length > 200 ? jsonPayload[..200] + "..." : jsonPayload);
                return DiscordReportSendResult.SkippedResult("Dry run enabled.");
            }

            var result = await PostWebhookAsync(
                settings.DiscordWebhookUrl,
                jsonPayload,
                cancellationToken);

            if (!result.Success)
            {
                return DiscordReportSendResult.Failed(result.ErrorMessage ?? "Failed to send webhook.");
            }

            return DiscordReportSendResult.Success();
        }

        private static string BuildReportPayload(
            DateTime startUtc,
            DateTime endUtc,
            List<Models.UserActivity> activities,
            WebhookEndpointKind endpointKind)
        {
            var totalWords = activities
                .Where(activity => ReadingActivityTypes.Contains(activity.ActivityType))
                .Sum(activity => activity.WordCount);

            var totalListeningSeconds = activities
                .Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                .Sum(activity => activity.ListeningDurationSeconds ?? 0);

            var readingActivities = activities
                .Where(activity => ReadingActivityTypes.Contains(activity.ActivityType))
                .ToList();

            var listeningActivities = activities
                .Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                .ToList();

            var dayTotals = BuildDayTotals(activities);

            var activeDays = dayTotals.Count;
            var totalDays = (int)Math.Ceiling((endUtc.Date - startUtc.Date).TotalDays);
            if (totalDays <= 0)
            {
                totalDays = 1;
            }

            var topDay = dayTotals
                .OrderByDescending(day => day.Words)
                .ThenByDescending(day => day.Seconds)
                .ThenByDescending(day => day.Activities)
                .FirstOrDefault();

            var languageTotals = BuildLanguageTotals(activities);

            var endDisplay = endUtc.AddSeconds(-1);
            var description = $"{startUtc:yyyy-MM-dd} \u2014 {endDisplay:yyyy-MM-dd}";

            var fields = new List<object>();

            if (activities.Count == 0)
            {
                fields.Add(new { name = "Status", value = "No activity recorded this period.", inline = false });
            }
            else
            {
                fields.Add(new { name = "Words Read", value = FormatNumber(totalWords), inline = true });
                fields.Add(new { name = "Listening", value = FormatDuration(totalListeningSeconds), inline = true });
                fields.Add(new { name = "Activities", value = $"{activities.Count} ({readingActivities.Count} read, {listeningActivities.Count} listened)", inline = true });
                fields.Add(new { name = "Active Days", value = $"{activeDays}/{totalDays}", inline = true });
                fields.Add(new { name = "Avg Words/Day", value = FormatNumber(activeDays > 0 ? (int)Math.Round(totalWords / (double)activeDays) : 0), inline = true });
                fields.Add(new { name = "Avg Listening/Day", value = FormatAverageDuration(totalListeningSeconds, activeDays), inline = true });

                if (topDay != null)
                {
                    fields.Add(new { name = "Top Day", value = $"{topDay.Date:yyyy-MM-dd} ({FormatNumber(topDay.Words)} words, {FormatDuration(topDay.Seconds)})", inline = false });
                }

                if (languageTotals.Count > 0)
                {
                    var orderedLanguages = languageTotals
                        .OrderByDescending(entry => entry.Value.Words)
                        .ThenByDescending(entry => entry.Value.Seconds)
                        .ToList();

                    var languageLines = new List<string>();
                    var displayed = orderedLanguages.Take(MaxLanguagesPerUser).ToList();
                    foreach (var entry in displayed)
                    {
                        languageLines.Add(
                            $"**{entry.Key}** \u2014 {FormatNumber(entry.Value.Words)} words, {FormatDuration(entry.Value.Seconds)}, {entry.Value.TotalSessions} sessions");
                    }

                    if (orderedLanguages.Count > MaxLanguagesPerUser)
                    {
                        languageLines.Add($"...and {orderedLanguages.Count - MaxLanguagesPerUser} more");
                    }

                    var languageValue = string.Join("\n", languageLines);
                    if (languageValue.Length > MaxEmbedFieldLength)
                    {
                        languageValue = languageValue[..(MaxEmbedFieldLength - 3)] + "...";
                    }

                    fields.Add(new { name = "Languages", value = languageValue, inline = false });
                }
            }

            var embed = new Dictionary<string, object>
            {
                ["color"] = EmbedColor,
                ["title"] = "\ud83d\udcda Activity Report",
                ["description"] = description,
                ["fields"] = fields,
                ["footer"] = new { text = "LinguaRead" },
                ["timestamp"] = endUtc.ToString("yyyy-MM-ddTHH:mm:ssZ")
            };

            var fallback = $"Weekly report: {FormatNumber(totalWords)} words, {FormatDuration(totalListeningSeconds)} listening, {activeDays}/{totalDays} active days";

            var payload = new Dictionary<string, object>
            {
                ["embeds"] = new[] { embed }
            };

            if (endpointKind == WebhookEndpointKind.ReportRelay)
            {
                payload["content"] = fallback;
            }

            return JsonSerializer.Serialize(payload);
        }

        private async Task<DiscordWebhookPostResult> PostWebhookAsync(
            string webhookUrl,
            string jsonPayload,
            CancellationToken cancellationToken)
        {
            try
            {
                using var client = _httpClientFactory.CreateClient();
                using var content = new StringContent(jsonPayload, Encoding.UTF8, "application/json");
                using var response = await client.PostAsync(webhookUrl, content, cancellationToken);

                if (response.IsSuccessStatusCode)
                {
                    return DiscordWebhookPostResult.SuccessResult();
                }

                var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning(
                    "Discord webhook returned {StatusCode}: {ResponseBody}",
                    response.StatusCode,
                    responseBody);
                var trimmedBody = responseBody?.Length > 200
                    ? responseBody[..200] + "..."
                    : responseBody;
                return DiscordWebhookPostResult.Failed(
                    $"Discord webhook returned {(int)response.StatusCode} {response.ReasonPhrase}. {trimmedBody}".Trim());
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send Discord webhook message.");
                return DiscordWebhookPostResult.Failed($"Failed to send Discord webhook: {ex.Message}");
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

        private static string FormatNumber(int value)
        {
            return value.ToString("N0");
        }

        private static string FormatAverageDuration(int totalSeconds, int divisor)
        {
            if (divisor <= 0)
            {
                return "0m";
            }

            var averageSeconds = (int)Math.Round(totalSeconds / (double)divisor, MidpointRounding.AwayFromZero);
            return FormatDuration(averageSeconds);
        }

        private static bool TryNormalizeWebhookUrl(
            string url,
            out string normalizedUrl,
            out WebhookEndpointKind endpointKind)
        {
            normalizedUrl = url.Trim();
            endpointKind = WebhookEndpointKind.Unknown;
            if (!Uri.TryCreate(normalizedUrl, UriKind.Absolute, out var uri))
            {
                return false;
            }

            if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            {
                return false;
            }

            if (IsDiscordWebhookUri(uri))
            {
                endpointKind = WebhookEndpointKind.Discord;
                normalizedUrl = uri.ToString();
                return true;
            }

            if (IsReportRelayWebhookUri(uri))
            {
                endpointKind = WebhookEndpointKind.ReportRelay;
                normalizedUrl = uri.ToString();
                return true;
            }

            return false;
        }

        private static bool IsDiscordWebhookUri(Uri uri)
        {
            var host = uri.Host.ToLowerInvariant();
            if (host is not ("discord.com" or "www.discord.com" or "discordapp.com" or "www.discordapp.com"))
            {
                return false;
            }

            var segments = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length < 4)
            {
                return false;
            }

            if (!segments[0].Equals("api", StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            var webhookIndex = Array.FindIndex(
                segments,
                segment => segment.Equals("webhooks", StringComparison.OrdinalIgnoreCase));
            if (webhookIndex < 1 || webhookIndex + 2 >= segments.Length)
            {
                return false;
            }

            return webhookIndex == 1 ||
                (webhookIndex == 2 && segments[1].StartsWith("v", StringComparison.OrdinalIgnoreCase));
        }

        private static bool IsReportRelayWebhookUri(Uri uri)
        {
            var segments = uri.AbsolutePath.Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            return segments.Length >= 3 &&
                segments[0].Equals("webhook", StringComparison.OrdinalIgnoreCase) &&
                segments[1].Equals("report", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(segments[2]);
        }

        private static List<DayTotals> BuildDayTotals(List<Models.UserActivity> activities)
        {
            return activities
                .GroupBy(activity => activity.Timestamp.Date)
                .Select(group =>
                {
                    var groupActivities = group.ToList();
                    var groupListeningActivities = groupActivities
                        .Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                        .ToList();

                    return new DayTotals
                    {
                        Date = group.Key,
                        Words = groupActivities
                            .Where(activity => ReadingActivityTypes.Contains(activity.ActivityType))
                            .Sum(activity => activity.WordCount),
                        Seconds = groupListeningActivities
                            .Sum(activity => activity.ListeningDurationSeconds ?? 0),
                        Activities = groupActivities.Count,
                        Sessions = groupActivities.Count(activity => ReadingActivityTypes.Contains(activity.ActivityType)) +
                            CountListeningSessions(groupListeningActivities)
                    };
                })
                .OrderBy(day => day.Date)
                .ToList();
        }

        private static Dictionary<string, LanguageTotals> BuildLanguageTotals(List<Models.UserActivity> activities)
        {
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
                    totals.ReadingSessions += 1;
                }

                if (ListeningActivityTypes.Contains(activity.ActivityType))
                {
                    totals.Seconds += activity.ListeningDurationSeconds ?? 0;
                }
            }

            foreach (var languageGroup in activities
                .Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                .GroupBy(activity => activity.Language?.Name ?? "Unknown", StringComparer.OrdinalIgnoreCase))
            {
                languageTotals[languageGroup.Key].ListeningSessions = CountListeningSessions(languageGroup);
            }

            return languageTotals;
        }

        private static int CountListeningSessions(IEnumerable<Models.UserActivity> listeningActivities)
        {
            var orderedActivities = listeningActivities
                .OrderBy(activity => activity.Timestamp)
                .ToList();
            if (orderedActivities.Count == 0)
            {
                return 0;
            }

            var sessions = 0;
            DateTime? currentSessionEnd = null;
            foreach (var activity in orderedActivities)
            {
                var durationSeconds = Math.Max(activity.ListeningDurationSeconds ?? 0, 0);
                var activityEnd = activity.Timestamp.AddSeconds(durationSeconds);

                if (!currentSessionEnd.HasValue || activity.Timestamp > currentSessionEnd.Value.Add(ListeningSessionGraceGap))
                {
                    sessions++;
                    currentSessionEnd = activityEnd;
                    continue;
                }

                if (activityEnd > currentSessionEnd.Value)
                {
                    currentSessionEnd = activityEnd;
                }
            }

            return sessions;
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
            public int ReadingSessions { get; set; }
            public int ListeningSessions { get; set; }
            public int TotalSessions => ReadingSessions + ListeningSessions;
        }

        private class DayTotals
        {
            public DateTime Date { get; set; }
            public int Words { get; set; }
            public int Seconds { get; set; }
            public int Activities { get; set; }
            public int Sessions { get; set; }
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

    public class DiscordReportSendResult
    {
        private DiscordReportSendResult(bool sent, bool skipped, string? reason)
        {
            Sent = sent;
            Skipped = skipped;
            Reason = reason;
        }

        public bool Sent { get; }
        public bool Skipped { get; }
        public string? Reason { get; }

        public static DiscordReportSendResult Success() => new(true, false, null);
        public static DiscordReportSendResult SkippedResult(string reason) => new(false, true, reason);
        public static DiscordReportSendResult Failed(string reason) => new(false, false, reason);
    }

    internal readonly record struct DiscordWebhookPostResult(bool Success, string? ErrorMessage)
    {
        public static DiscordWebhookPostResult SuccessResult() => new(true, null);
        public static DiscordWebhookPostResult Failed(string errorMessage) => new(false, errorMessage);
    }

    internal enum WebhookEndpointKind
    {
        Unknown = 0,
        Discord = 1,
        ReportRelay = 2
    }
}
