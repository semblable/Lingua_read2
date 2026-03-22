using LinguaReadApi.Utilities;
using Xunit;

namespace LinguaReadApi.Tests;

public class PairedTranslationTagExtractorTests
{
    [Fact]
    public void ExtractTranslatedTextOnly_StripsPairedTags_ReturnsTranslationOnly()
    {
        const string raw = "<o s=\"1\">O cinema brasileiro vai ganhar o mundo?</o><t s=\"1\">Will Brazilian cinema conquer the world?</t>";

        var plain = PairedTranslationTagExtractor.ExtractTranslatedTextOnly(raw);

        Assert.Equal("Will Brazilian cinema conquer the world?", plain);
    }

    [Fact]
    public void ExtractTranslatedTextOnly_MultipleSentences_JoinsInOrder()
    {
        const string raw = "<t s=\"2\">Second.</t><t s=\"1\">First.</t>";

        var plain = PairedTranslationTagExtractor.ExtractTranslatedTextOnly(raw);

        Assert.Equal("First. Second.", plain);
    }

    [Fact]
    public void ExtractTranslatedTextOnly_NoTags_ReturnsTrimmedOriginal()
    {
        const string raw = "  Plain translation  ";

        var plain = PairedTranslationTagExtractor.ExtractTranslatedTextOnly(raw);

        Assert.Equal("Plain translation", plain);
    }
}
