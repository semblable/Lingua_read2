using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace LinguaReadApi.Utilities
{
    /// <summary>
    /// LLM sentence translation returns paired XML-like tags: &lt;o s="N"&gt;...&lt;/o&gt;&lt;t s="N"&gt;...&lt;/t&gt;.
    /// UIs that only need the translation should receive plain text extracted from &lt;t&gt; tags.
    /// </summary>
    public static class PairedTranslationTagExtractor
    {
        // Matches <t s="1">...</t> or <t s='1'>...</t> with flexible whitespace
        private static readonly Regex TranslationTagRegex = new(
            @"<t\s+s=[""'](\d+)[""']>(.*?)</t>",
            RegexOptions.Singleline | RegexOptions.Compiled);

        /// <summary>
        /// If the string contains &lt;t s="N"&gt;...&lt;/t&gt; segments, returns their inner text in order, joined by spaces.
        /// Otherwise returns the original string trimmed (e.g. plain output from non-LLM providers).
        /// </summary>
        public static string ExtractTranslatedTextOnly(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return raw?.Trim() ?? string.Empty;
            }

            var matches = TranslationTagRegex.Matches(raw);
            if (matches.Count == 0)
            {
                return raw.Trim();
            }

            var parts = new List<(int Order, string Text)>();
            foreach (Match m in matches)
            {
                if (!int.TryParse(m.Groups[1].Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var order))
                {
                    continue;
                }

                parts.Add((order, m.Groups[2].Value.Trim()));
            }

            if (parts.Count == 0)
            {
                return raw.Trim();
            }

            return string.Join(" ", parts.OrderBy(p => p.Order).Select(p => p.Text));
        }
    }
}
