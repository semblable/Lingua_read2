using System.Text;
using System.Text.Json;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Xunit;

namespace LinguaReadApi.Tests;

public class KoreanLookupTests
{
    private static readonly Language Korean = new()
    {
        Name = "Korean", Code = "ko", ParserType = "spacedel",
        WordCharacters = Language.DefaultWordCharacters, CharacterSubstitutions = ""
    };

    private static JsonDocument Cases()
    {
        // Keep this one fixture shared without adding a package/project dependency.
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory != null; directory = directory.Parent)
        {
            var path = Path.Combine(directory.FullName, "verification", "language-support", "korean-cases.json");
            if (File.Exists(path)) return JsonDocument.Parse(File.ReadAllText(path));
        }
        throw new FileNotFoundException("Cannot locate verification/language-support/korean-cases.json.");
    }

    [Fact]
    public void SharedCanonicalCases_ComposeOnlyModernConjoiningJamo()
    {
        using var cases = Cases();
        foreach (var item in cases.RootElement.GetProperty("canonical").EnumerateArray())
        {
            var source = item.GetProperty("source").GetString()!;
            var expected = item.GetProperty("key").GetString()!;
            Assert.Equal(expected, KoreanLookup.ComposeHangul(source));
            Assert.Equal(expected, KoreanLookup.ComposeHangul(expected));
        }
    }

    [Fact]
    public void AllModernSyllables_ComposeCanonicalJamoAndLvPlusFinal()
    {
        for (var code = 0xac00; code <= 0xd7a3; code++)
        {
            var syllable = ((char)code).ToString();
            Assert.Equal(syllable, KoreanLookup.ComposeHangul(syllable.Normalize(NormalizationForm.FormD)));
            var finalOffset = (code - 0xac00) % 28;
            if (finalOffset == 0) continue;
            var partial = new string(new[] { (char)(code - finalOffset), (char)(0x11a7 + finalOffset) });
            Assert.Equal(syllable, KoreanLookup.ComposeHangul(partial));
        }
    }

    [Fact]
    public void SharedSurfaceCases_PreserveDisplayAndUtf16Offsets()
    {
        using var cases = Cases();
        foreach (var item in cases.RootElement.GetProperty("surfaces").EnumerateArray())
        {
            var source = item.GetProperty("text").GetString()!;
            var result = Tokenizer.Tokenize(source, Korean);
            Assert.Equal(source, result.Processed);
            Assert.Equal(source, string.Concat(result.Tokens.Select(token => token.Text)));
            var words = result.Tokens.Where(token => token.IsWord).ToArray();
            var expected = item.GetProperty("words").EnumerateArray().ToArray();
            Assert.Equal(expected.Length, words.Length);
            for (var i = 0; i < words.Length; i++)
            {
                Assert.Equal(expected[i].GetProperty("text").GetString(), words[i].Text);
                Assert.Equal(expected[i].GetProperty("start").GetInt32(), words[i].Start);
                Assert.Equal(expected[i].GetProperty("end").GetInt32(), words[i].End);
                Assert.Equal(expected[i].GetProperty("key").GetString(), KoreanLookup.ComposeHangul(Tokenizer.NormalizeKey(words[i].Text, Korean)));
            }
            foreach (var token in result.Tokens) Assert.Equal(token.Text, source[token.Start..token.End]);
        }
    }

    [Fact]
    public void SharedMatchingCases_ReturnCompleteOriginalSourceSpans()
    {
        using var cases = Cases();
        foreach (var item in cases.RootElement.GetProperty("matches").EnumerateArray())
        {
            var source = item.GetProperty("source").GetString()!;
            var term = item.GetProperty("term").GetString()!;
            var expected = item.GetProperty("spans").EnumerateArray()
                .Select(span => new KoreanLookup.SourceSpan(span.GetProperty("start").GetInt32(), span.GetProperty("end").GetInt32())).ToArray();
            var matches = KoreanLookup.FindMatches(source, term);
            Assert.Equal(expected, matches);
            foreach (var span in matches) Assert.Equal(KoreanLookup.ComposeHangul(term), KoreanLookup.ComposeHangul(source[span.Start..span.End]));
        }
    }

    [Fact]
    public void UniqueLegacyRow_ResolvesBothFormsWithoutChangingIdentity()
    {
        foreach (var term in new[] { "한글", "한글" })
        {
            var row = new Word { WordId = 41, Term = term, Status = 4, Translation = new WordTranslation { WordId = 41, Translation = "saved meaning" } };
            var index = KoreanLookup.CreateIndex(new[] { row }, word => word.Term);
            Assert.Same(row, index.Resolve("한글"));
            Assert.Same(row, index.Resolve("한글"));
            Assert.Equal(term, row.Term);
            Assert.Equal(41, row.WordId);
            Assert.Equal(4, row.Status);
            Assert.Equal("saved meaning", row.Translation.Translation);
        }
    }

    [Fact]
    public void ConflictingRows_PreserveExactMeaningsAndRefuseAmbiguousAlias()
    {
        var composed = new Word { WordId = 41, Term = "각", Status = 5, Translation = new WordTranslation { WordId = 41, Translation = "first" } };
        var decomposed = new Word { WordId = 42, Term = "각", Status = 2, Translation = new WordTranslation { WordId = 42, Translation = "second" } };
        foreach (var rows in new[] { new[] { composed, decomposed }, new[] { decomposed, composed } })
        {
            var index = KoreanLookup.CreateIndex(rows, word => word.Term);
            Assert.Same(composed, index.Resolve("각"));
            Assert.Same(decomposed, index.Resolve("각"));
            Assert.Null(index.Resolve("각"));
            Assert.Equal(2, rows.Length);
        }
        Assert.Equal((41, "각", 5, "first"), (composed.WordId, composed.Term, composed.Status, composed.Translation.Translation));
        Assert.Equal((42, "각", 2, "second"), (decomposed.WordId, decomposed.Term, decomposed.Status, decomposed.Translation.Translation));
    }

    [Fact]
    public void PendingRows_IncrementallyResolveAliasesAndRetainLaterConflicts()
    {
        var composed = new Word { WordId = 41, Term = "각", Status = 5 };
        var decomposed = new Word { WordId = 42, Term = "각", Status = 2 };
        var index = KoreanLookup.CreateIndex(Array.Empty<Word>(), word => word.Term);
        index.Add(composed, word => word.Term);
        Assert.Same(composed, index.Resolve("각"));
        index.Add(decomposed, word => word.Term);
        Assert.Same(composed, index.Resolve("각"));
        Assert.Same(decomposed, index.Resolve("각"));
        Assert.Null(index.Resolve("각"));
    }

    [Theory]
    [InlineData("ko", true)]
    [InlineData(" KO-KR ", true)]
    [InlineData("ko_KP", true)]
    [InlineData("kok", false)]
    [InlineData("zh-ko", false)]
    [InlineData(null, false)]
    public void LanguageGate_OnlyAcceptsKorean(string? code, bool expected) =>
        Assert.Equal(expected, KoreanLookup.IsKoreanLanguageCode(code));
}
