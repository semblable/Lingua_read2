using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;
using LinguaReadApi.Models;

namespace LinguaReadApi.Services.Tokenization
{
    /// <summary>
    /// Language-aware tokenizer shared by reader rendering (frontend mirror)
    /// and the word-linking background service. The algorithm mirrors
    /// `client/lingua-read-client/src/utils/readerText.js`:
    ///
    /// 1. Apply <see cref="Language.CharacterSubstitutions"/> as literal
    ///    find-and-replace pairs (pipe-separated <c>old=new</c>).
    /// 2. Build a per-character regex from <see cref="Language.WordCharacters"/>
    ///    with a Unicode-letter (\p{L}) fallback.
    /// 3. Walk the substituted content, accumulating runs of core word
    ///    chars **plus glued connectors**: ASCII apostrophe (U+0027) and
    ///    hyphen-minus, but only when sandwiched between two core word
    ///    chars. This preserves glued forms required for translation
    ///    lookup quality:
    ///      - French / Italian / Catalan / Occitan elisions: l'eau, qu'il, dell'acqua
    ///      - Portuguese clitics: interrompo-a, beijá-lo
    ///      - English contractions and hyphenated compounds: don't, well-known
    /// 4. Lookup keys are produced via locale-aware <see cref="TextInfo.ToLower(string)"/>
    ///    using the language's BCP-47 code, falling back to invariant.
    ///
    /// CJK parser types (mecab/jieba) currently fall back to the default
    /// algorithm; full CJK support is out of scope for this pass.
    /// </summary>
    public static class Tokenizer
    {
        private const char Apostrophe = '\'';
        private const char Hyphen = '-';
        private const string DefaultWordClass = @"\p{L}";

        // Built-in normalizations applied BEFORE user-defined
        // CharacterSubstitutions. Guarantees that apostrophe glue works
        // in every language — even custom ones with empty CharacterSubstitutions —
        // by mapping common curly / modifier apostrophe variants to
        // ASCII U+0027. User subs can still override.
        private static readonly (string Old, string New)[] BuiltInSubstitutions =
        {
            ("’", "'"), // ’ right single quote
            ("‘", "'"), // ‘ left single quote
            ("ʼ", "'")  // ʼ modifier letter apostrophe
        };

        private static readonly ConcurrentDictionary<string, Regex> _regexCache = new();
        private static readonly ConcurrentDictionary<string, TextInfo> _textInfoCache = new();

        public readonly record struct Token(string Text, int Start, int End, bool IsWord);

        public readonly record struct TokenizationResult(string Processed, IReadOnlyList<Token> Tokens);

        /// <summary>
        /// Parse a pipe-separated list of <c>old=new</c> pairs. The first
        /// '=' in each pair separates old from new; later '=' chars
        /// belong to the replacement.
        /// </summary>
        public static IReadOnlyList<(string Old, string New)> ParseCharacterSubstitutions(string? raw)
        {
            if (string.IsNullOrEmpty(raw))
            {
                return Array.Empty<(string, string)>();
            }

            var result = new List<(string Old, string New)>();
            foreach (var pair in raw.Split('|'))
            {
                var eq = pair.IndexOf('=');
                if (eq <= 0) continue;
                var oldStr = pair.Substring(0, eq);
                var newStr = pair.Substring(eq + 1);
                if (oldStr.Length == 0) continue;
                result.Add((oldStr, newStr));
            }
            return result;
        }

        public static string ApplyCharacterSubstitutions(string content, IReadOnlyList<(string Old, string New)> subs)
        {
            if (string.IsNullOrEmpty(content) || subs.Count == 0) return content;
            var current = content;
            foreach (var (oldStr, newStr) in subs)
            {
                current = current.Replace(oldStr, newStr);
            }
            return current;
        }

        public static Regex BuildCoreWordRegex(string? wordCharacters)
        {
            var raw = (wordCharacters ?? string.Empty).Trim();
            var key = string.IsNullOrEmpty(raw) ? "__default__" : raw;
            return _regexCache.GetOrAdd(key, _ =>
            {
                var cls = string.IsNullOrEmpty(raw) ? DefaultWordClass : raw;
                try
                {
                    return new Regex($"^[{cls}]$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
                }
                catch (ArgumentException)
                {
                    return new Regex($"^[{DefaultWordClass}]$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
                }
            });
        }

        /// <summary>
        /// Tokenize content into ordered word/separator segments. Indices
        /// reference the post-substitution text (returned as <c>Processed</c>).
        /// </summary>
        public static TokenizationResult Tokenize(string? rawContent, Language? language)
        {
            if (string.IsNullOrEmpty(rawContent))
            {
                return new TokenizationResult(string.Empty, Array.Empty<Token>());
            }

            var userSubs = ParseCharacterSubstitutions(language?.CharacterSubstitutions);
            // Built-in apostrophe normalizations run first so glue
            // works even when a custom language has empty
            // CharacterSubstitutions; user subs can override.
            var processed = ApplyCharacterSubstitutions(rawContent, BuiltInSubstitutions);
            processed = ApplyCharacterSubstitutions(processed, userSubs);
            var coreRegex = BuildCoreWordRegex(language?.WordCharacters);

            var tokens = new List<Token>();
            var i = 0;
            var len = processed.Length;

            ReadOnlySpan<char> span = processed.AsSpan();

            while (i < len)
            {
                if (IsCoreWordChar(coreRegex, span, i))
                {
                    var start = i;
                    i++;
                    while (i < len)
                    {
                        if (IsCoreWordChar(coreRegex, span, i))
                        {
                            i++;
                            continue;
                        }
                        if (IsConnector(processed[i])
                            && i + 1 < len
                            && IsCoreWordChar(coreRegex, span, i + 1))
                        {
                            i++;
                            continue;
                        }
                        break;
                    }
                    tokens.Add(new Token(processed.Substring(start, i - start), start, i, IsWord: true));
                }
                else
                {
                    tokens.Add(new Token(processed.Substring(i, 1), i, i + 1, IsWord: false));
                    i++;
                }
            }

            return new TokenizationResult(processed, tokens);
        }

        /// <summary>
        /// Convenience: extract the lowercased lookup keys of every word
        /// token, in document order, for word-linking and known-word
        /// lookups. Uses locale-aware lowercasing per the language's
        /// BCP-47 code with a safe fallback to invariant.
        /// </summary>
        public static IEnumerable<string> ExtractLookupKeys(string? rawContent, Language? language)
        {
            var result = Tokenize(rawContent, language);
            var textInfo = GetTextInfo(language?.Code);
            foreach (var tok in result.Tokens)
            {
                if (!tok.IsWord) continue;
                var trimmed = tok.Text.Trim();
                if (trimmed.Length == 0) continue;
                yield return textInfo.ToLower(trimmed);
            }
        }

        public static string NormalizeKey(string text, Language? language)
        {
            if (string.IsNullOrEmpty(text)) return text;
            return GetTextInfo(language?.Code).ToLower(text.Trim());
        }

        private static bool IsCoreWordChar(Regex coreRegex, ReadOnlySpan<char> span, int index)
        {
            // Span-based IsMatch avoids per-character string allocations
            // in the hot tokenization loop. Available on .NET 7+.
            return coreRegex.IsMatch(span.Slice(index, 1));
        }

        private static bool IsConnector(char ch) => ch == Apostrophe || ch == Hyphen;

        private static TextInfo GetTextInfo(string? code)
        {
            if (string.IsNullOrEmpty(code)) return CultureInfo.InvariantCulture.TextInfo;
            return _textInfoCache.GetOrAdd(code, c =>
            {
                try
                {
                    return CultureInfo.GetCultureInfo(c).TextInfo;
                }
                catch (CultureNotFoundException)
                {
                    return CultureInfo.InvariantCulture.TextInfo;
                }
            });
        }
    }
}
