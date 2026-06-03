using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services.Tokenization
{
    /// <summary>
    /// Unified word-linking helper. Owned by both the synchronous text
    /// upload path (TextsController) and the background channel
    /// (WordLinkingBackgroundService), and reused by the migration
    /// service that re-links legacy texts after a tokenizer change.
    ///
    /// On successful linking, stamps <see cref="Text.WordLinkingTokenizerVersion"/>
    /// with <see cref="CurrentTokenizerVersion"/> so the migration
    /// service can skip already-current texts.
    /// </summary>
    public static class WordLinker
    {
        /// <summary>
        /// Bumped whenever the tokenization algorithm changes in a way
        /// that would alter the produced token sequence (e.g.
        /// apostrophe/hyphen glue rules, default substitutions). The
        /// migration service re-links any text whose stored version is
        /// less than this constant.
        /// </summary>
        // Bump to 2: the linker now writes TextWord.OccurrenceCount
        // (running-token count per word per text). Re-linking each
        // legacy text replaces its placeholder OccurrenceCount=1 rows
        // with real frequencies so book/text stats reflect actual
        // running-word percentages instead of unique-word percentages.
        public const int CurrentTokenizerVersion = 2;

        private const int WordBatchSize = 500;

        /// <summary>
        /// Tokenize <paramref name="content"/>, materialise any new
        /// Word rows, and link the text via TextWord rows. Stamps the
        /// owning Text's <see cref="Text.WordLinkingTokenizerVersion"/>
        /// on success so the migration service can skip it next time.
        /// Idempotent: skips Words and (TextId, WordId) links that already
        /// exist, so re-running for the same text is safe. It does not delete
        /// stale TextWord rows — callers that need a clean re-link (e.g. after
        /// a tokenizer change) should call <see cref="RelinkAsync"/>.
        /// </summary>
        public static async Task LinkAsync(
            AppDbContext context,
            int textId,
            string content,
            int languageId,
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(content)) return;

            var language = await context.Languages
                .AsNoTracking()
                .FirstOrDefaultAsync(l => l.LanguageId == languageId, cancellationToken);

            var wordsInText = Tokenizer.ExtractLookupKeys(content, language)
                                       .Where(w => !string.IsNullOrWhiteSpace(w))
                                       .ToList();

            if (wordsInText.Count == 0)
            {
                await StampVersion(context, textId, cancellationToken);
                return;
            }

            var uniqueWords = wordsInText.Distinct().ToList();

            // Tally running-token counts per word so TextWord rows can
            // store real frequencies; drives running-word % stats.
            var occurrenceByTerm = wordsInText
                .GroupBy(w => w)
                .ToDictionary(g => g.Key, g => g.Count());

            var existingWordsList = new List<Word>();
            foreach (var batch in uniqueWords.Chunk(WordBatchSize))
            {
                var batchList = batch.ToList();
                var batchResults = await context.Words
                    .AsNoTracking()
                    .Where(w => w.UserId == userId
                             && w.LanguageId == languageId
                             && batchList.Contains(w.Term.ToLower()))
                    .ToListAsync(cancellationToken);
                existingWordsList.AddRange(batchResults);
            }

            // Key by the same normalized lookup key the probes use (uniqueWords
            // are already lowercased keys); keying by the raw Term would miss a
            // stored capitalized row (e.g. "Été") and create a duplicate.
            var existingWords = existingWordsList
                .GroupBy(w => Tokenizer.NormalizeKey(w.Term, language))
                .ToDictionary(g => g.Key, g => g.First());

            var newWords = new List<Word>();
            foreach (var wordTerm in uniqueWords)
            {
                if (!existingWords.ContainsKey(wordTerm))
                {
                    var newWord = new Word
                    {
                        UserId = userId,
                        LanguageId = languageId,
                        Term = wordTerm,
                        Status = 0,
                        CreatedAt = DateTime.UtcNow
                    };
                    newWords.Add(newWord);
                    existingWords[wordTerm] = newWord;
                }
            }

            foreach (var batch in newWords.Chunk(WordBatchSize))
            {
                context.Words.AddRange(batch);
                await context.SaveChangesAsync(cancellationToken);
                context.ChangeTracker.Clear();
            }

            // Skip (TextId, WordId) pairs already linked so re-running LinkAsync
            // for a text is idempotent and never violates the unique index.
            var alreadyLinkedWordIds = (await context.TextWords
                .Where(tw => tw.TextId == textId)
                .Select(tw => tw.WordId)
                .ToListAsync(cancellationToken))
                .ToHashSet();

            var textWordsToAdd = new List<TextWord>();
            foreach (var wordTerm in uniqueWords)
            {
                if (existingWords.TryGetValue(wordTerm, out var word)
                    && alreadyLinkedWordIds.Add(word.WordId))
                {
                    textWordsToAdd.Add(new TextWord
                    {
                        TextId = textId,
                        WordId = word.WordId,
                        OccurrenceCount = occurrenceByTerm.TryGetValue(wordTerm, out var occ) ? occ : 1,
                        CreatedAt = DateTime.UtcNow
                    });
                }
            }

            foreach (var batch in textWordsToAdd.Chunk(WordBatchSize))
            {
                await context.TextWords.AddRangeAsync(batch, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                context.ChangeTracker.Clear();
            }

            await StampVersion(context, textId, cancellationToken);
        }

        /// <summary>
        /// Drop existing TextWord rows for the text and re-link from
        /// scratch using the current tokenizer. Used by the
        /// /admin/relink-all endpoint and by
        /// <see cref="Services.WordLinkingMigrationService"/>.
        /// </summary>
        public static async Task RelinkAsync(
            AppDbContext context,
            int textId,
            string content,
            int languageId,
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            var existingLinks = await context.TextWords
                .Where(tw => tw.TextId == textId)
                .ToListAsync(cancellationToken);
            if (existingLinks.Count > 0)
            {
                context.TextWords.RemoveRange(existingLinks);
                await context.SaveChangesAsync(cancellationToken);
                context.ChangeTracker.Clear();
            }

            await LinkAsync(context, textId, content, languageId, userId, cancellationToken);
        }

        /// <summary>
        /// Delete orphan Word rows: auto-created (Status = 0), no
        /// TextWord references, and no WordTranslation row. These are
        /// the surface-form fragments left behind after a tokenizer
        /// change re-links texts to different boundaries (e.g. the bare
        /// "l" / "eau" stranded once "l'eau" became a single token).
        ///
        /// Words the user has interacted with are preserved unconditionally:
        /// any Status &gt; 0 (bumped past the linker default) or any
        /// WordTranslation row keeps the Word alive even if it has no
        /// current TextWord references.
        /// </summary>
        public static async Task<int> CleanupOrphanWordsAsync(
            AppDbContext context,
            CancellationToken cancellationToken = default)
        {
            return await context.Words
                .Where(w => w.Status == 0)
                .Where(w => !context.TextWords.Any(tw => tw.WordId == w.WordId))
                .Where(w => !context.WordTranslations.Any(wt => wt.WordId == w.WordId))
                .ExecuteDeleteAsync(cancellationToken);
        }

        private static async Task StampVersion(AppDbContext context, int textId, CancellationToken ct)
        {
            // Use a targeted UPDATE so we don't have to load the Text
            // entity (and don't conflict with any tracked version).
            var text = await context.Texts.FindAsync(new object[] { textId }, ct);
            if (text == null) return;
            text.WordLinkingTokenizerVersion = CurrentTokenizerVersion;
            await context.SaveChangesAsync(ct);
        }
    }
}
