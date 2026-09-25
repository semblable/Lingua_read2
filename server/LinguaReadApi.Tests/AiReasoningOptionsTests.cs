using System.Text.Json;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Ai;
using Xunit;

namespace LinguaReadApi.Tests;

public class AiReasoningOptionsTests
{
    private static ChatCompletionRequest Story(AiReasoningStyle style, bool enabled, string effort)
    {
        var request = new ChatCompletionRequest { Model = "m" };
        AiReasoningOptions.ApplyForStory(request, style, new UserSettings
        {
            OpenRouterStoryReasoningEnabled = enabled,
            OpenRouterStoryReasoningEffort = effort
        });
        return request;
    }

    private static ChatCompletionRequest Translation(AiReasoningStyle style, bool enabled, string effort)
    {
        var request = new ChatCompletionRequest { Model = "m" };
        AiReasoningOptions.ApplyForTranslation(request, style, new UserSettings
        {
            OpenRouterReasoningEnabled = enabled,
            OpenRouterReasoningEffort = effort
        });
        return request;
    }

    // --- OpenRouter: unchanged from before other providers existed ---

    [Fact]
    public void OpenRouter_DisabledStoryReasoning_SendsEffortNone()
    {
        var result = Story(AiReasoningStyle.OpenRouter, enabled: false, "high").Reasoning;
        Assert.NotNull(result);
        Assert.Null(result!.Enabled);
        Assert.Equal("none", result.Effort);
    }

    [Fact]
    public void OpenRouter_EnabledWithValidEffort_SendsIt()
    {
        var result = Story(AiReasoningStyle.OpenRouter, enabled: true, "high").Reasoning;
        Assert.True(result!.Enabled);
        Assert.Equal("high", result.Effort);
    }

    [Fact]
    public void OpenRouter_InvalidEffort_DefaultsToMedium()
    {
        Assert.Equal("medium", Story(AiReasoningStyle.OpenRouter, enabled: true, "INVALID").Reasoning!.Effort);
    }

    [Fact]
    public void OpenRouter_DisabledTranslationReasoning_SendsNothing()
    {
        var request = Translation(AiReasoningStyle.OpenRouter, enabled: false, "high");
        Assert.Null(request.Reasoning);
        Assert.Null(request.Thinking);
        Assert.Null(request.ReasoningEffort);
    }

    [Fact]
    public void OpenRouter_NeverSendsDeepSeekFields()
    {
        var request = Translation(AiReasoningStyle.OpenRouter, enabled: true, "xhigh");
        Assert.Equal("xhigh", request.Reasoning!.Effort);
        Assert.Null(request.Thinking);
        Assert.Null(request.ReasoningEffort);
    }

    // --- DeepSeek: thinks by default, so "off" is always explicit ---

    [Fact]
    public void DeepSeek_Disabled_TurnsThinkingOff_ForTranslationAndStory()
    {
        foreach (var request in new[]
                 {
                     Translation(AiReasoningStyle.DeepSeek, enabled: false, "high"),
                     Story(AiReasoningStyle.DeepSeek, enabled: false, "high")
                 })
        {
            Assert.Equal("disabled", request.Thinking!.Type);
            Assert.Null(request.ReasoningEffort);
            Assert.Null(request.Reasoning);
        }
    }

    [Theory]
    [InlineData("xhigh", "max")]
    [InlineData("high", "high")]
    [InlineData("medium", "high")]
    [InlineData("low", "low")]
    [InlineData("minimal", "low")]
    [InlineData("bogus", "high")]
    public void DeepSeek_Enabled_MapsEffort(string effort, string expected)
    {
        var request = Translation(AiReasoningStyle.DeepSeek, enabled: true, effort);
        Assert.Equal("enabled", request.Thinking!.Type);
        Assert.Equal(expected, request.ReasoningEffort);
    }

    [Fact]
    public void DeepSeek_EnabledWithEffortNone_TurnsThinkingOff()
    {
        var request = Story(AiReasoningStyle.DeepSeek, enabled: true, "none");
        Assert.Equal("disabled", request.Thinking!.Type);
        Assert.Null(request.ReasoningEffort);
    }

    [Fact]
    public void DeepSeek_SerializesTheDocumentedShape()
    {
        var json = JsonSerializer.Serialize(Translation(AiReasoningStyle.DeepSeek, enabled: true, "low"));
        Assert.Contains("\"thinking\":{\"type\":\"enabled\"}", json);
        Assert.Contains("\"reasoning_effort\":\"low\"", json);
        Assert.DoesNotContain("\"reasoning\":", json);
    }

    // --- Everyone else: no reasoning parameters, which several of them reject ---

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void None_SendsNoReasoningFields(bool enabled)
    {
        foreach (var request in new[]
                 {
                     Translation(AiReasoningStyle.None, enabled, "high"),
                     Story(AiReasoningStyle.None, enabled, "high")
                 })
        {
            var json = JsonSerializer.Serialize(request);
            Assert.DoesNotContain("reasoning", json);
            Assert.DoesNotContain("thinking", json);
        }
    }
}
