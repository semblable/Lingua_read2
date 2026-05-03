using System.Collections.Generic;
using LinguaReadApi.Services;
using Xunit;

namespace LinguaReadApi.Tests;

public class PromptTemplateRendererTests
{
    [Fact]
    public void Render_SubstitutesAllPlaceholders()
    {
        var template = "Translate {text} from {sourceLanguage} to {targetLanguage}.";
        var vars = new Dictionary<string, string?>
        {
            ["text"] = "Hello",
            ["sourceLanguage"] = "English",
            ["targetLanguage"] = "French"
        };

        var result = PromptTemplateRenderer.Render(template, vars);

        Assert.Equal("Translate Hello from English to French.", result);
    }

    [Fact]
    public void Render_LeavesUnknownPlaceholdersIntact()
    {
        var template = "Hello {name}, your code is {code}.";
        var vars = new Dictionary<string, string?>
        {
            ["name"] = "Anna"
        };

        var result = PromptTemplateRenderer.Render(template, vars);

        Assert.Equal("Hello Anna, your code is {code}.", result);
    }

    [Fact]
    public void Render_ReturnsTemplateUnchanged_WhenNoPlaceholders()
    {
        var template = "Plain text without braces.";
        var result = PromptTemplateRenderer.Render(template, new Dictionary<string, string?>());
        Assert.Equal(template, result);
    }

    [Fact]
    public void Render_HandlesNullValuesAsEmptyString()
    {
        var template = "Before {x} after.";
        var vars = new Dictionary<string, string?> { ["x"] = null };

        var result = PromptTemplateRenderer.Render(template, vars);

        Assert.Equal("Before  after.", result);
    }

    [Fact]
    public void Render_ReturnsEmptyString_WhenTemplateIsNull()
    {
        var result = PromptTemplateRenderer.Render(null!, new Dictionary<string, string?>());
        Assert.Equal(string.Empty, result);
    }

    [Fact]
    public void Render_HandlesUnclosedBraceGracefully()
    {
        var template = "Stray {open without close";
        var result = PromptTemplateRenderer.Render(template, new Dictionary<string, string?>());
        Assert.Equal(template, result);
    }
}
