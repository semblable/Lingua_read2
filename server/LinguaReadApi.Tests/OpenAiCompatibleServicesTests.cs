using System.Net;
using System.Text.Json;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Ai;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;
using static LinguaReadApi.Tests.OpenAiCompatibleChatClientTests;

namespace LinguaReadApi.Tests;

/// <summary>
/// The translation, story and summary services on top of the chat client: which model each task
/// uses, the reasoning switches, and the error strings the controllers turn into HTTP statuses.
/// </summary>
public class OpenAiCompatibleServicesTests
{
    private static AiProviderConnection DeepSeekWithOverrides(UserSettings? settings = null)
    {
        var definition = AiProviderCatalog.Find("deepseek")!;
        return AiProviderConnection.TryCreate(definition, new UserAiProvider
        {
            Provider = "deepseek",
            ApiKey = "sk-ds",
            Model = "deepseek-flash",
            ExplanationModel = "deepseek-v4-pro",
            StoryModel = "story-model",
            SummarizationModel = "summary-model"
        }, settings ?? new UserSettings(), out _)!;
    }

    private static OpenAiCompatibleTranslationService Translation(ScriptedHandler handler, params Language[] languages)
    {
        var languageService = new Mock<ILanguageService>();
        languageService.Setup(s => s.GetAllLanguagesAsync()).ReturnsAsync(languages.ToList());
        return new OpenAiCompatibleTranslationService(CreateClient(handler), NullLogger<OpenAiCompatibleTranslationService>.Instance, languageService.Object);
    }

    private static JsonElement Body(ScriptedHandler handler, int index = 0) => JsonDocument.Parse(handler.Requests[index].Body).RootElement;

    [Fact]
    public async Task SentenceTranslation_UsesTheProvidersModel_AndTurnsDeepSeekThinkingOff()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("Hello")));

        var result = await Translation(handler).TranslateSentenceAsync("Olá", "", "EN", DeepSeekWithOverrides());

        Assert.Equal("Hello", result);
        var body = Body(handler);
        Assert.Equal("deepseek-flash", body.GetProperty("model").GetString());
        Assert.Equal("disabled", body.GetProperty("thinking").GetProperty("type").GetString());
        Assert.False(body.TryGetProperty("reasoning", out _));
    }

    [Fact]
    public async Task Translation_UsesTheLanguagesConfiguredTargetCode()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("Hello")));
        var portuguese = new Language { Code = "pt", Name = "Portuguese", GeminiTargetCode = "English (UK)" };

        await Translation(handler, portuguese).TranslateSentenceAsync("Olá", "pt", "EN", DeepSeekWithOverrides());

        Assert.Contains("to English (UK)", Body(handler).GetProperty("messages")[0].GetProperty("content").GetString());
    }

    [Fact]
    public async Task Explanation_UsesTheExplanationModel_AndTheCustomPrompt()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("It means hello.")));
        var connection = DeepSeekWithOverrides(new UserSettings { CustomExplanationPrompt = "Explain {text} in {explanationLanguage}" });

        var result = await Translation(handler).ExplainSentenceAsync("Olá", "", "EN", connection);

        Assert.Equal("It means hello.", result);
        var body = Body(handler);
        Assert.Equal("deepseek-v4-pro", body.GetProperty("model").GetString());
        Assert.Equal("Explain Olá in EN", body.GetProperty("messages")[0].GetProperty("content").GetString());
    }

    [Fact]
    public async Task Errors_KeepThePrefixesTheControllersMapToStatuses()
    {
        var unauthorized = Json(HttpStatusCode.Unauthorized, """{"error":{"message":"Authentication Fails"}}""");
        var handler = new ScriptedHandler(unauthorized, unauthorized, unauthorized);
        var service = Translation(handler);
        var connection = DeepSeekWithOverrides();

        Assert.Equal("Translation error: Unauthorized (Authentication Fails)", await service.TranslateSentenceAsync("Olá", "", "EN", connection));
        Assert.Equal("Explanation error: Unauthorized (Authentication Fails)", await service.ExplainSentenceAsync("Olá", "", "EN", connection));
        Assert.Equal("Translation error: Unauthorized (Authentication Fails)",
            await service.TranslateSelectionWithContextAsync("Olá", "Olá mundo", "", "EN", connection));
    }

    [Fact]
    public async Task AnAnswerlessResponse_IsTranslationFailed()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, """{"choices":[]}"""));

        var result = await Translation(handler).TranslateFullTextAsync("Olá.", "", "EN", DeepSeekWithOverrides());

        Assert.Equal("Translation failed: Could not extract result", result);
    }

    [Fact]
    public async Task SelectionTranslation_IsTrimmed_AndCappedAt1024Tokens()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("  world  ")));

        var result = await Translation(handler).TranslateSelectionWithContextAsync("mundo", "Olá mundo", "", "EN", DeepSeekWithOverrides());

        Assert.Equal("world", result);
        Assert.Equal(1024, Body(handler).GetProperty("max_tokens").GetInt32());
    }

    [Fact]
    public async Task Story_UsesTheStoryModel_AndReportsAnEmptyAnswer()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("")));
        var service = new OpenAiCompatibleStoryGenerationService(CreateClient(handler), NullLogger<OpenAiCompatibleStoryGenerationService>.Instance);

        var result = await service.GenerateStoryAsync("Write a story", 20000, DeepSeekWithOverrides());

        Assert.StartsWith("Story generation failed: Model returned empty response", result);
        var body = Body(handler);
        Assert.Equal("story-model", body.GetProperty("model").GetString());
        Assert.Equal(16384, body.GetProperty("max_tokens").GetInt32()); // unknown model: default output cap
    }

    [Fact]
    public async Task Story_OnOpenRouter_StillTurnsReasoningOffExplicitly()
    {
        var handler = new ScriptedHandler(Json(HttpStatusCode.OK, Completion("Once upon a time")));
        var service = new OpenAiCompatibleStoryGenerationService(CreateClient(handler), NullLogger<OpenAiCompatibleStoryGenerationService>.Instance);

        var result = await service.GenerateStoryAsync("Write a story", 20000, Connection("openrouter", model: "mistralai/mistral-small-2603"));

        Assert.Equal("Once upon a time", result);
        var body = Body(handler);
        Assert.Equal("none", body.GetProperty("reasoning").GetProperty("effort").GetString());
        Assert.Equal(16384, body.GetProperty("max_tokens").GetInt32()); // this model's known cap
    }

    [Fact]
    public async Task Summarization_UsesTheSummaryModel_AndPrefixesErrors()
    {
        var handler = new ScriptedHandler(
            Json(HttpStatusCode.OK, Completion("  A summary.  ")),
            Json(HttpStatusCode.TooManyRequests, "{}"),
            Json(HttpStatusCode.TooManyRequests, "{}"));
        var client = CreateClient(handler);
        client.Delay = (_, _) => Task.CompletedTask;
        var service = new OpenAiCompatibleSummarizationService(client, NullLogger<OpenAiCompatibleSummarizationService>.Instance);

        Assert.Equal("A summary.", await service.SummarizeAsync("text", "pt", "EN", 100, DeepSeekWithOverrides()));
        Assert.Equal("summary-model", Body(handler).GetProperty("model").GetString());
        Assert.Equal("Summarization error: TooManyRequests", await service.SummarizeAsync("text", "pt", "EN", 100, DeepSeekWithOverrides()));
    }
}
