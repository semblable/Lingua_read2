using System;
using System.Collections.Generic;
using System.Text.Json;

namespace LinguaReadApi.Controllers
{
    /// <summary>
    /// Parses the raw AI response from SRS micro-context generation.
    /// Expects a JSON array of {term, context} objects, optionally wrapped in a markdown fence
    /// or surrounded by commentary. Returns an empty list on any parse failure.
    /// </summary>
    public static class SrsStoryResponseParser
    {
        public readonly record struct MicroContext(string Term, string Context, string UsedForm);

        public static List<MicroContext> ParseMicroContexts(string rawResponse)
        {
            var result = new List<MicroContext>();
            if (string.IsNullOrWhiteSpace(rawResponse)) return result;

            var jsonText = ExtractJsonArray(rawResponse);
            if (jsonText is null) return result;

            try
            {
                using var doc = JsonDocument.Parse(jsonText);
                if (doc.RootElement.ValueKind != JsonValueKind.Array) return result;

                foreach (var element in doc.RootElement.EnumerateArray())
                {
                    if (element.ValueKind != JsonValueKind.Object) continue;
                    if (!element.TryGetProperty("term", out var termProp)) continue;
                    if (!element.TryGetProperty("context", out var contextProp)) continue;
                    if (termProp.ValueKind != JsonValueKind.String) continue;
                    if (contextProp.ValueKind != JsonValueKind.String) continue;

                    var term = termProp.GetString()?.Trim() ?? "";
                    var context = contextProp.GetString()?.Trim() ?? "";
                    if (term.Length == 0 || context.Length == 0) continue;

                    // usedForm is optional; default to the term when absent or empty.
                    var usedForm = term;
                    if (element.TryGetProperty("usedForm", out var usedFormProp)
                        && usedFormProp.ValueKind == JsonValueKind.String)
                    {
                        var raw = usedFormProp.GetString()?.Trim() ?? "";
                        if (raw.Length > 0) usedForm = raw;
                    }

                    // Validate: usedForm must be a substring of context (case-insensitive).
                    // If the model lied or hallucinated, drop back to the term and let the
                    // frontend's substring search degrade gracefully.
                    if (context.IndexOf(usedForm, StringComparison.OrdinalIgnoreCase) < 0)
                    {
                        usedForm = term;
                    }

                    result.Add(new MicroContext(term, context, usedForm));
                }
            }
            catch (JsonException)
            {
                return new List<MicroContext>();
            }

            return result;
        }

        private static string? ExtractJsonArray(string raw)
        {
            var trimmed = raw.Trim();

            // Strip ```json … ``` or ``` … ``` fence
            if (trimmed.StartsWith("```"))
            {
                var firstNewline = trimmed.IndexOf('\n');
                if (firstNewline > 0) trimmed = trimmed[(firstNewline + 1)..];
                var fenceEnd = trimmed.LastIndexOf("```", StringComparison.Ordinal);
                if (fenceEnd >= 0) trimmed = trimmed[..fenceEnd];
                trimmed = trimmed.Trim();
            }

            // Find the outermost [ … ]
            var start = trimmed.IndexOf('[');
            var end = trimmed.LastIndexOf(']');
            if (start < 0 || end <= start) return null;

            return trimmed.Substring(start, end - start + 1);
        }
    }
}
