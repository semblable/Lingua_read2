using Xunit;
using LinguaReadApi.Controllers;

namespace LinguaReadApi.Tests;

public class SrsStoryGenerationTests
{
    // --- Micro-context JSON Parsing Tests ---

    [Fact]
    public void ParseMicroContexts_BareJsonArray_ParsesAllEntries()
    {
        var raw = @"[
  {""term"": ""gato"", ""context"": ""El gato duerme. Está muy tranquilo.""},
  {""term"": ""parque"", ""context"": ""Voy al parque cada mañana. Me gusta correr ahí.""}
]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Equal(2, result.Count);
        Assert.Equal("gato", result[0].Term);
        Assert.StartsWith("El gato duerme.", result[0].Context);
        Assert.Equal("parque", result[1].Term);
    }

    [Fact]
    public void ParseMicroContexts_FencedJson_StripsFenceAndParses()
    {
        var raw = "```json\n[{\"term\": \"perro\", \"context\": \"El perro corre.\"}]\n```";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("perro", result[0].Term);
        Assert.Equal("El perro corre.", result[0].Context);
    }

    [Fact]
    public void ParseMicroContexts_PlainFence_StripsFenceAndParses()
    {
        var raw = "```\n[{\"term\": \"casa\", \"context\": \"Mi casa es grande.\"}]\n```";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("casa", result[0].Term);
    }

    [Fact]
    public void ParseMicroContexts_SurroundingCommentary_ExtractsArray()
    {
        var raw = "Sure, here is the JSON you requested:\n[{\"term\": \"libro\", \"context\": \"Leo un libro.\"}]\n\nLet me know if you need more.";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("libro", result[0].Term);
    }

    [Fact]
    public void ParseMicroContexts_MalformedJson_ReturnsEmptyList()
    {
        var raw = "[{\"term\": \"gato\", \"context\": ";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Empty(result);
    }

    [Fact]
    public void ParseMicroContexts_EmptyTermOrContext_FiltersEntry()
    {
        var raw = @"[
  {""term"": """", ""context"": ""Some context.""},
  {""term"": ""gato"", ""context"": """"},
  {""term"": ""perro"", ""context"": ""El perro ladra.""}
]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("perro", result[0].Term);
    }

    [Fact]
    public void ParseMicroContexts_MissingFields_FiltersEntry()
    {
        var raw = @"[
  {""term"": ""gato""},
  {""context"": ""orphan context""},
  {""term"": ""perro"", ""context"": ""El perro ladra.""}
]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("perro", result[0].Term);
    }

    [Fact]
    public void ParseMicroContexts_EmptyInput_ReturnsEmptyList()
    {
        Assert.Empty(SrsStoryResponseParser.ParseMicroContexts(""));
        Assert.Empty(SrsStoryResponseParser.ParseMicroContexts("   "));
        Assert.Empty(SrsStoryResponseParser.ParseMicroContexts(null!));
    }

    [Fact]
    public void ParseMicroContexts_NoJsonArrayPresent_ReturnsEmptyList()
    {
        var raw = "I'm sorry, I can't help with that.";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Empty(result);
    }

    [Fact]
    public void ParseMicroContexts_TrimsTermAndContextWhitespace()
    {
        var raw = @"[{""term"": ""  gato  "", ""context"": ""  El gato duerme.  ""}]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("gato", result[0].Term);
        Assert.Equal("El gato duerme.", result[0].Context);
    }

    // --- usedForm Tests ---

    [Fact]
    public void ParseMicroContexts_UsedFormPresentAndInContext_KeepsUsedForm()
    {
        var raw = @"[{""term"": ""lembrar"", ""usedForm"": ""lembrei-me"", ""context"": ""Ontem lembrei-me da reunião importante.""}]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("lembrar", result[0].Term);
        Assert.Equal("lembrei-me", result[0].UsedForm);
    }

    [Fact]
    public void ParseMicroContexts_UsedFormMissing_FallsBackToTerm()
    {
        var raw = @"[{""term"": ""gato"", ""context"": ""El gato duerme.""}]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("gato", result[0].UsedForm);
    }

    [Fact]
    public void ParseMicroContexts_UsedFormEmpty_FallsBackToTerm()
    {
        var raw = @"[{""term"": ""gato"", ""usedForm"": """", ""context"": ""El gato duerme.""}]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("gato", result[0].UsedForm);
    }

    [Fact]
    public void ParseMicroContexts_UsedFormNotInContext_FallsBackToTerm()
    {
        // Model hallucinated a usedForm that does not appear in the context — discard it
        var raw = @"[{""term"": ""gato"", ""usedForm"": ""gatitos"", ""context"": ""El gato duerme en el sofá.""}]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("gato", result[0].UsedForm);
    }

    [Fact]
    public void ParseMicroContexts_UsedFormCaseInsensitiveSubstring_Accepted()
    {
        var raw = @"[{""term"": ""gato"", ""usedForm"": ""Gato"", ""context"": ""El gato duerme.""}]";
        var result = SrsStoryResponseParser.ParseMicroContexts(raw);

        Assert.Single(result);
        Assert.Equal("Gato", result[0].UsedForm);
    }

    // --- OpenRouter Reasoning Options Tests ---

    [Fact]
    public void BuildReasoningOptions_DisabledStoryReasoning_ReturnsEffortNone()
    {
        var settings = new Models.UserSettings
        {
            OpenRouterStoryReasoningEnabled = false,
            OpenRouterStoryReasoningEffort = "high"
        };

        var result = OpenRouterStoryReasoningHelper.BuildReasoningOptions(settings);
        Assert.NotNull(result);
        Assert.Null(result.Enabled);
        Assert.Equal("none", result.Effort);
    }

    [Fact]
    public void BuildReasoningOptions_EnabledWithValidEffort_ReturnsOptions()
    {
        var settings = new Models.UserSettings
        {
            OpenRouterStoryReasoningEnabled = true,
            OpenRouterStoryReasoningEffort = "high"
        };

        var result = OpenRouterStoryReasoningHelper.BuildReasoningOptions(settings);
        Assert.NotNull(result);
        Assert.True(result!.Enabled);
        Assert.Equal("high", result.Effort);
    }

    [Fact]
    public void BuildReasoningOptions_InvalidEffort_DefaultsToMedium()
    {
        var settings = new Models.UserSettings
        {
            OpenRouterStoryReasoningEnabled = true,
            OpenRouterStoryReasoningEffort = "INVALID"
        };

        var result = OpenRouterStoryReasoningHelper.BuildReasoningOptions(settings);
        Assert.NotNull(result);
        Assert.Equal("medium", result!.Effort);
    }
}
