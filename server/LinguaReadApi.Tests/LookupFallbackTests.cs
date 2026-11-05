using LinguaReadApi.Models;
using LinguaReadApi.Data;
using LinguaReadApi.Services.Tokenization;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

public class LookupFallbackTests
{
    [Theory]
    [InlineData("fr", "l'eau", "eau", "eau")]
    [InlineData("fr-CA", "D’Anne", "Anne", "anne")]
    [InlineData("fr_FR", "lʼeau", "eau", "eau")]
    [InlineData("fr", "l'eau", "eau|l’eau", "l'eau")]
    [InlineData("fr", "d'accord", "accord|d'accord", "d'accord")]
    [InlineData("fr", "aujourd'hui", "hui", null)]
    [InlineData("fr", "qu'il", "il", "il")]
    [InlineData("fr", "œuf-là", "œuf", "œuf")]
    [InlineData("fr", "C'est", "est", "est")]
    [InlineData("fr", "l'a", "a", null)]
    [InlineData("fr", "l'ami fidèle", "ami fidèle", null)]
    [InlineData("fr", "d'l'eau", "l'eau|eau", null)]
    [InlineData("fr", "l'arc-en-ciel", "arc-en-ciel", null)]
    [InlineData("fr", "l'123", "123", null)]
    [InlineData("fr", "l'inconnu", "eau", null)]
    [InlineData("fr", "l'𐐨a", "𐐨a", "𐐨a")]
    [InlineData("fr", "l'İa", "ia", "ia")]
    [InlineData("fr", "l'ΟΣ", "οσ", "οσ")]
    [InlineData("fr", "l'âme", "âme", "âme")]
    [InlineData("fr", "l'ax́e", "ax́e", "ax́e")]
    [InlineData("fr", "l'á", "á", null)]
    [InlineData("fr", "l'́a", "́a", null)]
    [InlineData("fr", "l'́ab", "́ab", null)]
    [InlineData("en", "l'eau", "eau", null)]
    [InlineData("pt", "d'água", "água", null)]
    [InlineData("it", "l'acqua", "acqua", "acqua")]
    [InlineData("it-IT", "d’acqua", "acqua", "acqua")]
    [InlineData("it", "un'occhiata", "occhiata", "occhiata")]
    [InlineData("it", "quell'albero", "albero", "albero")]
    [InlineData("it", "po'", "po", "po")]
    [InlineData("it", "Po’", "po|po'", "po'")]
    [InlineData("it", "d'accordo", "accordo|d'accordo", "d'accordo")]
    [InlineData("it", "nell'ombra", "ombra", "ombra")]
    [InlineData("it", "qualcos'altro", "altro", "altro")]
    [InlineData("it", "c'è", "è|essere", null)]
    [InlineData("it", "un'idea", "acqua", null)]
    [InlineData("it", "l'İa", "ia", "ia")]
    [InlineData("it", "l'ΟΣ", "οσ", "οσ")]
    [InlineData("ca", "L'home", "home", "home")]
    [InlineData("ca-ES", "d’aigua", "aigua", "aigua")]
    [InlineData("ca", "d'un", "un", "un")]
    [InlineData("ca", "l'església", "església|l’església", "l'església")]
    [InlineData("ca", "d'anar-te'n", "anar-te'n|anar", "anar-te'n")]
    [InlineData("ca", "Dona'm-ho", "dona|donar", "dona")]
    [InlineData("ca", "anem-nos-en", "anem", "anem")]
    [InlineData("ro", "și-au", "au", "au")]
    [InlineData("ro", "și-au", "și", "și")]
    [InlineData("ro", "și-au", "și-au|au", "și-au")]
    [InlineData("ca", "l'objecte", "aigua", null)]
    [InlineData("ca", "l'İa", "ia", "ia")]
    [InlineData("ca", "l'ΟΣ", "οσ", "οσ")]
    [InlineData("nl", "'s Morgens", "morgens", "morgens")]
    [InlineData("nl", "'s Morgens", "'s morgens|morgens", "'s morgens")]
    [InlineData("nl", "'s Winters", "winters", "winters")]
    [InlineData("en", "rock 'n' roll", "rock 'n' roll", "rock 'n' roll")]
    public void FrenchElisionFallbackIsBoundedAndExactFirst(string code, string term, string fixture, string? expected) =>
        Assert.Equal(expected, Tokenizer.ResolveLookupKey(term, new Language { Code = code }, fixture.Split('|')));

    [Theory]
    [InlineData("it-IT", "un po’ l’acqua d’acqua un’acqua quell’acqua", "acqua", "po", 4, 1)]
    [InlineData("ca-ES", "l’aigua d’aigua aigua", "aigua", "home", 3, 0)]
    public async Task ItalianAndCatalanLinkerReusesValidatedWordsAndPreservesLearnerRecords(
        string code, string content, string primaryHeadword, string secondaryHeadword, int expectedPrimaryCount, int expectedSecondaryCount)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var userId = Guid.NewGuid();
        db.Users.Add(new User { Id = userId, UserName = "romance", Email = "romance@example.com" });
        db.Languages.Add(new Language { LanguageId = 1, Code = code, Name = code });
        db.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Romance", Content = content });
        db.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = primaryHeadword, Status = 5 });
        db.Words.Add(new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = secondaryHeadword, Status = 4 });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        await WordLinker.LinkAsync(db, 1, content, 1, userId);

        var links = await db.TextWords.OrderBy(link => link.WordId).ToListAsync();
        var primaryLink = Assert.Single(links, link => link.WordId == 1);
        Assert.Equal(expectedPrimaryCount, primaryLink.OccurrenceCount);
        if (expectedSecondaryCount > 0)
        {
            var secondaryLink = Assert.Single(links, link => link.WordId == 2);
            Assert.Equal(expectedSecondaryCount, secondaryLink.OccurrenceCount);
        }
    }

    [Fact]
    public void ItalianTrailingPoAndNumericCurrencySpansPreserveBoundaries()
    {
        var itResult = Tokenizer.Tokenize("C'è un po' d'acqua e 'po'!", new Language { Code = "it" });
        Assert.Equal(new[] { "C'è", "un", "po'", "d'acqua", "e", "po" },
            itResult.Tokens.Where(t => t.IsWord).Select(t => t.Text));

        var numResult = Tokenizer.Tokenize("Koszt 12,5 zł, pi 3.14. Цена 1\u00A0500,50 ₽, 12\u202F500,75 €, € 25.000,-, 10%-os, ۴۵٬۰۰۰.", new Language { Code = "pl" });
        Assert.Equal(
            new[] { "Koszt", "12,5", "zł", "pi", "3.14", "Цена", "1\u00A0500,50", "₽", "12\u202F500,75", "€", "€", "25.000,-", "10%-os", "۴۵٬۰۰۰" },
            numResult.Tokens.Where(t => t.IsWord).Select(t => t.Text));
        Assert.Contains(numResult.Tokens, t => !t.IsWord && t.Text == ".");
    }

    [Theory]
    [InlineData(false, 0)]
    [InlineData(true, 0)]
    [InlineData(true, 2)]
    public async Task FrenchLinkerReusesValidatedWordAndKeepsTrackedIdentity(bool directExists, int directStatus)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var userId = Guid.NewGuid();
        db.Users.Add(new User { Id = userId, UserName = "elision", Email = "elision@example.com" });
        db.Languages.Add(new Language { LanguageId = 1, Code = "fr-CA", Name = "French" });
        const string content = "l’eau eau d’eau";
        db.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Lookup", Content = content });
        db.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "eau", Status = 5,
            Translation = new WordTranslation { WordId = 1, Translation = "water" } });
        if (directExists) db.Words.Add(new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "l’eau", Status = directStatus });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        await WordLinker.LinkAsync(db, 1, content, 1, userId);
        var rows = await db.Words.Include(w => w.Translation).OrderBy(w => w.WordId).ToListAsync();
        Assert.Equal(directExists ? 2 : 1, rows.Count);
        Assert.Equal("eau", rows[0].Term);
        Assert.Equal(5, rows[0].Status);
        Assert.Equal("water", rows[0].Translation.Translation);
        if (directExists) { Assert.Equal("l’eau", rows[1].Term); Assert.Equal(directStatus, rows[1].Status); }
        var links = await db.TextWords.OrderBy(link => link.WordId).ToListAsync();
        Assert.Equal(directExists ? 2 : 1, links.Count);
        Assert.Equal(1, links[0].WordId);
        Assert.Equal(directExists ? 2 : 3, links[0].OccurrenceCount);
        if (directExists) { Assert.Equal(2, links[1].WordId); Assert.Equal(1, links[1].OccurrenceCount); }
    }

    [Theory]
    [InlineData("he", "\"צה\"ל\"", "צה״ל")]
    [InlineData("he", "'מס'", "מס׳")]
    [InlineData("he", "וכו׳", "וכו׳")]
    [InlineData("ar", "کِتاب يی أإآٱ ةه", "كتاب يي أإآٱ ةه")]
    [InlineData("fa", "كِتاب يی أإآٱ ةه", "کتاب یی أإآٱ ةه")]
    [InlineData("tr", "İI", "iı")]
    [InlineData("az-Latn", "İI", "iı")]
    [InlineData("el", "λόγος", "λόγος")]
    [InlineData("el", "ΛΟΓΟΣ", "λογος")]
    [InlineData("en", "I", "i")]
    [InlineData("en", "ς", "ς")]
    public void NormalizationIsLanguageGated(string code, string term, string expected) =>
        Assert.Equal(expected, Tokenizer.NormalizeKey(term, new Language { Code = code }));

    [Theory]
    [InlineData("he", "וכו׳", "וכו׳|וכו", "וכו׳")]
    [InlineData("he", "מס׳", "מס", "מס")]
    [InlineData("he", "והספר", "ספר", "ספר")]
    [InlineData("he", "ובספר", "בספר|ספר", "בספר")]
    [InlineData("he", "ושמהספר", "ספר", "ספר")]
    [InlineData("ar", "والكتاب", "كتاب", "كتاب")]
    [InlineData("ar", "للكتاب", "كتاب", "كتاب")]
    [InlineData("ar", "فبالكتاب", "كتاب", "كتاب")]
    [InlineData("ar", "والكتاب", "والكتاب|كتاب", "والكتاب")]
    [InlineData("ar", "بكتاب", "کِتاب", "كتاب")]
    [InlineData("en", "והספר", "ספר", null)]
    [InlineData("he", "ומסתורין", "ספר", null)]
    public void FallbackRequiresValidatedHeadwordAndDirectWins(string code, string term, string fixture, string? expected) =>
        Assert.Equal(expected, Tokenizer.ResolveLookupKey(term, new Language { Code = code }, fixture.Split('|')));

    [Fact]
    public void HebrewTrailingGereshRemainsInClickableSpan()
    {
        var result = Tokenizer.Tokenize("מס׳ וכו'", new Language { Code = "he" });
        Assert.Equal(new[] { "מס׳", "וכו'" }, result.Tokens.Where(t => t.IsWord).Select(t => t.Text));
        foreach (var token in result.Tokens)
            Assert.Equal(token.Text, result.Processed[token.Start..token.End]);
    }

    [Fact]
    public void GreekAccentFoldingPreservesMalformedUtf16AndFoldsValidRuns()
    {
        var input = "Ά" + (char)0xd800 + " Ώ" + (char)0xdc00;
        var expectedCanonical = "ά" + (char)0xd800 + " ώ" + (char)0xdc00;
        var expectedFolded = "α" + (char)0xd800 + " ω" + (char)0xdc00;
        Assert.Equal(expectedCanonical, Tokenizer.NormalizeKey(input, new Language { Code = "el" }));
        Assert.Equal(expectedFolded, Tokenizer.FoldLookupKey(input, new Language { Code = "el" }));
    }

    [Theory]
    [InlineData("he", "והספר", "ספר")]
    [InlineData("he", "מס׳", "מס")]
    [InlineData("ar", "بكتاب", "کِتاب")]
    [InlineData("fa", "کتاب", "كِتاب")]
    [InlineData("az", "IŞIQ", "ışıq")]
    [InlineData("el", "ΛΟΓΟΣ", "λόγος")]
    public async Task LinkerUsesNormalizedStoredHeadwordsWithoutRewritingThem(string code, string content, string stored)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var userId = Guid.NewGuid();
        db.Users.Add(new User { Id = userId, UserName = "lookup", Email = "lookup@example.com" });
        db.Languages.Add(new Language { LanguageId = 1, Code = code, Name = code });
        db.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Lookup", Content = content });
        db.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = stored, Status = 5 });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        await WordLinker.LinkAsync(db, 1, content, 1, userId);
        var row = Assert.Single(await db.Words.ToListAsync());
        Assert.Equal(stored, row.Term);
        Assert.Equal(5, row.Status);
        Assert.Equal(1, Assert.Single(await db.TextWords.ToListAsync()).WordId);
    }
    [Theory]
    [InlineData("af-ZA", "'n 'N 'n' 'name 's", "'n|'N|n|name|s")]
    [InlineData("nl-NL", "'s 'S 't 'T 's' 't' 'test 'n", "'s|'S|'t|'T|s|t|test|n")]
    [InlineData("nl", "'s Morgens 's Avonds 's Winters 't Kofschip", "'s Morgens|'s Avonds|'s Winters|'t Kofschip")]
    [InlineData("en", "'hello' 'em 'tis don't dogs' rock 'n' roll", "hello|em|tis|don't|dogs|rock 'n' roll")]
    [InlineData("fi", "EU:ssa EU: ssa EU:SSA EU:2 EU:! sana:ssa U.S.A.:ssa", "EU:ssa|EU|ssa|EU|SSA|EU|2|EU|sana:ssa|U.S.A.:ssa")]
    [InlineData("en", "EU:ssa Dr. U.S.A. A.B word. A.Beta A.", "EU|ssa|Dr.|U.S.A.|A.B|word|A|Beta|A")]
    [InlineData("fr", "M. Dupont arriva.", "M|Dupont|arriva")]
    [InlineData("uk", "1 250,00 грн. 12 345 678,90 kg 2026 2 000 грн.", "1 250,00|грн.|12 345 678,90|kg|2026|2 000|грн.")]
    [InlineData("uk", "1 250,00! 12 34,50 грн. 1 250 грн.", "1|250,00|12|34,50|грн.|1 250|грн.")]
    [InlineData("uk", "€ 1 250,00. 1 250,00 %", "€|1 250,00|1 250,00")]
    public void BoundedSpansPreserveUtf16(string code, string input, string expected)
    {
        var result = Tokenizer.Tokenize(input, new Language { Code = code });
        Assert.Equal(expected.Split('|'), result.Tokens.Where(t => t.IsWord).Select(t => t.Text));
        foreach (var token in result.Tokens) Assert.Equal(token.Text, result.Processed[token.Start..token.End]);
    }

    [Theory]
    [InlineData("af", "’N", "’N")]
    [InlineData("nl", "’S", "’S")]
    [InlineData("fi", "EU:ssa", "eu:ssa")]
    [InlineData("en", "U.S.A.", "u.s.a.")]
    [InlineData("en", "Dr.", "dr.")]
    [InlineData("uk", "грн.", "грн.")]
    [InlineData("uk", "1 250,00", "1 250,00")]
    public async Task BoundedLinkerPreservesSavedIdentity(string code, string content, string stored)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        await using var db = new AppDbContext(options);
        var userId = Guid.NewGuid();
        db.Users.Add(new User { Id = userId, UserName = "bounded", Email = "bounded@example.com" });
        db.Languages.Add(new Language { LanguageId = 1, Code = code, Name = code });
        content = code == "uk" && content.StartsWith("1") ? content + " kg" : content;
        db.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "Bounded", Content = content });
        db.Words.Add(new Word { WordId = 42, UserId = userId, LanguageId = 1, Term = stored, Status = 5,
            Translation = new WordTranslation { WordId = 42, Translation = "saved" } });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        await WordLinker.LinkAsync(db, 1, content, 1, userId);
        await WordLinker.LinkAsync(db, 1, content, 1, userId);
        var row = await db.Words.Include(w => w.Translation).SingleAsync(w => w.WordId == 42);
        Assert.Equal(stored, row.Term);
        Assert.Equal(5, row.Status);
        Assert.Equal("saved", row.Translation.Translation);
        Assert.Equal(1, (await db.TextWords.SingleAsync(w => w.WordId == 42)).OccurrenceCount);
        Assert.Equal(5, (await db.Texts.SingleAsync()).WordLinkingTokenizerVersion);
    }
}
