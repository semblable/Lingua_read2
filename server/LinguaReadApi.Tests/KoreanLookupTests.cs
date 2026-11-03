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

    [Fact]
    public void Batchim_Calculation_And_Check()
    {
        Assert.True(KoreanLookup.HasBatchim('책'));
        Assert.Equal(1, KoreanLookup.GetBatchim('책')); // ㄱ
        Assert.False(KoreanLookup.HasBatchim('가'));
        Assert.Equal(0, KoreanLookup.GetBatchim('가'));
        Assert.True(KoreanLookup.HasBatchim('물'));
        Assert.Equal(8, KoreanLookup.GetBatchim('물')); // ㄹ
        Assert.False(KoreanLookup.HasBatchim('A'));
        Assert.Equal(0, KoreanLookup.GetBatchim('A'));
    }

    [Fact]
    public void Case_ko01_DecomposesJosa_AndLeavesVerbsIntact()
    {
        var teacher = KoreanLookup.AnalyzeKoreanToken("선생님께서");
        Assert.NotNull(teacher);
        Assert.Equal("선생님", teacher.Lemma);
        Assert.Equal("께서", teacher.Particle);
        Assert.Equal("Honorific Subject Marker", teacher.ParticleType);

        var students = KoreanLookup.AnalyzeKoreanToken("학생들에게");
        Assert.NotNull(students);
        Assert.Equal("학생", students.Lemma);
        Assert.Equal("들에게", students.Particle);
        Assert.Equal("Plural + Dative Marker", students.ParticleType);

        var book = KoreanLookup.AnalyzeKoreanToken("책을");
        Assert.NotNull(book);
        Assert.Equal("책", book.Lemma);
        Assert.Equal("을", book.Particle);
        Assert.Equal("Object Marker", book.ParticleType);

        Assert.Null(KoreanLookup.AnalyzeKoreanToken("주셨습니다"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("한국어"));
    }

    [Fact]
    public void Case_ko02_DecomposesMarkers_AndCopula()
    {
        var bookSubj = KoreanLookup.AnalyzeKoreanToken("책이");
        Assert.NotNull(bookSubj);
        Assert.Equal(("책", "이", "Subject Marker"), (bookSubj.Lemma, bookSubj.Particle, bookSubj.ParticleType));

        var bookTopic = KoreanLookup.AnalyzeKoreanToken("책은");
        Assert.NotNull(bookTopic);
        Assert.Equal(("책", "은", "Topic Marker"), (bookTopic.Lemma, bookTopic.Particle, bookTopic.ParticleType));

        var bookAdd = KoreanLookup.AnalyzeKoreanToken("책도");
        Assert.NotNull(bookAdd);
        Assert.Equal(("책", "도", "Additive Marker"), (bookAdd.Lemma, bookAdd.Particle, bookAdd.ParticleType));

        var oldTextCopula = KoreanLookup.AnalyzeKoreanToken("옛글이다");
        Assert.NotNull(oldTextCopula);
        Assert.Equal(("옛글", "이다", "Copula"), (oldTextCopula.Lemma, oldTextCopula.Particle, oldTextCopula.ParticleType));

        Assert.Null(KoreanLookup.AnalyzeKoreanToken("값비싼"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("다"));
    }

    [Fact]
    public void StrictBatchimGating_EnforcesPhonotactics()
    {
        // -을 vs -를
        Assert.Equal("책", KoreanLookup.AnalyzeKoreanToken("책을")?.Lemma);
        Assert.Equal("사과", KoreanLookup.AnalyzeKoreanToken("사과를")?.Lemma);
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("책를"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("사과을"));

        // -이 vs -가
        Assert.Equal("책", KoreanLookup.AnalyzeKoreanToken("책이")?.Lemma);
        Assert.Equal("사과", KoreanLookup.AnalyzeKoreanToken("사과가")?.Lemma);
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("책가"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("사과이"));

        // -은 vs -는
        Assert.Equal("책", KoreanLookup.AnalyzeKoreanToken("책은")?.Lemma);
        Assert.Equal("사과", KoreanLookup.AnalyzeKoreanToken("사과는")?.Lemma);
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("책는"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("사과은"));

        // -과 vs -와
        Assert.Equal("책", KoreanLookup.AnalyzeKoreanToken("책과")?.Lemma);
        Assert.Equal("사과", KoreanLookup.AnalyzeKoreanToken("사과와")?.Lemma);
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("책와"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("사과과"));

        // -으로 vs -로
        Assert.Equal(("책", "으로"), (KoreanLookup.AnalyzeKoreanToken("책으로")?.Lemma, KoreanLookup.AnalyzeKoreanToken("책으로")?.Particle));
        Assert.Equal(("손", "으로"), (KoreanLookup.AnalyzeKoreanToken("손으로")?.Lemma, KoreanLookup.AnalyzeKoreanToken("손으로")?.Particle));
        Assert.Equal(("물", "로"), (KoreanLookup.AnalyzeKoreanToken("물로")?.Lemma, KoreanLookup.AnalyzeKoreanToken("물로")?.Particle));
        Assert.Equal(("사과", "로"), (KoreanLookup.AnalyzeKoreanToken("사과로")?.Lemma, KoreanLookup.AnalyzeKoreanToken("사과로")?.Particle));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("책로"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("물으로"));

        // -이에요 vs -예요
        Assert.Equal(("책", "이에요"), (KoreanLookup.AnalyzeKoreanToken("책이에요")?.Lemma, KoreanLookup.AnalyzeKoreanToken("책이에요")?.Particle));
        Assert.Equal(("사과", "예요"), (KoreanLookup.AnalyzeKoreanToken("사과예요")?.Lemma, KoreanLookup.AnalyzeKoreanToken("사과예요")?.Particle));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("책예요"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("사과이에요"));
    }

    [Fact]
    public void OneSyllableWhitelist_AllowsKnownNouns_AndProtectsFalsePositives()
    {
        foreach (var noun in new[] { "책", "집", "밥", "물", "눈", "손", "발", "꽃", "돈", "방", "문", "산", "강", "달", "별", "해", "돌", "새" })
        {
            var res = KoreanLookup.AnalyzeKoreanToken($"{noun}도");
            Assert.NotNull(res);
            Assert.Equal(noun, res.Lemma);
            Assert.Equal("도", res.Particle);
        }

        Assert.Null(KoreanLookup.AnalyzeKoreanToken("오이"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("포도"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("사자"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("지도"));
    }

    [Fact]
    public void ThreePlusSyllableGuards_ProtectBoundSuffixesAndLoanwords()
    {
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("고속도로"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("민주주의"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("선거제도"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("한반도"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("바나나"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("코로나"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("정치가"));
        Assert.Null(KoreanLookup.AnalyzeKoreanToken("만화가"));

        var highway = KoreanLookup.AnalyzeKoreanToken("고속도로로");
        Assert.NotNull(highway);
        Assert.Equal(("고속도로", "로", "Instrumental Marker"), (highway.Lemma, highway.Particle, highway.ParticleType));

        var democracy = KoreanLookup.AnalyzeKoreanToken("민주주의를");
        Assert.NotNull(democracy);
        Assert.Equal(("민주주의", "를", "Object Marker"), (democracy.Lemma, democracy.Particle, democracy.ParticleType));

        var politician = KoreanLookup.AnalyzeKoreanToken("정치가가");
        Assert.NotNull(politician);
        Assert.Equal(("정치가", "가", "Subject Marker"), (politician.Lemma, politician.Particle, politician.ParticleType));

        var banana = KoreanLookup.AnalyzeKoreanToken("바나나를");
        Assert.NotNull(banana);
        Assert.Equal(("바나나", "를", "Object Marker"), (banana.Lemma, banana.Particle, banana.ParticleType));
    }

    [Fact]
    public void StackedParticles_DecomposeRightToLeft()
    {
        var school = KoreanLookup.AnalyzeKoreanToken("학교에서는");
        Assert.NotNull(school);
        Assert.Equal(("학교", "에서는", "Locative + Topic Marker"), (school.Lemma, school.Particle, school.ParticleType));

        var teacher = KoreanLookup.AnalyzeKoreanToken("선생님께서는");
        Assert.NotNull(teacher);
        Assert.Equal(("선생님", "께서는", "Honorific Subject + Topic Marker"), (teacher.Lemma, teacher.Particle, teacher.ParticleType));

        var friend = KoreanLookup.AnalyzeKoreanToken("친구에게도");
        Assert.NotNull(friend);
        Assert.Equal(("친구", "에게도", "Dative + Additive Marker"), (friend.Lemma, friend.Particle, friend.ParticleType));

        var studentsCopula = KoreanLookup.AnalyzeKoreanToken("학생들입니다");
        Assert.NotNull(studentsCopula);
        Assert.Equal(("학생", "들입니다", "Plural + Copula"), (studentsCopula.Lemma, studentsCopula.Particle, studentsCopula.ParticleType));

        var studentsPlural = KoreanLookup.AnalyzeKoreanToken("학생들");
        Assert.NotNull(studentsPlural);
        Assert.Equal(("학생", "들", "Plural Marker"), (studentsPlural.Lemma, studentsPlural.Particle, studentsPlural.ParticleType));
    }
}
