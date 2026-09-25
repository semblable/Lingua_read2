using System.Net;
using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Ai;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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
    public async Task BuiltInGemini_IsUsed_WhenSelected()
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, "gemini", new UserAiProvider { Provider = "deepseek", ApiKey = "sk" });

        Assert.IsType<GeminiTranslationService>(await TranslationFactory(context).GetServiceForUserAsync(userId));
        Assert.IsType<GeminiStoryGenerationService>(await StoryFactory(context).GetServiceForUserAsync(userId));
        Assert.IsType<GeminiSummarizationService>(await SummarizationFactory(context).GetServiceForUserAsync(userId));
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
    public async Task AnIncompleteProvider_FallsBackToGemini(string selection, UserAiProvider? config)
    {
        await using var context = CreateContext();
        var userId = await SeedUserAsync(context, selection, config);

        Assert.IsType<GeminiTranslationService>(await TranslationFactory(context).GetServiceForUserAsync(userId));
    }

    public static TheoryData<string, UserAiProvider?> UnusableSetups() => new()
    {
        { "deepseek", null },                                                                  // never set up
        { "deepseek", new UserAiProvider { Provider = "deepseek", ApiKey = "  " } },            // blank key
        { "openrouter", new UserAiProvider { Provider = "openrouter", ApiKey = "sk" } },        // no model, no default
        { "custom", new UserAiProvider { Provider = "custom", Model = "llama3" } },             // no base URL
        { "openai", new UserAiProvider { Provider = "deepseek", ApiKey = "sk" } },              // key belongs to another provider
        { "retired-provider", null },                                                          // stale selection
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

        Assert.IsType<GeminiStoryGenerationService>(await StoryFactory(context).GetServiceForUserAsync(userId));
    }

    [Fact]
    public async Task NoSettingsRow_UsesGemini()
    {
        await using var context = CreateContext();

        Assert.IsType<GeminiTranslationService>(await TranslationFactory(context).GetServiceForUserAsync(Guid.NewGuid()));
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
        Assert.Equal("https://openrouter.ai/api/v1/models", Assert.Single(handler.Requests).Uri.ToString());
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

    private static IConfiguration GeminiConfig() =>
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Gemini:ApiKey"] = "server-key" }).Build();

    private static IHttpClientFactory NoHttp() => Mock.Of<IHttpClientFactory>(f => f.CreateClient(It.IsAny<string>()) == new HttpClient());

    private static OpenAiCompatibleChatClient ChatClient() =>
        new(NoHttp(), NullLogger<OpenAiCompatibleChatClient>.Instance);

    private static TranslationServiceFactory TranslationFactory(AppDbContext context) => new(
        new GeminiTranslationService(GeminiConfig(), NullLogger<GeminiTranslationService>.Instance, Mock.Of<ILanguageService>(), NoHttp()),
        new OpenAiCompatibleTranslationService(ChatClient(), NullLogger<OpenAiCompatibleTranslationService>.Instance, Mock.Of<ILanguageService>()),
        context);

    private static StoryGenerationServiceFactory StoryFactory(AppDbContext context) => new(
        new GeminiStoryGenerationService(GeminiConfig(), NullLogger<GeminiStoryGenerationService>.Instance, NoHttp()),
        new OpenAiCompatibleStoryGenerationService(ChatClient(), NullLogger<OpenAiCompatibleStoryGenerationService>.Instance),
        context);

    private static SummarizationServiceFactory SummarizationFactory(AppDbContext context) => new(
        new GeminiSummarizationService(GeminiConfig(), NullLogger<GeminiSummarizationService>.Instance, NoHttp()),
        new OpenAiCompatibleSummarizationService(ChatClient(), NullLogger<OpenAiCompatibleSummarizationService>.Instance),
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
