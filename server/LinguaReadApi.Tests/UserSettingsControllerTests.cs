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
        Assert.Equal(1.5, dto.LineSpacing);
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
            AutoTranslateOnOpen = true,
            PauseOnWordClick = true,
            LineSpacing = 1.75,
            LeftPanelWidth = 72
        };

        var result = await controller.UpdateUserSettings(update);

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.Equal("dark", dto.Theme);
        Assert.Equal(20, dto.TextSize);
        Assert.True(dto.UseOpenRouter);
        Assert.Equal("anthropic/claude-3-haiku", dto.OpenRouterModel);
        Assert.False(dto.AutoTranslateWords);
        Assert.True(dto.AutoTranslateOnOpen);
        Assert.True(dto.PauseOnWordClick);
        Assert.Equal(1.75, dto.LineSpacing);
        Assert.Equal(72, dto.LeftPanelWidth);

        var row = await context.UserSettings.SingleAsync();
        Assert.Equal("dark", row.Theme);
        Assert.True(row.UseOpenRouter);
        Assert.True(row.AutoTranslateOnOpen);
        Assert.Equal(1.75, row.LineSpacing);
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

    [Fact]
    public async Task UpdateUserSettings_StoresHardcoverTokenButOnlyReturnsPresenceFlag()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        var result = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            HardcoverApiToken = "  hardcover-secret  ",
            HardcoverSyncEnabled = true
        });

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.True(dto.HasHardcoverApiToken);
        Assert.True(dto.HardcoverSyncEnabled);

        var row = await context.UserSettings.SingleAsync();
        Assert.Equal("hardcover-secret", row.HardcoverApiToken);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto { ClearHardcoverApiToken = true });
        row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Null(row.HardcoverApiToken);
        Assert.False(row.HardcoverSyncEnabled);
    }

    [Fact]
    public async Task UpdateUserSettings_PersistsPerTaskOpenRouterModelsAndPrompts()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        var update = new UpdateUserSettingsDto
        {
            OpenRouterTranslationModel = "anthropic/claude-3.5-sonnet",
            OpenRouterExplanationModel = "openai/gpt-4o",
            OpenRouterStoryModel = "google/gemini-pro-1.5",
            OpenRouterSummarizationModel = "meta-llama/llama-3.3-8b-instruct:free",
            CustomTranslationPrompt = "Translate {text} to {targetLanguage}.",
            CustomExplanationPrompt = "Explain {text} in {explanationLanguage}.",
            CustomStoryPrompt = "Write a {level} {language} story about {prompt} in {maxLength} words.",
            CustomSummarizationPrompt = "Summarize {text} in under {maxSummaryWords} words in {targetLanguage}."
        };

        var result = await controller.UpdateUserSettings(update);

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.Equal("anthropic/claude-3.5-sonnet", dto.OpenRouterTranslationModel);
        Assert.Equal("openai/gpt-4o", dto.OpenRouterExplanationModel);
        Assert.Equal("google/gemini-pro-1.5", dto.OpenRouterStoryModel);
        Assert.Equal("meta-llama/llama-3.3-8b-instruct:free", dto.OpenRouterSummarizationModel);
        Assert.Equal("Translate {text} to {targetLanguage}.", dto.CustomTranslationPrompt);
        Assert.Equal("Explain {text} in {explanationLanguage}.", dto.CustomExplanationPrompt);
        Assert.Equal("Write a {level} {language} story about {prompt} in {maxLength} words.", dto.CustomStoryPrompt);
        Assert.Equal("Summarize {text} in under {maxSummaryWords} words in {targetLanguage}.", dto.CustomSummarizationPrompt);

        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal("anthropic/claude-3.5-sonnet", row.OpenRouterTranslationModel);
        Assert.Equal("Explain {text} in {explanationLanguage}.", row.CustomExplanationPrompt);

        // GET should round-trip the same values.
        var getResult = await controller.GetUserSettings();
        var getDto = Assert.IsType<UserSettingsDto>(getResult.Value);
        Assert.Equal("google/gemini-pro-1.5", getDto.OpenRouterStoryModel);
        Assert.Equal("Summarize {text} in under {maxSummaryWords} words in {targetLanguage}.", getDto.CustomSummarizationPrompt);
    }

    [Fact]
    public async Task UpdateUserSettings_ClearsPerTaskFields_WhenWhitespaceOnly()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.UserSettings.AddAsync(new UserSettings
        {
            UserId = userId,
            OpenRouterTranslationModel = "previous/model",
            OpenRouterExplanationModel = "previous/exp",
            OpenRouterStoryModel = "previous/story",
            OpenRouterSummarizationModel = "previous/sum",
            CustomTranslationPrompt = "old translation prompt",
            CustomExplanationPrompt = "old explanation prompt",
            CustomStoryPrompt = "old story prompt",
            CustomSummarizationPrompt = "old summary prompt",
            CreatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            OpenRouterTranslationModel = "   ",
            OpenRouterExplanationModel = "",
            OpenRouterStoryModel = "  ",
            OpenRouterSummarizationModel = "\t",
            CustomTranslationPrompt = "   ",
            CustomExplanationPrompt = "",
            CustomStoryPrompt = "  ",
            CustomSummarizationPrompt = "\n"
        });

        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Null(row.OpenRouterTranslationModel);
        Assert.Null(row.OpenRouterExplanationModel);
        Assert.Null(row.OpenRouterStoryModel);
        Assert.Null(row.OpenRouterSummarizationModel);
        Assert.Null(row.CustomTranslationPrompt);
        Assert.Null(row.CustomExplanationPrompt);
        Assert.Null(row.CustomStoryPrompt);
        Assert.Null(row.CustomSummarizationPrompt);
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
