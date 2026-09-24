using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Startup repair for texts left at "processing" after they were linked
/// (book imports that saved the status after enqueueing, and queued
/// requests lost on restart then relinked by the migration pass).
/// Sqlite rather than InMemory because the repair is an ExecuteUpdate.
/// </summary>
public class WordLinkingStatusRepairTests
{
    [Fact]
    public async Task CompleteLinkedTextsStuckProcessing_OnlyFlipsProcessingRowsAtCurrentVersion()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;

        await using (var seed = new AppDbContext(options))
        {
            await seed.Database.EnsureCreatedAsync();
            var userId = Guid.NewGuid();
            seed.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
            seed.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
            seed.Texts.AddRange(
                // Linked but stuck: the rows the repair is for.
                StatusText(1, userId, "processing", WordLinker.CurrentTokenizerVersion),
                // Not linked yet (still queued, or waiting for the migration pass).
                StatusText(2, userId, "processing", null),
                StatusText(3, userId, "processing", WordLinker.CurrentTokenizerVersion - 1),
                // Other states are left as they are.
                StatusText(4, userId, "completed", WordLinker.CurrentTokenizerVersion),
                StatusText(5, userId, "failed", WordLinker.CurrentTokenizerVersion),
                StatusText(6, userId, null, WordLinker.CurrentTokenizerVersion));
            await seed.SaveChangesAsync();
        }

        await using var context = new AppDbContext(options);
        var repaired = await WordLinker.CompleteLinkedTextsStuckProcessingAsync(context);

        Assert.Equal(1, repaired);
        var statuses = await context.Texts.AsNoTracking()
            .OrderBy(t => t.TextId)
            .Select(t => t.WordLinkingStatus)
            .ToListAsync();
        Assert.Equal(new string?[] { "completed", "processing", "processing", "completed", "failed", null }, statuses);

        // Idempotent: a second startup finds nothing to do.
        Assert.Equal(0, await WordLinker.CompleteLinkedTextsStuckProcessingAsync(context));
    }

    private static Text StatusText(int id, Guid userId, string? status, int? tokenizerVersion) => new()
    {
        TextId = id,
        UserId = userId,
        LanguageId = 1,
        Title = $"T{id}",
        Content = "hola",
        WordLinkingStatus = status,
        WordLinkingTokenizerVersion = tokenizerVersion
    };
}
