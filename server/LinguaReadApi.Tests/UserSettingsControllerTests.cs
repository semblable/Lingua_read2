using System.IO;
using System.Net.Http;
using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Ai;
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
        Assert.Equal("gemini", dto.AiProvider);
        Assert.Empty(dto.AiProviders);
        Assert.Empty(dto.AiProvidersWithApiKey);

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
            AiProvider = "openrouter",
            AiProviders = new() { ["openrouter"] = new AiProviderConfigDto { Model = "anthropic/claude-3-haiku" } },
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
        Assert.Equal("openrouter", dto.AiProvider);
        Assert.Equal("anthropic/claude-3-haiku", dto.AiProviders["openrouter"].Model);
        Assert.False(dto.AutoTranslateWords);
        Assert.True(dto.AutoTranslateOnOpen);
        Assert.True(dto.PauseOnWordClick);
        Assert.Equal(1.75, dto.LineSpacing);
        Assert.Equal(72, dto.LeftPanelWidth);

        var row = await context.UserSettings.SingleAsync();
        Assert.Equal("dark", row.Theme);
        Assert.Equal("openrouter", row.AiProvider);
        Assert.True(row.AutoTranslateOnOpen);
        Assert.Equal(1.75, row.LineSpacing);
        Assert.Equal(72, row.LeftPanelWidth);
    }

    [Fact]
    public async Task UpdateUserSettings_TrimsAiApiKeyAndDiscordWebhook_AndClearsWhenWhitespaceOnly()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.UserSettings.AddAsync(new UserSettings
        {
            UserId = userId,
            DiscordWebhookUrl = "old",
            CreatedAt = DateTime.UtcNow
        });
        context.UserAiProviders.Add(new UserAiProvider { UserId = userId, Provider = "openrouter", ApiKey = "oldkey" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            DiscordWebhookUrl = "  https://discord.example/webhook  ",
            AiApiKeys = new() { ["openrouter"] = "  secret-key  " }
        });

        var row = await context.UserSettings.SingleAsync();
        Assert.Equal("https://discord.example/webhook", row.DiscordWebhookUrl);
        Assert.Equal("secret-key", (await context.UserAiProviders.SingleAsync()).ApiKey);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            DiscordWebhookUrl = "   ",
            AiApiKeys = new() { ["openrouter"] = "  " }
        });

        row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Null(row.DiscordWebhookUrl);
        Assert.Null((await context.UserAiProviders.AsNoTracking().SingleAsync()).ApiKey);
    }

    [Fact]
    public async Task UpdateUserSettings_StoresDiscordWebhookButOnlyReturnsPresenceFlag()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        // Set the webhook URL (a posting capability, so treated as a write-only secret).
        var result = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            DiscordWebhookUrl = "  https://discord.example/webhook  ",
            DiscordWeeklyReportEnabled = true
        });

        // The response exposes only a presence flag — the URL itself is never returned to the
        // client (the DTO no longer has a DiscordWebhookUrl property).
        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.True(dto.HasDiscordWebhookUrl);
        Assert.True(dto.DiscordWeeklyReportEnabled);

        // The trimmed URL is still stored server-side for the report sender.
        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal("https://discord.example/webhook", row.DiscordWebhookUrl);

        // GET returns only the flag too.
        var getResult = await controller.GetUserSettings();
        Assert.True(Assert.IsType<UserSettingsDto>(getResult.Value).HasDiscordWebhookUrl);

        // Clearing (empty string) flips the flag off and nulls the stored value.
        var cleared = await controller.UpdateUserSettings(new UpdateUserSettingsDto { DiscordWebhookUrl = "" });
        Assert.False(Assert.IsType<UserSettingsDto>(cleared.Value).HasDiscordWebhookUrl);
        row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Null(row.DiscordWebhookUrl);
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
    public async Task UpdateUserSettings_StoresProviderKeysButOnlyReturnsPresenceFlags()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        // Set the per-user word-translation provider keys.
        var result = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AzureTranslatorKey = "  azure-secret  ",
            GoogleTranslateApiKey = "google-secret",
            WiktionaryAccessToken = "wiki-token"
        });

        // The response exposes only presence flags — the DTO no longer has the raw key properties.
        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.True(dto.HasAzureTranslatorKey);
        Assert.True(dto.HasGoogleTranslateApiKey);
        Assert.True(dto.HasWiktionaryAccessToken);

        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal("azure-secret", row.AzureTranslatorKey); // trimmed + stored
        Assert.Equal("google-secret", row.GoogleTranslateApiKey);

        // A later bulk save that omits the key fields (null) must NOT wipe stored keys.
        await controller.UpdateUserSettings(new UpdateUserSettingsDto { Theme = "dark" });
        row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal("azure-secret", row.AzureTranslatorKey);
        Assert.Equal("google-secret", row.GoogleTranslateApiKey);
        Assert.Equal("wiki-token", row.WiktionaryAccessToken);

        // Clearing sends an empty string (Clear button).
        var cleared = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AzureTranslatorKey = "",
            GoogleTranslateApiKey = "",
            WiktionaryAccessToken = ""
        });
        var clearedDto = Assert.IsType<UserSettingsDto>(cleared.Value);
        Assert.False(clearedDto.HasAzureTranslatorKey);
        Assert.False(clearedDto.HasGoogleTranslateApiKey);
        Assert.False(clearedDto.HasWiktionaryAccessToken);

        row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Null(row.AzureTranslatorKey);
        Assert.Null(row.GoogleTranslateApiKey);
        Assert.Null(row.WiktionaryAccessToken);
    }

    [Fact]
    public async Task UpdateUserSettings_PersistsPerTaskProviderModelsAndPrompts()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);

        var update = new UpdateUserSettingsDto
        {
            AiProviders = new()
            {
                ["openrouter"] = new AiProviderConfigDto
                {
                    TranslationModel = "anthropic/claude-3.5-sonnet",
                    ExplanationModel = "openai/gpt-4o",
                    StoryModel = "google/gemini-pro-1.5",
                    SummarizationModel = "meta-llama/llama-3.3-8b-instruct:free"
                }
            },
            CustomTranslationPrompt = "Translate {text} to {targetLanguage}.",
            CustomExplanationPrompt = "Explain {text} in {explanationLanguage}.",
            CustomStoryPrompt = "Write a {level} {language} story about {prompt} in {maxLength} words.",
            CustomSummarizationPrompt = "Summarize {text} in under {maxSummaryWords} words in {targetLanguage}."
        };

        var result = await controller.UpdateUserSettings(update);

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        var openRouter = dto.AiProviders["openrouter"];
        Assert.Equal("anthropic/claude-3.5-sonnet", openRouter.TranslationModel);
        Assert.Equal("openai/gpt-4o", openRouter.ExplanationModel);
        Assert.Equal("google/gemini-pro-1.5", openRouter.StoryModel);
        Assert.Equal("meta-llama/llama-3.3-8b-instruct:free", openRouter.SummarizationModel);
        Assert.Equal("Translate {text} to {targetLanguage}.", dto.CustomTranslationPrompt);
        Assert.Equal("Explain {text} in {explanationLanguage}.", dto.CustomExplanationPrompt);
        Assert.Equal("Write a {level} {language} story about {prompt} in {maxLength} words.", dto.CustomStoryPrompt);
        Assert.Equal("Summarize {text} in under {maxSummaryWords} words in {targetLanguage}.", dto.CustomSummarizationPrompt);

        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal("anthropic/claude-3.5-sonnet", (await context.UserAiProviders.AsNoTracking().SingleAsync()).TranslationModel);
        Assert.Equal("Explain {text} in {explanationLanguage}.", row.CustomExplanationPrompt);

        // GET should round-trip the same values.
        var getResult = await controller.GetUserSettings();
        var getDto = Assert.IsType<UserSettingsDto>(getResult.Value);
        Assert.Equal("google/gemini-pro-1.5", getDto.AiProviders["openrouter"].StoryModel);
        Assert.Equal("Summarize {text} in under {maxSummaryWords} words in {targetLanguage}.", getDto.CustomSummarizationPrompt);
    }

    [Fact]
    public async Task UpdateUserSettings_ClearsPerTaskFields_WhenWhitespaceOnly()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.UserAiProviders.Add(new UserAiProvider
        {
            UserId = userId,
            Provider = "openrouter",
            TranslationModel = "previous/model",
            ExplanationModel = "previous/exp",
            StoryModel = "previous/story",
            SummarizationModel = "previous/sum"
        });
        await context.UserSettings.AddAsync(new UserSettings
        {
            UserId = userId,
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
            AiProviders = new()
            {
                ["openrouter"] = new AiProviderConfigDto
                {
                    TranslationModel = "   ",
                    ExplanationModel = "",
                    StoryModel = "  ",
                    SummarizationModel = "\t"
                }
            },
            CustomTranslationPrompt = "   ",
            CustomExplanationPrompt = "",
            CustomStoryPrompt = "  ",
            CustomSummarizationPrompt = "\n"
        });

        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        var provider = await context.UserAiProviders.AsNoTracking().SingleAsync();
        Assert.Null(provider.TranslationModel);
        Assert.Null(provider.ExplanationModel);
        Assert.Null(provider.StoryModel);
        Assert.Null(provider.SummarizationModel);
        Assert.Null(row.CustomTranslationPrompt);
        Assert.Null(row.CustomExplanationPrompt);
        Assert.Null(row.CustomStoryPrompt);
        Assert.Null(row.CustomSummarizationPrompt);
    }

    // --- AI providers ---

    [Fact]
    public async Task UpdateUserSettings_KeepsEachProvidersKeyAndModels_AcrossSwitches()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiProvider = "openrouter",
            AiProviders = new() { ["openrouter"] = new AiProviderConfigDto { Model = "mistralai/mistral-small-2603" } },
            AiApiKeys = new() { ["openrouter"] = "sk-or-1" }
        });
        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiProvider = "DeepSeek ", // normalized
            AiProviders = new() { ["deepseek"] = new AiProviderConfigDto { Model = "deepseek-v4-pro" } },
            AiApiKeys = new() { ["deepseek"] = "sk-ds" }
        });

        var dto = Assert.IsType<UserSettingsDto>((await controller.GetUserSettings()).Value);
        Assert.Equal("deepseek", dto.AiProvider);
        Assert.Equal("mistralai/mistral-small-2603", dto.AiProviders["openrouter"].Model);
        Assert.Equal("deepseek-v4-pro", dto.AiProviders["deepseek"].Model);
        Assert.Equal(new[] { "deepseek", "openrouter" }, dto.AiProvidersWithApiKey);

        // Switching back touches nothing else.
        await controller.UpdateUserSettings(new UpdateUserSettingsDto { AiProvider = "openrouter" });
        var rows = await context.UserAiProviders.AsNoTracking().OrderBy(p => p.Provider).ToListAsync();
        Assert.Equal(new[] { "sk-ds", "sk-or-1" }, rows.Select(r => r.ApiKey));
        Assert.Equal("openrouter", (await context.UserSettings.AsNoTracking().SingleAsync()).AiProvider);
    }

    [Fact]
    public async Task UpdateUserSettings_NeverReturnsAiApiKeys()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        var result = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiApiKeys = new() { ["deepseek"] = "sk-secret-value" }
        });

        var json = System.Text.Json.JsonSerializer.Serialize(result.Value);
        Assert.DoesNotContain("sk-secret-value", json);
        Assert.Equal(new[] { "deepseek" }, Assert.IsType<UserSettingsDto>(result.Value).AiProvidersWithApiKey);
    }

    [Theory]
    [InlineData("anthropic")]
    [InlineData("")]
    [InlineData("xai")]
    public async Task UpdateUserSettings_RejectsUnknownAiProviderSelection(string selection)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        var result = await controller.UpdateUserSettings(new UpdateUserSettingsDto { AiProvider = selection });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task UpdateUserSettings_RejectsUnknownProviderInConfigsOrKeys_WithoutChangingAnything()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.UserSettings.Add(new UserSettings { UserId = userId, CreatedAt = DateTime.UtcNow });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        var badConfig = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiProviders = new()
            {
                ["deepseek"] = new AiProviderConfigDto { Model = "deepseek-flash" },
                ["nope"] = new AiProviderConfigDto { Model = "x" }
            }
        });
        var badKey = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiApiKeys = new() { ["openai"] = "sk", ["nope"] = "sk" }
        });

        Assert.IsType<BadRequestObjectResult>(badConfig.Result);
        Assert.IsType<BadRequestObjectResult>(badKey.Result);
        Assert.Empty(await context.UserAiProviders.ToListAsync());
    }

    [Fact]
    public async Task UpdateUserSettings_RejectsOverlongModelOrKey()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.UserSettings.Add(new UserSettings { UserId = userId, CreatedAt = DateTime.UtcNow });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        var longModel = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiProviders = new() { ["openai"] = new AiProviderConfigDto { StoryModel = new string('m', 201) } }
        });
        var longKey = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiApiKeys = new() { ["openai"] = new string('k', 1025) }
        });

        Assert.IsType<BadRequestObjectResult>(longModel.Result);
        Assert.IsType<BadRequestObjectResult>(longKey.Result);
    }

    [Theory]
    [InlineData("http://localhost:11434/v1", "http://localhost:11434/v1")]
    [InlineData("  http://localhost:11434/v1/  ", "http://localhost:11434/v1")]
    [InlineData("https://llm.example.com/v1/chat/completions", "https://llm.example.com/v1")]
    [InlineData("", null)]
    public async Task UpdateUserSettings_NormalizesCustomBaseUrl(string input, string? expected)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        var result = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiProviders = new() { ["custom"] = new AiProviderConfigDto { BaseUrl = input, Model = "llama3" } }
        });

        Assert.Equal(expected, Assert.IsType<UserSettingsDto>(result.Value).AiProviders["custom"].BaseUrl);
    }

    [Theory]
    [InlineData("localhost:11434")]
    [InlineData("ftp://example.com/v1")]
    [InlineData("https://user:pass@example.com/v1")]
    [InlineData("https://example.com/v1?key=1")]
    public async Task UpdateUserSettings_RejectsInvalidCustomBaseUrl(string input)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        var result = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiProviders = new() { ["custom"] = new AiProviderConfigDto { BaseUrl = input } }
        });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task UpdateUserSettings_IgnoresBaseUrlForCatalogProviders()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiProviders = new() { ["deepseek"] = new AiProviderConfigDto { BaseUrl = "http://evil.example", Model = "deepseek-flash" } }
        });

        Assert.Null((await context.UserAiProviders.AsNoTracking().SingleAsync()).BaseUrl);
    }

    [Fact]
    public async Task UpdateUserSettings_NullConfigFieldsLeaveValuesUnchanged()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.UserAiProviders.Add(new UserAiProvider { UserId = userId, Provider = "groq", ApiKey = "gsk", Model = "old", StoryModel = "story" });
        await context.SaveChangesAsync();
        var controller = CreateController(context, userId);

        await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            AiProviders = new() { ["groq"] = new AiProviderConfigDto { Model = "new" } }
        });

        var row = await context.UserAiProviders.AsNoTracking().SingleAsync();
        Assert.Equal("new", row.Model);
        Assert.Equal("story", row.StoryModel);
        Assert.Equal("gsk", row.ApiKey);
    }

    // --- SrsCardType (Feature 1) ---

    [Fact]
    public async Task GetUserSettings_DefaultSrsCardType_IsTranslation()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var result = await controller.GetUserSettings();

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.Equal("translation", dto.SrsCardType);
    }

    [Theory]
    [InlineData("translation")]
    [InlineData("cloze")]
    [InlineData("mixed")]
    public async Task UpdateUserSettings_AcceptsValidSrsCardType(string value)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        var result = await controller.UpdateUserSettings(new UpdateUserSettingsDto { SrsCardType = value });

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.Equal(value, dto.SrsCardType);

        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal(value, row.SrsCardType);
    }

    [Fact]
    public async Task UpdateUserSettings_RejectsUnknownSrsCardType_WithBadRequest_KeepingPriorValue()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        await controller.UpdateUserSettings(new UpdateUserSettingsDto { SrsCardType = "cloze" });

        var rejected = await controller.UpdateUserSettings(
            new UpdateUserSettingsDto { SrsCardType = "nonsense" });

        // 400 instead of a silent 200-with-no-change so clients can detect
        // and surface the bad value rather than thinking the update applied.
        Assert.IsType<BadRequestObjectResult>(rejected.Result);

        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal("cloze", row.SrsCardType);
    }

    [Fact]
    public async Task UpdateUserSettings_NormalizesCaseAndWhitespaceForSrsCardType()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        await controller.UpdateUserSettings(new UpdateUserSettingsDto { SrsCardType = "  CLOZE  " });

        var row = await context.UserSettings.AsNoTracking().SingleAsync();
        Assert.Equal("cloze", row.SrsCardType);
    }

    // ---- FSRS settings ----

    private static async Task<(AppDbContext Context, Guid UserId, int CardId)> SeedGraduatedCard()
    {
        var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.UserSettings.Add(new UserSettings { UserId = userId });
        var card = new SrsCardReview
        {
            WordId = 1, UserId = userId, HasEverGraduated = true, Stability = 30, Difficulty = 5,
            Interval = 30, Repetitions = 5, LastReviewedAt = DateTime.UtcNow.AddDays(-1),
            NextReviewAt = DateTime.UtcNow.AddDays(29),
        };
        context.SrsCardReviews.Add(card);
        await context.SaveChangesAsync();
        return (context, userId, card.SrsCardReviewId);
    }

    [Fact]
    public async Task UpdateUserSettings_RoundTripsFsrsSettings()
    {
        var (context, userId, _) = await SeedGraduatedCard();
        await using var _ctx = context;
        var weights = string.Join(",", LinguaReadApi.Services.Srs.FsrsParameters.DefaultWeights
            .Select(w => w.ToString(System.Globalization.CultureInfo.InvariantCulture)));

        var result = await CreateController(context, userId).UpdateUserSettings(new UpdateUserSettingsDto
        {
            SrsDesiredRetention = 0.85,
            SrsRelearningStepMinutes = " 5, 20 ",
            SrsDayStartHour = 6,
            SrsFsrsWeights = weights,
        });

        var dto = Assert.IsType<UserSettingsDto>(result.Value);
        Assert.Equal(0.85, dto.SrsDesiredRetention);
        Assert.Equal("5, 20", dto.SrsRelearningStepMinutes);
        Assert.Equal(6, dto.SrsDayStartHour);
        Assert.Equal(weights, dto.SrsFsrsWeights);

        await CreateController(context, userId).UpdateUserSettings(new UpdateUserSettingsDto { SrsFsrsWeights = "" });
        Assert.Null((await context.UserSettings.AsNoTracking().SingleAsync()).SrsFsrsWeights);
    }

    [Fact]
    public async Task UpdateUserSettings_RejectsMalformedFsrsWeights()
    {
        var (context, userId, _) = await SeedGraduatedCard();
        await using var _ctx = context;

        var result = await CreateController(context, userId).UpdateUserSettings(new UpdateUserSettingsDto { SrsFsrsWeights = "1,2,3" });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Null((await context.UserSettings.AsNoTracking().SingleAsync()).SrsFsrsWeights);
    }

    [Fact]
    public async Task ChangingDesiredRetention_ReschedulesGraduatedCards()
    {
        var (context, userId, cardId) = await SeedGraduatedCard();
        await using var _ctx = context;

        await CreateController(context, userId).UpdateUserSettings(new UpdateUserSettingsDto { SrsDesiredRetention = 0.95 });

        var card = await context.SrsCardReviews.AsNoTracking().SingleAsync(c => c.SrsCardReviewId == cardId);
        var ideal = new LinguaReadApi.Services.Srs.FsrsAlgorithm().NextIntervalDays(30, 0.95, 36500);
        var (min, max) = LinguaReadApi.Services.Srs.FsrsAlgorithm.FuzzRange(ideal, 36500);
        Assert.InRange(card.Interval, min, max);
        Assert.True(card.Interval < 30, $"higher retention should shorten the interval, got {card.Interval}d");
        var lastDay = LinguaReadApi.Utilities.SrsDay.UserDay(card.LastReviewedAt!.Value, 0, 4);
        Assert.Equal(LinguaReadApi.Utilities.SrsDay.DayStartUtc(lastDay.AddDays(card.Interval), 0, 4), card.NextReviewAt);
    }

    [Fact]
    public async Task ChangingDesiredRetention_ReschedulesOnTheUsersLocalDays()
    {
        var (context, userId, cardId) = await SeedGraduatedCard();
        await using var _ctx = context;
        // Reviewed at noon on March 10 for a user at UTC-5; stability 1 gives a 1-day interval (never fuzzed).
        var card = await context.SrsCardReviews.SingleAsync(c => c.SrsCardReviewId == cardId);
        card.Stability = 1;
        card.LastReviewedAt = new DateTime(2026, 3, 10, 17, 0, 0, DateTimeKind.Utc);
        await context.SaveChangesAsync();

        await CreateController(context, userId).UpdateUserSettings(
            new UpdateUserSettingsDto { SrsDesiredRetention = 0.95 }, timezoneOffsetMinutes: -300);

        // Due at 04:00 local on March 11. On UTC days it would be 04:00 UTC, i.e. 23:00 local
        // on March 10: due again the evening it was reviewed.
        var rescheduled = await context.SrsCardReviews.AsNoTracking().SingleAsync(c => c.SrsCardReviewId == cardId);
        Assert.Equal(1, rescheduled.Interval);
        Assert.Equal(new DateTime(2026, 3, 11, 9, 0, 0, DateTimeKind.Utc), rescheduled.NextReviewAt);
    }

    [Fact]
    public async Task RaisingTheDayStart_ReschedulesCardsOntoTheNewDayStart()
    {
        var (context, userId, cardId) = await SeedGraduatedCard();
        await using var _ctx = context;
        var card = await context.SrsCardReviews.SingleAsync(c => c.SrsCardReviewId == cardId);
        card.Stability = 1; // a 1-day interval, never fuzzed
        card.LastReviewedAt = new DateTime(2026, 3, 10, 12, 0, 0, DateTimeKind.Utc);
        await context.SaveChangesAsync();

        await CreateController(context, userId).UpdateUserSettings(new UpdateUserSettingsDto { SrsDayStartHour = 6 });

        // Left at 04:00 on March 11, the card would belong to March 10 under a 06:00 day start.
        var rescheduled = await context.SrsCardReviews.AsNoTracking().SingleAsync(c => c.SrsCardReviewId == cardId);
        Assert.Equal(new DateTime(2026, 3, 11, 6, 0, 0, DateTimeKind.Utc), rescheduled.NextReviewAt);
    }

    [Fact]
    public async Task UpdateUserSettings_RoundTripsAndValidatesStatusSync()
    {
        var (context, userId, _) = await SeedGraduatedCard();
        await using var _ctx = context;
        var controller = CreateController(context, userId);

        var ok = await controller.UpdateUserSettings(new UpdateUserSettingsDto
        {
            SrsAutoCreateCards = " WITH_SENTENCE ",
            SrsStatusSyncMode = "promote_demote",
            SrsStatusLevel3Days = 5,
            SrsStatusLevel4Days = 15,
            SrsAutoKnownDays = 60,
            SrsKnownCardAction = "suspend",
        });
        var dto = Assert.IsType<UserSettingsDto>(ok.Value);
        Assert.Equal(("with_sentence", "promote_demote", 5, 15, 60, "suspend"),
            (dto.SrsAutoCreateCards, dto.SrsStatusSyncMode, dto.SrsStatusLevel3Days, dto.SrsStatusLevel4Days, dto.SrsAutoKnownDays, dto.SrsKnownCardAction));

        Assert.IsType<BadRequestObjectResult>((await controller.UpdateUserSettings(new UpdateUserSettingsDto { SrsStatusSyncMode = "sometimes" })).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.UpdateUserSettings(new UpdateUserSettingsDto { SrsStatusLevel4Days = 3 })).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.UpdateUserSettings(new UpdateUserSettingsDto { SrsAutoKnownDays = 10 })).Result);
        Assert.IsType<UserSettingsDto>((await controller.UpdateUserSettings(new UpdateUserSettingsDto { SrsAutoKnownDays = 0 })).Value);
    }

    [Fact]
    public async Task UnrelatedSettingChange_LeavesDueDatesAlone()
    {
        var (context, userId, cardId) = await SeedGraduatedCard();
        await using var _ctx = context;
        var before = (await context.SrsCardReviews.AsNoTracking().SingleAsync(c => c.SrsCardReviewId == cardId)).NextReviewAt;

        await CreateController(context, userId).UpdateUserSettings(new UpdateUserSettingsDto { SrsMaxNewCards = 5, SrsDesiredRetention = 0.9 });

        Assert.Equal(before, (await context.SrsCardReviews.AsNoTracking().SingleAsync(c => c.SrsCardReviewId == cardId)).NextReviewAt);
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
            discord)
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
