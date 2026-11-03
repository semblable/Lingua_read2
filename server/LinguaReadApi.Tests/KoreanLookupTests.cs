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

        var given = KoreanLookup.AnalyzeKoreanToken("주셨습니다");
        Assert.NotNull(given);
        Assert.Equal("주다", given.Lemma);
        Assert.Equal("셨습니다", given.Particle);
        Assert.Equal("Honorific Past Polite", given.ParticleType);

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

        var expensive = KoreanLookup.AnalyzeKoreanToken("값비싼");
        Assert.NotNull(expensive);
        Assert.Equal("값비싸다", expensive.Lemma);
        Assert.Equal("ㄴ", expensive.Particle);
        Assert.Equal("Modifier Form", expensive.ParticleType);

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

    [Fact]
    public void VerbDeconjugation_HonorificEndings()
    {
        Assert.Equal(("주다", "셨습니다", "Honorific Past Polite"), 
            (KoreanLookup.AnalyzeKoreanToken("주셨습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("주셨습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("주셨습니다")?.ParticleType));
        Assert.Equal(("하다", "셨습니다", "Honorific Past Polite"),
            (KoreanLookup.AnalyzeKoreanToken("하셨습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("하셨습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("하셨습니다")?.ParticleType));
        Assert.Equal(("가다", "셨습니다", "Honorific Past Polite"),
            (KoreanLookup.AnalyzeKoreanToken("가셨습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가셨습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("가셨습니다")?.ParticleType));
        Assert.Equal(("보다", "셨습니다", "Honorific Past Polite"),
            (KoreanLookup.AnalyzeKoreanToken("보셨습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("보셨습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("보셨습니다")?.ParticleType));
        Assert.Equal(("하다", "시었습니다", "Honorific Past Polite"),
            (KoreanLookup.AnalyzeKoreanToken("하시었습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("하시었습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("하시었습니다")?.ParticleType));
        Assert.Equal(("주다", "셨어요", "Honorific Past Polite"),
            (KoreanLookup.AnalyzeKoreanToken("주셨어요")?.Lemma, KoreanLookup.AnalyzeKoreanToken("주셨어요")?.Particle, KoreanLookup.AnalyzeKoreanToken("주셨어요")?.ParticleType));
        Assert.Equal(("가다", "세요", "Honorific Polite"),
            (KoreanLookup.AnalyzeKoreanToken("가세요")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가세요")?.Particle, KoreanLookup.AnalyzeKoreanToken("가세요")?.ParticleType));
        Assert.Equal(("주다", "세요", "Honorific Polite"),
            (KoreanLookup.AnalyzeKoreanToken("주세요")?.Lemma, KoreanLookup.AnalyzeKoreanToken("주세요")?.Particle, KoreanLookup.AnalyzeKoreanToken("주세요")?.ParticleType));
        Assert.Equal(("먹다", "으세요", "Honorific Polite"),
            (KoreanLookup.AnalyzeKoreanToken("먹으세요")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹으세요")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹으세요")?.ParticleType));
        Assert.Equal(("가다", "셔요", "Honorific Polite"),
            (KoreanLookup.AnalyzeKoreanToken("가셔요")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가셔요")?.Particle, KoreanLookup.AnalyzeKoreanToken("가셔요")?.ParticleType));
        Assert.Equal(("가다", "시지요", "Honorific Polite"),
            (KoreanLookup.AnalyzeKoreanToken("가시지요")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가시지요")?.Particle, KoreanLookup.AnalyzeKoreanToken("가시지요")?.ParticleType));
        Assert.Equal(("가다", "시죠", "Honorific Polite"),
            (KoreanLookup.AnalyzeKoreanToken("가시죠")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가시죠")?.Particle, KoreanLookup.AnalyzeKoreanToken("가시죠")?.ParticleType));
        Assert.Equal(("가다", "시어", "Honorific"),
            (KoreanLookup.AnalyzeKoreanToken("가시어")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가시어")?.Particle, KoreanLookup.AnalyzeKoreanToken("가시어")?.ParticleType));
    }

    [Fact]
    public void VerbDeconjugation_FormalPoliteEndings()
    {
        Assert.Equal(("먹다", "습니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("먹습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹습니다")?.ParticleType));
        Assert.Equal(("있다", "습니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("있습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("있습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("있습니다")?.ParticleType));
        Assert.Equal(("없다", "습니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("없습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("없습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("없습니다")?.ParticleType));
        Assert.Equal(("좋다", "습니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("좋습니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("좋습니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("좋습니다")?.ParticleType));

        Assert.Equal(("가다", "ㅂ니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("갑니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("갑니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("갑니다")?.ParticleType));
        Assert.Equal(("보다", "ㅂ니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("봅니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("봅니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("봅니다")?.ParticleType));
        Assert.Equal(("하다", "ㅂ니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("합니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("합니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("합니다")?.ParticleType));
        Assert.Equal(("주다", "ㅂ니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("줍니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("줍니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("줍니다")?.ParticleType));
        Assert.Equal(("값비싸다", "ㅂ니다", "Formal Polite"),
            (KoreanLookup.AnalyzeKoreanToken("값비쌉니다")?.Lemma, KoreanLookup.AnalyzeKoreanToken("값비쌉니다")?.Particle, KoreanLookup.AnalyzeKoreanToken("값비쌉니다")?.ParticleType));

        Assert.Equal(("먹다", "습니까", "Formal Polite Question"),
            (KoreanLookup.AnalyzeKoreanToken("먹습니까")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹습니까")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹습니까")?.ParticleType));
        Assert.Equal(("가다", "ㅂ니까", "Formal Polite Question"),
            (KoreanLookup.AnalyzeKoreanToken("갑니까")?.Lemma, KoreanLookup.AnalyzeKoreanToken("갑니까")?.Particle, KoreanLookup.AnalyzeKoreanToken("갑니까")?.ParticleType));
        Assert.Equal(("하다", "ㅂ니까", "Formal Polite Question"),
            (KoreanLookup.AnalyzeKoreanToken("합니까")?.Lemma, KoreanLookup.AnalyzeKoreanToken("합니까")?.Particle, KoreanLookup.AnalyzeKoreanToken("합니까")?.ParticleType));
    }

    [Fact]
    public void VerbDeconjugation_PastTenseAndContractions()
    {
        Assert.Equal("가다", KoreanLookup.AnalyzeKoreanToken("갔어요")?.Lemma);
        Assert.Equal("가다", KoreanLookup.AnalyzeKoreanToken("갔습니다")?.Lemma);
        Assert.Equal("오다", KoreanLookup.AnalyzeKoreanToken("왔어요")?.Lemma);
        Assert.Equal("오다", KoreanLookup.AnalyzeKoreanToken("왔습니다")?.Lemma);
        Assert.Equal("보다", KoreanLookup.AnalyzeKoreanToken("봤어요")?.Lemma);
        Assert.Equal("보다", KoreanLookup.AnalyzeKoreanToken("봤습니다")?.Lemma);
        Assert.Equal("주다", KoreanLookup.AnalyzeKoreanToken("줬어요")?.Lemma);
        Assert.Equal("주다", KoreanLookup.AnalyzeKoreanToken("줬습니다")?.Lemma);
        Assert.Equal("하다", KoreanLookup.AnalyzeKoreanToken("했어요")?.Lemma);
        Assert.Equal("하다", KoreanLookup.AnalyzeKoreanToken("했습니다")?.Lemma);
        Assert.Equal("먹다", KoreanLookup.AnalyzeKoreanToken("먹었어요")?.Lemma);
        Assert.Equal("먹다", KoreanLookup.AnalyzeKoreanToken("먹었습니다")?.Lemma);
        Assert.Equal("예쁘다", KoreanLookup.AnalyzeKoreanToken("예뻤어요")?.Lemma);
        Assert.Equal("예쁘다", KoreanLookup.AnalyzeKoreanToken("예뻤습니다")?.Lemma);
        Assert.Equal("바쁘다", KoreanLookup.AnalyzeKoreanToken("바빴어요")?.Lemma);
        Assert.Equal("바쁘다", KoreanLookup.AnalyzeKoreanToken("바빴습니다")?.Lemma);
    }

    [Fact]
    public void VerbDeconjugation_PresentTensePolite()
    {
        Assert.Equal("가다", KoreanLookup.AnalyzeKoreanToken("가요")?.Lemma);
        Assert.Equal("보다", KoreanLookup.AnalyzeKoreanToken("봐요")?.Lemma);
        Assert.Equal("오다", KoreanLookup.AnalyzeKoreanToken("와요")?.Lemma);
        Assert.Equal("주다", KoreanLookup.AnalyzeKoreanToken("줘요")?.Lemma);
        Assert.Equal("하다", KoreanLookup.AnalyzeKoreanToken("해요")?.Lemma);
        Assert.Equal("먹다", KoreanLookup.AnalyzeKoreanToken("먹어요")?.Lemma);
        Assert.Equal("예쁘다", KoreanLookup.AnalyzeKoreanToken("예뻐요")?.Lemma);
        Assert.Equal("바쁘다", KoreanLookup.AnalyzeKoreanToken("바빠요")?.Lemma);
        Assert.Equal("마시다", KoreanLookup.AnalyzeKoreanToken("마셔요")?.Lemma);
        Assert.Equal("쓰다", KoreanLookup.AnalyzeKoreanToken("써요")?.Lemma);
        Assert.Equal("크다", KoreanLookup.AnalyzeKoreanToken("커요")?.Lemma);
    }

    [Fact]
    public void VerbDeconjugation_ConnectiveAndConditional()
    {
        Assert.Equal(("먹다", "고", "Connective"), (KoreanLookup.AnalyzeKoreanToken("먹고")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹고")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹고")?.ParticleType));
        Assert.Equal(("가다", "고", "Connective"), (KoreanLookup.AnalyzeKoreanToken("가고")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가고")?.Particle, KoreanLookup.AnalyzeKoreanToken("가고")?.ParticleType));
        Assert.Equal(("하다", "고", "Connective"), (KoreanLookup.AnalyzeKoreanToken("하고")?.Lemma, KoreanLookup.AnalyzeKoreanToken("하고")?.Particle, KoreanLookup.AnalyzeKoreanToken("하고")?.ParticleType));

        Assert.Equal(("먹다", "지만", "Contrastive"), (KoreanLookup.AnalyzeKoreanToken("먹지만")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹지만")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹지만")?.ParticleType));
        Assert.Equal(("하다", "지만", "Contrastive"), (KoreanLookup.AnalyzeKoreanToken("하지만")?.Lemma, KoreanLookup.AnalyzeKoreanToken("하지만")?.Particle, KoreanLookup.AnalyzeKoreanToken("하지만")?.ParticleType));
        Assert.Equal(("있다", "지만", "Contrastive"), (KoreanLookup.AnalyzeKoreanToken("있지만")?.Lemma, KoreanLookup.AnalyzeKoreanToken("있지만")?.Particle, KoreanLookup.AnalyzeKoreanToken("있지만")?.ParticleType));

        Assert.Equal(("가다", "아서", "Causal/Sequential"), (KoreanLookup.AnalyzeKoreanToken("가서")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가서")?.Particle, KoreanLookup.AnalyzeKoreanToken("가서")?.ParticleType));
        Assert.Equal(("오다", "아서", "Causal/Sequential"), (KoreanLookup.AnalyzeKoreanToken("와서")?.Lemma, KoreanLookup.AnalyzeKoreanToken("와서")?.Particle, KoreanLookup.AnalyzeKoreanToken("와서")?.ParticleType));
        Assert.Equal(("보다", "아서", "Causal/Sequential"), (KoreanLookup.AnalyzeKoreanToken("봐서")?.Lemma, KoreanLookup.AnalyzeKoreanToken("봐서")?.Particle, KoreanLookup.AnalyzeKoreanToken("봐서")?.ParticleType));
        Assert.Equal(("먹다", "어서", "Causal/Sequential"), (KoreanLookup.AnalyzeKoreanToken("먹어서")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹어서")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹어서")?.ParticleType));
        Assert.Equal(("하다", "해서", "Causal/Sequential"), (KoreanLookup.AnalyzeKoreanToken("해서")?.Lemma, KoreanLookup.AnalyzeKoreanToken("해서")?.Particle, KoreanLookup.AnalyzeKoreanToken("해서")?.ParticleType));

        Assert.Equal(("먹다", "으면", "Conditional"), (KoreanLookup.AnalyzeKoreanToken("먹으면")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹으면")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹으면")?.ParticleType));
        Assert.Equal(("가다", "면", "Conditional"), (KoreanLookup.AnalyzeKoreanToken("가면")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가면")?.Particle, KoreanLookup.AnalyzeKoreanToken("가면")?.ParticleType));
        Assert.Equal(("하다", "면", "Conditional"), (KoreanLookup.AnalyzeKoreanToken("하면")?.Lemma, KoreanLookup.AnalyzeKoreanToken("하면")?.Particle, KoreanLookup.AnalyzeKoreanToken("하면")?.ParticleType));

        Assert.Equal(("가다", "는데", "Connective/Background"), (KoreanLookup.AnalyzeKoreanToken("가는데")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가는데")?.Particle, KoreanLookup.AnalyzeKoreanToken("가는데")?.ParticleType));
        Assert.Equal(("먹다", "는데", "Connective/Background"), (KoreanLookup.AnalyzeKoreanToken("먹는데")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹는데")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹는데")?.ParticleType));
        Assert.Equal(("예쁘다", "ㄴ데", "Connective/Background"), (KoreanLookup.AnalyzeKoreanToken("예쁜데")?.Lemma, KoreanLookup.AnalyzeKoreanToken("예쁜데")?.Particle, KoreanLookup.AnalyzeKoreanToken("예쁜데")?.ParticleType));

        Assert.Equal(("가다", "니까", "Causal"), (KoreanLookup.AnalyzeKoreanToken("가니까")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가니까")?.Particle, KoreanLookup.AnalyzeKoreanToken("가니까")?.ParticleType));
        Assert.Equal(("먹다", "으니까", "Causal"), (KoreanLookup.AnalyzeKoreanToken("먹으니까")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹으니까")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹으니까")?.ParticleType));

        Assert.Equal(("가다", "려고", "Intentional"), (KoreanLookup.AnalyzeKoreanToken("가려고")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가려고")?.Particle, KoreanLookup.AnalyzeKoreanToken("가려고")?.ParticleType));
        Assert.Equal(("먹다", "으려고", "Intentional"), (KoreanLookup.AnalyzeKoreanToken("먹으려고")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹으려고")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹으려고")?.ParticleType));
    }

    [Fact]
    public void VerbDeconjugation_AdnominalModifierForms()
    {
        Assert.Equal(("값비싸다", "ㄴ", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("값비싼")?.Lemma, KoreanLookup.AnalyzeKoreanToken("값비싼")?.Particle, KoreanLookup.AnalyzeKoreanToken("값비싼")?.ParticleType));
        Assert.Equal(("예쁘다", "ㄴ", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("예쁜")?.Lemma, KoreanLookup.AnalyzeKoreanToken("예쁜")?.Particle, KoreanLookup.AnalyzeKoreanToken("예쁜")?.ParticleType));
        Assert.Equal(("빠르다", "ㄴ", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("빠른")?.Lemma, KoreanLookup.AnalyzeKoreanToken("빠른")?.Particle, KoreanLookup.AnalyzeKoreanToken("빠른")?.ParticleType));

        Assert.Equal(("먹다", "은", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("먹은")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹은")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹은")?.ParticleType));
        Assert.Equal(("좋다", "은", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("좋은")?.Lemma, KoreanLookup.AnalyzeKoreanToken("좋은")?.Particle, KoreanLookup.AnalyzeKoreanToken("좋은")?.ParticleType));
        Assert.Equal(("작다", "은", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("작은")?.Lemma, KoreanLookup.AnalyzeKoreanToken("작은")?.Particle, KoreanLookup.AnalyzeKoreanToken("작은")?.ParticleType));

        Assert.Equal(("가다", "는", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("가는")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가는")?.Particle, KoreanLookup.AnalyzeKoreanToken("가는")?.ParticleType));
        Assert.Equal(("먹다", "는", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("먹는")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹는")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹는")?.ParticleType));
        Assert.Equal(("보다", "는", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("보는")?.Lemma, KoreanLookup.AnalyzeKoreanToken("보는")?.Particle, KoreanLookup.AnalyzeKoreanToken("보는")?.ParticleType));
        Assert.Equal(("하다", "는", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("하는")?.Lemma, KoreanLookup.AnalyzeKoreanToken("하는")?.Particle, KoreanLookup.AnalyzeKoreanToken("하는")?.ParticleType));

        Assert.Equal(("먹다", "을", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("먹을")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹을")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹을")?.ParticleType));
        Assert.Equal(("값비싸다", "ㄹ", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("값비쌀")?.Lemma, KoreanLookup.AnalyzeKoreanToken("값비쌀")?.Particle, KoreanLookup.AnalyzeKoreanToken("값비쌀")?.ParticleType));
        Assert.Equal(("예쁘다", "ㄹ", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("예쁠")?.Lemma, KoreanLookup.AnalyzeKoreanToken("예쁠")?.Particle, KoreanLookup.AnalyzeKoreanToken("예쁠")?.ParticleType));

        Assert.Equal(("가다", "던", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("가던")?.Lemma, KoreanLookup.AnalyzeKoreanToken("가던")?.Particle, KoreanLookup.AnalyzeKoreanToken("가던")?.ParticleType));
        Assert.Equal(("먹다", "던", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("먹던")?.Lemma, KoreanLookup.AnalyzeKoreanToken("먹던")?.Particle, KoreanLookup.AnalyzeKoreanToken("먹던")?.ParticleType));
        Assert.Equal(("하다", "던", "Modifier Form"), (KoreanLookup.AnalyzeKoreanToken("했던")?.Lemma, KoreanLookup.AnalyzeKoreanToken("했던")?.Particle, KoreanLookup.AnalyzeKoreanToken("했던")?.ParticleType));
    }

    [Fact]
    public void VerbDeconjugation_CommonIrregulars()
    {
        // ㄷ irregular
        Assert.Equal("듣다", KoreanLookup.AnalyzeKoreanToken("들어요")?.Lemma);
        Assert.Equal("듣다", KoreanLookup.AnalyzeKoreanToken("들은")?.Lemma);
        Assert.Equal("듣다", KoreanLookup.AnalyzeKoreanToken("들으면")?.Lemma);

        // ㅂ irregular
        Assert.Equal("돕다", KoreanLookup.AnalyzeKoreanToken("도와요")?.Lemma);
        Assert.Equal("돕다", KoreanLookup.AnalyzeKoreanToken("도운")?.Lemma);
        Assert.Equal("어렵다", KoreanLookup.AnalyzeKoreanToken("어려워요")?.Lemma);
        Assert.Equal("어렵다", KoreanLookup.AnalyzeKoreanToken("어려운")?.Lemma);
        Assert.Equal("춥다", KoreanLookup.AnalyzeKoreanToken("추워요")?.Lemma);
        Assert.Equal("춥다", KoreanLookup.AnalyzeKoreanToken("추운")?.Lemma);
        Assert.Equal("고맙다", KoreanLookup.AnalyzeKoreanToken("고마워요")?.Lemma);
        Assert.Equal("고맙다", KoreanLookup.AnalyzeKoreanToken("고마운")?.Lemma);

        // ㅅ irregular
        Assert.Equal("낫다", KoreanLookup.AnalyzeKoreanToken("나아요")?.Lemma);
        Assert.Equal("낫다", KoreanLookup.AnalyzeKoreanToken("나은")?.Lemma);
        Assert.Equal("짓다", KoreanLookup.AnalyzeKoreanToken("지어요")?.Lemma);
        Assert.Equal("짓다", KoreanLookup.AnalyzeKoreanToken("지은")?.Lemma);

        // 르 irregular
        Assert.Equal("모르다", KoreanLookup.AnalyzeKoreanToken("몰라요")?.Lemma);
        Assert.Equal("모르다", KoreanLookup.AnalyzeKoreanToken("몰랐어요")?.Lemma);
        Assert.Equal("빠르다", KoreanLookup.AnalyzeKoreanToken("빨라요")?.Lemma);
        Assert.Equal("빠르다", KoreanLookup.AnalyzeKoreanToken("빨랐어요")?.Lemma);
        Assert.Equal("부르다", KoreanLookup.AnalyzeKoreanToken("불러요")?.Lemma);
        Assert.Equal("부르다", KoreanLookup.AnalyzeKoreanToken("불렀어요")?.Lemma);

        // ㅎ irregular
        Assert.Equal("하얗다", KoreanLookup.AnalyzeKoreanToken("하얘요")?.Lemma);
        Assert.Equal("하얗다", KoreanLookup.AnalyzeKoreanToken("하얀")?.Lemma);
        Assert.Equal("그렇다", KoreanLookup.AnalyzeKoreanToken("그래요")?.Lemma);
        Assert.Equal("그렇다", KoreanLookup.AnalyzeKoreanToken("그런")?.Lemma);
    }

    [Fact]
    public void DirectDeconjugateKoreanVerbApi()
    {
        var analysis1 = KoreanLookup.DeconjugateKoreanVerb("주셨습니다");
        Assert.NotNull(analysis1);
        Assert.Equal("주다", analysis1.Lemma);
        Assert.Equal("셨습니다", analysis1.Particle);

        var analysis2 = KoreanLookup.DeconjugateKoreanVerb("간");
        Assert.NotNull(analysis2);
        Assert.Equal("가다", analysis2.Lemma);
        Assert.Equal("ㄴ", analysis2.Particle);

        var analysis3 = KoreanLookup.DeconjugateKoreanVerb("본");
        Assert.NotNull(analysis3);
        Assert.Equal("보다", analysis3.Lemma);
        Assert.Equal("ㄴ", analysis3.Particle);

        var analysis4 = KoreanLookup.DeconjugateKoreanVerb("한");
        Assert.NotNull(analysis4);
        Assert.Equal("하다", analysis4.Lemma);
        Assert.Equal("ㄴ", analysis4.Particle);

        var analysis5 = KoreanLookup.DeconjugateKoreanVerb("갈");
        Assert.NotNull(analysis5);
        Assert.Equal("가다", analysis5.Lemma);
        Assert.Equal("ㄹ", analysis5.Particle);

        var analysis6 = KoreanLookup.DeconjugateKoreanVerb("볼");
        Assert.NotNull(analysis6);
        Assert.Equal("보다", analysis6.Lemma);
        Assert.Equal("ㄹ", analysis6.Particle);

        var analysis7 = KoreanLookup.DeconjugateKoreanVerb("할");
        Assert.NotNull(analysis7);
        Assert.Equal("하다", analysis7.Lemma);
        Assert.Equal("ㄹ", analysis7.Particle);

        Assert.Null(KoreanLookup.DeconjugateKoreanVerb("오이"));
        Assert.Null(KoreanLookup.DeconjugateKoreanVerb("포도"));
        Assert.Null(KoreanLookup.DeconjugateKoreanVerb("한국어"));
    }
}
