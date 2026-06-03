using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.InMemory.Infrastructure.Internal;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Regression coverage for Tier-1 fixes 1.1 (a case-different stored term must
/// not spawn a duplicate Word row) and 1.3 (LinkAsync is idempotent w.r.t.
/// TextWord rows, so re-running it for a text is a no-op for linked pairs).
/// </summary>
public class WordLinkerTests
{
    [Fact]
    public async Task LinkAsync_WhenCapitalizedWordExists_DoesNotCreateDuplicate()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, code: "es");
        // A capitalized row already exists for this user+language.
        context.Words.Add(new Word { UserId = userId, LanguageId = 1, Term = "Hola", Status = 5 });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "T", Content = "hola hola" });
        context.SaveChanges();
        context.ChangeTracker.Clear();

        await WordLinker.LinkAsync(context, textId: 1, content: "hola hola", languageId: 1, userId: userId);

        // The lowercase tokens resolved to the existing "Hola" row — no duplicate.
        Assert.Equal(1, await context.Words.CountAsync());
        var links = await context.TextWords.Where(tw => tw.TextId == 1).ToListAsync();
        var link = Assert.Single(links);
        Assert.Equal(2, link.OccurrenceCount); // "hola" occurs twice
    }

    [Fact]
    public async Task LinkAsync_RunTwice_IsIdempotent_DoesNotDuplicateTextWords()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, code: "es");
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "T", Content = "uno dos tres" });
        context.SaveChanges();
        context.ChangeTracker.Clear();

        await WordLinker.LinkAsync(context, 1, "uno dos tres", 1, userId);
        var afterFirst = await context.TextWords.CountAsync(tw => tw.TextId == 1);

        await WordLinker.LinkAsync(context, 1, "uno dos tres", 1, userId);
        var afterSecond = await context.TextWords.CountAsync(tw => tw.TextId == 1);

        Assert.Equal(3, afterFirst);
        Assert.Equal(3, afterSecond); // second run skips already-linked pairs
        Assert.Equal(3, await context.Words.CountAsync());
    }

    // --- Helpers ---

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            // InMemory is non-transactional; suppress the warning so any
            // BeginTransactionAsync() is a no-op instead of throwing.
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        return new AppDbContext(options);
    }

    private static void SeedUserAndLanguage(AppDbContext context, Guid userId, string code)
    {
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Lang", Code = code });
        context.SaveChanges();
        context.ChangeTracker.Clear();
    }
}
