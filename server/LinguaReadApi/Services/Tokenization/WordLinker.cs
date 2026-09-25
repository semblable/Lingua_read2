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
        // Bump to 3: soft hyphens are dropped and decomposed accents
        // composed before tokenizing (Greek oxia letters become tonos
        // letters), Unicode hyphens glue like '-', a middle dot glues
        // (col·lecció), the Latin seeds cover every Latin letter, Russian
        // no longer counts a lone ' or - as a word, and an empty or invalid
        // class falls back to letters plus marks. Re-linking replaces
        // fragments such as "repa" + "rava" with "reparava"; the orphan
        // cleanup then deletes the fragments nobody translated or marked.
        public const int CurrentTokenizerVersion = 3;

        private const int WordBatchSize = 500;

        // Tries at the Word insert when a reader save keeps winning the race.
        private const int MaxWordInsertAttempts = 3;

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

            // The reader saves words too (a word click, auto-translate's batch), and
            // one it inserts between our probe and our insert collides on
            // IX_Words_UserId_LanguageId_Term. Chunks saved before the collision
            // stay; the re-probe finds them along with the reader's row.
            Dictionary<string, Word> existingWords;
            for (var attempt = 1; ; attempt++)
            {
                existingWords = await LoadWordsAsync(context, uniqueWords, language, languageId, userId, cancellationToken);

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

                try
                {
                    foreach (var batch in newWords.Chunk(WordBatchSize))
                    {
                        context.Words.AddRange(batch);
                        await context.SaveChangesAsync(cancellationToken);
                        context.ChangeTracker.Clear();
                    }
                    break;
                }
                catch (DbUpdateException) when (attempt < MaxWordInsertAttempts)
                {
                    context.ChangeTracker.Clear();
                }
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

        private static async Task<Dictionary<string, Word>> LoadWordsAsync(
            AppDbContext context,
            List<string> uniqueWords,
            Language? language,
            int languageId,
            Guid userId,
            CancellationToken cancellationToken)
        {
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
            return existingWordsList
                .GroupBy(w => Tokenizer.NormalizeKey(w.Term, language))
                .ToDictionary(g => g.Key, g => g.First());
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
        /// any Status &gt; 0 (bumped past the linker default), any
        /// WordTranslation row, a mined sentence or an SRS card keeps the Word
        /// alive even if it has no current TextWord references. Mining works on
        /// an untranslated status-0 word and reviews never raise status 0, so the
        /// last two are needed: a mined sentence's foreign key restricts the
        /// delete, which would fail the whole statement, and a card's cascades,
        /// which would take its review history with it.
        /// </summary>
        public static async Task<int> CleanupOrphanWordsAsync(
            AppDbContext context,
            CancellationToken cancellationToken = default)
        {
            return await context.Words
                .Where(w => w.Status == 0)
                .Where(w => !context.TextWords.Any(tw => tw.WordId == w.WordId))
                .Where(w => !context.WordTranslations.Any(wt => wt.WordId == w.WordId))
                .Where(w => !context.SrsPhrases.Any(sp => sp.WordId == w.WordId))
                .Where(w => !context.SrsCardReviews.Any(c => c.WordId == w.WordId))
                .ExecuteDeleteAsync(cancellationToken);
        }

        /// <summary>
        /// Rewrite stored terms the tokenizer can no longer produce into their
        /// <see cref="Tokenizer.NormalizeText"/> form (trimmed, case kept), so the
        /// reader, the linker and word saves find them again: a phrase saved with
        /// a soft hyphen in it, a word stored with decomposed accents, a curly
        /// apostrophe from before the built-in substitutions, a character the
        /// language substitutes. The row keeps its WordId, so its status,
        /// translation, sentences and card stay attached.
        ///
        /// The old linker never produced such terms, so a stale row is one the user
        /// saved. When rows already in normalized form answer the same lookup key:
        /// <list type="bullet">
        /// <item>If they are all untouched linker output (status 0, no translation,
        /// mined sentence or card) and the stale row is not, they are merged into
        /// it: their text links move over, they are deleted and the stale row is
        /// rewritten. Otherwise the relink would link every text to the empty row
        /// and hide the user's status and translation.</item>
        /// <item>If one of them has user data too, both are left alone: merging two
        /// rows' statuses, translations and cards is not worth it for a few
        /// duplicates.</item>
        /// </list>
        /// When several stale rows normalize to the same term, one with user data
        /// wins, then the oldest (lowest WordId). Called by
        /// <see cref="Services.WordLinkingMigrationService"/> before a relink pass;
        /// new writes are normalized by <see cref="Tokenizer.NormalizeKey"/>.
        /// </summary>
        public static async Task<int> RekeyLegacyTermsAsync(
            AppDbContext context,
            CancellationToken cancellationToken = default)
        {
            var languages = await context.Languages
                .AsNoTracking()
                .ToDictionaryAsync(l => l.LanguageId, cancellationToken);
            var words = await context.Words
                .AsNoTracking()
                .Select(w => new { w.WordId, w.UserId, w.LanguageId, w.Term, w.Status })
                .ToListAsync(cancellationToken);

            // Per user, language and lookup key: the stale rows and the rows already
            // in normalized form that answer the same key.
            var plans = new List<(List<RekeyRow> Stale, List<RekeyRow> Current)>();
            foreach (var group in words.GroupBy(w => (w.UserId, w.LanguageId)))
            {
                var language = languages.GetValueOrDefault(group.Key.LanguageId);
                var rows = group.Select(w =>
                {
                    var normalized = Tokenizer.NormalizeText(w.Term, language).Trim();
                    return new RekeyRow(w.WordId, w.Status, w.Term, normalized,
                        Tokenizer.LowercaseKey(normalized, language));
                });
                foreach (var byKey in rows.GroupBy(r => r.Key))
                {
                    var stale = byKey.Where(r => r.Normalized != r.Term && r.Normalized.Length > 0).ToList();
                    if (stale.Count == 0) continue;
                    plans.Add((stale, byKey.Where(r => r.Normalized == r.Term).ToList()));
                }
            }
            if (plans.Count == 0) return 0;

            var involvedIds = plans.SelectMany(p => p.Stale.Concat(p.Current)).Select(r => r.WordId).ToList();
            var withUserData = await WordIdsWithUserDataAsync(context, involvedIds, cancellationToken);
            bool Touched(RekeyRow row) => row.Status != 0 || withUserData.Contains(row.WordId);

            var changed = 0;
            foreach (var (stale, current) in plans)
            {
                var survivor = stale.OrderByDescending(Touched).ThenBy(r => r.WordId).First();
                if (current.Count == 0)
                {
                    changed += await RewriteTermAsync(context, survivor.WordId, survivor.Normalized, cancellationToken);
                }
                else if (Touched(survivor) && !current.Any(Touched))
                {
                    changed += await MergeUntouchedWordsAsync(
                        context, survivor.WordId, survivor.Normalized,
                        current.Select(r => r.WordId).ToList(), cancellationToken);
                }
            }
            return changed;
        }

        private sealed record RekeyRow(int WordId, int Status, string Term, string Normalized, string Key);

        // Words with a translation, a mined sentence or an SRS card: the user's data,
        // which a merge must never delete.
        private static async Task<HashSet<int>> WordIdsWithUserDataAsync(
            AppDbContext context,
            List<int> wordIds,
            CancellationToken cancellationToken)
        {
            var result = new HashSet<int>();
            foreach (var chunk in wordIds.Distinct().Chunk(WordBatchSize))
            {
                result.UnionWith(await context.WordTranslations
                    .Where(wt => chunk.Contains(wt.WordId)).Select(wt => wt.WordId).ToListAsync(cancellationToken));
                result.UnionWith(await context.SrsPhrases
                    .Where(sp => chunk.Contains(sp.WordId)).Select(sp => sp.WordId).ToListAsync(cancellationToken));
                result.UnionWith(await context.SrsCardReviews
                    .Where(c => chunk.Contains(c.WordId)).Select(c => c.WordId).ToListAsync(cancellationToken));
            }
            return result;
        }

        private static async Task<int> RewriteTermAsync(
            AppDbContext context,
            int wordId,
            string term,
            CancellationToken cancellationToken)
        {
            try
            {
                return await context.Words
                    .Where(w => w.WordId == wordId)
                    .ExecuteUpdateAsync(s => s.SetProperty(w => w.Term, term), cancellationToken);
            }
            catch (Exception ex) when (ex is DbUpdateException or System.Data.Common.DbException)
            {
                // A reader save inserted the same term since the read above (the
                // unique index says no), or the term outgrew the column. The new
                // row is the one lookups find; leave this one as it is.
                return 0;
            }
        }

        // Move the untouched words' text links onto the user's word, delete them and
        // rewrite the user's word, all or nothing. Returns 0 and changes nothing when
        // one of them gained user data since the read, or the write collides.
        private static async Task<int> MergeUntouchedWordsAsync(
            AppDbContext context,
            int survivorId,
            string term,
            List<int> untouchedIds,
            CancellationToken cancellationToken)
        {
            var strategy = context.Database.CreateExecutionStrategy();
            try
            {
                return await strategy.ExecuteAsync(async () =>
                {
                    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
                    foreach (var id in untouchedIds)
                    {
                        // A text linked to both keeps the user's word's link; the relink
                        // pass that follows recounts occurrences either way.
                        await context.TextWords
                            .Where(tw => tw.WordId == id
                                && !context.TextWords.Any(o => o.TextId == tw.TextId && o.WordId == survivorId))
                            .ExecuteUpdateAsync(s => s.SetProperty(tw => tw.WordId, survivorId), cancellationToken);
                        await context.TextWords
                            .Where(tw => tw.WordId == id)
                            .ExecuteDeleteAsync(cancellationToken);
                        var deleted = await context.Words
                            .Where(w => w.WordId == id
                                && w.Status == 0
                                && !context.WordTranslations.Any(wt => wt.WordId == w.WordId)
                                && !context.SrsPhrases.Any(sp => sp.WordId == w.WordId)
                                && !context.SrsCardReviews.Any(c => c.WordId == w.WordId))
                            .ExecuteDeleteAsync(cancellationToken);
                        if (deleted == 0) return 0; // no commit: the transaction rolls back
                    }
                    var updated = await context.Words
                        .Where(w => w.WordId == survivorId)
                        .ExecuteUpdateAsync(s => s.SetProperty(w => w.Term, term), cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return updated;
                });
            }
            catch (Exception ex) when (ex is DbUpdateException or System.Data.Common.DbException)
            {
                // A reader save inserted the same term, or linked the untouched word
                // to a new text, since the read. Nothing was committed.
                return 0;
            }
        }

        /// <summary>
        /// Mark "completed" every text still flagged "processing" that has
        /// already been linked with the current tokenizer. Two paths leave
        /// such rows behind: book imports that saved "processing" after
        /// enqueueing, overwriting parts the worker had already finished,
        /// and texts whose queued request was lost on restart and then
        /// relinked by <see cref="Services.WordLinkingMigrationService"/>,
        /// which stamps the version but never touches the status. The
        /// reader polls audio lessons for as long as the status says
        /// "processing". Texts not yet stamped are left alone: they are
        /// either still queued or waiting for the migration pass.
        /// </summary>
        public static async Task<int> CompleteLinkedTextsStuckProcessingAsync(
            AppDbContext context,
            CancellationToken cancellationToken = default)
        {
            return await context.Texts
                .Where(t => t.WordLinkingStatus == "processing")
                .Where(t => t.WordLinkingTokenizerVersion >= CurrentTokenizerVersion)
                .ExecuteUpdateAsync(
                    s => s.SetProperty(t => t.WordLinkingStatus, "completed"),
                    cancellationToken);
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
