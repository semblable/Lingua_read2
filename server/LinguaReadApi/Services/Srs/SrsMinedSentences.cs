using System;
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
    /// Duplicate check for mined sentences. Sentences mined before tokenizer version 3
    /// are the reader's raw segment text (soft hyphens, decomposed accents), while the
    /// reader now sends them normalized, so an exact comparison would store the same
    /// sentence a second time. Both sides are compared in
    /// <see cref="Tokenizer.NormalizeText"/> form instead.
    /// </summary>
    public static class SrsMinedSentences
    {
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
