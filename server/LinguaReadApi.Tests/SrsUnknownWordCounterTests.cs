using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Srs;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

public class SrsUnknownWordCounterTests
{
    [Theory]
    [InlineData("en", "cats 2026", "cats", "unused", 5, 1)]
    [InlineData("en", "cats 2026", "cats", "2026", 1, 2)]
    [InlineData("en", "cats 2026", "cats", "2026", 6, 1)]
    [InlineData("en", "2026 cats", "2026", "cats", 5, 1)]
    [InlineData("fr", "chat l'eau", "chat", "eau", 5, 1)]
    [InlineData("fr", "chat l'eau", "chat", "eau", 1, 2)]
    [InlineData("el", "γάτα ΛΟΓΟΣ", "γάτα", "λόγος", 5, 1)]
    [InlineData("ar", "قط الكتاب", "قط", "كتاب", 5, 1)]
    [InlineData("nl", "kat 's Morgens", "kat", "morgens", 5, 1)]
    public async Task CountsMatchReaderNumericAndHeadwordLookupRules(
        string code, string sentence, string target, string other, int status, int expected)
    {
        await using var db = CreateContext();
        var user = Guid.NewGuid();
        db.Languages.Add(new Language { LanguageId = 1, Code = code, Name = code });
        db.Words.AddRange(
            new Word { WordId = 1, UserId = user, LanguageId = 1, Term = target, Status = 1 },
            new Word { WordId = 2, UserId = user, LanguageId = 1, Term = other, Status = status });
        await db.SaveChangesAsync();

        var counts = await SrsUnknownWordCounter.CountAsync(db, user,
            new[] { new SrsUnknownWordCounter.Sentence(1, 1, 1, sentence) });

        Assert.Equal(expected, counts[1]);
    }

    [Fact]
    public async Task ExactHeadwordTakesPrecedenceOverKnownFallback()
    {
        await using var db = CreateContext();
        var user = Guid.NewGuid();
        db.Languages.Add(new Language { LanguageId = 1, Code = "fr", Name = "French" });
        db.Words.AddRange(
            new Word { WordId = 1, UserId = user, LanguageId = 1, Term = "chat", Status = 1 },
            new Word { WordId = 2, UserId = user, LanguageId = 1, Term = "eau", Status = 5 },
            new Word { WordId = 3, UserId = user, LanguageId = 1, Term = "l'eau", Status = 1 });
        await db.SaveChangesAsync();

        var counts = await SrsUnknownWordCounter.CountAsync(db, user,
            new[] { new SrsUnknownWordCounter.Sentence(1, 1, 1, "chat l'eau") });

        Assert.Equal(2, counts[1]);
    }

    private static AppDbContext CreateContext() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
}
