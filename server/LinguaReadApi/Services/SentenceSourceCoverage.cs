using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LinguaReadApi.Services;

public sealed record SentenceSourceRange([property: Required] int Start, [property: Required] int End);

/// <summary>Credited character ranges in the reader's display blocks, independent of sentence boundaries.</summary>
public sealed class SentenceSourceCoverage
{
    [Required] public string SourceRevision { get; init; } = "";
    [Required] public List<SentenceSourceRange> Ranges { get; init; } = [];
    [Required] public HashSet<int> LegacyIndices { get; init; } = [];
    // Tracks all ordinals credited against this revision (both span-aware and legacy)
    // so revisionless clients do not collide with earlier revisions' indices or double-credit.
    [JsonIgnore] internal HashSet<int> CreditedIndices { get; init; } = [];
    // False for pre-existing rows persisted before CreditedIndices existed in JSON,
    // so LogSentenceRead can hydrate same-revision ordinals from CreditedSegmentIndicesJson.
    [JsonIgnore] internal bool HasStoredCreditedIndices { get; set; } = true;

    private sealed class StoredCoverage
    {
        public string SourceRevision { get; init; } = "";
        public List<SentenceSourceRange> Ranges { get; init; } = [];
        public HashSet<int> LegacyIndices { get; init; } = [];
        public HashSet<int>? CreditedIndices { get; init; }
    }

    private static SentenceSourceCoverage FromStored(StoredCoverage stored) => new()
    {
        SourceRevision = stored.SourceRevision,
        Ranges = stored.Ranges,
        LegacyIndices = stored.LegacyIndices,
        CreditedIndices = new(stored.CreditedIndices ?? stored.LegacyIndices),
        HasStoredCreditedIndices = stored.CreditedIndices != null
    };

    internal static Dictionary<string, SentenceSourceCoverage> ReadVersions(string? json)
    {
        if (json == null) return [];
        try
        {
            using var document = JsonDocument.Parse(json);
            var stored = document.RootElement;
            if (stored.ValueKind != JsonValueKind.Object) return [];
            if (stored.TryGetProperty(nameof(SourceRevision), out _) && stored.Deserialize<StoredCoverage>() is { } single)
            {
                var coverage = FromStored(single);
                return new() { [coverage.SourceRevision] = coverage };
            }
            var map = stored.Deserialize<Dictionary<string, StoredCoverage>>();
            return map == null ? [] : map.ToDictionary(pair => pair.Key, pair => FromStored(pair.Value));
        }
        catch (JsonException) { return []; }
    }

    internal static string WriteVersions(Dictionary<string, SentenceSourceCoverage> versions) =>
        JsonSerializer.Serialize(versions.ToDictionary(
            pair => pair.Key,
            pair => new StoredCoverage
            {
                SourceRevision = pair.Value.SourceRevision,
                Ranges = pair.Value.Ranges,
                LegacyIndices = pair.Value.LegacyIndices,
                CreditedIndices = pair.Value.CreditedIndices
            }));

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
