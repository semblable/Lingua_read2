using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services.Srs
{
    /// <summary>
    /// Counts unknown words in the sentences shown on SRS cards (the "1T" badge and
    /// filter: a 1T sentence's only unknown word is the card's own). Tokenizes with the
    /// reader's <see cref="Tokenizer"/> and looks every sentence up in one vocabulary
    /// query per language, instead of one query per card.
    /// </summary>
    public static class SrsUnknownWordCounter
    {
        public sealed record Sentence(int Key, int TargetWordId, int LanguageId, string Text);

        /// <summary>
        /// Returns unknown-word counts by <see cref="Sentence.Key"/>. A word counts as
        /// unknown if it is the card's own word, if the user's highest-status row for it is
        /// below Known (5), or if it isn't in the vocabulary at all and is longer than one
        /// character. Known (5) and Ignored (6) words don't count.
        /// </summary>
        /// <param name="languages">The sentences' languages by id when the caller has
        /// already loaded them; looked up otherwise.</param>
        public static async Task<Dictionary<int, int>> CountAsync(
            AppDbContext db,
            Guid userId,
            IReadOnlyCollection<Sentence> sentences,
            IReadOnlyDictionary<int, Language>? languages = null,
            CancellationToken cancellationToken = default)
        {
            var counts = new Dictionary<int, int>();
            if (sentences.Count == 0) return counts;

            if (languages == null)
            {
                var languageIds = sentences.Select(s => s.LanguageId).Distinct().ToList();
                languages = await db.Languages.AsNoTracking()
                    .Where(l => languageIds.Contains(l.LanguageId))
                    .ToDictionaryAsync(l => l.LanguageId, cancellationToken);
            }

            foreach (var group in sentences.GroupBy(s => s.LanguageId))
            {
                var language = languages.GetValueOrDefault(group.Key);
                var keysBySentence = group.ToDictionary(
                    s => s.Key,
                    s => Tokenizer.ExtractLookupKeys(s.Text, language).Distinct().ToList());

                var allKeys = keysBySentence.Values.SelectMany(k => k).Distinct().ToList();
                if (allKeys.Count == 0)
                {
                    foreach (var s in group) counts[s.Key] = 0;
                    continue;
                }

                var vocab = await db.Words.AsNoTracking()
                    .Where(w => w.UserId == userId && w.LanguageId == group.Key && allKeys.Contains(w.Term.ToLower()))
                    .Select(w => new { w.WordId, w.Term, w.Status })
                    .ToListAsync(cancellationToken);

                // A lookup, not a dictionary: vocab can hold duplicate rows for one term
                // (see GetDueCards_DoesNotCrash_WhenVocabHasDuplicateTermRows).
                var byKey = vocab.ToLookup(w => Tokenizer.NormalizeKey(w.Term, language));

                foreach (var sentence in group)
                {
                    int unknown = 0;
                    foreach (var key in keysBySentence[sentence.Key])
                    {
                        var matches = byKey[key].ToList();
                        if (matches.Count == 0)
                        {
                            if (key.Length > 1) unknown++;
                        }
                        else if (matches.Any(m => m.WordId == sentence.TargetWordId) || matches.Max(m => m.Status) < 5)
                        {
                            unknown++;
                        }
                    }
                    counts[sentence.Key] = unknown;
                }
            }

            return counts;
        }
    }
}
