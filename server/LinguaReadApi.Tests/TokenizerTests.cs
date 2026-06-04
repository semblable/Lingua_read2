using System.Text.Json;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Backend tokenizer tests. Cross-language word-sequence expectations live in
/// the shared <c>tokenizer-golden-vectors.json</c> at the repo root and are
/// exercised by <see cref="GoldenVectorTests"/> below; the frontend
/// (<c>client/lingua-read-client/src/__tests__/tokenizer.spec.js</c>) loads the
/// same file. Both tokenizers MUST produce the same word sequence for every
/// case — drift between BE and FE is exactly the bug this fixture guards.
///
/// The tests in this class cover backend-specific behaviour (substitution
/// parsing, regex construction, locale-aware lookup keys, index mapping,
/// built-in apostrophe normalization) that isn't pure token-sequence data.
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
    private static readonly Language Pt = Lang("pt", "a-zA-ZÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü");

    private static string[] WordsOf(string content, Language? lang)
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

    // ---- Cross-language word-sequence cases --------------------------
    // French/Italian/Portuguese/English/German/Russian elisions, clitics,
    // hyphenated forms, and null-language fallback now live in the shared
    // tokenizer-golden-vectors.json and are asserted by GoldenVectorTests
    // (below) so the BE and FE suites can't drift.

    // ---- Empty ------------------------------------------------------

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

/// <summary>
/// Data-driven cross-language tokenization tests fed by the shared
/// <c>tokenizer-golden-vectors.json</c> at the repo root (copied next to the
/// test assembly via the test .csproj). The frontend
/// <c>tokenizer.spec.js</c> loads the same file, so every case below is
/// asserted identically on both sides — this is the guard against the
/// backend (<see cref="Tokenizer"/>) and frontend (<c>readerText.ts</c>)
/// tokenizers drifting apart.
/// </summary>
public class GoldenVectorTests
{
    private const string NullLang = "(null)";

    private sealed record LangSeed(string Code, string WordCharacters, string? CharacterSubstitutions);
    private sealed record GoldenCase(string? Lang, string Input, string[] ExpectedWords);
    private sealed record GoldenFile(Dictionary<string, LangSeed> Languages, List<GoldenCase> Cases);

    private static readonly GoldenFile Golden = LoadGolden();

    private static GoldenFile LoadGolden()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "tokenizer-golden-vectors.json");
        var json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<GoldenFile>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("tokenizer-golden-vectors.json deserialized to null");
    }

    private static Language? LanguageFor(string lang)
    {
        if (lang == NullLang) return null;
        var seed = Golden.Languages[lang];
        return new Language
        {
            Code = seed.Code,
            Name = seed.Code,
            WordCharacters = seed.WordCharacters,
            CharacterSubstitutions = seed.CharacterSubstitutions,
            SplitSentences = ".!?",
            ParserType = "spacedel"
        };
    }

    public static IEnumerable<object[]> Cases()
    {
        foreach (var c in Golden.Cases)
        {
            yield return new object[] { c.Lang ?? NullLang, c.Input, c.ExpectedWords };
        }
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Tokenize_MatchesGoldenVector(string lang, string input, string[] expectedWords)
    {
        var language = LanguageFor(lang);
        var words = Tokenizer.Tokenize(input, language).Tokens
            .Where(t => t.IsWord)
            .Select(t => t.Text)
            .ToArray();
        Assert.Equal(expectedWords, words);
    }
}
