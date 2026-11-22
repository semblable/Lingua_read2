using System.Net;
using System.Security.Claims;
using System.Text.Json;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Ai;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;
using static LinguaReadApi.Tests.OpenAiCompatibleChatClientTests;

namespace LinguaReadApi.Tests;

/// <summary>
/// Which service the factories hand out for a user's AI provider settings, and the Settings
/// page's provider endpoints (catalog, connection test, model list).
/// </summary>
public class AiProviderSelectionTests
{
    // --- factories ---

    [Fact]
    public async Task Gemini_UsesTheUsersSavedKeyAndDefaultModel()
    {
        await using var context = CreateContext();
        await SeedUserAsync(context, "google", new UserAiProvider { Provider = "google", ApiKey = "other-test-key" });
        var userId = await SeedUserAsync(context, "google", new UserAiProvider { Provider = "google", ApiKey = "user-test-key" });
        var handler = new ScriptedHandler(
            Json(HttpStatusCode.OK, Completion("bonjour")),
            Json(HttpStatusCode.OK, Completion("Une histoire.")),
            Json(HttpStatusCode.OK, Completion("Un résumé.")));
        var client = CreateClient(handler);

        var translation = await TranslationFactory(context, client).GetServiceForUserAsync(userId);
        var story = await StoryFactory(context, client).GetServiceForUserAsync(userId);
        var summary = await SummarizationFactory(context, client).GetServiceForUserAsync(userId);
        Assert.Equal("bonjour", await translation.TranslateSentenceAsync("hello", "", "fr"));
        Assert.Equal("Une histoire.", await story.GenerateStoryAsync("Write a story in French."));
        Assert.Equal("Un résumé.", await summary.SummarizeAsync("Mon histoire", "fr", "fr"));

        Assert.Equal(3, handler.Requests.Count);
        Assert.All(handler.Requests, request =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", request.Uri.ToString());
            Assert.Equal("Bearer user-test-key", request.Authorization);
            using var body = JsonDocument.Parse(request.Body);
            Assert.Equal("gemini-3.5-flash-lite", body.RootElement.GetProperty("model").GetString());
            Assert.False(body.RootElement.TryGetProperty("temperature", out _));
            Assert.False(body.RootElement.TryGetProperty("top_p", out _));
            Assert.False(body.RootElement.TryGetProperty("top_k", out _));
        });
    }

    [Fact]
    public async Task TheSelectedProvider_IsUsed_WhenItHasAKey()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "deepseek", new UserAiProvider { Provider = "deepseek", ApiKey = "sk" });

        Assert.IsType<ProviderTranslationServiceAdapter>(await TranslationFactory(context).GetServiceForUserAsync(userId));
        Assert.IsType<ProviderStoryServiceAdapter>(await StoryFactory(context).GetServiceForUserAsync(userId));
        Assert.IsType<ProviderSummarizationServiceAdapter>(await SummarizationFactory(context).GetServiceForUserAsync(userId));
    }

    [Theory]
    [MemberData(nameof(UnusableSetups))]
    public async Task AnIncompleteProvider_ReportsMissingSetup(string selection, UserAiProvider? config)
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, selection, config);
        context.UserAiProviders.Add(new UserAiProvider { UserId = userId, Provider = "google", ApiKey = "unselected-test-key" });
        await context.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<TranslationProviderNotConfiguredException>(
            () => TranslationFactory(context).GetServiceForUserAsync(userId));
        Assert.Contains("Settings", error.Message);
    }

    public static TheoryData<string, UserAiProvider?> UnusableSetups() => new()
    {
        { "deepseek", null },                                                                  // never set up
        { "deepseek", new UserAiProvider { Provider = "deepseek", ApiKey = "  " } },            // blank key
        { "openrouter", new UserAiProvider { Provider = "openrouter", ApiKey = "sk" } },        // no model, no default
        { "custom", new UserAiProvider { Provider = "custom", Model = "llama3" } },             // no base URL
        { "openai", new UserAiProvider { Provider = "deepseek", ApiKey = "sk" } },              // key belongs to another provider
        { "retired-provider", null },                                                          // stale selection
        { "gemini", null },                                                                    // retired shared-key setup
        { "none", null },
    };

    [Fact]
    public async Task ACustomEndpoint_NeedsNoKey()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "custom",
            new UserAiProvider { Provider = "custom", BaseUrl = "http://localhost:11434/v1", Model = "llama3" });

        Assert.IsType<ProviderTranslationServiceAdapter>(await TranslationFactory(context).GetServiceForUserAsync(userId));
    }

    [Fact]
    public async Task EveryTaskNeedsAModel()
    {
        await using var context = CreateContext();
        // Only the translation override: stories would have no model.
        var userId = await SeedUserAsync(context, "openai",
            new UserAiProvider { Provider = "openai", ApiKey = "sk", TranslationModel = "gpt" });

        var error = await Assert.ThrowsAsync<TranslationProviderNotConfiguredException>(
            () => StoryFactory(context).GetServiceForUserAsync(userId));
        Assert.Contains("no model selected", error.Message);
    }

    [Fact]
    public async Task NoSettingsRow_ReportsTheMissingGeminiKey()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();

        var error = await Assert.ThrowsAsync<TranslationProviderNotConfiguredException>(
            () => TranslationFactory(context).GetServiceForUserAsync(userId));
        Assert.Contains("Google Gemini API key not configured", error.Message);
        Assert.Contains("Settings", error.Message);
    }

    // --- AiProvidersController ---

    [Fact]
    public void Catalog_ListsTheProviders_WithoutXai()
    {
        var controller = CreateController(CreateContext(), Guid.NewGuid(), new ScriptedHandler());

        var providers = controller.GetProviders().Value!;

        Assert.Equal(new[] { "openrouter", "deepseek", "openai", "google", "mistral", "groq", "custom" }, providers.Select(p => p.Id));
        var deepSeek = providers.Single(p => p.Id == "deepseek");
        Assert.Equal("deepseek-flash", deepSeek.DefaultModel);
        Assert.True(deepSeek.SupportsReasoning);
        var custom = providers.Single(p => p.Id == "custom");
        Assert.True(custom.RequiresBaseUrl);
        Assert.True(custom.ApiKeyOptional);
        Assert.Null(custom.BaseUrl);
        Assert.False(providers.Single(p => p.Id == "openai").SupportsReasoning);
        Assert.Equal("gemini-3.5-flash-lite", providers.Single(p => p.Id == "google").DefaultModel);
    }

    [Fact]
    public void PromptDefaults_ExposeTheTemplatesWithoutCallingAProvider()
    {
        using var context = CreateContext();
        var handler = new ScriptedHandler();
        var defaults = CreateController(context, Guid.NewGuid(), handler).GetPromptDefaults();

        Assert.Contains("{text}", defaults.SentenceTranslation);
        Assert.Contains("{sentenceContext}", defaults.SelectionTranslation);
        Assert.Contains("<o s=\"N\">", defaults.FullTextTranslation);
        Assert.Contains("{explanationLanguage}", defaults.SentenceExplanation);
        Assert.Contains("{maxLength}", defaults.Story);
        Assert.Contains("{maxSummaryWords}", defaults.Summarization);
        Assert.Contains("{wordList}", defaults.VocabularyPractice);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Test_SaysWhatIsMissing_WithoutCallingTheProvider()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "deepseek", null);
        var handler = new ScriptedHandler();

        var result = (await CreateController(context, userId, handler).TestConnection("deepseek")).Value!;

        Assert.False(result.Success);
        Assert.Equal("DeepSeek API key not configured", result.Message);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task Test_SendsATinyRequest_WithTheSavedModel()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "gemini", new UserAiProvider { Provider = "deepseek", ApiKey = "sk-ds", Model = "deepseek-v4-pro" });
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("OK")));

        // Testing a provider doesn't require it to be the selected one.
        var result = (await CreateController(context, userId, handler).TestConnection("DeepSeek")).Value!;

        Assert.True(result.Success, result.Message);
        Assert.Equal("Connection successful! Model 'deepseek-v4-pro' responded.", result.Message);
        Assert.Equal("OK", result.Details);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("Bearer sk-ds", request.Authorization);
        Assert.Contains("\"max_tokens\":256", request.Body);
    }

    [Fact]
    public async Task Test_ReportsTheProvidersError()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "deepseek", new UserAiProvider { Provider = "deepseek", ApiKey = "bad" });
        var handler = new ScriptedHandler(Json(HttpStatusCode.Unauthorized, """{"error":{"message":"Authentication Fails"}}"""));

        var result = (await CreateController(context, userId, handler).TestConnection("deepseek")).Value!;

        Assert.False(result.Success);
        Assert.Equal("DeepSeek error: Unauthorized (Authentication Fails)", result.Message);
    }

    [Fact]
    public async Task UnknownProvider_Is404()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "gemini", null);
        var controller = CreateController(context, userId, new ScriptedHandler());

        Assert.IsType<NotFoundObjectResult>((await controller.TestConnection("xai")).Result);
        Assert.IsType<NotFoundObjectResult>((await controller.GetModels("gemini")).Result);
    }

    [Fact]
    public async Task Models_AreListedBeforeAModelIsChosen()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "openrouter", new UserAiProvider { Provider = "openrouter", ApiKey = "sk-or" });
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, """{"data":[{"id":"z/model"},{"id":"a/model"}]}"""));

        var result = (await CreateController(context, userId, handler).GetModels("openrouter")).Value!;

        Assert.Null(result.Error);
        Assert.Equal(new[] { "a/model", "z/model" }, result.Models);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://openrouter.ai/api/v1/models", request.Uri.ToString());
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Empty(request.Body);
    }

    [Fact]
    public async Task Models_SaysWhatIsMissing()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "custom", new UserAiProvider { Provider = "custom" });

        var result = (await CreateController(context, userId, new ScriptedHandler()).GetModels("custom")).Value!;

        Assert.Empty(result.Models);
        Assert.Equal("Custom (OpenAI-compatible): base URL not configured", result.Error);
    }

    // --- helpers ---

    private static async Task<Guid> SeedUserAsync(AppDbContext context, string selection, UserAiProvider? config)
    {
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.UserSettings.Add(new UserSettings { UserId = userId, AiProvider = selection, CreatedAt = DateTime.UtcNow });
        if (config != null)
        {
            config.UserId = userId;
            context.UserAiProviders.Add(config);
        }
        await context.SaveChangesAsync();
        return userId;
    }

    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static OpenAiCompatibleChatClient UnusedClient() => CreateClient(new ScriptedHandler());

    private static TranslationServiceFactory TranslationFactory(AppDbContext context, OpenAiCompatibleChatClient? client = null) => new(
        new OpenAiCompatibleTranslationService(client ?? UnusedClient(), NullLogger<OpenAiCompatibleTranslationService>.Instance, Mock.Of<ILanguageService>()),
        context);

    private static StoryGenerationServiceFactory StoryFactory(AppDbContext context, OpenAiCompatibleChatClient? client = null) => new(
        new OpenAiCompatibleStoryGenerationService(client ?? UnusedClient(), NullLogger<OpenAiCompatibleStoryGenerationService>.Instance),
        context);

    private static SummarizationServiceFactory SummarizationFactory(AppDbContext context, OpenAiCompatibleChatClient? client = null) => new(
        new OpenAiCompatibleSummarizationService(client ?? UnusedClient(), NullLogger<OpenAiCompatibleSummarizationService>.Instance),
        context);

    private static AiProvidersController CreateController(AppDbContext context, Guid userId, ScriptedHandler handler) =>
        new(context, CreateClient(handler), NullLogger<AiProvidersController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "TestAuth"))
                }
            }
        };
}
