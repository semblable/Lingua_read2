using LinguaReadApi.Services.Tokenization;
using Xunit;

namespace LinguaReadApi.Tests;

public class KoreanCandidateTests
{
    [Fact]
    public void EmbeddedDictionaryMatchesPinnedCanonicalSource()
    {
        using var stream = typeof(KoreanLookup).Assembly.GetManifestResourceStream("LinguaReadApi.KrdictLemmas");
        Assert.NotNull(stream);
        Assert.Equal("0a9969de8b86597f947128ddb72fc7e17e686adc1e064ddb3fbf9ccde802e1e5",
            Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(stream)));
    }
    [Theory]
    [InlineData("길이", "길이", "길")]
    [InlineData("먹이", "먹이", "먹")]
    [InlineData("놀이", "놀이", "놀다")]
    [InlineData("높이", "높이", "높다")]
    [InlineData("산다", "사다", "살다")]
    [InlineData("간다", "가다", "갈다")]
    [InlineData("사는데", "사다", "살다")]
    [InlineData("아는데", "알다")]
    [InlineData("만드는데", "만들다")]
    [InlineData("사네", "사다", "살다")]
    [InlineData("아네", "알다")]
    [InlineData("삽니다", "사다", "살다")]
    [InlineData("사십니까", "사다", "살다")]
    [InlineData("사는", "사다", "살다")]
    [InlineData("아는", "알다")]
    [InlineData("만든", "만들다")]
    [InlineData("산", "산", "사다", "살다")]
    [InlineData("간", "간", "가다", "갈다")]
    [InlineData("살", "살", "사다", "살다")]
    [InlineData("갈", "가다", "갈다")]
    [InlineData("알", "알", "알다")]
    [InlineData("사세요", "사다", "살다")]
    [InlineData("아십니다", "알다")]
    public void RetainsAllValidatedReadings(string surface, params string[] lemmas)
    {
        var actual = KoreanLookup.AnalyzeKoreanCandidates(surface).Select(candidate => candidate.Lemma).ToArray();
        foreach (var lemma in lemmas) Assert.Contains(lemma, actual);
    }

    [Fact]
    public void ValidationIsConditionalAndTiesAreOrdinal()
    {
        KoreanLookup.KoreanTokenAnalysis[] candidates = [new("살다", "", ""), new("사다", "", ""), new("가다", "", "")];
        Assert.Equal(["가다", "사다", "살다"], KoreanLookup.RankKoreanCandidates(candidates, new HashSet<string>()).Select(c => c.Lemma));
        Assert.All(KoreanLookup.RankKoreanCandidates(candidates, new HashSet<string>()), c => Assert.False(c.DictionaryValidated));
        Assert.Equal(["살다"], KoreanLookup.RankKoreanCandidates(candidates, new HashSet<string> { "살다" }).Select(c => c.Lemma));
        Assert.Equal(["살다", "사다", "가다"], KoreanLookup.RankKoreanCandidates(candidates,
            new HashSet<string> { "살다", "사다", "가다" }, new Dictionary<string, int> { ["살다"] = 20, ["사다"] = 10 }).Select(c => c.Lemma));
    }
}
