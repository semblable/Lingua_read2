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
    /// Legacy mecab/jieba retain their boundaries. Explicit jieba-v1 text profiles
    /// use the pinned Chinese dictionary; no stored text is automatically upgraded.
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
        // Greek punctuation stays out of the letter runs: NFC turns the ano teleia
        // (U+0387) into a middle dot, which glues the words around it.
        private static readonly Regex ComposableRuns = new(
            @"(?:(?=\p{L})[\u0370-\u03FF\u1F00-\u1FFF])+\p{M}*|(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|\P{M})\p{M}+",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private static readonly Regex ArabicDiacriticsRegex = new(@"[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]", RegexOptions.Compiled);
        private static readonly Regex HebrewDiacriticsRegex = new(@"[\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]", RegexOptions.Compiled);
        private static readonly Regex CyrillicStressRegex = new(@"\u0301", RegexOptions.Compiled);
        private static readonly Regex LithuanianAccentsRegex = new(@"[\u0300\u0301\u0303]", RegexOptions.Compiled);
        // Normalize valid UTF-16 runs independently; preserve unmatched surrogates
        // like JavaScript String.normalize rather than throwing on malformed input.
        private static readonly Regex WellFormedRuns = new(@"(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\uD800-\uDFFF])+", RegexOptions.Compiled);

        private static readonly ConcurrentDictionary<string, Regex> _regexCache = new();
        private static readonly ConcurrentDictionary<string, TextInfo> _textInfoCache = new();
        private static readonly ConcurrentDictionary<string, IReadOnlyList<(string Old, string New)>> _substitutionCache = new();

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
            return ApplyCharacterSubstitutions(processed, GetCharacterSubstitutions(language?.CharacterSubstitutions));
        }

        // NormalizeKey runs this for every stored word a lookup or an import touches,
        // so the parsed pairs are cached per substitution string (a handful of languages).
        private static IReadOnlyList<(string Old, string New)> GetCharacterSubstitutions(string? raw) =>
            string.IsNullOrEmpty(raw)
                ? Array.Empty<(string, string)>()
                : _substitutionCache.GetOrAdd(raw, ParseCharacterSubstitutions);

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

            var chinese = language?.ParserType == ChineseSegmenter.Profile;
            var japanese = language?.ParserType == JapaneseSegmenter.Profile;
            var thai = language?.ParserType == ThaiSegmenter.Profile;
            var code = BaseLanguageCode(language?.Code);
            var italian = code == "it";
            var tokens = new List<Token>();
            var i = 0;
            var len = processed.Length;

            ReadOnlySpan<char> span = processed.AsSpan();

            while (i < len)
            {
                if (chinese && ChineseSegmenter.IsHanAt(processed, i))
                {
                    var end = ChineseSegmenter.FindHanRunEnd(processed, i);
                    tokens.AddRange(ChineseSegmenter.Default.SegmentHanRun(processed, i, end)
                        .Select(word => new Token(word.Text, word.Start, word.End, true)));
                    i = end;
                }
                else if (japanese && JapaneseSegmenter.IsJapaneseScriptAt(processed, i))
                {
                    var end = JapaneseSegmenter.FindJapaneseRunEnd(processed, i);
                    tokens.AddRange(JapaneseSegmenter.Default.SegmentRun(processed, i, end)
                        .Select(word => new Token(word.Text, word.Start, word.End, true)));
                    i = end;
                }
                else if (thai && ThaiSegmenter.IsThaiAt(processed, i))
                {
                    var end = ThaiSegmenter.FindThaiRunEnd(processed, i);
                    tokens.AddRange(ThaiSegmenter.Default.SegmentThaiRun(processed, i, end)
                        .Select(word => new Token(word.Text, word.Start, word.End, true)));
                    i = end;
                }
                else if (TryConsumeNumericOrCurrencyToken(processed, span, coreRegex, i, chinese, japanese, thai, out var numericEnd))
                {
                    tokens.Add(new Token(processed.Substring(i, numericEnd - i), i, numericEnd, IsWord: true));
                    i = numericEnd;
                }
                else if (TryConsumeLeadingApostrophe(processed, span, coreRegex, i, code, out var apostropheEnd))
                {
                    tokens.Add(new Token(processed.Substring(i, apostropheEnd - i), i, apostropheEnd, true));
                    i = apostropheEnd;
                }
                else if (CanStartWord(coreRegex, span, i))
                {
                    var start = i;
                    i = FindDottedInitialismEnd(processed, span, coreRegex, start);
                    while (i < len)
                    {
                        if ((chinese && ChineseSegmenter.IsHanAt(processed, i))
                            || (japanese && JapaneseSegmenter.IsJapaneseScriptAt(processed, i))
                            || (thai && ThaiSegmenter.IsThaiAt(processed, i))) break;
                        if (IsCoreWordChar(coreRegex, span, i))
                        {
                            i++;
                            continue;
                        }
                        if (code == "fi" && processed[i] == ':' && i > start
                            && (char.IsLetter(processed[i - 1]) || processed[i - 1] == '.') && i + 1 < len
                            && char.IsLower(processed[i + 1]) && IsCoreWordChar(coreRegex, span, i + 1))
                        {
                            i++;
                            continue;
                        }
                        if (IsConnector(processed[i])
                            && i + 1 < len
                            && IsCoreWordChar(coreRegex, span, i + 1)
                            && !((chinese && ChineseSegmenter.IsHanAt(processed, i + 1))
                                || (japanese && JapaneseSegmenter.IsJapaneseScriptAt(processed, i + 1))
                                || (thai && ThaiSegmenter.IsThaiAt(processed, i + 1))))
                        {
                            i++;
                            continue;
                        }
                        break;
                    }
                    while (i > start + 1 && (processed[i - 1] is '\u200c' or '\u200d'))
                    {
                        i--;
                    }
                    if (i < len && processed[i] is '\'' or '\u05f3'
                        && processed[i - 1] is >= '\u05d0' and <= '\u05ea') i++;
                    else if (italian && i < len && processed[i] == '\''
                        && i - start == 2
                        && (processed[start] is 'p' or 'P')
                        && (processed[start + 1] is 'o' or 'O')
                        && !(start > 0 && processed[start - 1] == '\'')) i++;
                    if (i < len && processed[i] == '.'
                        && (i + 1 == len || !IsCoreWordChar(coreRegex, span, i + 1))
                        && ((code == "en" && processed[start..i].Equals("dr", StringComparison.OrdinalIgnoreCase))
                            || (code == "uk" && processed[start..i].Equals("грн", StringComparison.OrdinalIgnoreCase)))) i++;
                    tokens.Add(new Token(processed.Substring(start, i - start), start, i, IsWord: true));
                }
                else
                {
                    var width = (chinese || japanese) && char.IsHighSurrogate(processed[i]) && i + 1 < len && char.IsLowSurrogate(processed[i + 1]) ? 2 : 1;
                    tokens.Add(new Token(processed.Substring(i, width), i, i + width, IsWord: false));
                    i += width;
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

            foreach (var tok in result.Tokens)
            {
                if (!tok.IsWord) continue;
                var trimmed = tok.Text.Trim();
                if (trimmed.Length == 0) continue;
                var key = NormalizeKey(trimmed, language);
                if (key.Length == 0) continue;
                yield return key;
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
            var normalized = NormalizeText(text, language).Trim().Trim('\u200c', '\u200d');
            var stripped = StripLookupDiacritics(normalized, language?.Code);
            return LowercaseKey(stripped, language);
        }

        /// <summary>
        /// Strip language-specific diacritics, cantillation, or tatweel for dictionary lookup:
        /// - Arabic (ar), Persian (fa), Urdu (ur): Tatweel (\u0640) and Tashkeel/Harakat/Quranic marks [\u064B-\u065F\u0670].
        /// - Hebrew (he): Niqqud and cantillation [\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7].
        /// - Russian (ru) and Ukrainian (uk): combining acute stress mark \u0301.
        /// - Lithuanian (lt): combining accents [\u0300\u0301\u0303].
        /// </summary>
        public static string StripLookupDiacritics(string text, string? languageCode)
        {
            if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(languageCode)) return text;
            var baseLang = languageCode.Trim().ToLowerInvariant().Replace('_', '-').Split('-')[0];
            if (baseLang == "iw") baseLang = "he";
            return baseLang switch
            {
                "ar" or "fa" => UnifyArabicLetters(ArabicDiacriticsRegex.Replace(text, string.Empty), baseLang),
                "ur" => ArabicDiacriticsRegex.Replace(text, string.Empty),
                "he" => HebrewDiacriticsRegex.Replace(text, string.Empty)
                    .TrimStart('"', '\'', '״', '׳').TrimEnd('"', '״').Replace('"', '״').Replace('\'', '׳'),
                "ru" or "uk" => CyrillicStressRegex.Replace(text, string.Empty),
                "lt" => LithuanianAccentsRegex.Replace(text, string.Empty),
                "el" => WellFormedRuns.Replace(text, run => run.Value.Normalize(NormalizationForm.FormD)
                    .Replace("\u0300", string.Empty).Replace("\u0301", string.Empty)
                    .Replace("\u0342", string.Empty).Normalize(NormalizationForm.FormC)),
                _ => text
            };
        }

        /// <summary>
        /// The lookup key of a term already in <see cref="NormalizeText"/> form and
        /// trimmed: <see cref="NormalizeKey"/> without normalizing a second time.
        /// </summary>
        internal static string LowercaseKey(string normalized, Language? language)
        {
            var code = BaseLanguageCode(language?.Code);
            if (RequiresNormalizedVocabularyLookup(code))
            {
                // Simple scalar casing is explicit on both runtimes: .NET and JS
                // otherwise differ on dotted I and contextual Greek final sigma.
                var lowered = new StringBuilder(normalized.Length);
                for (var i = 0; i < normalized.Length; i++)
                {
                    var ch = normalized[i];
                    if (ch == 'İ') lowered.Append('i');
                    else if (ch == 'I') lowered.Append(code is "tr" or "az" ? 'ı' : 'i');
                    else if (char.IsHighSurrogate(ch) && i + 1 < normalized.Length && char.IsLowSurrogate(normalized[i + 1]))
                        lowered.Append(Rune.ToLowerInvariant(new Rune(ch, normalized[++i])).ToString());
                    else lowered.Append(char.ToLowerInvariant(ch));
                }
                var result = lowered.ToString();
                return code == "el" ? result.Replace('ς', 'σ') : result;
            }
            return GetTextInfo(language?.Code).ToLower(normalized);
        }

        private static string BaseLanguageCode(string? code)
        {
            var value = (code ?? string.Empty).Trim().ToLowerInvariant().Replace('_', '-').Split('-')[0];
            return value == "iw" ? "he" : value;
        }

        public static bool RequiresNormalizedVocabularyLookup(string? code) =>
            BaseLanguageCode(code) is "he" or "ar" or "fa" or "tr" or "az" or "el";

        // Keep fallback eligibility separate from the language-specific casing table.
        public static bool RequiresLookupFallback(string? code) =>
            BaseLanguageCode(code) is "he" or "ar" or "fr" or "it" or "ca";

        private static string UnifyArabicLetters(string text, string code)
        {
            var unified = text.Replace('أ', 'ا').Replace('إ', 'ا').Replace('آ', 'ا').Replace('ٱ', 'ا');
            return code == "fa"
                ? unified.Replace('ي', 'ی').Replace('ك', 'ک')
                : unified.Replace('ی', 'ي').Replace('ک', 'ك');
        }

        /// <summary>Direct key first; fallback keys require a matching vocabulary/dictionary headword.
        /// Each peeling depth is ordered ordinally, so dictionary insertion order cannot choose a lemma.</summary>
        public static IReadOnlyList<string> GetLookupCandidates(string term, Language? language)
        {
            var key = NormalizeKey(term, language);
            var result = new List<string> { key };
            var seen = new HashSet<string>(StringComparer.Ordinal) { key };
            var code = BaseLanguageCode(language?.Code);
            if (code is "fr" or "it" or "ca")
            {
                // Bounded Romance elisions are lookup alternatives only:
                // keep the whole display span and prefer its exact saved headword.
                if (code == "it" && key == "po'")
                {
                    result.Add("po");
                    return result;
                }
                var prefixes = code == "it"
                    ? new[] { "l'", "d'", "un'", "quell'" }
                    : new[] { "l'", "d'" };
                foreach (var prefix in prefixes)
                {
                    if (key.StartsWith(prefix, StringComparison.Ordinal)
                        && IsElisionRemainder(key[prefix.Length..]))
                    {
                        result.Add(key[prefix.Length..]);
                        break;
                    }
                }
                return result;
            }
            var frontier = new List<string> { key };
            if (code == "he" && key.EndsWith('׳'))
            {
                var withoutGeresh = key.TrimEnd('׳');
                if (seen.Add(withoutGeresh)) { result.Add(withoutGeresh); frontier.Add(withoutGeresh); }
            }
            if (code is not ("he" or "ar")) return result;
            // At most conjunction + relative + preposition + article. Peeling never
            // changes display spans and never returns an unvalidated guess.
            for (var depth = 0; depth < 4 && frontier.Count > 0; depth++)
            {
                var next = new SortedSet<string>(StringComparer.Ordinal);
                foreach (var current in frontier)
                {
                    var prefixes = code == "he"
                        ? new[] { "ו", "ב", "ל", "כ", "מ", "ש", "ה" }
                        : new[] { "و", "ف", "ب", "ل", "ك", "ال" };
                    foreach (var prefix in prefixes)
                        if (current.StartsWith(prefix, StringComparison.Ordinal) && current.Length - prefix.Length >= 2)
                        {
                            var stripped = current[prefix.Length..];
                            if (seen.Add(stripped)) next.Add(stripped);
                        }
                    if (code == "ar" && current.StartsWith("لل", StringComparison.Ordinal) && current.Length >= 4)
                    {
                        var stripped = current[2..];
                        if (seen.Add(stripped)) next.Add(stripped);
                    }
                }
                frontier = next.ToList();
                result.AddRange(frontier);
            }
            return result;
        }

        private static bool IsElisionRemainder(string value)
        {
            var letters = 0;
            foreach (var rune in value.EnumerateRunes())
            {
                if (Rune.IsLetter(rune)) { letters++; continue; }
                if (letters == 0 || Rune.GetUnicodeCategory(rune) is not
                    (UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark))
                    return false;
            }
            return letters >= 2;
        }

        public static string? ResolveLookupKey(string term, Language? language, IEnumerable<string> headwords)
        {
            var keys = headwords.Select(word => NormalizeKey(word, language)).ToHashSet(StringComparer.Ordinal);
            return GetLookupCandidates(term, language).FirstOrDefault(keys.Contains);
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
            return coreRegex.IsMatch(span.Slice(index, 1)) || ThaiSegmenter.IsThaiDigit(span[index]) || span[index] is '\u200c' or '\u200d';
        }

        private static bool IsConnector(char ch) =>
            ch == Apostrophe || ch == Hyphen || ch == MiddleDot || ch == '\u05f4' || ch == '\u05f3' || ch == '"';

        // Only isolated language-specific proclitics; quoted letters remain separators.
        private static bool TryConsumeLeadingApostrophe(string text, ReadOnlySpan<char> span, Regex core,
            int start, string code, out int end)
        {
            end = start + 2;
            if (text[start] != '\'' || start + 1 >= text.Length
                || (start > 0 && (IsCoreWordChar(core, span, start - 1) || text[start - 1] == '\''))) return false;
            var letter = char.ToLowerInvariant(text[start + 1]);
            return ((code == "af" && letter == 'n') || (code == "nl" && letter is 's' or 't'))
                && IsCoreWordChar(core, span, start + 1)
                && (end == text.Length || (text[end] != '\'' && !IsCoreWordChar(core, span, end)));
        }

        private static int FindDottedInitialismEnd(string text, ReadOnlySpan<char> span, Regex core, int start)
        {
            var end = start;
            var letters = 0;
            while (end < text.Length && char.IsLetter(text[end]) && IsCoreWordChar(core, span, end))
            {
                letters++;
                end++;
                if (end == text.Length || text[end] != '.') break;
                end++;
            }
            return letters >= 2 && (end == text.Length || !IsCoreWordChar(core, span, end)) ? end : start + 1;
        }

        // ASCII grouping is deliberately narrower than the existing NBSP/decimal rules.
        private static int FindSpaceGroupedDecimalEnd(string text, ReadOnlySpan<char> span, Regex core, int start, int digitsEnd)
        {
            if (digitsEnd - start > 3) return digitsEnd;
            var end = digitsEnd;
            var groups = 0;
            while (end < text.Length && text[end] == ' ')
            {
                var next = end + 1;
                while (next < text.Length && IsNumericDigit(text[next])) next++;
                if (next - end != 4) break;
                groups++;
                end = next;
            }
            if (groups == 0 || end + 1 >= text.Length || text[end] != ',' || !IsNumericDigit(text[end + 1])) return digitsEnd;
            end += 2;
            while (end < text.Length && IsNumericDigit(text[end])) end++;
            var nextContext = end;
            while (nextContext < text.Length && IsHorizontalSpace(text[nextContext])) nextContext++;
            var previous = start - 1;
            while (previous >= 0 && IsHorizontalSpace(text[previous])) previous--;
            var hasContext = (nextContext < text.Length && (IsCurrencySymbol(text[nextContext]) || text[nextContext] == '%'
                || (char.IsLetter(text[nextContext]) && IsCoreWordChar(core, span, nextContext))))
                || (previous >= 0 && IsCurrencySymbol(text[previous]));
            return hasContext ? end : digitsEnd;
        }

        private static bool IsNumericDigit(char ch) =>
            char.GetUnicodeCategory(ch) == UnicodeCategory.DecimalDigitNumber;

        private static bool IsPersianDigit(char ch) =>
            ch is >= '\u06f0' and <= '\u06f9';

        private static bool IsNumericSeparator(char ch) =>
            ch is '.' or ',' or '\u00a0' or '\u202f' or '\u066c' or '\u066b';

        private static bool IsHorizontalSpace(char ch) =>
            ch is ' ' or '\u00a0' or '\u202f';

        private static bool IsCurrencySymbol(char ch) =>
            char.GetUnicodeCategory(ch) == UnicodeCategory.CurrencySymbol;

        private static bool TryConsumeNumericOrCurrencyToken(
            string processed,
            ReadOnlySpan<char> span,
            Regex coreRegex,
            int start,
            bool chinese,
            bool japanese,
            bool thai,
            out int numericEnd)
        {
            numericEnd = start;
            var len = processed.Length;
            if (start < 0 || start >= len) return false;
            var ch = processed[start];

            if (IsCurrencySymbol(ch))
            {
                var k = start + 1;
                while (k < len && IsHorizontalSpace(processed[k])) k++;
                if (k < len && IsNumericDigit(processed[k]))
                {
                    numericEnd = start + 1;
                    return true;
                }

                var p = start - 1;
                while (p >= 0 && IsHorizontalSpace(processed[p])) p--;
                if (p >= 0 && (IsNumericDigit(processed[p])
                    || (p >= 2 && processed[p] == '-' && processed[p - 1] == ',' && IsNumericDigit(processed[p - 2]))))
                {
                    numericEnd = start + 1;
                    return true;
                }
                return false;
            }

            if (!IsNumericDigit(ch)) return false;

            var end = start + 1;
            var hasPersianDigit = IsPersianDigit(ch);
            while (end < len && IsNumericDigit(processed[end]))
            {
                if (IsPersianDigit(processed[end])) hasPersianDigit = true;
                end++;
            }

            var groupedEnd = FindSpaceGroupedDecimalEnd(processed, span, coreRegex, start, end);
            var hasGroupedOrDecimalDigits = groupedEnd != end;
            end = groupedEnd;
            while (end + 1 < len && IsNumericSeparator(processed[end]) && IsNumericDigit(processed[end + 1]))
            {
                hasGroupedOrDecimalDigits = true;
                end++;
                while (end < len && IsNumericDigit(processed[end]))
                {
                    if (IsPersianDigit(processed[end])) hasPersianDigit = true;
                    end++;
                }
            }

            var hasAffix = false;
            if (end + 1 < len && processed[end] == ',' && processed[end + 1] == '-'
                && (end + 2 >= len || (!IsNumericDigit(processed[end + 2]) && !IsCoreWordChar(coreRegex, span, end + 2))))
            {
                hasAffix = true;
                end += 2;
            }
            else
            {
                if (end < len && processed[end] == '%')
                {
                    hasAffix = true;
                    end++;
                }
                if (end + 1 < len && processed[end] == '-'
                    && IsCoreWordChar(coreRegex, span, end + 1)
                    && !((chinese && ChineseSegmenter.IsHanAt(processed, end + 1))
                        || (japanese && JapaneseSegmenter.IsJapaneseScriptAt(processed, end + 1))
                        || (thai && ThaiSegmenter.IsThaiAt(processed, end + 1))))
                {
                    hasAffix = true;
                    end++;
                    while (end < len)
                    {
                        if ((chinese && ChineseSegmenter.IsHanAt(processed, end))
                            || (japanese && JapaneseSegmenter.IsJapaneseScriptAt(processed, end))
                            || (thai && ThaiSegmenter.IsThaiAt(processed, end))) break;
                        if (IsCoreWordChar(coreRegex, span, end))
                        {
                            end++;
                            continue;
                        }
                        break;
                    }
                    while (end > start + 1 && (processed[end - 1] is '\u200c' or '\u200d'))
                    {
                        end--;
                    }
                }
            }

            if (hasGroupedOrDecimalDigits || hasAffix || hasPersianDigit)
            {
                numericEnd = end;
                return true;
            }

            return false;
        }

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
