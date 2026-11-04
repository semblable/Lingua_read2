using LinguaReadApi.Models;
using LinguaReadApi.Data;
using LinguaReadApi.Services.Tokenization;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

public class LookupFallbackTests
{
    [Theory]
    [InlineData("he", "\"צה\"ל\"", "צה״ל")]
    [InlineData("he", "'מס'", "מס׳")]
    [InlineData("he", "וכו׳", "וכו׳")]
    [InlineData("ar", "کِتاب يی أإآٱ ةه", "كتاب يي اااا ةه")]
    [InlineData("fa", "كِتاب يی أإآٱ ةه", "کتاب یی اااا ةه")]
    [InlineData("tr", "İI", "iı")]
    [InlineData("az-Latn", "İI", "iı")]
    [InlineData("el", "λόγος", "λογοσ")]
    [InlineData("el", "ΛΟΓΟΣ", "λογοσ")]
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
}
