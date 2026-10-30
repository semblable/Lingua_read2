using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LinguaReadApi.Services.Tokenization;
using Xunit;
using Xunit.Abstractions;

namespace LinguaReadApi.Tests;

public class ChineseSegmenterTests(ITestOutputHelper output)
{
    [Fact]
    public void FullPinnedDictionary_MatchesSharedUtf16Spans()
    {
        var dictionary = ChineseSegmenter.ReadEmbeddedDictionary();
        Assert.Equal(ChineseSegmenter.DictionarySha256,
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(dictionary))));
        var timer = Stopwatch.StartNew();
        var segmenter = ChineseSegmenter.Create(dictionary);
        var parseMilliseconds = timer.Elapsed.TotalMilliseconds;
        Assert.Equal(583280, segmenter.EntryCount);
        Assert.Equal(87043992L, segmenter.TotalFrequency);
        Assert.Equal(16, segmenter.MaxWordLength);

        var fixturePath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
            "../../../../../verification/language-support/chinese-cases.json"));
        using var fixture = JsonDocument.Parse(File.ReadAllText(fixturePath));
        Assert.Equal(ChineseSegmenter.Profile, fixture.RootElement.GetProperty("profile").GetString());
        Assert.Equal(ChineseSegmenter.DictionarySha256, fixture.RootElement.GetProperty("dictionarySha256").GetString());
        foreach (var testCase in fixture.RootElement.GetProperty("cases").EnumerateArray())
        {
            var text = testCase.GetProperty("text").GetString()!;
            var expected = testCase.GetProperty("hanSpans").EnumerateArray()
                .Select(span => new ChineseWordSpan(span.GetProperty("text").GetString()!,
                    span.GetProperty("start").GetInt32(), span.GetProperty("end").GetInt32())).ToArray();
            var actual = SegmentRuns(segmenter, text);
            Assert.True(expected.SequenceEqual(actual),
                $"Fixture {testCase.GetProperty("id").GetString()}: {string.Join("|", actual.Select(x => x.Text))}");
            foreach (var span in actual) Assert.Equal(span.Text, text[span.Start..span.End]);
        }
        var repeated = string.Concat(Enumerable.Repeat("图书馆的学生今天正在阅读中文小说", 400));
        timer.Restart();
        var spans = segmenter.SegmentHanRun(repeated, 0, repeated.Length);
        output.WriteLine($"Pinned raw dictionary: {Encoding.UTF8.GetByteCount(dictionary)} bytes; parse {parseMilliseconds:F1} ms; " +
            $"segment {repeated.Length} UTF-16 units/{spans.Count} words {timer.Elapsed.TotalMilliseconds:F1} ms. Measurements are diagnostic, not budgets.");
        Assert.Equal(repeated, string.Concat(spans.Select(x => x.Text)));
    }

    [Fact]
    public void Parser_UsesLastDuplicateButKeepsEveryRowsFrequencyInTotal()
    {
        var segmenter = ChineseSegmenter.Create("中 1 n\r\n中文 10 n\r\n中 2 n\r\n文 0 n");
        Assert.Equal(3, segmenter.EntryCount);
        Assert.Equal(13, segmenter.TotalFrequency);
        Assert.Equal(new[] { new ChineseWordSpan("中文", 2, 4) }, segmenter.SegmentHanRun("🙂中文", 2, 4));
    }

    [Fact]
    public void SupplementaryDictionaryWordsAndUnknownScalars_PreserveOriginalSpans()
    {
        var segmenter = ChineseSegmenter.Create("𠀀讀者 100 n\n讀者 10 n\n");
        const string text = "a𠀀讀者𠀁\U000E0100";
        Assert.Equal(text.Length, ChineseSegmenter.FindHanRunEnd(text, 1));
        Assert.Equal(new[] { new ChineseWordSpan("𠀀讀者", 1, 5), new ChineseWordSpan("𠀁\U000E0100", 5, 9) },
            segmenter.SegmentHanRun(text, 1, text.Length));
        Assert.False(ChineseSegmenter.IsHanAt(text, 2)); // Low surrogate is not a new Han scalar.
        Assert.Throws<ArgumentException>(() => segmenter.SegmentHanRun(text, 1, 2));
        Assert.Throws<ArgumentException>(() => segmenter.SegmentHanRun("中文A", 0, 3));
    }

    [Theory]
    [InlineData("")]
    [InlineData("中文")]
    [InlineData("中文 -1 n")]
    [InlineData("中文 1.5 n")]
    [InlineData("中文 0 n")]
    public void InvalidDictionary_IsRejected(string dictionary) =>
        Assert.Throws<FormatException>(() => ChineseSegmenter.Create(dictionary));

    private static IReadOnlyList<ChineseWordSpan> SegmentRuns(ChineseSegmenter segmenter, string text)
    {
        var spans = new List<ChineseWordSpan>();
        for (var position = 0; position < text.Length;)
        {
            if (!ChineseSegmenter.IsHanAt(text, position)) { position++; continue; }
            var end = ChineseSegmenter.FindHanRunEnd(text, position);
            spans.AddRange(segmenter.SegmentHanRun(text, position, end));
            position = end;
        }
        return spans;
    }
}
