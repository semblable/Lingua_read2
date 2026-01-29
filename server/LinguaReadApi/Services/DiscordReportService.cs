using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Net.Http.Headers;
using System.IO;
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
        private const long MaxDiscordUploadBytes = 7L * 1024 * 1024;

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

            if (!TryNormalizeWebhookUrl(settings.DiscordWebhookUrl, out var normalizedUrl))
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

            var message = BuildReportMessage(startUtc, endUtc, userActivities);

            if (dryRun)
            {
                _logger.LogInformation(
                    "Discord report dry run for user {UserId}: {MessagePreview}",
                    settings.UserId,
                    message.Length > 200 ? message[..200] + "..." : message);
                return DiscordReportSendResult.SkippedResult("Dry run enabled.");
            }

            string? htmlReportPath = null;
            try
            {
                var htmlReport = BuildReportHtml(startUtc, endUtc, userActivities);
                htmlReportPath = SaveHtmlReport(htmlReport, settings.UserId, startUtc, endUtc);

                var attachments = new List<string>();
                if (!string.IsNullOrWhiteSpace(htmlReportPath) && System.IO.File.Exists(htmlReportPath))
                {
                    attachments.Add(htmlReportPath);
                }

                var attachmentDecision = FilterAttachmentsForDiscord(attachments, MaxDiscordUploadBytes);

                var messageResult = await PostWebhookAsync(
                    settings.DiscordWebhookUrl,
                    message,
                    Array.Empty<string>(),
                    cancellationToken);

                if (!messageResult.Success)
                {
                    return DiscordReportSendResult.Failed(messageResult.ErrorMessage ?? "Failed to send webhook.");
                }

                var attachmentFailures = new List<string>();
                foreach (var attachmentPath in attachmentDecision.Sendable)
                {
                    var attachmentMessage = $"Report attachment: {Path.GetFileName(attachmentPath)}";
                    var attachmentResult = await PostWebhookAsync(
                        settings.DiscordWebhookUrl,
                        attachmentMessage,
                        new[] { attachmentPath },
                        cancellationToken);

                    if (!attachmentResult.Success)
                    {
                        attachmentFailures.Add(
                            $"{Path.GetFileName(attachmentPath)} ({attachmentResult.ErrorMessage ?? "failed"})");
                    }
                }

                var skipped = attachmentDecision.Skipped;
                if (skipped.Count > 0 || attachmentFailures.Count > 0)
                {
                    var statusMessage = BuildAttachmentStatusMessage(skipped, attachmentFailures);
                    var statusResult = await PostWebhookAsync(
                        settings.DiscordWebhookUrl,
                        statusMessage,
                        Array.Empty<string>(),
                        cancellationToken);

                    if (!statusResult.Success)
                    {
                        _logger.LogWarning(
                            "Failed to send Discord attachment status message for user {UserId}: {Error}",
                            settings.UserId,
                            statusResult.ErrorMessage ?? "unknown error");
                    }
                }

                if (attachmentFailures.Count > 0)
                {
                    _logger.LogWarning(
                        "One or more Discord report attachments failed for user {UserId}: {Failures}",
                        settings.UserId,
                        string.Join(", ", attachmentFailures));
                }

                return DiscordReportSendResult.Success();
            }
            finally
            {
                if (!string.IsNullOrWhiteSpace(htmlReportPath) && System.IO.File.Exists(htmlReportPath))
                {
                    try
                    {
                        System.IO.File.Delete(htmlReportPath);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to delete temporary HTML report {ReportPath}.", htmlReportPath);
                    }
                }
            }
        }

        private string BuildReportMessage(
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

            var readingActivities = activities
                .Where(activity => ReadingActivityTypes.Contains(activity.ActivityType))
                .ToList();

            var listeningActivities = activities
                .Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                .ToList();

            var dayTotals = activities
                .GroupBy(activity => activity.Timestamp.Date)
                .Select(group => new
                {
                    Date = group.Key,
                    Words = group.Where(activity => ReadingActivityTypes.Contains(activity.ActivityType))
                        .Sum(activity => activity.WordCount),
                    Seconds = group.Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                        .Sum(activity => activity.ListeningDurationSeconds ?? 0),
                    Activities = group.Count()
                })
                .ToList();

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
                    totals.ListeningSessions += 1;
                }
            }

            var endDisplay = endUtc.AddSeconds(-1);
            var messageLines = new List<string>
            {
                $"**Activity report** ({startUtc:yyyy-MM-dd} to {endDisplay:yyyy-MM-dd} UTC)",
                $"Total words read: {totalWords}",
                $"Total listening time: {FormatDuration(totalListeningSeconds)}",
                $"Total activities: {activities.Count} (reading {readingActivities.Count}, listening {listeningActivities.Count})",
                $"Active days: {activeDays}/{totalDays}",
                $"Avg words per active day: {FormatAverage(totalWords, activeDays)}",
                $"Avg listening per active day: {FormatAverageDuration(totalListeningSeconds, activeDays)}",
                $"Languages active: {languageTotals.Count}"
            };

            if (activities.Count == 0)
            {
                messageLines.Add("No activity recorded this week.");
                return string.Join("\n", messageLines);
            }

            if (topDay != null)
            {
                messageLines.Add($"Most active day: {topDay.Date:yyyy-MM-dd} ({topDay.Words} words, {FormatDuration(topDay.Seconds)})");
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
                        $"- {entry.Key}: {entry.Value.Words} words, {FormatDuration(entry.Value.Seconds)}, {entry.Value.TotalSessions} sessions");
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

        private async Task<DiscordWebhookPostResult> PostWebhookAsync(
            string webhookUrl,
            string message,
            IReadOnlyList<string> attachmentPaths,
            CancellationToken cancellationToken)
        {
            try
            {
                using var client = _httpClientFactory.CreateClient();
                using var content = CreateWebhookContent(message, attachmentPaths);
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

        private static HttpContent CreateWebhookContent(string message, IReadOnlyList<string> attachmentPaths)
        {
            var hasAttachments = attachmentPaths.Any(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));
            if (hasAttachments)
            {
                var safeMessage = string.IsNullOrWhiteSpace(message) ? "Attachment" : message;
                var attachmentPayload = JsonSerializer.Serialize(new { content = safeMessage });
                var multipartContent = new MultipartFormDataContent();
                multipartContent.Add(new StringContent(safeMessage, Encoding.UTF8), "content");
                multipartContent.Add(new StringContent(attachmentPayload, Encoding.UTF8, "application/json"), "payload_json");

                var index = 0;
                foreach (var attachmentPath in attachmentPaths)
                {
                    if (string.IsNullOrWhiteSpace(attachmentPath) || !File.Exists(attachmentPath))
                    {
                        continue;
                    }

                    var fileName = Path.GetFileName(attachmentPath);
                    var fileStream = File.OpenRead(attachmentPath);
                    var fileContent = new StreamContent(fileStream);
                    var contentType = GetAttachmentContentType(attachmentPath);
                    fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
                    multipartContent.Add(fileContent, $"files[{index}]", fileName);
                    index++;
                }

                return multipartContent;
            }

            var payload = JsonSerializer.Serialize(new { content = message });
            return new StringContent(payload, Encoding.UTF8, "application/json");
        }

        private static string SaveHtmlReport(string htmlReport, Guid userId, DateTime startUtc, DateTime endUtc)
        {
            var safeStart = startUtc.ToString("yyyyMMdd");
            var safeEnd = endUtc.AddSeconds(-1).ToString("yyyyMMdd");
            var fileName = $"linguaread_report_{userId}_{safeStart}_{safeEnd}.html";
            var directory = Path.Combine(Directory.GetCurrentDirectory(), "temp_reports");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, fileName);
            File.WriteAllText(path, htmlReport, Encoding.UTF8);
            return path;
        }

        private static string BuildReportHtml(
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

            var readingActivities = activities
                .Where(activity => ReadingActivityTypes.Contains(activity.ActivityType))
                .ToList();

            var listeningActivities = activities
                .Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                .ToList();

            var dayTotals = activities
                .GroupBy(activity => activity.Timestamp.Date)
                .Select(group => new
                {
                    Date = group.Key,
                    Words = group.Where(activity => ReadingActivityTypes.Contains(activity.ActivityType))
                        .Sum(activity => activity.WordCount),
                    Seconds = group.Where(activity => ListeningActivityTypes.Contains(activity.ActivityType))
                        .Sum(activity => activity.ListeningDurationSeconds ?? 0),
                    Activities = group.Count()
                })
                .OrderBy(day => day.Date)
                .ToList();

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
                    totals.ListeningSessions += 1;
                }
            }

            var orderedLanguages = languageTotals
                .OrderByDescending(entry => entry.Value.Words)
                .ThenByDescending(entry => entry.Value.Seconds)
                .ToList();

            var endDisplay = endUtc.AddSeconds(-1);
            var title = $"LinguaRead weekly report ({startUtc:yyyy-MM-dd} to {endDisplay:yyyy-MM-dd} UTC)";
            var maxDailyWords = dayTotals.Count == 0 ? 1 : Math.Max(1, dayTotals.Max(day => day.Words));
            var maxDailySeconds = dayTotals.Count == 0 ? 1 : Math.Max(1, dayTotals.Max(day => day.Seconds));
            var maxLanguageWords = orderedLanguages.Count == 0 ? 1 : Math.Max(1, orderedLanguages.Max(entry => entry.Value.Words));

            var builder = new StringBuilder();
            builder.AppendLine("<!doctype html>");
            builder.AppendLine("<html lang=\"en\">");
            builder.AppendLine("<head>");
            builder.AppendLine("  <meta charset=\"utf-8\" />");
            builder.AppendLine($"  <title>{EscapeHtml(title)}</title>");
            builder.AppendLine("  <style>");
            builder.AppendLine("    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; background: #f9fafb; }");
            builder.AppendLine("    h1 { margin-bottom: 6px; }");
            builder.AppendLine("    .subtitle { color: #6b7280; margin-bottom: 18px; }");
            builder.AppendLine("    .card { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }");
            builder.AppendLine("    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }");
            builder.AppendLine("    .stat { font-size: 22px; font-weight: bold; }");
            builder.AppendLine("    .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }");
            builder.AppendLine("    table { width: 100%; border-collapse: collapse; }");
            builder.AppendLine("    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; }");
            builder.AppendLine("    th { font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.04em; }");
            builder.AppendLine("    .bar { height: 12px; border-radius: 999px; background: #e5e7eb; position: relative; overflow: hidden; }");
            builder.AppendLine("    .bar > span { position: absolute; top: 0; left: 0; height: 100%; background: #6366f1; }");
            builder.AppendLine("    .bar.secondary > span { background: #10b981; }");
            builder.AppendLine("    .chart-title { font-weight: 600; margin-bottom: 8px; }");
            builder.AppendLine("    .empty { color: #9ca3af; }");
            builder.AppendLine("  </style>");
            builder.AppendLine("</head>");
            builder.AppendLine("<body>");
            builder.AppendLine($"  <h1>{EscapeHtml(title)}</h1>");
            builder.AppendLine($"  <div class=\"subtitle\">Generated {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC</div>");

            builder.AppendLine("  <div class=\"card grid\">");
            builder.AppendLine($"    <div><div class=\"label\">Total words read</div><div class=\"stat\">{totalWords}</div></div>");
            builder.AppendLine($"    <div><div class=\"label\">Total listening time</div><div class=\"stat\">{FormatDuration(totalListeningSeconds)}</div></div>");
            builder.AppendLine($"    <div><div class=\"label\">Total activities</div><div class=\"stat\">{activities.Count}</div></div>");
            builder.AppendLine($"    <div><div class=\"label\">Active days</div><div class=\"stat\">{activeDays}/{totalDays}</div></div>");
            builder.AppendLine($"    <div><div class=\"label\">Avg words / active day</div><div class=\"stat\">{FormatAverage(totalWords, activeDays)}</div></div>");
            builder.AppendLine($"    <div><div class=\"label\">Avg listening / active day</div><div class=\"stat\">{FormatAverageDuration(totalListeningSeconds, activeDays)}</div></div>");
            builder.AppendLine($"    <div><div class=\"label\">Languages active</div><div class=\"stat\">{languageTotals.Count}</div></div>");
            if (topDay != null)
            {
                builder.AppendLine($"    <div><div class=\"label\">Most active day</div><div class=\"stat\">{topDay.Date:yyyy-MM-dd}</div></div>");
            }
            builder.AppendLine("  </div>");

            builder.AppendLine("  <div class=\"card\">");
            builder.AppendLine("    <div class=\"chart-title\">Daily activity</div>");
            if (dayTotals.Count == 0)
            {
                builder.AppendLine("    <div class=\"empty\">No activity recorded for this period.</div>");
            }
            else
            {
                builder.AppendLine("    <table>");
                builder.AppendLine("      <thead><tr><th>Date</th><th>Words</th><th>Listening</th><th>Sessions</th></tr></thead>");
                builder.AppendLine("      <tbody>");
                foreach (var day in dayTotals)
                {
                    var wordWidth = (int)Math.Round(day.Words / (double)maxDailyWords * 100);
                    var secondsWidth = (int)Math.Round(day.Seconds / (double)maxDailySeconds * 100);
                    builder.AppendLine("        <tr>");
                    builder.AppendLine($"          <td>{day.Date:yyyy-MM-dd}</td>");
                    builder.AppendLine($"          <td>{day.Words}<div class=\"bar\"><span style=\"width:{wordWidth}%\"></span></div></td>");
                    builder.AppendLine($"          <td>{FormatDuration(day.Seconds)}<div class=\"bar secondary\"><span style=\"width:{secondsWidth}%\"></span></div></td>");
                    builder.AppendLine($"          <td>{day.Activities}</td>");
                    builder.AppendLine("        </tr>");
                }
                builder.AppendLine("      </tbody>");
                builder.AppendLine("    </table>");
            }
            builder.AppendLine("  </div>");

            builder.AppendLine("  <div class=\"card\">");
            builder.AppendLine("    <div class=\"chart-title\">Language breakdown</div>");
            if (orderedLanguages.Count == 0)
            {
                builder.AppendLine("    <div class=\"empty\">No language activity recorded.</div>");
            }
            else
            {
                builder.AppendLine("    <table>");
                builder.AppendLine("      <thead><tr><th>Language</th><th>Words</th><th>Listening</th><th>Sessions</th></tr></thead>");
                builder.AppendLine("      <tbody>");
                foreach (var entry in orderedLanguages)
                {
                    var barWidth = (int)Math.Round(entry.Value.Words / (double)maxLanguageWords * 100);
                    builder.AppendLine("        <tr>");
                    builder.AppendLine($"          <td>{EscapeHtml(entry.Key)}</td>");
                    builder.AppendLine($"          <td>{entry.Value.Words}<div class=\"bar\"><span style=\"width:{barWidth}%\"></span></div></td>");
                    builder.AppendLine($"          <td>{FormatDuration(entry.Value.Seconds)}</td>");
                    builder.AppendLine($"          <td>{entry.Value.TotalSessions}</td>");
                    builder.AppendLine("        </tr>");
                }
                builder.AppendLine("      </tbody>");
                builder.AppendLine("    </table>");
            }
            builder.AppendLine("  </div>");

            builder.AppendLine("  <div class=\"card\">");
            builder.AppendLine("    <div class=\"chart-title\">Activity split</div>");
            builder.AppendLine("    <table>");
            builder.AppendLine("      <thead><tr><th>Type</th><th>Count</th></tr></thead>");
            builder.AppendLine("      <tbody>");
            builder.AppendLine($"        <tr><td>Reading</td><td>{readingActivities.Count}</td></tr>");
            builder.AppendLine($"        <tr><td>Listening</td><td>{listeningActivities.Count}</td></tr>");
            builder.AppendLine("      </tbody>");
            builder.AppendLine("    </table>");
            builder.AppendLine("  </div>");

            builder.AppendLine("</body>");
            builder.AppendLine("</html>");

            return builder.ToString();
        }

        private static string EscapeHtml(string? value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            return value
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;")
                .Replace("\"", "&quot;")
                .Replace("'", "&#39;");
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

        private static string FormatAverage(int total, int divisor)
        {
            if (divisor <= 0)
            {
                return "0";
            }

            var average = (int)Math.Round(total / (double)divisor, MidpointRounding.AwayFromZero);
            return average.ToString();
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

        private static AttachmentDecision FilterAttachmentsForDiscord(
            IReadOnlyList<string> attachmentPaths,
            long maxFileBytes)
        {
            var selected = new List<string>();
            var skipped = new List<string>();

            foreach (var path in attachmentPaths)
            {
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    continue;
                }

                var size = new FileInfo(path).Length;
                if (size <= 0)
                {
                    skipped.Add($"{Path.GetFileName(path)} (empty)");
                    continue;
                }

                if (size > maxFileBytes)
                {
                    skipped.Add($"{Path.GetFileName(path)} ({FormatBytes(size)})");
                    continue;
                }

                selected.Add(path);
            }

            return new AttachmentDecision(selected, skipped);
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes < 1024)
            {
                return $"{bytes} B";
            }

            if (bytes < 1024 * 1024)
            {
                return $"{bytes / 1024d:0.#} KB";
            }

            if (bytes < 1024L * 1024 * 1024)
            {
                return $"{bytes / (1024d * 1024):0.#} MB";
            }

            return $"{bytes / (1024d * 1024 * 1024):0.#} GB";
        }

        private static string GetAttachmentContentType(string attachmentPath)
        {
            var extension = Path.GetExtension(attachmentPath);
            return extension.Equals(".html", StringComparison.OrdinalIgnoreCase)
                ? "text/html"
                : "application/octet-stream";
        }

        private static string BuildAttachmentStatusMessage(
            IReadOnlyList<string> skipped,
            IReadOnlyList<string> failed)
        {
            var lines = new List<string> { "Attachment status:" };
            if (skipped.Count > 0)
            {
                lines.Add($"- Skipped (size limit): {string.Join(", ", skipped)}");
            }
            else
            {
                lines.Add("- Skipped (size limit): none");
            }

            if (failed.Count > 0)
            {
                lines.Add($"- Failed uploads: {string.Join(", ", failed)}");
            }
            else
            {
                lines.Add("- Failed uploads: none");
            }

            var message = string.Join("\n", lines);
            if (message.Length > MaxDiscordMessageLength)
            {
                message = message[..(MaxDiscordMessageLength - 3)] + "...";
            }

            return message;
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
            public int ReadingSessions { get; set; }
            public int ListeningSessions { get; set; }
            public int TotalSessions => ReadingSessions + ListeningSessions;
        }

        private readonly record struct AttachmentDecision(
            IReadOnlyList<string> Sendable,
            IReadOnlyList<string> Skipped);
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
}
