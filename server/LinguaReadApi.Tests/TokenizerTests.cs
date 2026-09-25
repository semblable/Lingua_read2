using System.Text.Json;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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

    private static readonly Language En = Lang("en", Language.LatinWordCharacters);
    private static readonly Language Fr = Lang("fr", Language.LatinWordCharacters);
    private static readonly Language Pt = Lang("pt", Language.LatinWordCharacters);

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

    // ---- Input normalization: soft hyphens, decomposed accents ------

    // Spelled by code point: a literal soft hyphen in source is invisible.
    private static readonly string Shy = ((char)0x00AD).ToString();
    private static readonly string Acute = ((char)0x0301).ToString();
    private static readonly string Diaeresis = ((char)0x0308).ToString();

    [Fact]
    public void NormalizeInput_DropsSoftHyphens()
    {
        Assert.Equal("reparava", Tokenizer.NormalizeInput($"repa{Shy}rava"));
        Assert.Equal("contá-las", Tokenizer.NormalizeInput($"contá-{Shy}las"));
        Assert.Equal(string.Empty, Tokenizer.NormalizeInput(Shy + Shy));
    }

    [Fact]
    public void NormalizeInput_ComposesDecomposedAccents()
    {
        Assert.Equal("été", Tokenizer.NormalizeInput($"e{Acute}te{Acute}"));
        Assert.Equal("Grüße", Tokenizer.NormalizeInput($"Gru{Diaeresis}ße"));
    }

    [Fact]
    public void NormalizeInput_KeepsMarkWithNoPrecomposedForm()
    {
        Assert.Equal($"n{Diaeresis}", Tokenizer.NormalizeInput($"n{Diaeresis}"));
    }

    [Fact]
    public void NormalizeInput_LeavesTextOutsideBaseMarkRunsUntouched()
    {
        // Blanket NFC would turn the Angstrom sign into Å and a CJK compatibility
        // ideograph into its unified form; only runs with combining marks change.
        var angstrom = ((char)0x212B).ToString();
        var cjkCompat = ((char)0xF900).ToString();
        Assert.Equal(angstrom, Tokenizer.NormalizeInput(angstrom));
        Assert.Equal($"{cjkCompat} é", Tokenizer.NormalizeInput($"{cjkCompat} e{Acute}"));
    }

    [Fact]
    public void NormalizeInput_SurrogatesNeverThrow()
    {
        // A mark after an astral base (a surrogate pair) must see the whole pair,
        // and a mark after an unpaired surrogate (malformed text) is left alone
        // instead of making string.Normalize throw.
        var astral = char.ConvertFromUtf32(0x1D49C); // 𝒜
        Assert.Equal(astral + Acute, Tokenizer.NormalizeInput(astral + Acute));
        var lone = ((char)0xD800).ToString();
        Assert.Equal($"{lone}{Acute} é", Tokenizer.NormalizeInput($"{lone}{Acute} e{Acute}"));
    }

    [Fact]
    public void Tokenize_IndicesReferenceNormalizedText()
    {
        var result = Tokenizer.Tokenize($"o repa{Shy}rava", Pt);
        Assert.Equal("o reparava", result.Processed);
        var word = result.Tokens.Where(t => t.IsWord).ElementAt(1);
        Assert.Equal(("reparava", 2, 10), (word.Text, word.Start, word.End));
    }

    [Fact]
    public void ExtractLookupKeys_SoftHyphenatedWordIsOneKey()
    {
        Assert.Equal(new[] { "quis", "contá-las" }, LookupKeysOf($"Quis contá-{Shy}las", Pt));
    }

    [Fact]
    public void NormalizeKey_MatchesTokenizerNormalization()
    {
        // Terms that reach the server without going through Tokenize (reader
        // saves, CSV import, stored rows) must key like the tokens the reader shows.
        Assert.Equal("verantwortung", Tokenizer.NormalizeKey($"Verant{Shy}wortung", De));
        Assert.Equal("été", Tokenizer.NormalizeKey($"E{Acute}TE{Acute}", Fr));
        Assert.Equal("l'eau", Tokenizer.NormalizeKey(" L’Eau ", Fr));
        Assert.Equal("peut-être", Tokenizer.NormalizeKey($"peut{(char)0x2011}être", Fr));
    }

    [Fact]
    public void NormalizeKey_AppliesTheLanguageSubstitutions()
    {
        // The Latin seeds map ´ and ` to an apostrophe, so the reader shows "d'África";
        // a CSV row or a stored term spelled with ´ must key the same way.
        Assert.Equal("d'áfrica", Tokenizer.NormalizeKey("d´África", Pt));
        Assert.Equal(LookupKeysOf("terras d´África", Pt)[1], Tokenizer.NormalizeKey("d´África", Pt));
    }

    [Fact]
    public void NormalizeText_IsTheTextTheTokenizerWalks()
    {
        var input = $"Il boit l’eau... e{Acute}te{Acute} repa{Shy}rava";
        Assert.Equal("Il boit l'eau… été reparava", Tokenizer.NormalizeText(input, Fr));
        Assert.Equal(Tokenizer.Tokenize(input, Fr).Processed, Tokenizer.NormalizeText(input, Fr));
        Assert.Equal(string.Empty, Tokenizer.NormalizeText(null, Fr));
    }

    [Fact]
    public void NormalizeInput_MapsGreekOxiaLettersToTonos()
    {
        // Omicron with oxia (U+1F79) and with tonos (U+03CC) look the same; ebooks
        // carry both, keyboards type the tonos one.
        var oxia = $"κ{(char)0x1F79}σμος";
        var tonos = $"κ{(char)0x03CC}σμος";
        Assert.Equal(tonos, Tokenizer.NormalizeInput(oxia));
        Assert.Equal(Tokenizer.NormalizeKey(tonos, El), Tokenizer.NormalizeKey(oxia, El));
        // Greek already in NFC is left as it is.
        Assert.Equal(tonos, Tokenizer.NormalizeInput(tonos));
    }

    // ---- Word-character classes ---------------------------------------

    private static readonly Language De = Lang("de", Language.LatinWordCharacters + @"\" + "u200C" + @"\" + "u200D");
    private static readonly Language El = Lang("el", Language.DefaultWordCharacters, subs: "");

    [Fact]
    public void EmptyOrInvalidClass_FallsBackToLettersAndMarks()
    {
        // "z-a" is a reversed range, rejected by .NET and JS alike.
        foreach (var wordCharacters in new[] { "", "z-a" })
        {
            var regex = Tokenizer.BuildCoreWordRegex(wordCharacters);
            Assert.Matches(regex, "ж");
            Assert.Matches(regex, Acute);
            Assert.DoesNotMatch(regex, "1");
        }
    }

    [Fact]
    public void LatinClass_CompilesAsWritten_NotTheAnyLetterFallback()
    {
        var regex = Tokenizer.BuildCoreWordRegex(Language.LatinWordCharacters);
        // The \p{L} fallback would accept these; the Latin class must not.
        foreach (var ch in new[] { "ª", "º", "α", "ж", "×", "÷", "·" })
        {
            Assert.DoesNotMatch(regex, ch);
        }
        foreach (var ch in new[] { "ñ", "è", "ò", "ü", "ẞ", "ș", "ł", "ř", "ŵ", "ệ", Acute })
        {
            Assert.Matches(regex, ch);
        }
    }

    [Fact]
    public void DefaultClass_AcceptsAnyLetterAndCombiningMarks()
    {
        var regex = Tokenizer.BuildCoreWordRegex(Language.DefaultWordCharacters);
        foreach (var ch in new[] { "a", "ą", "α", "ж", "ß", Acute })
        {
            Assert.Matches(regex, ch);
        }
        Assert.DoesNotMatch(regex, "1");
        Assert.DoesNotMatch(regex, "·");
    }

    [Fact]
    public void NewLanguage_DefaultsToAnyLetter()
    {
        Assert.Equal(Language.DefaultWordCharacters, new Language().WordCharacters);
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

    [Fact]
    public void LanguageSeeds_MirrorDbInitializer()
    {
        // The golden file claims its seeds mirror what a fresh install stores;
        // run the real seeding and hold it to that.
        var services = new ServiceCollection();
        services.AddSingleton(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);
        using var provider = services.BuildServiceProvider();
        DbInitializer.Initialize(provider);

        using var context = new AppDbContext(provider.GetRequiredService<DbContextOptions<AppDbContext>>());
        var seeded = context.Languages.AsNoTracking().ToDictionary(l => l.Code, l => l.WordCharacters);
        Assert.Equal(new[] { "de", "en", "es", "fr", "it", "pt", "ru" }, seeded.Keys.OrderBy(k => k));
        foreach (var (code, wordCharacters) in seeded)
        {
            Assert.Equal(Golden.Languages[code].WordCharacters, wordCharacters);
        }
    }

    [Fact]
    public void LanguageSeeds_UseTheSharedConstants()
    {
        foreach (var code in new[] { "en", "es", "fr", "it", "pt" })
        {
            Assert.Equal(Language.LatinWordCharacters, Golden.Languages[code].WordCharacters);
        }
        // Russian is seeded with the any-letter default; the rest are form-added languages.
        foreach (var code in new[] { "ru", "pl", "cs", "ca", "ro", "el", "lt", "nl", "hu", "is" })
        {
            Assert.Equal(Language.DefaultWordCharacters, Golden.Languages[code].WordCharacters);
        }

        // German is the Latin class plus zero-width (non-)joiners.
        var german = Golden.Languages["de"].WordCharacters;
        Assert.StartsWith(Language.LatinWordCharacters, german);
        var regex = Tokenizer.BuildCoreWordRegex(german);
        Assert.Matches(regex, ((char)0x200C).ToString());
        Assert.Matches(regex, ((char)0x200D).ToString());
        Assert.DoesNotMatch(regex, "ª");
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
