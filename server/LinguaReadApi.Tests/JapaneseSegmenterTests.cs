using System.Diagnostics;
using System.Text;
using System.Text.Json;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Xunit;
using Xunit.Abstractions;

namespace LinguaReadApi.Tests;

public class JapaneseSegmenterTests(ITestOutputHelper output)
{
    [Fact]
    public void SharedFixtures_MatchExpectedJapaneseUtf16Spans()
    {
        var segmenter = JapaneseSegmenter.Default;
        var fixturePath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
            "../../../../../verification/language-support/japanese-cases.json"));
        using var fixture = JsonDocument.Parse(File.ReadAllText(fixturePath));
        Assert.Equal(JapaneseSegmenter.Profile, fixture.RootElement.GetProperty("profile").GetString());

        foreach (var testCase in fixture.RootElement.GetProperty("cases").EnumerateArray())
        {
            var id = testCase.GetProperty("id").GetString()!;
            var text = testCase.GetProperty("text").GetString()!;
            var expected = testCase.GetProperty("japaneseSpans").EnumerateArray()
                .Select(span => new JapaneseWordSpan(
                    span.GetProperty("start").GetInt32(),
                    span.GetProperty("end").GetInt32(),
                    span.GetProperty("text").GetString()!))
                .ToArray();
            var actual = SegmentRuns(segmenter, text);
            Assert.True(expected.SequenceEqual(actual),
                $"Fixture {id}: expected [{string.Join("|", expected.Select(x => $"{x.Text}@{x.Start}..{x.End}"))}] " +
                $"but got [{string.Join("|", actual.Select(x => $"{x.Text}@{x.Start}..{x.End}"))}]");
            foreach (var span in actual)
            {
                Assert.Equal(span.Text, text[span.Start..span.End]);
            }
        }

        var repeated = string.Concat(Enumerable.Repeat("私は昨日図書館で日本語の本を読みました。", 400));
        var timer = Stopwatch.StartNew();
        var spans = SegmentRuns(segmenter, repeated);
        output.WriteLine($"Segment {repeated.Length} UTF-16 units/{spans.Count} words in {timer.Elapsed.TotalMilliseconds:F1} ms. Measurements are diagnostic, not budgets.");
        Assert.Equal(repeated.Replace("。", string.Empty), string.Concat(spans.Select(x => x.Text)));
    }

    [Fact]
    public void SurrogatePairs_VariationSelectors_AndVoicingMarks_PreserveUtf16Boundaries()
    {
        var segmenter = JapaneseSegmenter.Default;

        // 1. Supplementary Han (𠮷 = \uD842\uDFB7, 2 UTF-16 code units)
        const string yoshinoya = "𠮷野家で食べる。";
        Assert.True(JapaneseSegmenter.IsJapaneseScriptAt(yoshinoya, 0));
        Assert.False(JapaneseSegmenter.IsJapaneseScriptAt(yoshinoya, 1)); // low surrogate
        Assert.Equal(8, JapaneseSegmenter.FindJapaneseRunEnd(yoshinoya, 0));
        Assert.Equal(
            new[]
            {
                new JapaneseWordSpan(0, 4, "𠮷野家"),
                new JapaneseWordSpan(4, 5, "で"),
                new JapaneseWordSpan(5, 8, "食べる")
            },
            segmenter.SegmentRun(yoshinoya, 0, 8));

        // 2. Supplementary IVS (葛󠄀 = 葛 + \U000E0100, 3 UTF-16 code units)
        const string katsuragi = "葛󠄀城市";
        Assert.True(JapaneseSegmenter.IsJapaneseScriptAt(katsuragi, 0));
        Assert.False(JapaneseSegmenter.IsJapaneseScriptAt(katsuragi, 1)); // high surrogate of IVS
        Assert.False(JapaneseSegmenter.IsJapaneseScriptAt(katsuragi, 2)); // low surrogate of IVS
        Assert.Equal(katsuragi.Length, JapaneseSegmenter.FindJapaneseRunEnd(katsuragi, 0));
        Assert.Equal(
            new[]
            {
                new JapaneseWordSpan(0, 4, "葛󠄀城"),
                new JapaneseWordSpan(4, 5, "市")
            },
            segmenter.SegmentRun(katsuragi, 0, katsuragi.Length));

        // 3. BMP variation selector (神︀ = 神 + \uFE00, 2 UTF-16 code units)
        const string kobe = "神︀戸";
        Assert.True(JapaneseSegmenter.IsJapaneseScriptAt(kobe, 0));
        Assert.False(JapaneseSegmenter.IsJapaneseScriptAt(kobe, 1));
        Assert.Equal(kobe.Length, JapaneseSegmenter.FindJapaneseRunEnd(kobe, 0));
        Assert.Equal(new[] { new JapaneseWordSpan(0, 3, "神︀戸") }, segmenter.SegmentRun(kobe, 0, kobe.Length));

        // 4. Combining kana voicing mark (ゔ = う + \u3099, 2 UTF-16 code units)
        const string violin = "ゔぁいおりん";
        Assert.True(JapaneseSegmenter.IsJapaneseScriptAt(violin, 0));
        Assert.False(JapaneseSegmenter.IsJapaneseScriptAt(violin, 1));
        Assert.Equal(violin.Length, JapaneseSegmenter.FindJapaneseRunEnd(violin, 0));
        Assert.Equal(
            new[]
            {
                new JapaneseWordSpan(0, 4, "ゔぁい"),
                new JapaneseWordSpan(4, 7, "おりん")
            },
            segmenter.SegmentRun(violin, 0, violin.Length));
    }

    [Fact]
    public void InvalidRanges_AndSurrogateMidpoints_ThrowOrReturnFalse()
    {
        var segmenter = JapaneseSegmenter.Default;
        const string text = "𠮷野家";

        Assert.Throws<ArgumentNullException>(() => segmenter.SegmentRun(null!, 0, 0));
        Assert.Throws<ArgumentNullException>(() => JapaneseSegmenter.IsJapaneseScriptAt(null!, 0));
        Assert.Throws<ArgumentNullException>(() => JapaneseSegmenter.FindJapaneseRunEnd(null!, 0));

        Assert.Throws<ArgumentOutOfRangeException>(() => segmenter.SegmentRun(text, -1, 2));
        Assert.Throws<ArgumentOutOfRangeException>(() => segmenter.SegmentRun(text, 2, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => segmenter.SegmentRun(text, 0, text.Length + 1));
        Assert.Empty(segmenter.SegmentRun(text, 2, 2));

        // Starting on the low surrogate of 𠮷 (index 1) or encountering an unpaired surrogate throws ArgumentException
        Assert.Throws<ArgumentException>(() => segmenter.SegmentRun(text, 1, text.Length));
        Assert.Throws<ArgumentException>(() => segmenter.SegmentRun("猫\uD842", 0, 2));

        // Starting on non-Japanese or out of bounds in FindJapaneseRunEnd returns start unchanged
        Assert.Equal(0, JapaneseSegmenter.FindJapaneseRunEnd("ABC", 0));
        Assert.Equal(1, JapaneseSegmenter.FindJapaneseRunEnd(text, 1));
        Assert.False(JapaneseSegmenter.IsJapaneseScriptAt(text, -1));
        Assert.False(JapaneseSegmenter.IsJapaneseScriptAt(text, text.Length));
    }

    [Fact]
    public void Tokenizer_WithJapaneseProfile_SegmentsJapaneseRuns_AndDoesNotGlueConnectorsAcrossScriptBoundaries()
    {
        var language = new Language
        {
            Code = "ja",
            Name = "Japanese",
            ParserType = JapaneseSegmenter.Profile
        };

        var result = Tokenizer.Tokenize("2026年にOpenAI-APIを使う🙂。A-猫", language);
        var words = result.Tokens.Where(t => t.IsWord).Select(t => t.Text).ToArray();
        Assert.Equal(new[] { "年", "に", "OpenAI-API", "を", "使う", "A", "猫" }, words);

        // Surrogate-pair emoji separator stays a single 2-code-unit separator token
        var emojiToken = Assert.Single(result.Tokens, t => t.Text == "🙂");
        Assert.False(emojiToken.IsWord);
        Assert.Equal(2, emojiToken.End - emojiToken.Start);
    }

    private static IReadOnlyList<JapaneseWordSpan> SegmentRuns(JapaneseSegmenter segmenter, string text)
    {
        var spans = new List<JapaneseWordSpan>();
        for (var position = 0; position < text.Length;)
        {
            if (!JapaneseSegmenter.IsJapaneseScriptAt(text, position))
            {
                position++;
                continue;
            }
            var end = JapaneseSegmenter.FindJapaneseRunEnd(text, position);
            spans.AddRange(segmenter.SegmentRun(text, position, end));
            position = end;
        }
        return spans;
    }
}
