using System.Text;
using System.Text.RegularExpressions;

namespace LinguaReadApi.Services.Tokenization;

/// <summary>
/// Lookup-only Korean canonical aliases. Never use these to rewrite stored terms
/// or displayed text: compatibility Jamo and conflicting vocabulary rows stay distinct.
/// Callers supply their existing trimmed/cased exact keys.
/// </summary>
public static class KoreanLookup
{
    public static bool IsKoreanLanguageCode(string? code) =>
        string.Equals((code ?? string.Empty).Trim().Replace('_', '-').Split('-')[0], "ko", StringComparison.OrdinalIgnoreCase);

    public sealed record Projection(string Text, IReadOnlyList<int> SourceStarts, IReadOnlyList<int> SourceEnds);
    public readonly record struct SourceSpan(int Start, int End);

    /// <summary>Each composed UTF-16 unit maps to its complete original source span.</summary>
    public static Projection Project(string source)
    {
        var text = new StringBuilder(source.Length);
        var starts = new List<int>(source.Length);
        var ends = new List<int>(source.Length);
        for (var start = 0; start < source.Length;)
        {
            var code = (int)source[start];
            var end = start + 1;
            if (code is >= 0x1100 and <= 0x1112 && end < source.Length && source[end] is >= '\u1161' and <= '\u1175')
            {
                code = 0xac00 + ((code - 0x1100) * 21 + source[end] - 0x1161) * 28;
                end++;
            }
            if (code is >= 0xac00 and <= 0xd7a3 && (code - 0xac00) % 28 == 0
                && end < source.Length && source[end] is >= '\u11a8' and <= '\u11c2')
            {
                code += source[end] - 0x11a7;
                end++;
            }
            text.Append((char)code);
            starts.Add(start);
            ends.Add(end);
            start = end;
        }
        return new Projection(text.ToString(), starts, ends);
    }

    public static string ComposeHangul(string source) => Project(source).Text;

    public sealed class Index<T> where T : class
    {
        private readonly Dictionary<string, T?> exact = new(StringComparer.Ordinal);
        private readonly Dictionary<string, T?> canonical = new(StringComparer.Ordinal);

        internal Index(IEnumerable<T> rows, Func<T, string> exactKey)
        {
            foreach (var row in rows) Add(row, exactKey);
        }

        /// <summary>Register a newly pending row without rebuilding the language index.</summary>
        public void Add(T row, Func<T, string> exactKey)
        {
            var key = exactKey(row);
            exact[key] = exact.ContainsKey(key) ? null : row;
            var alias = ComposeHangul(key);
            canonical[alias] = canonical.ContainsKey(alias) ? null : row;
        }

        /// <summary>Exact spelling wins; an alias with multiple candidates has no winner.</summary>
        public T? Resolve(string exactKey) => exact.TryGetValue(exactKey, out var row)
            ? row
            : canonical.GetValueOrDefault(ComposeHangul(exactKey));

        /// <summary>True also for an exact key whose stored rows conflict.</summary>
        public bool ContainsExact(string exactKey) => exact.ContainsKey(exactKey);
    }

    public static Index<T> CreateIndex<T>(IEnumerable<T> rows, Func<T, string> exactKey) where T : class => new(rows, exactKey);

    /// <summary>Canonical matches with offsets in the unmodified source, including phrases.</summary>
    public static IReadOnlyList<SourceSpan> FindMatches(string source, string term)
    {
        var projection = Project(source);
        var needle = ComposeHangul(term);
        if (needle.Length == 0) return Array.Empty<SourceSpan>();
        return Regex.Matches(projection.Text, Regex.Escape(needle), RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
            .Select(match => new SourceSpan(projection.SourceStarts[match.Index], projection.SourceEnds[match.Index + match.Length - 1]))
            .ToArray();
    }
}
