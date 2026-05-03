using System.Collections.Generic;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Xunit;

namespace LinguaReadApi.Tests;

public class OpenRouterTaskConfigTests
{
    [Theory]
    [InlineData(OpenRouterTask.Translation)]
    [InlineData(OpenRouterTask.Explanation)]
    [InlineData(OpenRouterTask.Story)]
    [InlineData(OpenRouterTask.Summarization)]
    public void ResolveModel_ReturnsTaskOverride_WhenSet(OpenRouterTask task)
    {
        var settings = new UserSettings
        {
            OpenRouterModel = "default/model",
            OpenRouterTranslationModel = "task/translation",
            OpenRouterExplanationModel = "task/explanation",
            OpenRouterStoryModel = "task/story",
            OpenRouterSummarizationModel = "task/summarization"
        };

        var resolved = OpenRouterTaskConfig.ResolveModel(settings, task);

        var expected = task switch
        {
            OpenRouterTask.Translation => "task/translation",
            OpenRouterTask.Explanation => "task/explanation",
            OpenRouterTask.Story => "task/story",
            OpenRouterTask.Summarization => "task/summarization",
            _ => "default/model"
        };
        Assert.Equal(expected, resolved);
    }

    [Theory]
    [InlineData(OpenRouterTask.Translation)]
    [InlineData(OpenRouterTask.Explanation)]
    [InlineData(OpenRouterTask.Story)]
    [InlineData(OpenRouterTask.Summarization)]
    public void ResolveModel_FallsBackToOpenRouterModel_WhenOverrideEmpty(OpenRouterTask task)
    {
        var settings = new UserSettings
        {
            OpenRouterModel = "default/model",
            OpenRouterTranslationModel = null,
            OpenRouterExplanationModel = "",
            OpenRouterStoryModel = null,
            OpenRouterSummarizationModel = ""
        };

        var resolved = OpenRouterTaskConfig.ResolveModel(settings, task);

        Assert.Equal("default/model", resolved);
    }

    [Fact]
    public void ResolveModel_FallsBackToOpenRouterModel_WhenOverrideWhitespace()
    {
        var settings = new UserSettings
        {
            OpenRouterModel = "default/model",
            OpenRouterStoryModel = "   "
        };

        var resolved = OpenRouterTaskConfig.ResolveModel(settings, OpenRouterTask.Story);

        Assert.Equal("default/model", resolved);
    }

    [Fact]
    public void ResolveModel_TrimsTaskOverride()
    {
        var settings = new UserSettings
        {
            OpenRouterModel = "default/model",
            OpenRouterTranslationModel = "  task/model  "
        };

        var resolved = OpenRouterTaskConfig.ResolveModel(settings, OpenRouterTask.Translation);

        Assert.Equal("task/model", resolved);
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

        var result = OpenRouterTaskConfig.ResolvePromptOrDefault(custom, "DEFAULT", vars);

        Assert.Equal("Translate ola into EN.", result);
    }

    [Fact]
    public void ResolvePromptOrDefault_ReturnsDefault_WhenCustomNull()
    {
        var result = OpenRouterTaskConfig.ResolvePromptOrDefault(
            null,
            "DEFAULT",
            new Dictionary<string, string?>());

        Assert.Equal("DEFAULT", result);
    }

    [Fact]
    public void ResolvePromptOrDefault_ReturnsDefault_WhenCustomWhitespace()
    {
        var result = OpenRouterTaskConfig.ResolvePromptOrDefault(
            "   \n\t  ",
            "DEFAULT",
            new Dictionary<string, string?>());

        Assert.Equal("DEFAULT", result);
    }
}
