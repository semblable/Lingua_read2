using System.ComponentModel.DataAnnotations;
using System.Text.Json;

namespace LinguaReadApi.Services;

public sealed record SentenceSourceRange([property: Required] int Start, [property: Required] int End);

/// <summary>Credited character ranges in the reader's display blocks, independent of sentence boundaries.</summary>
public sealed class SentenceSourceCoverage
{
    [Required] public string SourceRevision { get; init; } = "";
    [Required] public List<SentenceSourceRange> Ranges { get; init; } = [];
    [Required] public HashSet<int> LegacyIndices { get; init; } = [];

    internal static SentenceSourceCoverage? Read(string? json)
    {
        try { return json == null ? null : JsonSerializer.Deserialize<SentenceSourceCoverage>(json); }
        catch (JsonException) { return null; }
    }

    internal IEnumerable<string> UnreadText(SentenceSourceRange span, string sourceText)
    {
        var next = span.Start;
        foreach (var covered in Ranges)
        {
            if (covered.End <= next) continue;
            if (covered.Start >= span.End) break;
            if (covered.Start > next) yield return sourceText[(next - span.Start)..(covered.Start - span.Start)];
            next = Math.Max(next, covered.End);
            if (next >= span.End) yield break;
        }
        if (next < span.End) yield return sourceText[(next - span.Start)..];
    }

    internal void Mark(SentenceSourceRange span)
    {
        var first = Ranges.FindIndex(r => r.End >= span.Start);
        if (first < 0)
        {
            Ranges.Add(span);
            return;
        }

        var start = span.Start;
        var end = span.End;
        var next = first;
        while (next < Ranges.Count && Ranges[next].Start <= end)
        {
            start = Math.Min(start, Ranges[next].Start);
            end = Math.Max(end, Ranges[next].End);
            next++;
        }
        Ranges.RemoveRange(first, next - first);
        Ranges.Insert(first, new(start, end));
    }
}
