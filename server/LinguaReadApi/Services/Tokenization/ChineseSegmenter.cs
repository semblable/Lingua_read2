using System.Globalization;
using System.Text;

namespace LinguaReadApi.Services.Tokenization;

/// <summary>
/// Versioned dictionary-frequency DAG segmentation, without HMM guessing or script conversion.
/// The browser mirrors this implementation and consumes the same pinned jieba dictionary.
/// Non-Han word/separator policy belongs to the caller's ordinary tokenizer.
/// </summary>
public sealed class ChineseSegmenter
{
    public const string Profile = "jieba-v1";
    public const string DictionarySha256 = "b16011275c42955ccd81fc1adecc93a59dbb7926af69d93fc95d4943d40f6aad";
    public const string DictionaryResourceName = "LinguaReadApi.ChineseDictionaryV1";

    private static readonly Lazy<ChineseSegmenter> Embedded = new(() => Create(ReadEmbeddedDictionary()));
    public static ChineseSegmenter Default => Embedded.Value;

    private readonly string _dictionary;
    private readonly Entry[] _entries;
    private readonly double _logTotal;
    private readonly record struct Entry(int Start, int End, int Frequency);

    public int EntryCount => _entries.Length;
    public long TotalFrequency { get; }
    public int MaxWordLength { get; }

    private ChineseSegmenter(string dictionary, Entry[] entries, long total, int maxWordLength)
    {
        _dictionary = dictionary;
        _entries = entries;
        TotalFrequency = total;
        MaxWordLength = maxWordLength;
        _logTotal = Math.Log(total);
    }

    public static string ReadEmbeddedDictionary()
    {
        using var stream = typeof(ChineseSegmenter).Assembly.GetManifestResourceStream(DictionaryResourceName)
            ?? throw new InvalidOperationException("The versioned Chinese dictionary resource is missing.");
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    /// <summary>
    /// Reads original jieba rows (word, nonnegative frequency, optional POS). Duplicate words use
    /// the last row's frequency, while the denominator includes every row, matching upstream.
    /// Sorted offsets index the original string; no prefix dictionary or per-entry strings remain.
    /// </summary>
    public static ChineseSegmenter Create(string dictionaryText)
    {
        ArgumentNullException.ThrowIfNull(dictionaryText);
        var rows = new List<Entry>();
        long total = 0;
        var maxLength = 0;
        for (var start = 0; start < dictionaryText.Length;)
        {
            var newline = dictionaryText.IndexOf('\n', start);
            var end = newline < 0 ? dictionaryText.Length : newline;
            if (end > start && dictionaryText[end - 1] == '\r') end--;
            if (end > start)
            {
                var space = dictionaryText.IndexOf(' ', start, end - start);
                var frequencyEnd = space < 0 ? -1 : dictionaryText.IndexOf(' ', space + 1, end - space - 1);
                if (frequencyEnd < 0) frequencyEnd = end;
                if (space <= start || !int.TryParse(dictionaryText.AsSpan(space + 1, frequencyEnd - space - 1),
                        NumberStyles.None, CultureInfo.InvariantCulture, out var frequency) || frequency < 0)
                    throw new FormatException("Invalid Chinese dictionary row.");
                rows.Add(new Entry(start, space, frequency));
                total = checked(total + frequency);
                maxLength = Math.Max(maxLength, space - start);
            }
            start = newline < 0 ? dictionaryText.Length : newline + 1;
        }
        if (rows.Count == 0 || total <= 0) throw new FormatException("The Chinese dictionary is empty.");
        rows.Sort((a, b) =>
        {
            var comparison = dictionaryText.AsSpan(a.Start, a.End - a.Start)
                .SequenceCompareTo(dictionaryText.AsSpan(b.Start, b.End - b.Start));
            return comparison != 0 ? comparison : a.Start.CompareTo(b.Start);
        });
        var unique = new List<Entry>(rows.Count);
        foreach (var row in rows)
        {
            if (unique.Count > 0 && dictionaryText.AsSpan(row.Start, row.End - row.Start)
                    .SequenceEqual(dictionaryText.AsSpan(unique[^1].Start, unique[^1].End - unique[^1].Start)))
                unique[^1] = row;
            else unique.Add(row);
        }
        return new ChineseSegmenter(dictionaryText, unique.ToArray(), total, maxLength);
    }

    /// <summary>Returns source UTF-16 spans for a contiguous Han run, including attached variation selectors.</summary>
    public IReadOnlyList<ChineseWordSpan> SegmentHanRun(string processed, int start, int end)
    {
        ArgumentNullException.ThrowIfNull(processed);
        if (start < 0 || end < start || end > processed.Length) throw new ArgumentOutOfRangeException(nameof(start));
        if (start == end) return Array.Empty<ChineseWordSpan>();
        var offsets = new List<int> { start };
        for (var position = start; position < end;)
        {
            if (!IsHanAt(processed, position)) throw new ArgumentException("Expected a contiguous Han run.", nameof(processed));
            position += ScalarWidth(processed, position);
            while (position < end && IsVariationSelectorAt(processed, position)) position += ScalarWidth(processed, position);
            if (position > end) throw new ArgumentException("A Han run cannot split a Unicode scalar.", nameof(end));
            offsets.Add(position);
        }
        var count = offsets.Count - 1;
        var scores = new double[count + 1];
        var next = new int[count];
        for (var i = count - 1; i >= 0; i--)
        {
            var best = double.NegativeInfinity;
            var chosen = i + 1;
            var lower = 0;
            var upper = _entries.Length;
            for (var j = i; j < count && offsets[j + 1] - offsets[i] <= MaxWordLength && lower < upper; j++)
            {
                for (var position = offsets[j]; position < offsets[j + 1] && lower < upper; position++)
                {
                    var depth = position - offsets[i];
                    var value = processed[position];
                    var rangeEnd = upper;
                    lower = Bound(lower, upper, depth, value, inclusive: false);
                    upper = Bound(lower, rangeEnd, depth, value, inclusive: true);
                }
                if (lower == upper) break;
                var entry = _entries[lower];
                if (entry.End - entry.Start != offsets[j + 1] - offsets[i] || entry.Frequency == 0) continue;
                var candidate = Math.Log(entry.Frequency) - _logTotal + scores[j + 1];
                // Exact ties choose the longer candidate, as Python jieba's max((score, end)) does.
                if (candidate >= best) { best = candidate; chosen = j + 1; }
            }
            scores[i] = double.IsNegativeInfinity(best) ? -_logTotal + scores[i + 1] : best;
            next[i] = chosen;
        }
        var words = new List<ChineseWordSpan>();
        for (var i = 0; i < count;)
        {
            var endIndex = next[i];
            words.Add(new ChineseWordSpan(processed[offsets[i]..offsets[endIndex]], offsets[i], offsets[endIndex]));
            i = endIndex;
        }
        return words;
    }

    private int Bound(int lower, int upper, int depth, int value, bool inclusive)
    {
        while (lower < upper)
        {
            var middle = lower + (upper - lower) / 2;
            var entry = _entries[middle];
            var actual = entry.Start + depth < entry.End ? _dictionary[entry.Start + depth] : -1;
            if (actual < value || (inclusive && actual == value)) lower = middle + 1;
            else upper = middle;
        }
        return lower;
    }

    public static bool IsHanAt(string text, int index)
    {
        if (index < 0 || index >= text.Length) return false;
        var scalar = ScalarAt(text, index);
        return scalar is 0x3005 or 0x3007
            or >= 0x3400 and <= 0x4DBF or >= 0x4E00 and <= 0x9FFF
            or >= 0xF900 and <= 0xFAFF or >= 0x20000 and <= 0x2FA1F
            or >= 0x30000 and <= 0x3347F;
    }

    public static int FindHanRunEnd(string text, int start)
    {
        var position = start;
        while (IsHanAt(text, position))
        {
            position += ScalarWidth(text, position);
            while (position < text.Length && IsVariationSelectorAt(text, position)) position += ScalarWidth(text, position);
        }
        return position;
    }

    private static bool IsVariationSelectorAt(string text, int index) => ScalarAt(text, index)
        is >= 0xFE00 and <= 0xFE0F or >= 0xE0100 and <= 0xE01EF;
    private static int ScalarWidth(string text, int index) =>
        char.IsHighSurrogate(text[index]) && index + 1 < text.Length && char.IsLowSurrogate(text[index + 1]) ? 2 : 1;
    private static int ScalarAt(string text, int index) => ScalarWidth(text, index) == 2
        ? char.ConvertToUtf32(text[index], text[index + 1]) : text[index];
}

public readonly record struct ChineseWordSpan(string Text, int Start, int End);
