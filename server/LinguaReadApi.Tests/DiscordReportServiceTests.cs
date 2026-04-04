using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class DiscordReportServiceTests
{
    [Fact]
    public async Task SendDueWeeklyReportsAsync_SendsWhenDue_UpdatesLastSent()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var databaseAdminService = new StubDatabaseAdminService();
        var service = new DiscordReportService(
            context,
            httpClientFactory,
            NullLogger<DiscordReportService>.Instance,
            databaseAdminService);

        var userId = Guid.NewGuid();
        var language = new Language { Name = "Spanish", Code = "es" };
        var settings = new UserSettings
        {
            UserId = userId,
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://discord.com/api/webhooks/test/test",
            DiscordWeeklyReportDayOfWeek = "Monday",
            DiscordWeeklyReportHourLocal = 8,
            DiscordTimezoneOffsetMinutes = 0
        };

        context.Users.Add(new User { Id = userId, Email = "user@example.com", UserName = "user@example.com" });
        context.Languages.Add(language);
        context.UserSettings.Add(settings);
        context.UserActivities.Add(new UserActivity
        {
            UserId = userId,
            Language = language,
            LanguageId = language.LanguageId,
            ActivityType = "Reading",
            WordCount = 120,
            ListeningDurationSeconds = 0,
            Timestamp = new DateTime(2026, 1, 25, 9, 0, 0, DateTimeKind.Utc)
        });
        context.UserActivities.Add(new UserActivity
        {
            UserId = userId,
            Language = language,
            LanguageId = language.LanguageId,
            ActivityType = "Listening",
            WordCount = 0,
            ListeningDurationSeconds = 3600,
            Timestamp = new DateTime(2026, 1, 26, 7, 0, 0, DateTimeKind.Utc)
        });
        await context.SaveChangesAsync();

        var nowUtc = new DateTime(2026, 1, 26, 10, 0, 0, DateTimeKind.Utc);
        var options = new DiscordReportOptions { WeeklyReportEnabled = true };

        var result = await service.SendDueWeeklyReportsAsync(options, nowUtc, false, CancellationToken.None);

        Assert.Equal(1, result.SentCount);
        Assert.NotNull(handler.FirstPayloadContent);

        var embed = ExtractFirstEmbed(handler.FirstPayloadContent);
        var fields = GetEmbedFields(embed);
        Assert.Equal("120", fields["Words Read"]);
        Assert.Equal("1h", fields["Listening"]);

        var updatedSettings = await context.UserSettings.SingleAsync(us => us.UserId == userId);
        Assert.Equal(new DateTime(2026, 1, 26, 8, 0, 0, DateTimeKind.Utc), updatedSettings.DiscordWeeklyReportLastSentAt);
    }

    [Fact]
    public async Task SendDueWeeklyReportsAsync_SkipsIfAlreadySentForSchedule()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var databaseAdminService = new StubDatabaseAdminService();
        var service = new DiscordReportService(
            context,
            httpClientFactory,
            NullLogger<DiscordReportService>.Instance,
            databaseAdminService);

        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, Email = "user2@example.com", UserName = "user2@example.com" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://discord.com/api/webhooks/test/test",
            DiscordWeeklyReportDayOfWeek = "Monday",
            DiscordWeeklyReportHourLocal = 8,
            DiscordTimezoneOffsetMinutes = 0,
            DiscordWeeklyReportLastSentAt = new DateTime(2026, 1, 19, 8, 0, 0, DateTimeKind.Utc)
        });
        await context.SaveChangesAsync();

        var nowUtc = new DateTime(2026, 1, 26, 6, 0, 0, DateTimeKind.Utc);
        var options = new DiscordReportOptions { WeeklyReportEnabled = true };

        var result = await service.SendDueWeeklyReportsAsync(options, nowUtc, false, CancellationToken.None);

        Assert.Equal(0, result.SentCount);
        Assert.Equal(1, result.SkippedCount);
        Assert.Null(handler.LastPayloadContent);
    }

    [Fact]
    public async Task SendDueWeeklyReportsAsync_ForceSend_BypassesSchedule()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var databaseAdminService = new StubDatabaseAdminService();
        var service = new DiscordReportService(
            context,
            httpClientFactory,
            NullLogger<DiscordReportService>.Instance,
            databaseAdminService);

        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, Email = "user3@example.com", UserName = "user3@example.com" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://discord.com/api/webhooks/test/test",
            DiscordWeeklyReportDayOfWeek = "Wednesday",
            DiscordWeeklyReportHourLocal = 20,
            DiscordTimezoneOffsetMinutes = 120,
            DiscordWeeklyReportLastSentAt = new DateTime(2026, 1, 22, 18, 0, 0, DateTimeKind.Utc)
        });
        await context.SaveChangesAsync();

        var nowUtc = new DateTime(2026, 1, 26, 10, 0, 0, DateTimeKind.Utc);
        var options = new DiscordReportOptions { WeeklyReportEnabled = true };

        var result = await service.SendDueWeeklyReportsAsync(options, nowUtc, true, CancellationToken.None);

        Assert.Equal(1, result.SentCount);
        Assert.NotNull(handler.FirstPayloadContent);
    }

    [Fact]
    public async Task SendReportForUserAsync_UsesCustomRange()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var databaseAdminService = new StubDatabaseAdminService();
        var service = new DiscordReportService(
            context,
            httpClientFactory,
            NullLogger<DiscordReportService>.Instance,
            databaseAdminService);

        var userId = Guid.NewGuid();
        var language = new Language { Name = "French", Code = "fr" };
        var settings = new UserSettings
        {
            UserId = userId,
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://discord.com/api/webhooks/test/test",
            DiscordWeeklyReportDayOfWeek = "Monday",
            DiscordWeeklyReportHourLocal = 8,
            DiscordTimezoneOffsetMinutes = 0
        };

        context.Users.Add(new User { Id = userId, Email = "user4@example.com", UserName = "user4@example.com" });
        context.Languages.Add(language);
        context.UserSettings.Add(settings);
        context.UserActivities.Add(new UserActivity
        {
            UserId = userId,
            Language = language,
            LanguageId = language.LanguageId,
            ActivityType = "Reading",
            WordCount = 50,
            ListeningDurationSeconds = 0,
            Timestamp = new DateTime(2026, 1, 1, 10, 0, 0, DateTimeKind.Utc)
        });
        context.UserActivities.Add(new UserActivity
        {
            UserId = userId,
            Language = language,
            LanguageId = language.LanguageId,
            ActivityType = "Reading",
            WordCount = 200,
            ListeningDurationSeconds = 0,
            Timestamp = new DateTime(2026, 1, 20, 10, 0, 0, DateTimeKind.Utc)
        });
        await context.SaveChangesAsync();

        var startUtc = new DateTime(2026, 1, 15, 0, 0, 0, DateTimeKind.Utc);
        var endUtc = new DateTime(2026, 1, 22, 0, 0, 0, DateTimeKind.Utc);

        var result = await service.SendReportForUserAsync(settings, startUtc, endUtc, false, CancellationToken.None);

        Assert.True(result.Sent);
        Assert.NotNull(handler.FirstPayloadContent);

        var embed = ExtractFirstEmbed(handler.FirstPayloadContent);
        var fields = GetEmbedFields(embed);
        Assert.Equal("200", fields["Words Read"]);
    }

    [Fact]
    public async Task SendReportForUserAsync_GroupsListeningAcrossShortBreaks()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var service = new DiscordReportService(
            context,
            httpClientFactory,
            NullLogger<DiscordReportService>.Instance,
            new StubDatabaseAdminService());

        var userId = Guid.NewGuid();
        var language = new Language { Name = "Portuguese", Code = "pt" };
        var settings = new UserSettings
        {
            UserId = userId,
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://discord.com/api/webhooks/test/test",
            DiscordWeeklyReportDayOfWeek = "Monday",
            DiscordWeeklyReportHourLocal = 8,
            DiscordTimezoneOffsetMinutes = 0
        };

        context.Users.Add(new User { Id = userId, Email = "grouped@example.com", UserName = "grouped@example.com" });
        context.Languages.Add(language);
        context.UserSettings.Add(settings);
        context.UserActivities.AddRange(
            new UserActivity
            {
                UserId = userId,
                Language = language,
                LanguageId = language.LanguageId,
                ActivityType = "Listening",
                WordCount = 0,
                ListeningDurationSeconds = 600,
                Timestamp = new DateTime(2026, 3, 20, 10, 0, 0, DateTimeKind.Utc)
            },
            new UserActivity
            {
                UserId = userId,
                Language = language,
                LanguageId = language.LanguageId,
                ActivityType = "Listening",
                WordCount = 0,
                ListeningDurationSeconds = 600,
                Timestamp = new DateTime(2026, 3, 20, 10, 12, 0, 0, DateTimeKind.Utc)
            },
            new UserActivity
            {
                UserId = userId,
                Language = language,
                LanguageId = language.LanguageId,
                ActivityType = "Listening",
                WordCount = 0,
                ListeningDurationSeconds = 600,
                Timestamp = new DateTime(2026, 3, 20, 10, 24, 0, 0, DateTimeKind.Utc)
            });
        await context.SaveChangesAsync();

        var startUtc = new DateTime(2026, 3, 14, 0, 0, 0, DateTimeKind.Utc);
        var endUtc = new DateTime(2026, 3, 21, 0, 0, 0, DateTimeKind.Utc);

        var result = await service.SendReportForUserAsync(settings, startUtc, endUtc, false, CancellationToken.None);

        Assert.True(result.Sent);
        Assert.NotNull(handler.FirstPayloadContent);

        var embed = ExtractFirstEmbed(handler.FirstPayloadContent);
        var fields = GetEmbedFields(embed);
        Assert.Contains("Portuguese", fields["Languages"]);
        Assert.Contains("30m", fields["Languages"]);
        Assert.Contains("1 sessions", fields["Languages"]);
    }

    [Fact]
    public async Task SendReportForUserAsync_StartsNewListeningSessionAfterLongGap()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var service = new DiscordReportService(
            context,
            httpClientFactory,
            NullLogger<DiscordReportService>.Instance,
            new StubDatabaseAdminService());

        var userId = Guid.NewGuid();
        var language = new Language { Name = "Portuguese", Code = "pt" };
        var settings = new UserSettings
        {
            UserId = userId,
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://discord.com/api/webhooks/test/test",
            DiscordWeeklyReportDayOfWeek = "Monday",
            DiscordWeeklyReportHourLocal = 8,
            DiscordTimezoneOffsetMinutes = 0
        };

        context.Users.Add(new User { Id = userId, Email = "split@example.com", UserName = "split@example.com" });
        context.Languages.Add(language);
        context.UserSettings.Add(settings);
        context.UserActivities.AddRange(
            new UserActivity
            {
                UserId = userId,
                Language = language,
                LanguageId = language.LanguageId,
                ActivityType = "Listening",
                WordCount = 0,
                ListeningDurationSeconds = 600,
                Timestamp = new DateTime(2026, 3, 20, 10, 0, 0, DateTimeKind.Utc)
            },
            new UserActivity
            {
                UserId = userId,
                Language = language,
                LanguageId = language.LanguageId,
                ActivityType = "Listening",
                WordCount = 0,
                ListeningDurationSeconds = 600,
                Timestamp = new DateTime(2026, 3, 20, 11, 0, 0, DateTimeKind.Utc)
            });
        await context.SaveChangesAsync();

        var startUtc = new DateTime(2026, 3, 14, 0, 0, 0, DateTimeKind.Utc);
        var endUtc = new DateTime(2026, 3, 21, 0, 0, 0, DateTimeKind.Utc);

        var result = await service.SendReportForUserAsync(settings, startUtc, endUtc, false, CancellationToken.None);

        Assert.True(result.Sent);
        Assert.NotNull(handler.FirstPayloadContent);

        var embed = ExtractFirstEmbed(handler.FirstPayloadContent);
        var fields = GetEmbedFields(embed);
        Assert.Contains("Portuguese", fields["Languages"]);
        Assert.Contains("20m", fields["Languages"]);
        Assert.Contains("2 sessions", fields["Languages"]);
    }

    [Fact]
    public async Task SendReportForUserAsync_SendsJsonPayloadWithEmbeds()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var service = new DiscordReportService(
            context,
            httpClientFactory,
            NullLogger<DiscordReportService>.Instance,
            new StubDatabaseAdminService());

        var userId = Guid.NewGuid();
        var settings = new UserSettings
        {
            UserId = userId,
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://discord.com/api/webhooks/test/test",
            DiscordWeeklyReportDayOfWeek = "Monday",
            DiscordWeeklyReportHourLocal = 8,
            DiscordTimezoneOffsetMinutes = 0
        };

        context.Users.Add(new User { Id = userId, Email = "embed@example.com", UserName = "embed@example.com" });
        context.UserSettings.Add(settings);
        await context.SaveChangesAsync();

        var startUtc = new DateTime(2026, 3, 14, 0, 0, 0, DateTimeKind.Utc);
        var endUtc = new DateTime(2026, 3, 21, 0, 0, 0, DateTimeKind.Utc);

        var result = await service.SendReportForUserAsync(settings, startUtc, endUtc, false, CancellationToken.None);

        Assert.True(result.Sent);

        // Verify it's plain JSON, not multipart
        var request = handler.Requests[0];
        Assert.Contains("application/json", request.ContentType);

        // Verify embed structure
        using var doc = JsonDocument.Parse(handler.FirstPayloadContent!);
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("embeds", out var embeds));
        Assert.Equal(1, embeds.GetArrayLength());

        var embed = embeds[0];
        Assert.Equal(0x6366F1, embed.GetProperty("color").GetInt32());
        Assert.True(embed.TryGetProperty("title", out _));
        Assert.True(embed.TryGetProperty("footer", out _));
        Assert.True(embed.TryGetProperty("timestamp", out _));
    }

    [Fact]
    public async Task SendReportForUserAsync_RejectsUnsupportedWebhookUrls()
    {
        using var context = CreateDbContext();
        var service = new DiscordReportService(
            context,
            new StubHttpClientFactory(new CapturingHttpMessageHandler()),
            NullLogger<DiscordReportService>.Instance,
            new StubDatabaseAdminService());

        var settings = new UserSettings
        {
            UserId = Guid.NewGuid(),
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://example.com/not-a-webhook",
            DiscordWeeklyReportDayOfWeek = "Monday",
            DiscordWeeklyReportHourLocal = 8,
            DiscordTimezoneOffsetMinutes = 0
        };

        var startUtc = new DateTime(2026, 3, 14, 0, 0, 0, DateTimeKind.Utc);
        var endUtc = new DateTime(2026, 3, 21, 0, 0, 0, DateTimeKind.Utc);

        var result = await service.SendReportForUserAsync(settings, startUtc, endUtc, false, CancellationToken.None);

        Assert.False(result.Sent);
        Assert.False(result.Skipped);
        Assert.Equal("Discord webhook URL is invalid.", result.Reason);
    }

    [Fact]
    public async Task SendReportForUserAsync_ZeroActivity_ShowsStatusField()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var service = new DiscordReportService(
            context,
            httpClientFactory,
            NullLogger<DiscordReportService>.Instance,
            new StubDatabaseAdminService());

        var userId = Guid.NewGuid();
        var settings = new UserSettings
        {
            UserId = userId,
            DiscordWeeklyReportEnabled = true,
            DiscordWebhookUrl = "https://discord.com/api/webhooks/test/test",
            DiscordWeeklyReportDayOfWeek = "Monday",
            DiscordWeeklyReportHourLocal = 8,
            DiscordTimezoneOffsetMinutes = 0
        };

        context.Users.Add(new User { Id = userId, Email = "zero@example.com", UserName = "zero@example.com" });
        context.UserSettings.Add(settings);
        await context.SaveChangesAsync();

        var startUtc = new DateTime(2026, 3, 14, 0, 0, 0, DateTimeKind.Utc);
        var endUtc = new DateTime(2026, 3, 21, 0, 0, 0, DateTimeKind.Utc);

        var result = await service.SendReportForUserAsync(settings, startUtc, endUtc, false, CancellationToken.None);

        Assert.True(result.Sent);

        var embed = ExtractFirstEmbed(handler.FirstPayloadContent);
        var fields = GetEmbedFields(embed);
        Assert.Contains("No activity", fields["Status"]);
    }

    private static AppDbContext CreateDbContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        private readonly HttpClient _client;

        public StubHttpClientFactory(HttpMessageHandler handler)
        {
            _client = new HttpClient(handler, disposeHandler: false);
        }

        public HttpClient CreateClient(string name) => _client;
    }

    private sealed class CapturingHttpMessageHandler : HttpMessageHandler
    {
        public string? FirstPayloadContent { get; private set; }
        public string? LastPayloadContent { get; private set; }
        public List<CapturedRequest> Requests { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (request.Content != null)
            {
                LastPayloadContent = await request.Content.ReadAsStringAsync(cancellationToken);
                FirstPayloadContent ??= LastPayloadContent;
                Requests.Add(new CapturedRequest(
                    request.RequestUri?.ToString(),
                    request.Content.Headers.ContentType?.ToString(),
                    LastPayloadContent));
            }
            else
            {
                Requests.Add(new CapturedRequest(
                    request.RequestUri?.ToString(),
                    null,
                    null));
            }

            return new HttpResponseMessage(HttpStatusCode.NoContent)
            {
                Content = new StringContent(string.Empty, Encoding.UTF8, "application/json")
            };
        }
    }

    private sealed class StubDatabaseAdminService : IDatabaseAdminService
    {
        public Task<string?> BackupDatabaseAsync()
        {
            var tempFile = Path.GetTempFileName();
            File.WriteAllText(tempFile, "test-backup");
            return Task.FromResult<string?>(tempFile);
        }

        public Task<bool> RestoreDatabaseAsync(Stream backupStream)
        {
            return Task.FromResult(true);
        }
    }

    private static JsonElement ExtractFirstEmbed(string? rawPayload)
    {
        Assert.NotNull(rawPayload);
        using var doc = JsonDocument.Parse(rawPayload!);
        var embeds = doc.RootElement.GetProperty("embeds");
        Assert.True(embeds.GetArrayLength() > 0, "Expected at least one embed");
        return embeds[0].Clone();
    }

    private static Dictionary<string, string> GetEmbedFields(JsonElement embed)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (embed.TryGetProperty("fields", out var fields))
        {
            foreach (var field in fields.EnumerateArray())
            {
                var name = field.GetProperty("name").GetString()!;
                var value = field.GetProperty("value").GetString()!;
                result[name] = value;
            }
        }
        return result;
    }

    private sealed record CapturedRequest(string? RequestUri, string? ContentType, string? Body);
}
