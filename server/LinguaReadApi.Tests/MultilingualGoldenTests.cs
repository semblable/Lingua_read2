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
}
