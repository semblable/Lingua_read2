using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using LinguaReadApi.Models;

namespace LinguaReadApi.Services.Tokenization
{
    /// <summary>
    /// Language-aware tokenizer shared by reader rendering (frontend mirror)
    /// and the word-linking background service. The algorithm mirrors
    /// `client/lingua-read-client/src/utils/readerText.js`:
    ///
    /// 1. <see cref="NormalizeInput"/>: drop soft hyphens (U+00AD, invisible
    ///    hyphenation points ebooks put inside words) and compose decomposed
    ///    accents (e + U+0301 → é), so neither splits a word.
    /// 2. Apply the built-in substitutions (curly / modifier apostrophes → ',
    ///    Unicode hyphens U+2010 / U+2011 → -), then
    ///    <see cref="Language.CharacterSubstitutions"/> as literal
    ///    find-and-replace pairs (pipe-separated <c>old=new</c>). Steps 1 and 2
    ///    together are <see cref="NormalizeText"/>.
    /// 3. Build a per-character regex from <see cref="Language.WordCharacters"/>
    ///    with a fallback to <see cref="Language.DefaultWordCharacters"/> when the
    ///    class is empty or invalid.
    /// 4. Walk the substituted content, accumulating runs of core word
    ///    chars **plus glued connectors**: ASCII apostrophe (U+0027),
    ///    hyphen-minus and middle dot (U+00B7), but only when sandwiched
    ///    between two core word chars. This preserves glued forms required
    ///    for translation lookup quality:
    ///      - French / Italian / Catalan / Occitan elisions: l'eau, qu'il, dell'acqua
    ///      - Portuguese clitics: interrompo-a, beijá-lo
    ///      - English contractions and hyphenated compounds: don't, well-known
    ///      - Catalan geminated l: col·lecció
    ///    A combining mark or format character can continue a word but not
    ///    start one (an emoji's variation selector is not a word).
    /// 5. Lookup keys are produced via locale-aware <see cref="TextInfo.ToLower(string)"/>
    ///    using the language's BCP-47 code, falling back to invariant.
    ///
    /// CJK parser types (mecab/jieba) currently fall back to the default
    /// algorithm; full CJK support is out of scope for this pass.
    /// </summary>
    public static class Tokenizer
    {
        private const char Apostrophe = '\'';
        private const char Hyphen = '-';
        private const char MiddleDot = '·';
        private const char SoftHyphen = '\u00AD';
        private const string DefaultWordClass = Language.DefaultWordCharacters;

        // Built-in normalizations applied BEFORE user-defined
        // CharacterSubstitutions. Guarantees that apostrophe/hyphen glue works
        // in every language — even custom ones with empty CharacterSubstitutions —
        // by mapping common curly / modifier apostrophe and Unicode hyphen
        // variants to ASCII. User subs can still override.
        private static readonly (string Old, string New)[] BuiltInSubstitutions =
        {
            ("’", "'"), // ’ right single quote
            ("‘", "'"), // ‘ left single quote
            ("ʼ", "'"), // ʼ modifier letter apostrophe
            ("\u2010", "-"), // hyphen
            ("\u2011", "-")  // non-breaking hyphen
        };

        // The runs NormalizeInput composes: a run of Greek letters (with any marks
        // after it), or any other base character followed by one or more combining
        // marks. A surrogate pair counts as one base so Normalize never sees half of it.
        private static readonly Regex ComposableRuns = new(
            @"[\u0370-\u03FF\u1F00-\u1FFF]+\p{M}*|(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|\P{M})\p{M}+",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

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

        /// <summary>
        /// Remove soft hyphens and compose decomposed accents (NFC, applied only
        /// to base + combining-mark runs and to Greek letters, so the rest of the
        /// text is untouched). Greek letters are composed even without a mark:
        /// that maps the oxia forms of Greek Extended (alpha with oxia, U+1F71)
        /// onto the tonos letters keyboards produce (alpha with tonos, U+03AC),
        /// which look the same but would otherwise be different words. Runs
        /// before any substitution. Mirrors
        /// <c>normalizeTokenizerInput</c> in the client's readerText.ts.
        /// </summary>
        public static string NormalizeInput(string content)
        {
            if (string.IsNullOrEmpty(content)) return content;
            var current = content.Contains(SoftHyphen)
                ? content.Replace(SoftHyphen.ToString(), string.Empty, StringComparison.Ordinal)
                : content;
            if (!NeedsComposition(current)) return current;
            return ComposableRuns.Replace(current, m =>
            {
                try
                {
                    return m.Value.Normalize(NormalizationForm.FormC);
                }
                catch (ArgumentException)
                {
                    // Unpaired surrogate in malformed input: leave the run as-is.
                    return m.Value;
                }
            });
        }

        /// <summary>
        /// <see cref="NormalizeInput"/>, then the built-in substitutions, then the
        /// language's <see cref="Language.CharacterSubstitutions"/>: the text the
        /// tokenizer walks and the reader displays. Also the form a sentence or a
        /// term has to be in before it is compared with tokens.
        /// </summary>
        public static string NormalizeText(string? content, Language? language)
        {
            if (string.IsNullOrEmpty(content)) return content ?? string.Empty;
            var processed = ApplyCharacterSubstitutions(NormalizeInput(content), BuiltInSubstitutions);
            return ApplyCharacterSubstitutions(processed, ParseCharacterSubstitutions(language?.CharacterSubstitutions));
        }

        private static bool NeedsComposition(string text)
        {
            foreach (var ch in text)
            {
                if (IsCombiningMark(ch) || IsGreek(ch)) return true;
            }
            return false;
        }

        // Greek and Coptic (U+0370-U+03FF) and Greek Extended (U+1F00-U+1FFF), the
        // blocks the first alternative of ComposableRuns covers.
        private static bool IsGreek(char ch) =>
            (ch >= 0x0370 && ch <= 0x03FF) || (ch >= 0x1F00 && ch <= 0x1FFF);

        private static bool IsCombiningMark(char ch) =>
            char.GetUnicodeCategory(ch) is UnicodeCategory.NonSpacingMark
                or UnicodeCategory.SpacingCombiningMark
                or UnicodeCategory.EnclosingMark;

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

            // Built-in apostrophe normalizations run first so glue
            // works even when a custom language has empty
            // CharacterSubstitutions; user subs can override.
            var processed = NormalizeText(rawContent, language);
            var coreRegex = BuildCoreWordRegex(language?.WordCharacters);

            var tokens = new List<Token>();
            var i = 0;
            var len = processed.Length;

            ReadOnlySpan<char> span = processed.AsSpan();

            while (i < len)
            {
                if (CanStartWord(coreRegex, span, i))
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

        /// <summary>
        /// Lookup key for a term that did not come out of <see cref="Tokenize"/>
        /// (a reader save, a CSV row, a stored Word): <see cref="NormalizeText"/>
        /// like the tokenizer, so a term with a soft hyphen, a curly apostrophe or
        /// a character the language substitutes (´ for ') keys like the word the
        /// reader shows, then trimmed and lowercased.
        /// </summary>
        public static string NormalizeKey(string text, Language? language)
        {
            if (string.IsNullOrEmpty(text)) return text;
            return GetTextInfo(language?.Code).ToLower(NormalizeText(text, language).Trim());
        }

        // A combining mark or format character (an emoji's variation selector, a
        // zero-width joiner) may continue a word but never start one: on its own
        // it would be an invisible clickable "word".
        private static bool CanStartWord(Regex coreRegex, ReadOnlySpan<char> span, int index) =>
            IsCoreWordChar(coreRegex, span, index)
            && !IsCombiningMark(span[index])
            && char.GetUnicodeCategory(span[index]) != UnicodeCategory.Format;

        private static bool IsCoreWordChar(Regex coreRegex, ReadOnlySpan<char> span, int index)
        {
            // Span-based IsMatch avoids per-character string allocations
            // in the hot tokenization loop. Available on .NET 7+.
            return coreRegex.IsMatch(span.Slice(index, 1));
        }

        private static bool IsConnector(char ch) => ch == Apostrophe || ch == Hyphen || ch == MiddleDot;

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
