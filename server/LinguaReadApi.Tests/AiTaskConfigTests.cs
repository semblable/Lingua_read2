using System.Collections.Generic;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Ai;
using Xunit;

namespace LinguaReadApi.Tests;

public class AiTaskConfigTests
{
    private static readonly AiProviderDefinition NoDefault = AiProviderCatalog.Find(AiProviderCatalog.OpenRouter)!;
    private static readonly AiProviderDefinition WithDefault = AiProviderCatalog.Find(AiProviderCatalog.DeepSeek)!;

    [Theory]
    [InlineData(AiTask.Translation)]
    [InlineData(AiTask.Explanation)]
    [InlineData(AiTask.Story)]
    [InlineData(AiTask.Summarization)]
    public void ResolveModel_ReturnsTaskOverride_WhenSet(AiTask task)
    {
        var config = new UserAiProvider
        {
            Model = "default/model",
            TranslationModel = "task/translation",
            ExplanationModel = "task/explanation",
            StoryModel = "task/story",
            SummarizationModel = "task/summarization"
        };

        var resolved = AiTaskConfig.ResolveModel(config, NoDefault, task);

        var expected = task switch
        {
            AiTask.Translation => "task/translation",
            AiTask.Explanation => "task/explanation",
            AiTask.Story => "task/story",
            AiTask.Summarization => "task/summarization",
            _ => "default/model"
        };
        Assert.Equal(expected, resolved);
    }

    [Theory]
    [InlineData(AiTask.Translation)]
    [InlineData(AiTask.Explanation)]
    [InlineData(AiTask.Story)]
    [InlineData(AiTask.Summarization)]
    public void ResolveModel_FallsBackToProviderModel_WhenOverrideEmpty(AiTask task)
    {
        var config = new UserAiProvider
        {
            Model = "default/model",
            TranslationModel = null,
            ExplanationModel = "",
            StoryModel = null,
            SummarizationModel = ""
        };

        var resolved = AiTaskConfig.ResolveModel(config, NoDefault, task);

        Assert.Equal("default/model", resolved);
    }

    [Fact]
    public void ResolveModel_FallsBackToProviderModel_WhenOverrideWhitespace()
    {
        var config = new UserAiProvider
        {
            Model = "default/model",
            StoryModel = "   "
        };

        var resolved = AiTaskConfig.ResolveModel(config, NoDefault, AiTask.Story);

        Assert.Equal("default/model", resolved);
    }

    [Fact]
    public void ResolveModel_TrimsTaskOverrideAndModel()
    {
        var config = new UserAiProvider
        {
            Model = "  default/model  ",
            TranslationModel = "  task/model  "
        };

        Assert.Equal("task/model", AiTaskConfig.ResolveModel(config, NoDefault, AiTask.Translation));
        Assert.Equal("default/model", AiTaskConfig.ResolveModel(config, NoDefault, AiTask.Story));
    }

    [Fact]
    public void ResolveModel_FallsBackToCatalogDefault_WhenNoModelIsSet()
    {
        var config = new UserAiProvider { Model = " " };

        Assert.Equal("deepseek-flash", AiTaskConfig.ResolveModel(config, WithDefault, AiTask.Explanation));
        Assert.Null(AiTaskConfig.ResolveModel(config, NoDefault, AiTask.Explanation));
    }

    [Fact]
    public void ResolvePromptOrDefault_ReturnsRenderedCustom_WhenProvided()
    {
        var custom = "Translate {text} into {targetLanguage}.";
        var vars = new Dictionary<string, string?>
        {
            ["text"] = "ola",
            ["targetLanguage"] = "EN"
        };

        var result = AiTaskConfig.ResolvePromptOrDefault(custom, "DEFAULT", vars);

        Assert.Equal("Translate ola into EN.", result);
    }

    [Fact]
    public void ResolvePromptOrDefault_ReturnsDefault_WhenCustomNull()
    {
        var result = AiTaskConfig.ResolvePromptOrDefault(
            null,
            "DEFAULT",
            new Dictionary<string, string?>());

        Assert.Equal("DEFAULT", result);
    }

    [Fact]
    public void ResolvePromptOrDefault_ReturnsDefault_WhenCustomWhitespace()
    {
        var result = AiTaskConfig.ResolvePromptOrDefault(
            "   \n\t  ",
            "DEFAULT",
            new Dictionary<string, string?>());

        Assert.Equal("DEFAULT", result);
    }
}
