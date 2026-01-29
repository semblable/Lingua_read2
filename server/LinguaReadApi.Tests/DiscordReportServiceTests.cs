using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
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
        var service = new DiscordReportService(context, httpClientFactory, NullLogger<DiscordReportService>.Instance);

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
        Assert.NotNull(handler.LastPayloadContent);

        using var payloadDoc = JsonDocument.Parse(handler.LastPayloadContent!);
        var content = payloadDoc.RootElement.GetProperty("content").GetString();
        Assert.NotNull(content);
        Assert.Contains("Total words read: 120", content);
        Assert.Contains("Total listening time: 1h", content);

        var updatedSettings = await context.UserSettings.SingleAsync(us => us.UserId == userId);
        Assert.Equal(new DateTime(2026, 1, 26, 8, 0, 0, DateTimeKind.Utc), updatedSettings.DiscordWeeklyReportLastSentAt);
    }

    [Fact]
    public async Task SendDueWeeklyReportsAsync_SkipsIfAlreadySentForSchedule()
    {
        using var context = CreateDbContext();
        var handler = new CapturingHttpMessageHandler();
        var httpClientFactory = new StubHttpClientFactory(handler);
        var service = new DiscordReportService(context, httpClientFactory, NullLogger<DiscordReportService>.Instance);

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
        var service = new DiscordReportService(context, httpClientFactory, NullLogger<DiscordReportService>.Instance);

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
        Assert.NotNull(handler.LastPayloadContent);
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
        public string? LastPayloadContent { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (request.Content != null)
            {
                LastPayloadContent = await request.Content.ReadAsStringAsync(cancellationToken);
            }

            return new HttpResponseMessage(HttpStatusCode.NoContent)
            {
                Content = new StringContent(string.Empty, Encoding.UTF8, "application/json")
            };
        }
    }
}
