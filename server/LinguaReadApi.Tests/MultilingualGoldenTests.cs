using System.Text.Json;
using System.Text;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Xunit;

namespace LinguaReadApi.Tests;

public class MultilingualGoldenTests
{
    private static readonly JsonElement Suite = JsonDocument.Parse(File.ReadAllText(Path.Combine(
        AppContext.BaseDirectory, "multilingual_tokenizer_and_lemmatizer_test_suite_v4.json"))).RootElement.Clone();

    public static IEnumerable<object[]> Cases => Suite.GetProperty("cases").EnumerateArray()
        .Select(fixture => new object[] { fixture.GetProperty("id").GetString()!, fixture.Clone() });
    public static IEnumerable<object[]> NormalizationCases => Suite.GetProperty("normalization_cases").EnumerateArray()
        .Select(fixture => new object[] { fixture.GetProperty("id").GetString()!, fixture.Clone() });
    public static IEnumerable<object[]> LookupCases => Suite.GetProperty("lookup_cases").EnumerateArray()
        .Select(fixture => new object[] { fixture.GetProperty("id").GetString()!, fixture.Clone() });
    public static IEnumerable<object[]> KoreanCandidateCases => Suite.GetProperty("korean_candidate_cases").EnumerateArray()
        .Select(fixture => new object[] { fixture.GetProperty("id").GetString()!, fixture.Clone() });
    public static IEnumerable<object[]> KoreanRankingCases => Suite.GetProperty("korean_ranking_cases").EnumerateArray()
        .Select(fixture => new object[] { fixture.GetProperty("id").GetString()!, fixture.Clone() });

    [Fact]
    public void CorpusPreservesAndExecutesEveryReferenceCase()
    {
        var languages = Suite.GetProperty("reference_suite").GetProperty("languages").EnumerateArray().ToArray();
        Assert.Equal(44, languages.Length);
        var referenceIds = languages.SelectMany(language => language.GetProperty("tests").EnumerateArray())
            .Select(fixture => fixture.GetProperty("id").GetString()!).ToArray();
        Assert.Equal(89, referenceIds.Length);
        var runtimeIds = Suite.GetProperty("cases").EnumerateArray()
            .Select(fixture => fixture.GetProperty("id").GetString()!).ToArray();
        Assert.Equal(runtimeIds.Length, runtimeIds.Distinct(StringComparer.Ordinal).Count());
        Assert.All(referenceIds, id => Assert.Contains(id, runtimeIds));
        var summary = Suite.GetProperty("reference_gap_summary");
        Assert.Equal(runtimeIds.Length, summary.GetProperty("runtime_cases").GetInt32());
        var spanDiffs = Suite.GetProperty("cases").EnumerateArray().Count(fixture =>
            fixture.GetProperty("provenance").TryGetProperty("differences", out var diffs)
            && diffs.EnumerateArray().Any(d => d.GetString() == "runtime_token_spans_or_keys"));
        var semanticDiffs = Suite.GetProperty("cases").EnumerateArray().Count(fixture =>
            fixture.GetProperty("provenance").TryGetProperty("differences", out var diffs)
            && diffs.EnumerateArray().Any(d => d.GetString() == "reference_semantic_lemmas"));
        Assert.Equal(11, spanDiffs);
        Assert.Equal(spanDiffs, summary.GetProperty("cases_with_runtime_span_or_key_differences").GetInt32());
        Assert.Equal(86, semanticDiffs);
        Assert.Equal(semanticDiffs, summary.GetProperty("cases_with_reference_semantic_lemmas").GetInt32());
    }

    [Fact]
    public void CorpusIsUtf8WithoutBomWithLfNewlines()
    {
        var bytes = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory,
            "multilingual_tokenizer_and_lemmatizer_test_suite_v4.json"));
        Assert.False(bytes.AsSpan().StartsWith(new byte[] { 0xef, 0xbb, 0xbf }));
        Assert.DoesNotContain((byte)'\r', bytes);
        _ = new UTF8Encoding(false, true).GetString(bytes);
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void SharedRuntimeContract(string id, JsonElement fixture)
    {
        Assert.Equal("UTF-16 code units", Suite.GetProperty("offset_unit").GetString());
        var config = fixture.GetProperty("language");
        var language = new Language
        {
            Code = config.GetProperty("code").GetString()!, Name = id,
            WordCharacters = config.GetProperty("wordCharacters").GetString()!,
            CharacterSubstitutions = config.GetProperty("characterSubstitutions").GetString(),
            ParserType = config.GetProperty("parserType").GetString()!
        };
        var actual = Tokenizer.Tokenize(fixture.GetProperty("input").GetString(), language);
        var sentence = fixture.GetProperty("sentence").GetString()!;
        Assert.Equal(sentence, actual.Processed);
        var words = actual.Tokens.Where(token => token.IsWord).ToArray();
        var expected = fixture.GetProperty("tokens").EnumerateArray().ToArray();
        Assert.Equal(expected.Length, words.Length);
        for (var index = 0; index < words.Length; index++)
        {
            var token = words[index];
            Assert.Equal(expected[index].GetProperty("surface_span").GetString(), token.Text);
            Assert.Equal(expected[index].GetProperty("start").GetInt32(), token.Start);
            Assert.Equal(expected[index].GetProperty("end").GetInt32(), token.End);
            Assert.Equal(expected[index].GetProperty("lookup_key").GetString(), Tokenizer.NormalizeKey(token.Text, language));
        }
        foreach (var token in actual.Tokens)
            Assert.Equal(token.Text, sentence[token.Start..token.End]);
    }

    [Theory]
    [MemberData(nameof(NormalizationCases))]
    public void SharedNormalizationContract(string id, JsonElement fixture)
    {
        var language = new Language { Name = id, Code = fixture.GetProperty("lang").GetString()! };
        Assert.Equal(fixture.GetProperty("expected").GetString(),
            Tokenizer.NormalizeKey(fixture.GetProperty("term").GetString()!, language));
    }

    [Theory]
    [MemberData(nameof(LookupCases))]
    public void SharedLookupContract(string id, JsonElement fixture)
    {
        var language = new Language { Name = id, Code = fixture.GetProperty("lang").GetString()! };
        var vocabulary = fixture.GetProperty("vocabulary").EnumerateArray().Select(value => value.GetString()!).ToArray();
        var term = fixture.GetProperty("term").GetString()!;
        Assert.Equal(fixture.GetProperty("expected").GetString(), Tokenizer.ResolveLookupKey(term, language, vocabulary));
        Assert.Equal(fixture.GetProperty("expected").GetString(), Tokenizer.ResolveLookupKey(term, language, vocabulary.Reverse()));
    }

    [Theory]
    [MemberData(nameof(KoreanCandidateCases))]
    public void SharedKoreanCandidates(string id, JsonElement fixture)
    {
        var expected = fixture.GetProperty("expected_lemmas").EnumerateArray().Select(value => value.GetString()!).ToArray();
        var actual = KoreanLookup.AnalyzeKoreanCandidates(fixture.GetProperty("surface").GetString()!)
            .Select(candidate => candidate.Lemma).ToArray();
        Assert.True(expected.SequenceEqual(actual, StringComparer.Ordinal),
            $"{id}: expected lemma order [{string.Join(", ", expected)}]; got [{string.Join(", ", actual)}].");
    }

    [Theory]
    [MemberData(nameof(KoreanRankingCases))]
    public void SharedKoreanRanking(string id, JsonElement fixture)
    {
        var lemmas = fixture.GetProperty("lemmas").EnumerateArray().Select(value => value.GetString()!).ToArray();
        var headwords = fixture.GetProperty("headwords").EnumerateArray().Select(value => value.GetString()!).ToHashSet(StringComparer.Ordinal);
        var frequencies = fixture.GetProperty("frequencies").EnumerateObject().ToDictionary(value => value.Name, value => value.Value.GetInt32(), StringComparer.Ordinal);
        var expected = fixture.GetProperty("expected_lemmas").EnumerateArray().Select(value => value.GetString()!).ToArray();
        foreach (var order in new[] { lemmas, lemmas.Reverse().ToArray() })
        {
            var actual = KoreanLookup.RankKoreanCandidates(order.Select(lemma => new KoreanLookup.KoreanTokenAnalysis(lemma, "", "")), headwords, frequencies);
            var actualLemmas = actual.Select(candidate => candidate.Lemma).ToArray();
            Assert.True(expected.SequenceEqual(actualLemmas, StringComparer.Ordinal),
                $"{id}: expected lemma order [{string.Join(", ", expected)}]; got [{string.Join(", ", actualLemmas)}] for input [{string.Join(", ", order)}].");
            Assert.All(actual, candidate =>
            {
                Assert.Equal(fixture.GetProperty("expected_validated").GetBoolean(), candidate.DictionaryValidated);
                Assert.Equal(fixture.GetProperty("expected_rank").GetInt32(), candidate.Rank);
            });
        }
    }
}
