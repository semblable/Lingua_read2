using System.Collections.Frozen;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace LinguaReadApi.Services.Tokenization;

public readonly record struct ThaiWordSpan(string Text, int Start, int End);

/// <summary>
/// Deterministic dictionary-based Thai word segmenter for the explicit
/// <c>thai-dict-v1</c> profile. Uses the CC0 Thai wordlist (~62,108 words from PyThaiNLP)
/// constrained to Thai Character Cluster (TCC) boundaries (Theeramunkong et al., 2000).
/// Contiguous out-of-vocabulary clusters are merged into single tokens during backtracking.
/// Thai digits (๐..๙) form independent number tokens.
/// </summary>
public sealed class ThaiSegmenter
{
    public const string Profile = "thai-dict-v1";
    public const string DictionarySha256 = "b654af583aaa269275339b3400e12a62311dd2c4d1779fb461dd9442319ff2a9";
    public const string DictionaryResourceName = "LinguaReadApi.ThaiDictionaryV1";

    private static readonly Lazy<ThaiSegmenter> Embedded = new(() => Create(ReadEmbeddedDictionary()));
    public static ThaiSegmenter Default => Embedded.Value;

    // TCC rule set based on Theeramunkong et al. 2000 and PyThaiNLP
    // k = ([ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?
    // c = [ก-ฮ]
    // t = [่-๋]?
    // d = [ุู]
    private static readonly Regex TccPattern = new(
        @"^(?:" +
        @"เ[ก-ฮ]็[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ][ก-ฮ][่-๋]?าะ(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ][ก-ฮ]ี[่-๋]?ยะ(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ][ก-ฮ]ี[่-๋]?ย(?=[เ-ไก-ฮ]|$)(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ][ก-ฮ]็[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ]ิ[ก-ฮ]์[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ]ิ[่-๋]?[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ]ี[่-๋]?ยะ?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ]ื[่-๋]?อะ?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ][\u0E34\u0E35\u0E38\u0E39][่-๋]?ย(?=[เ-ไก-ฮ]|$)(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"เ[ก-ฮ][่-๋]?า?ะ?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"[ก-ฮ]ั[่-๋]?วะ(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"[ก-ฮ][\u0E31\u0E37][่-๋]?[ก-ฮ][\u0E38\u0E34ะ]?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"[ก-ฮ][\u0E34\u0E38\u0E39]์|" +
        @"[ก-ฮ][\u0E30-\u0E39][่-๋]?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"[ก-ฮ]รร[ก-ฮ]์|" +
        @"[ก-ฮ]็|" +
        @"[ก-ฮ][่-๋]?[ะาำ]?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|" +
        @"แ[ก-ฮ]็[ก-ฮ]|" +
        @"แ[ก-ฮ][ก-ฮ]์|" +
        @"แ[ก-ฮ][่-๋]?ะ|" +
        @"แ[ก-ฮ][ก-ฮ]็[ก-ฮ]|" +
        @"แ[ก-ฮ][ก-ฮ][ก-ฮ]์|" +
        @"โ[ก-ฮ][่-๋]?ะ|" +
        @"[เ-ไ][ก-ฮ][่-๋]?|" +
        @"ก็|" +
        @"อึ|" +
        @"หึ" +
        @")",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly FrozenSet<string> _words;

    public int EntryCount => _words.Count;
    public int MaxWordLength { get; }

    private ThaiSegmenter(FrozenSet<string> words, int maxWordLength)
    {
        _words = words;
        MaxWordLength = maxWordLength;
    }

    public static string ReadEmbeddedDictionary()
    {
        using var stream = typeof(ThaiSegmenter).Assembly.GetManifestResourceStream(DictionaryResourceName)
            ?? throw new InvalidOperationException("The versioned Thai dictionary resource is missing.");
        using var memoryStream = new MemoryStream();
        stream.CopyTo(memoryStream);
        var bytes = memoryStream.ToArray();

        using var sha256 = SHA256.Create();
        var hash = Convert.ToHexString(sha256.ComputeHash(bytes)).ToLowerInvariant();
        if (hash != DictionarySha256)
            throw new InvalidOperationException($"Thai dictionary hash mismatch: expected {DictionarySha256}, got {hash}");

        return Encoding.UTF8.GetString(bytes);
    }

    public static ThaiSegmenter Create(string dictionaryText)
    {
        ArgumentNullException.ThrowIfNull(dictionaryText);
        var set = new HashSet<string>(StringComparer.Ordinal);
        var maxLength = 0;

        foreach (var line in dictionaryText.Split('\n'))
        {
            var word = line.Trim();
            if (word.Length == 0) continue;
            set.Add(word);
            if (word.Length > maxLength)
                maxLength = word.Length;
        }

        if (set.Count == 0)
            throw new FormatException("The Thai dictionary is empty.");

        return new ThaiSegmenter(set.ToFrozenSet(StringComparer.Ordinal), maxLength);
    }

    /// <summary>
    /// Detects whether the character at <paramref name="index"/> belongs to Thai script,
    /// including Thai consonants, vowels, tone marks, Paiyannoi, Maiyamok, and Thai digits.
    /// Excludes Thai Baht currency symbol (฿ U+0E3F).
    /// </summary>
    public static bool IsThaiAt(string text, int index)
    {
        if (index < 0 || index >= text.Length) return false;
        var c = text[index];
        return (c >= '\u0E01' && c <= '\u0E3A') || (c >= '\u0E40' && c <= '\u0E59');
    }

    public static bool IsThaiDigit(char c) => c >= '\u0E50' && c <= '\u0E59';

    public static bool IsThaiCombiningMark(char c) =>
        c is '\u0E31' or >= '\u0E34' and <= '\u0E3A' or >= '\u0E47' and <= '\u0E4E';

    public static int FindThaiRunEnd(string text, int start)
    {
        var cursor = start;
        while (cursor < text.Length && IsThaiAt(text, cursor))
        {
            cursor++;
        }
        return cursor;
    }

    /// <summary>
    /// Segments a Thai run into word and number tokens. Thai digit sequences are tokenized
    /// as numbers; Thai text runs are segmented via TCC-constrained backward DP with OOV coalescing.
    /// </summary>
    public IReadOnlyList<ThaiWordSpan> SegmentThaiRun(string processed, int start, int end)
    {
        ArgumentNullException.ThrowIfNull(processed);
        if (start < 0 || end < start || end > processed.Length)
            throw new ArgumentOutOfRangeException(nameof(start), "Invalid Thai run bounds.");
        if (start == end) return Array.Empty<ThaiWordSpan>();

        var words = new List<ThaiWordSpan>();
        var cursor = start;

        while (cursor < end)
        {
            if (IsThaiDigit(processed[cursor]))
            {
                var digitEnd = cursor + 1;
                while (digitEnd < end && IsThaiDigit(processed[digitEnd])) digitEnd++;
                words.Add(new ThaiWordSpan(processed[cursor..digitEnd], cursor, digitEnd));
                cursor = digitEnd;
            }
            else
            {
                var textEnd = cursor + 1;
                while (textEnd < end && !IsThaiDigit(processed[textEnd])) textEnd++;
                words.AddRange(SegmentThaiTextRun(processed, cursor, textEnd));
                cursor = textEnd;
            }
        }

        return words;
    }

    private IReadOnlyList<ThaiWordSpan> SegmentThaiTextRun(string text, int start, int end)
    {
        var bounds = GetTccBoundaries(text, start, end);
        var n = bounds.Count - 1;
        if (n == 0) return Array.Empty<ThaiWordSpan>();
        if (n == 1) return new[] { new ThaiWordSpan(text[start..end], start, end) };

        var dp = new int[n + 1];
        Array.Fill(dp, int.MaxValue);
        var next = new int[n];
        var isDict = new bool[n];
        dp[n] = 0;

        for (var i = n - 1; i >= 0; i--)
        {
            var bestCost = int.MaxValue;
            var bestJ = -1;
            var isDictionary = false;

            for (var j = i + 1; j <= n; j++)
            {
                var len = bounds[j] - bounds[i];
                if (len > MaxWordLength) break;
                var slice = text.Substring(bounds[i], len);
                if (_words.Contains(slice) || (slice.Length > 1 && (slice[^1] == '\u0E2F' || slice[^1] == '\u0E46') && _words.Contains(slice[..^1])))
                {
                    var cost = dp[j] == int.MaxValue ? int.MaxValue : 1 + dp[j];
                    if (cost < bestCost || (cost == bestCost && len > (bestJ >= 0 ? bounds[bestJ] - bounds[i] : 0)))
                    {
                        bestCost = cost;
                        bestJ = j;
                        isDictionary = true;
                    }
                }
            }

            var oovCost = dp[i + 1] == int.MaxValue ? int.MaxValue : 1 + dp[i + 1];
            if (bestCost == int.MaxValue || oovCost < bestCost)
            {
                bestCost = oovCost;
                bestJ = i + 1;
                isDictionary = false;
            }

            dp[i] = bestCost;
            next[i] = bestJ;
            isDict[i] = isDictionary;
        }

        var spans = new List<ThaiWordSpan>();
        var curr = 0;
        while (curr < n)
        {
            var nxt = next[curr];
            if (isDict[curr])
            {
                spans.Add(new ThaiWordSpan(text[bounds[curr]..bounds[nxt]], bounds[curr], bounds[nxt]));
                curr = nxt;
            }
            else
            {
                // Unmatched (OOV): coalesce contiguous unmatched TCCs
                var endCurr = nxt;
                while (endCurr < n && !isDict[endCurr])
                {
                    endCurr = next[endCurr];
                }
                spans.Add(new ThaiWordSpan(text[bounds[curr]..bounds[endCurr]], bounds[curr], bounds[endCurr]));
                curr = endCurr;
            }
        }

        return spans;
    }

    private static List<int> GetTccBoundaries(string text, int start, int end)
    {
        var boundaries = new List<int> { start };
        var p = start;
        while (p < end)
        {
            var sub = text.Substring(p, end - p);
            var match = TccPattern.Match(sub);
            var len = match.Success ? match.Length : 1;

            // Never split leading/pre-posed vowels from consonant
            if (text[p] >= '\u0E40' && text[p] <= '\u0E44' && p + 1 < end && len < 2)
            {
                len = 2;
            }

            // Attach trailing Paiyannoi (ฯ) or Maiyamok (ๆ)
            while (p + len < end && (text[p + len] == '\u0E2F' || text[p + len] == '\u0E46'))
            {
                len++;
            }

            // Attach trailing combining vowels / tone marks
            while (p + len < end && IsThaiCombiningMark(text[p + len]))
            {
                len++;
            }

            p += len;
            boundaries.Add(p);
        }
        return boundaries;
    }
}
