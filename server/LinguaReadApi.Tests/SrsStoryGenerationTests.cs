using Xunit;
using LinguaReadApi.Controllers;

namespace LinguaReadApi.Tests;

public class SrsStoryGenerationTests
{
    // --- USED_WORDS Parsing Tests ---

    [Fact]
    public void ParseUsedWords_WithUsedWordsAtEnd_ExtractsCorrectly()
    {
        var raw = "El gato rápido corre por el parque.\nUSED_WORDS: gato, rápido, parque";
        var (story, usedWords) = SrsStoryResponseParser.Parse(raw, new List<string> { "gato", "rápido", "parque" });

        Assert.Equal("El gato rápido corre por el parque.", story);
        Assert.Equal(3, usedWords.Count);
        Assert.Contains("gato", usedWords);
        Assert.Contains("rápido", usedWords);
        Assert.Contains("parque", usedWords);
    }

    [Fact]
    public void ParseUsedWords_CaseInsensitive_ExtractsCorrectly()
    {
        var raw = "A story here.\nused_words: word1, word2";
        var (story, usedWords) = SrsStoryResponseParser.Parse(raw, new List<string> { "word1", "word2" });

        Assert.Equal("A story here.", story);
        Assert.Equal(2, usedWords.Count);
    }

    [Fact]
    public void ParseUsedWords_NoUsedWordsMarker_FallsBackToAllTargetWords()
    {
        var raw = "El gato rápido corre por el parque.";
        var targetWords = new List<string> { "gato", "rápido" };
        var (story, usedWords) = SrsStoryResponseParser.Parse(raw, targetWords);

        Assert.Equal(raw, story);
        Assert.Equal(targetWords, usedWords);
    }

    [Fact]
    public void ParseUsedWords_EmptyWordList_ReturnsEmptyList()
    {
        var raw = "A story.\nUSED_WORDS: ";
        var (story, usedWords) = SrsStoryResponseParser.Parse(raw, new List<string>());

        Assert.Equal("A story.", story);
        Assert.Empty(usedWords);
    }

    [Fact]
    public void ParseUsedWords_ExtraWhitespaceAndCommas_HandlesGracefully()
    {
        var raw = "Story text.\nUSED_WORDS:  gato ,  rápido ,, , parque  ";
        var (story, usedWords) = SrsStoryResponseParser.Parse(raw, new List<string> { "gato", "rápido", "parque" });

        Assert.Equal("Story text.", story);
        Assert.Equal(3, usedWords.Count);
        Assert.Contains("gato", usedWords);
        Assert.Contains("rápido", usedWords);
        Assert.Contains("parque", usedWords);
    }

    [Fact]
    public void ParseUsedWords_UsedWordsInMiddleOfText_UsesLastOccurrence()
    {
        var raw = "The word USED_WORDS: appears in the story.\n\nUSED_WORDS: gato, perro";
        var (story, usedWords) = SrsStoryResponseParser.Parse(raw, new List<string> { "gato", "perro" });

        Assert.Equal("The word USED_WORDS: appears in the story.", story);
        Assert.Equal(2, usedWords.Count);
    }

    [Fact]
    public void ParseUsedWords_EmptyResponse_ReturnsEmptyStoryAndFallback()
    {
        var targetWords = new List<string> { "word1" };
        var (story, usedWords) = SrsStoryResponseParser.Parse("", targetWords);

        Assert.Equal("", story);
        Assert.Equal(targetWords, usedWords);
    }

    // --- OpenRouter Reasoning Options Tests ---

    [Fact]
    public void BuildReasoningOptions_DisabledStoryReasoning_ReturnsNull()
    {
        var settings = new Models.UserSettings
        {
            OpenRouterStoryReasoningEnabled = false,
            OpenRouterStoryReasoningEffort = "high"
        };

        var result = OpenRouterStoryReasoningHelper.BuildReasoningOptions(settings);
        Assert.Null(result);
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

    // --- Story Style in DTO Tests ---

    [Fact]
    public void SrsStoryGenerateRequest_StyleField_AcceptsValues()
    {
        var request = new SrsStoryGenerateRequest
        {
            LanguageId = 1,
            MaxWords = 15,
            MaxLength = 400,
            Style = "Absurd"
        };

        Assert.Equal("Absurd", request.Style);
    }

    [Fact]
    public void SrsStoryGenerateRequest_StyleField_NullByDefault()
    {
        var request = new SrsStoryGenerateRequest { LanguageId = 1 };
        Assert.Null(request.Style);
    }
}
