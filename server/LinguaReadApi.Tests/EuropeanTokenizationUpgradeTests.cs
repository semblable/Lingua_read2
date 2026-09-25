using LinguaReadApi.Data;
using LinguaReadApi.Data.Migrations;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// The upgrade path for existing installs when the tokenizer learned soft hyphens, decomposed
/// accents and the wider Latin classes: the WidenLanguageWordCharacters migration rewrites the
/// stored defaults, and the version-3 relink plus orphan cleanup replaces the fragments the old
/// tokenizer linked. Sqlite rather than InMemory: the migration is raw SQL and the cleanup is an
/// ExecuteDelete.
/// </summary>
public class EuropeanTokenizationUpgradeTests
{
    // The values DbInitializer and the add-language form stored before the migration.
    private const string OldLatin = "a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ";
    private const string OldItalian = "a-zA-ZÀàÉéÈèÌìÎîÓóÒòÙù";
    private const string OldPortuguese = "a-zA-ZÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü";
    private const string OldFormDefault = "a-zA-Z";
    private const string OldRussian = @"\p{L}\p{M}'-";

    // German's suffix: the regex escapes for ZWNJ and ZWJ, stored as backslash text.
    private const string ZeroWidthEscapes = @"\" + "u200C" + @"\" + "u200D";

    private static readonly string Shy = ((char)0x00AD).ToString();

    [Fact]
    public async Task WidenLanguageWordCharacters_RewritesOnlyShippedDefaults()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;

        await using (var seed = new AppDbContext(options))
        {
            await seed.Database.EnsureCreatedAsync();
            seed.Languages.AddRange(
                Lang(1, "en", OldLatin),
                Lang(2, "es", OldLatin),
                Lang(3, "fr", OldLatin),
                Lang(4, "de", OldLatin + ZeroWidthEscapes),
                Lang(5, "it", OldItalian),
                Lang(6, "pt", OldPortuguese),
                Lang(7, "ru", OldRussian),
                Lang(8, "pl", OldFormDefault),
                // Edited by the user: left alone.
                Lang(9, "cs", "a-zA-Záčďéěíňóřšťúůýž"),
                // Close to a default but not equal: left alone.
                Lang(10, "sv", OldLatin + "'"),
                // An old seed copied into a custom language: widened like the seed.
                Lang(11, "gl", OldPortuguese),
                // The form default on a MeCab / Jieba language: there is no segmenter yet,
                // so "any letter" would make each unspaced run of text one word. Left alone.
                Lang(12, "ja", OldFormDefault, parserType: "mecab"),
                Lang(13, "zh", OldFormDefault, parserType: "jieba"));
            await seed.SaveChangesAsync();
        }

        var migration = new WidenLanguageWordCharacters();
        await RunUpAsync(migration, connection);

        await using var context = new AppDbContext(options);
        var stored = await context.Languages.AsNoTracking()
            .OrderBy(l => l.LanguageId)
            .Select(l => l.WordCharacters)
            .ToListAsync();
        Assert.Equal(new[]
        {
            Language.LatinWordCharacters,
            Language.LatinWordCharacters,
            Language.LatinWordCharacters,
            Language.LatinWordCharacters + ZeroWidthEscapes,
            Language.LatinWordCharacters,
            Language.LatinWordCharacters,
            Language.DefaultWordCharacters,
            Language.DefaultWordCharacters,
            "a-zA-Záčďéěíňóřšťúůýž",
            OldLatin + "'",
            Language.LatinWordCharacters,
            OldFormDefault,
            OldFormDefault,
        }, stored);

        // Re-running is harmless, and Down deliberately does nothing.
        await RunUpAsync(migration, connection);
        Assert.Equal(stored, await context.Languages.AsNoTracking()
            .OrderBy(l => l.LanguageId).Select(l => l.WordCharacters).ToListAsync());
        Assert.Empty(migration.DownOperations);
    }

    [Fact]
    public async Task Relink_ReplacesSoftHyphenFragments_AndCleanupKeepsWordsTheUserTouched()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        var userId = Guid.NewGuid();
        var content = $"Fazal Elahi repa{Shy}rava. Quis contá-{Shy}las.";

        await using (var seed = new AppDbContext(options))
        {
            await seed.Database.EnsureCreatedAsync();
            seed.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
            seed.Languages.Add(Lang(1, "pt", Language.LatinWordCharacters));
            seed.Texts.AddRange(
                // Linked by tokenizer version 2, which split at the soft hyphens.
                new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Book part", Content = content, WordLinkingTokenizerVersion = 2 },
                // A text that really contains "repa" keeps that word alive.
                new Text { TextId = 2, UserId = userId, LanguageId = 1, Title = "Other", Content = "quis repa", WordLinkingTokenizerVersion = WordLinker.CurrentTokenizerVersion });
            var terms = new[] { "fazal", "elahi", "repa", "rava", "quis", "contá", "las" };
            for (var i = 0; i < terms.Length; i++)
            {
                seed.Words.Add(new Word
                {
                    WordId = i + 1,
                    UserId = userId,
                    LanguageId = 1,
                    Term = terms[i],
                    // The user marked "rava" while reading; everything else is linker-created.
                    Status = terms[i] == "rava" ? 2 : 0,
                });
                seed.TextWords.Add(new TextWord { TextId = 1, WordId = i + 1 });
            }
            // The user translated the fragment "las".
            seed.WordTranslations.Add(new WordTranslation { WordId = 7, Translation = "the" });
            seed.TextWords.Add(new TextWord { TextId = 2, WordId = 3 }); // repa
            seed.TextWords.Add(new TextWord { TextId = 2, WordId = 5 }); // quis
            await seed.SaveChangesAsync();
        }

        await using (var context = new AppDbContext(options))
        {
            await WordLinker.RelinkAsync(context, textId: 1, content, languageId: 1, userId);
        }

        await using (var context = new AppDbContext(options))
        {
            var linked = await context.TextWords.AsNoTracking()
                .Where(tw => tw.TextId == 1)
                .Select(tw => context.Words.First(w => w.WordId == tw.WordId).Term)
                .ToListAsync();
            Assert.Equal(new[] { "contá-las", "elahi", "fazal", "quis", "reparava" }, linked.OrderBy(t => t, StringComparer.Ordinal));
            var version = await context.Texts.AsNoTracking()
                .Where(t => t.TextId == 1).Select(t => t.WordLinkingTokenizerVersion).SingleAsync();
            Assert.Equal(WordLinker.CurrentTokenizerVersion, version);

            var deleted = await WordLinker.CleanupOrphanWordsAsync(context);

            // Only "contá" goes: untouched, unlinked and untranslated. "repa" is still in text 2,
            // "rava" has a status and "las" a translation.
            Assert.Equal(1, deleted);
            var remaining = await context.Words.AsNoTracking().Select(w => w.Term).ToListAsync();
            Assert.Equal(
                new[] { "contá-las", "elahi", "fazal", "las", "quis", "rava", "repa", "reparava" },
                remaining.OrderBy(t => t, StringComparer.Ordinal));
        }
    }

    [Fact]
    public async Task Cleanup_KeepsUntouchedWordsThatHaveAMinedSentenceOrACard()
    {
        // Mining works on an untranslated status-0 word and reviews never raise status 0.
        // A mined sentence's foreign key restricts the delete (one such word failed the whole
        // cleanup) and a card's cascades (the delete took the card's review history).
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        var userId = Guid.NewGuid();

        await using (var seed = new AppDbContext(options))
        {
            await seed.Database.EnsureCreatedAsync();
            seed.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
            seed.Languages.Add(Lang(1, "pt", Language.LatinWordCharacters));
            seed.Words.AddRange(
                new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "repa", Status = 0 },
                new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "rava", Status = 0 },
                new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "contá", Status = 0 });
            seed.SrsPhrases.Add(new SrsPhrase { WordId = 1, UserId = userId, Sentence = "Fazal Elahi repa" });
            seed.SrsCardReviews.Add(new SrsCardReview { WordId = 2, UserId = userId, NextReviewAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow });
            await seed.SaveChangesAsync();
        }

        await using var context = new AppDbContext(options);
        Assert.Equal(1, await WordLinker.CleanupOrphanWordsAsync(context));
        var remaining = await context.Words.AsNoTracking().Select(w => w.Term).ToListAsync();
        Assert.Equal(new[] { "rava", "repa" }, remaining.OrderBy(t => t, StringComparer.Ordinal));
        Assert.Equal(1, await context.SrsCardReviews.CountAsync());
    }

    [Fact]
    public async Task RekeyLegacyTerms_RewritesStaleTermsInPlace_AndLeavesDuplicatesAlone()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        var userId = Guid.NewGuid();
        var acute = ((char)0x0301).ToString();

        await using (var seed = new AppDbContext(options))
        {
            await seed.Database.EnsureCreatedAsync();
            seed.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
            var portuguese = Lang(1, "pt", Language.LatinWordCharacters);
            portuguese.CharacterSubstitutions = "´='|`='|’='|‘='|...=…|..=‥";
            seed.Languages.AddRange(portuguese, Lang(2, "es", Language.LatinWordCharacters));
            seed.Words.AddRange(
                // A phrase selected across a soft-hyphenated word by the old reader.
                new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = $"de repen{Shy}te", Status = 3 },
                // Decomposed accents.
                new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = $"e{acute}te{acute}", Status = 2 },
                // Its normalized form "l'eau" is taken (in another case) by row 4: left alone.
                new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "l’eau", Status = 1 },
                new Word { WordId = 4, UserId = userId, LanguageId = 1, Term = "L'eau", Status = 5 },
                // Two stale rows with one normalized form: the older one is rewritten, case kept.
                new Word { WordId = 5, UserId = userId, LanguageId = 1, Term = $"Ver{Shy}dade", Status = 1 },
                new Word { WordId = 6, UserId = userId, LanguageId = 1, Term = $"Verda{Shy}de", Status = 1 },
                // The language's own substitution, and stray whitespace.
                new Word { WordId = 7, UserId = userId, LanguageId = 1, Term = "d´África", Status = 1 },
                new Word { WordId = 8, UserId = userId, LanguageId = 1, Term = " casa ", Status = 1 },
                // "casa" in another language doesn't count as taken.
                new Word { WordId = 9, UserId = userId, LanguageId = 2, Term = "casa", Status = 1 });
            seed.WordTranslations.Add(new WordTranslation { WordId = 1, Translation = "suddenly" });
            await seed.SaveChangesAsync();
        }

        await using (var context = new AppDbContext(options))
        {
            Assert.Equal(5, await WordLinker.RekeyLegacyTermsAsync(context));
        }

        await using (var context = new AppDbContext(options))
        {
            var terms = await context.Words.AsNoTracking().ToDictionaryAsync(w => w.WordId, w => w.Term);
            Assert.Equal("de repente", terms[1]);
            Assert.Equal("été", terms[2]);
            Assert.Equal("l’eau", terms[3]);
            Assert.Equal("L'eau", terms[4]);
            Assert.Equal("Verdade", terms[5]);
            Assert.Equal($"Verda{Shy}de", terms[6]);
            Assert.Equal("d'África", terms[7]);
            Assert.Equal("casa", terms[8]);
            Assert.Equal("casa", terms[9]);
            // Rewritten in place: the translation is still attached.
            Assert.Equal(1, await context.WordTranslations.Where(wt => wt.WordId == 1).CountAsync());

            // Nothing left to do on a second run.
            Assert.Equal(0, await WordLinker.RekeyLegacyTermsAsync(context));
        }
    }

    private static async Task RunUpAsync(WidenLanguageWordCharacters migration, SqliteConnection connection)
    {
        // The migration is plain UPDATE statements, valid in both Postgres and Sqlite.
        foreach (var sql in migration.UpOperations.OfType<SqlOperation>().Select(o => o.Sql))
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            await command.ExecuteNonQueryAsync();
        }
    }

    private static Language Lang(int id, string code, string wordCharacters, string parserType = "spacedel") => new()
    {
        LanguageId = id,
        Name = code,
        Code = code,
        WordCharacters = wordCharacters,
        ParserType = parserType,
    };
}
