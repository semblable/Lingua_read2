using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Backend mirror of `client/lingua-read-client/src/__tests__/tokenizer.spec.js`.
/// Every fixture here MUST produce the same word sequence on both sides;
/// drift between FE and BE is exactly the bug this work is fixing.
/// </summary>
public class TokenizerTests
{
    private const string LatinSubs = "´='|`='|’='|‘='|...=…|..=‥";

    private static Language Lang(string code, string wordChars, string subs = LatinSubs) => new()
    {
        Code = code,
        Name = code,
        WordCharacters = wordChars,
        CharacterSubstitutions = subs,
        SplitSentences = ".!?",
        ParserType = "spacedel"
    };

    private static readonly Language En = Lang("en", "a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ");
    private static readonly Language Fr = Lang("fr", "a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ");
    private static readonly Language It = Lang("it", "a-zA-ZÀàÉéÈèÌìÎîÓóÒòÙù");
    private static readonly Language Pt = Lang("pt", "a-zA-ZÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü");
    private static readonly Language De = Lang("de", "a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ‌‍");
    private static readonly Language Ru = Lang("ru", @"\p{L}\p{M}'-", "’='|‘='|...=…");

    private static string[] WordsOf(string content, Language lang)
    {
        var result = Tokenizer.Tokenize(content, lang);
        return result.Tokens.Where(t => t.IsWord).Select(t => t.Text).ToArray();
    }

    private static string[] LookupKeysOf(string content, Language lang)
    {
        return Tokenizer.ExtractLookupKeys(content, lang).ToArray();
    }

    // ---- Substitution parsing ----------------------------------------

    [Fact]
    public void ParseSubstitutions_HandlesEqualsInReplacement()
    {
        var subs = Tokenizer.ParseCharacterSubstitutions("a=b=c");
        Assert.Single(subs);
        Assert.Equal(("a", "b=c"), subs[0]);
    }

    [Fact]
    public void ParseSubstitutions_RejectsEmptyOrMalformed()
    {
        var subs = Tokenizer.ParseCharacterSubstitutions("garbage|=foo|x=y");
        Assert.Single(subs);
        Assert.Equal(("x", "y"), subs[0]);
    }

    [Fact]
    public void ParseSubstitutions_NullEmpty()
    {
        Assert.Empty(Tokenizer.ParseCharacterSubstitutions(null));
        Assert.Empty(Tokenizer.ParseCharacterSubstitutions(""));
    }

    [Fact]
    public void ApplySubstitutions_NormalizesCurlyApostrophes()
    {
        var subs = Tokenizer.ParseCharacterSubstitutions("’='|‘='");
        Assert.Equal("l'eau", Tokenizer.ApplyCharacterSubstitutions("l’eau", subs));
        Assert.Equal("'hi'", Tokenizer.ApplyCharacterSubstitutions("‘hi’", subs));
    }

    // ---- French elisions stay glued ----------------------------------

    [Theory]
    [InlineData("l'eau coule", new[] { "l'eau", "coule" })]
    [InlineData("qu'il vienne", new[] { "qu'il", "vienne" })]
    [InlineData("l’eau coule", new[] { "l'eau", "coule" })] // curly normalized
    [InlineData("c'est-à-dire", new[] { "c'est-à-dire" })]
    [InlineData("M. Dupont arriva.", new[] { "M", "Dupont", "arriva" })]
    public void Tokenize_French(string input, string[] expected)
    {
        Assert.Equal(expected, WordsOf(input, Fr));
    }

    // ---- Italian -----------------------------------------------------

    [Theory]
    [InlineData("dell'acqua fresca", new[] { "dell'acqua", "fresca" })]
    [InlineData("un'altra volta", new[] { "un'altra", "volta" })]
    public void Tokenize_Italian(string input, string[] expected)
    {
        Assert.Equal(expected, WordsOf(input, It));
    }

    // ---- Portuguese clitics -----------------------------------------

    [Theory]
    [InlineData("interrompo-a agora", new[] { "interrompo-a", "agora" })]
    [InlineData("beijá-lo gentilmente", new[] { "beijá-lo", "gentilmente" })]
    [InlineData("dá-me um café", new[] { "dá-me", "um", "café" })]
    public void Tokenize_Portuguese(string input, string[] expected)
    {
        Assert.Equal(expected, WordsOf(input, Pt));
    }

    // ---- English -----------------------------------------------------

    [Theory]
    [InlineData("don't worry", new[] { "don't", "worry" })]
    [InlineData("well-known", new[] { "well-known" })]
    [InlineData("'hello'", new[] { "hello" })]
    [InlineData("a -- b", new[] { "a", "b" })]
    [InlineData("the dogs' tails", new[] { "the", "dogs", "tails" })]
    public void Tokenize_English(string input, string[] expected)
    {
        Assert.Equal(expected, WordsOf(input, En));
    }

    // ---- German ------------------------------------------------------

    [Fact]
    public void Tokenize_German_PreservesUmlautsAndEszett()
    {
        Assert.Equal(new[] { "Schöne", "Grüße" }, WordsOf("Schöne Grüße", De));
    }

    // ---- Russian (apostrophe & hyphen are core chars in seed) -------

    [Fact]
    public void Tokenize_Russian_BasicSplit()
    {
        Assert.Equal(new[] { "Привет", "мир" }, WordsOf("Привет мир", Ru));
    }

    [Fact]
    public void Tokenize_Russian_InterLetterHyphenStillGlues()
    {
        Assert.Equal(new[] { "кое-что" }, WordsOf("кое-что", Ru));
    }

    // ---- Null / empty / fallback ------------------------------------

    [Fact]
    public void Tokenize_NullLanguage_FallsBackToUnicodeLetters()
    {
        Assert.Equal(new[] { "l'eau", "coule" }, WordsOf("l'eau coule", null!));
        Assert.Equal(new[] { "interrompo-a", "agora" }, WordsOf("interrompo-a agora", null!));
    }

    [Fact]
    public void Tokenize_EmptyContent_ReturnsEmpty()
    {
        Assert.Empty(WordsOf(string.Empty, En));
    }

    // ---- ExtractLookupKeys: locale-aware lowercase ------------------

    [Fact]
    public void ExtractLookupKeys_LowercasesViaLocale()
    {
        Assert.Equal(
            new[] { "qu'il", "vienne" },
            LookupKeysOf("Qu'il VIENNE", Fr));
    }

    [Fact]
    public void ExtractLookupKeys_GluedFormsBecomeSingleKey()
    {
        Assert.Contains("interrompo-a", LookupKeysOf("Interrompo-a agora", Pt));
        Assert.DoesNotContain("interrompo", LookupKeysOf("Interrompo-a agora", Pt));
    }

    [Fact]
    public void ExtractLookupKeys_PortugueseDoesNotSplitOnHyphen()
    {
        // Regression: the old separator-array tokenizer split "interrompo-a"
        // into ["interrompo", "a"], which diverged from the reader and
        // broke known-word linking on PT clitics.
        var keys = LookupKeysOf("Beijá-lo dá-me", Pt);
        Assert.Contains("beijá-lo", keys);
        Assert.Contains("dá-me", keys);
        Assert.DoesNotContain("beijá", keys);
        Assert.DoesNotContain("lo", keys);
    }

    // ---- Token start/end indices ------------------------------------

    [Fact]
    public void Tokenize_IndicesReferenceProcessedText()
    {
        var result = Tokenizer.Tokenize("l’eau", Fr);
        Assert.Equal("l'eau", result.Processed);
        var word = result.Tokens.Single(t => t.IsWord);
        Assert.Equal("l'eau", word.Text);
        Assert.Equal("l'eau", result.Processed.Substring(word.Start, word.End - word.Start));
    }

    // ---- Built-in apostrophe normalization (no user subs) -----------

    [Fact]
    public void BuiltInNormalization_CurlyApostropheGluesWithoutUserSubs()
    {
        // Custom language with empty CharacterSubstitutions still gets
        // glue for elisions because the tokenizer applies built-in
        // apostrophe normalizations first.
        var fresh = new Language
        {
            Code = "fr",
            Name = "fr",
            WordCharacters = "a-zA-Zà-ÿ",
            CharacterSubstitutions = "",
            SplitSentences = ".!?",
            ParserType = "spacedel"
        };
        var result = Tokenizer.Tokenize("l’eau coule", fresh);
        var words = result.Tokens.Where(t => t.IsWord).Select(t => t.Text).ToArray();
        Assert.Equal(new[] { "l'eau", "coule" }, words);
    }

    [Fact]
    public void BuiltInNormalization_ModifierApostropheGluesWithoutUserSubs()
    {
        var fresh = new Language
        {
            Code = "fr",
            Name = "fr",
            WordCharacters = "a-zA-Zà-ÿ",
            CharacterSubstitutions = null,
            SplitSentences = ".!?",
            ParserType = "spacedel"
        };
        var result = Tokenizer.Tokenize("quʼil vienne", fresh);
        var words = result.Tokens.Where(t => t.IsWord).Select(t => t.Text).ToArray();
        Assert.Equal(new[] { "qu'il", "vienne" }, words);
    }
}
