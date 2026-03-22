using System.IO;
using System.Net.Http;
using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class UserSettingsControllerTests
{
    [Fact]
    public async Task GetUserSettings_FirstCall_CreatesRowWithDefaults()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        var result = await controller.GetUserSettings();

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.Equal("light", dto.Theme);
        Assert.Equal(16, dto.TextSize);
        Assert.False(dto.UseOpenRouter);
        Assert.Equal("google/gemini-2.5-flash-preview-05-20:free", dto.OpenRouterModel);

        Assert.Equal(1, await context.UserSettings.CountAsync());
        var row = await context.UserSettings.SingleAsync();
        Assert.Equal(userId, row.UserId);
        Assert.False(row.AutoMoveFinishedLessons);
        Assert.Equal(85, row.LeftPanelWidth);
    }

    [Fact]
    public async Task GetUserSettings_SecondCall_DoesNotCreateDuplicateRow()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        await controller.GetUserSettings();
        await controller.GetUserSettings();

        Assert.Equal(1, await context.UserSettings.CountAsync());
    }

    [Fact]
    public async Task UpdateUserSettings_PersistsRepresentativeFields()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        var update = new UpdateUserSettingsDto
        {
            Theme = "dark",
            TextSize = 20,
            UseOpenRouter = true,
            OpenRouterModel = "anthropic/claude-3-haiku",
            AutoTranslateWords = false,
            PauseOnWordClick = true,
            LeftPanelWidth = 72
        };

        var result = await controller.UpdateUserSettings(update);

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.Equal("dark", dto.Theme);
        Assert.Equal(20, dto.TextSize);
        Assert.True(dto.UseOpenRouter);
        Assert.Equal("anthropic/claude-3-haiku", dto.OpenRouterModel);
        Assert.False(dto.AutoTranslateWords);
        Assert.True(dto.PauseOnWordClick);
        Assert.Equal(72, dto.LeftPanelWidth);

        var row = await context.UserSettings.SingleAsync();
        Assert.Equal("dark", row.Theme);
        Assert.True(row.UseOpenRouter);
        Assert.Equal(72, row.LeftPanelWidth);
    }

    [Fact]
    public async Task UpdateUserSettings_TrimsOpenRouterApiKeyAndDiscordWebhook_AndClearsWhenWhitespaceOnly()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.UserSettings.AddAsync(new UserSettings
        {
            UserId = userId,
            DiscordWebhookUrl = "old",
            OpenRouterApiKey = "oldkey",
            CreatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            DiscordWebhookUrl = "  https://discord.example/webhook  ",
            OpenRouterApiKey = "  secret-key  "
        });

        var row = await context.UserSettings.SingleAsync();
        Assert.Equal("https://discord.example/webhook", row.DiscordWebhookUrl);
        Assert.Equal("secret-key", row.OpenRouterApiKey);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            DiscordWebhookUrl = "   ",
            OpenRouterApiKey = "  "
        });

        row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Null(row.DiscordWebhookUrl);
        Assert.Null(row.OpenRouterApiKey);
    }

    private static UserSettingsController CreateController(AppDbContext context, Guid userId)
    {
        var discord = new DiscordReportService(
            context,
            new MinimalHttpClientFactory(),
            NullLogger<DiscordReportService>.Instance,
            new StubDatabaseAdminService());

        return new UserSettingsController(
            context,
            discord,
            new MinimalHttpClientFactory(),
            NullLogger<UserSettingsController>.Instance)
        {
            ControllerContext = BuildControllerContext(userId)
        };
    }

    private static ControllerContext BuildControllerContext(Guid userId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                ], "TestAuth"))
            }
        };
    }

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new AppDbContext(options);
    }

    private sealed class MinimalHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) =>
            new HttpClient(new HttpClientHandler(), disposeHandler: true);
    }

    private sealed class StubDatabaseAdminService : IDatabaseAdminService
    {
        public Task<string?> BackupDatabaseAsync()
        {
            var tempFile = Path.GetTempFileName();
            File.WriteAllText(tempFile, "test-backup");
            return Task.FromResult<string?>(tempFile);
        }

        public Task<bool> RestoreDatabaseAsync(Stream backupStream) => Task.FromResult(true);
    }
}
