using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>
    /// Duplicate check for mined sentences. Sentences mined before tokenizer version 3
    /// are the reader's raw segment text (soft hyphens, decomposed accents), while the
    /// reader now sends them normalized, so an exact comparison would store the same
    /// sentence a second time. Both sides are compared in
    /// <see cref="Tokenizer.NormalizeText"/> form instead.
    /// </summary>
    public static class SrsMinedSentences
    {
        /// <summary>Use the vocabulary's language-aware keys and lookup aliases when
        /// checking a reader example, rather than accepting an unrelated sentence.</summary>
        public static bool ContainsTerm(string sentence, string term, Language? language)
        {
            var needle = Tokenizer.NormalizeKey(term, language);
            if (string.IsNullOrWhiteSpace(needle)) return false;
            if (KoreanLookup.IsKoreanLanguageCode(language?.Code))
            {
                // Match the reader's base/surface spans and equivalent Hangul encodings.
                return KoreanLookup.FindMatches(Tokenizer.NormalizeText(sentence, language), needle).Count > 0;
            }
            var words = Tokenizer.Tokenize(term, language).Tokens.Where(t => t.IsWord).ToList();
            if (words.Count == 1 && Tokenizer.NormalizeKey(words[0].Text, language) == needle)
            {
                if (Tokenizer.Tokenize(sentence, language).Tokens.Any(t => t.IsWord &&
                    Tokenizer.ResolveLookupKey(t.Text, language, new[] { term }) != null)) return true;
            }
            var normalized = Tokenizer.NormalizeKey(sentence, language);
            var code = language?.Code.Split('-', '_')[0].ToLowerInvariant();
            // Unspaced scripts can contain a valid selected term within a longer
            // token even when a legacy language profile has no segmenter.
            var pattern = code is "zh" or "ja" or "th"
                ? Regex.Escape(needle)
                : $@"(?<![\p{{L}}\p{{M}}\p{{N}}]){Regex.Escape(needle)}(?![\p{{L}}\p{{M}}\p{{N}}])";
            return Regex.IsMatch(normalized, pattern, RegexOptions.CultureInvariant);
        }

        /// <summary>Ordinary saves fill a missing example once. Later encounters do
        /// not replace it, append duplicates, or create additional review cards.</summary>
        public static async Task<bool> CaptureFirstAsync(AppDbContext context, Word word,
            string? sentence, Text text)
        {
            if (word.Status is < 1 or > 4 || string.IsNullOrWhiteSpace(sentence)
                || !ContainsTerm(sentence, word.Term, text.Language)) return false;
            if (word.WordId != 0)
            {
                var stored = await context.SrsPhrases.AsNoTracking()
                    .Where(p => p.WordId == word.WordId && p.UserId == word.UserId)
                    .Select(p => p.Sentence).ToListAsync();
                if (stored.Concat(context.SrsPhrases.Local.Where(p => p.WordId == word.WordId && p.UserId == word.UserId)
                    .Select(p => p.Sentence)).Any(s => !string.IsNullOrWhiteSpace(s) && ContainsTerm(s, word.Term, text.Language))) return false;
            }
            context.SrsPhrases.Add(new SrsPhrase
            {
                Word = word, UserId = word.UserId,
                Sentence = Tokenizer.NormalizeText(sentence, text.Language).Trim(),
                TextId = text.TextId, TextTitle = text.Title, CreatedAt = DateTime.UtcNow
            });
            return true;
        }

        public static async Task<bool> ExistsAsync(
            AppDbContext context,
            int wordId,
            Guid userId,
            string sentence,
            Language? language,
            CancellationToken cancellationToken = default)
        {
            var normalized = Tokenizer.NormalizeText(sentence, language);
            // A word has a handful of mined sentences at most.
            var stored = await context.SrsPhrases
                .AsNoTracking()
                .Where(p => p.WordId == wordId && p.UserId == userId)
                .Select(p => p.Sentence)
                .ToListAsync(cancellationToken);
            return stored.Any(s => Tokenizer.NormalizeText(s, language) == normalized);
        }
    }
}
