using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Tokenization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class RemediationReviewRegressionTests
{
    [Theory]
    [InlineData(false, false, false)]
    [InlineData(true, false, false)]
    [InlineData(true, true, false)]
    [InlineData(true, false, true)]
    public async Task WordInsertConflict_RetriesTheOwningTransactionOnlyForTheNamedWordConstraint(
        bool editText, bool unrelatedConstraint, bool persistentFailure)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        var userId = Guid.NewGuid();
        await using (var seed = new AppDbContext(options))
        {
            await seed.Database.EnsureCreatedAsync();
            seed.Users.Add(new User { Id = userId, UserName = "transaction-review" });
            seed.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
            seed.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "old",
                Content = editText ? "old word" : "new token" });
            await seed.SaveChangesAsync();
            if (editText) await WordLinker.LinkAsync(seed, 1, "old word", 1, userId);
        }
        var collision = new WordCollisionInterceptor(unrelatedConstraint, persistentFailure);
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>(options).AddInterceptors(collision).Options);
        async Task Apply()
        {
            if (editText)
            {
                var controller = new TextsController(context, NullLogger<TextsController>.Instance, null!, new WordLinkingChannel(), null!)
                    { ControllerContext = Identity(userId) };
                Assert.IsType<NoContentResult>(await controller.UpdateText(1, new UpdateTextDto {
                    TextId = 1, Title = "new", Content = "new token", LanguageId = 1 }));
            }
            else await WordLinker.LinkAsync(context, 1, "new token", 1, userId);
        }
        if (unrelatedConstraint || persistentFailure)
        {
            await Assert.ThrowsAsync<DbUpdateException>(Apply);
            Assert.Equal(unrelatedConstraint ? 1 : 3, collision.Transactions.Count);
            context.ChangeTracker.Clear();
            Assert.Equal("old word", (await context.Texts.SingleAsync()).Content);
            Assert.Equal(new[] { "old", "word" }, await context.TextWords.Select(tw => tw.Word.Term).OrderBy(term => term).ToArrayAsync());
        }
        else
        {
            await Apply();
            Assert.Equal(2, collision.Transactions.Count);
            Assert.Equal(2, collision.Transactions.Distinct().Count());
            Assert.Equal(new[] { "new", "token" }, await context.TextWords.Select(tw => tw.Word.Term).OrderBy(term => term).ToArrayAsync());
        }
    }

    private sealed class WordCollisionInterceptor(bool unrelated, bool persistent) : SaveChangesInterceptor
    {
        public List<Guid> Transactions { get; } = [];
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            var context = eventData.Context!;
            if (context.ChangeTracker.Entries<Word>().Any(entry => entry.State == EntityState.Added))
            {
                Transactions.Add(context.Database.CurrentTransaction!.TransactionId);
                if (persistent || Transactions.Count == 1)
                    throw new DbUpdateException("Simulated concurrent insert", new Npgsql.PostgresException(
                        "duplicate", "ERROR", "ERROR", "23505", constraintName:
                        unrelated ? "Unrelated_constraint" : "IX_Words_UserId_LanguageId_Term"));
            }
            return ValueTask.FromResult(result);
        }
    }
    private static ControllerContext Identity(Guid userId) => new() { HttpContext = new DefaultHttpContext {
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test")) } };

    [Fact]
    public async Task OldQueuedOrdinarySourceCannotUndoAnEditedText()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "review" });
        context.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "old", Content = "old word" });
        await context.SaveChangesAsync();
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, null!, new WordLinkingChannel(), null!)
            { ControllerContext = Identity(userId) };
        Assert.IsType<NoContentResult>(await controller.UpdateText(1, new UpdateTextDto { TextId = 1, Title = "new", Content = "new token", LanguageId = 1 }));
        // Exactly the arguments retained in an import's old WordLinkingRequest.
        await WordLinker.LinkAsync(context, 1, "old word", 1, userId);
        var linked = await context.TextWords.Where(tw => tw.TextId == 1).Select(tw => tw.Word.Term).Order().ToListAsync();
        Assert.Equal(new[] { "new", "token" }, linked);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateUpsertCanApplyAnOfflineCreatedWordsLaterDemotionAndTranslationEdit(string? translation)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "word-review" });
        context.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "text", Content = "a cat" });
        await context.SaveChangesAsync();
        var controller = new WordsController(context, NullLogger<WordsController>.Instance) { ControllerContext = Identity(userId) };
        // Initial queued create gets replayed, but the frontend's local row stays wordId=0.
        await controller.CreateWord(new CreateWordDto { TextId = 1, Term = "cat", Status = 4, Translation = "kot" });
        // The reader's zero-ID row causes the next save to POST again rather than PUT.
        await controller.CreateWord(new CreateWordDto { TextId = 1, Term = "cat", Status = 2, Translation = translation, ReplaceExisting = true });
        context.ChangeTracker.Clear();
        var word = await context.Words.Include(w => w.Translation).SingleAsync();
        Assert.Equal(2, word.Status);
        if (translation == null) Assert.Equal("kot", word.Translation?.Translation);
        else Assert.Null(word.Translation);
    }
}
