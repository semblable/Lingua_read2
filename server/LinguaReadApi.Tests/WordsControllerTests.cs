using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class WordsControllerTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()) // Unique DB per test
            .Options;
        return new AppDbContext(options);
    }

    private static WordsController CreateController(AppDbContext context, Guid userId)
    {
        return new WordsController(context, NullLogger<WordsController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                    }, "TestAuth"))
                }
            }
        };
    }

    private static (Guid userId, int wordId) SeedWord(AppDbContext context, int status)
    {
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
        var word = new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "gato", Status = status };
        context.Words.Add(word);
        context.SaveChanges();
        return (userId, word.WordId);
    }

    [Fact]
    public async Task UpdateWord_MarkingIgnored_SuspendsExistingSrsCard()
    {
        using var context = CreateContext();
        var (userId, wordId) = SeedWord(context, status: 2);
        context.SrsCardReviews.Add(new SrsCardReview
        {
            WordId = wordId,
            UserId = userId,
            NextReviewAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            IsSuspended = false
        });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        var result = await controller.UpdateWord(wordId, new UpdateWordDto { Status = 6 });

        Assert.IsType<NoContentResult>(result);
        var card = await context.SrsCardReviews.SingleAsync(c => c.WordId == wordId);
        Assert.True(card.IsSuspended);
        var word = await context.Words.SingleAsync(w => w.WordId == wordId);
        Assert.Equal(6, word.Status);
    }

    [Fact]
    public async Task UpdateWord_MarkingIgnored_DoesNotCreateSrsCard()
    {
        using var context = CreateContext();
        var (userId, wordId) = SeedWord(context, status: 1);

        var controller = CreateController(context, userId);
        var result = await controller.UpdateWord(wordId, new UpdateWordDto { Status = 6 });

        Assert.IsType<NoContentResult>(result);
        Assert.Empty(context.SrsCardReviews.Where(c => c.WordId == wordId));
    }

    [Fact]
    public async Task UpdateWord_UnignoringWord_UnsuspendsExistingCard()
    {
        using var context = CreateContext();
        var (userId, wordId) = SeedWord(context, status: 6);
        context.SrsCardReviews.Add(new SrsCardReview
        {
            WordId = wordId,
            UserId = userId,
            NextReviewAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            IsSuspended = true,
            SuspendReason = "ignored" // what ignoring (or the AddFsrsScheduling migration) records
        });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        var result = await controller.UpdateWord(wordId, new UpdateWordDto { Status = 2 });

        Assert.IsType<NoContentResult>(result);
        var card = await context.SrsCardReviews.SingleAsync(c => c.WordId == wordId);
        Assert.False(card.IsSuspended);
        Assert.Null(card.SuspendReason);
    }

    [Fact]
    public async Task UpdateWord_UnignoringWord_KeepsAManualSuspension()
    {
        using var context = CreateContext();
        var (userId, wordId) = SeedWord(context, status: 3);
        context.SrsCardReviews.Add(new SrsCardReview
        {
            WordId = wordId, UserId = userId, NextReviewAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow,
            IsSuspended = true, SuspendReason = "manual"
        });
        context.SaveChanges();
        var controller = CreateController(context, userId);

        await controller.UpdateWord(wordId, new UpdateWordDto { Status = 6 });
        await controller.UpdateWord(wordId, new UpdateWordDto { Status = 2 });

        var card = await context.SrsCardReviews.SingleAsync(c => c.WordId == wordId);
        Assert.True(card.IsSuspended);
        Assert.Equal("manual", card.SuspendReason);
    }

    [Fact]
    public async Task UpdateWord_ReSavingNonIgnoredWord_PreservesManualSuspension()
    {
        using var context = CreateContext();
        var (userId, wordId) = SeedWord(context, status: 3);
        // A card the user manually suspended via the SRS interface.
        context.SrsCardReviews.Add(new SrsCardReview
        {
            WordId = wordId,
            UserId = userId,
            NextReviewAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow,
            IsSuspended = true
        });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        // Re-saving the word at a non-ignored status must not touch the card —
        // only a genuine un-ignore (6 -> 1-4) transition restores reviews.
        var result = await controller.UpdateWord(wordId, new UpdateWordDto { Status = 3 });

        Assert.IsType<NoContentResult>(result);
        var card = await context.SrsCardReviews.SingleAsync(c => c.WordId == wordId);
        Assert.True(card.IsSuspended);
    }

    // --- 1.1: case-insensitive matching / no duplicate Word rows ---

    [Fact]
    public async Task CreateWord_WhenLowercaseWordExists_MatchesCaseInsensitively_NoDuplicate()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        // The linker stores terms lowercased; this is the row it created.
        context.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "perro", Status = 1 });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "T", Content = "Perro ..." });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        // User clicks the sentence-initial capitalized form.
        var result = await controller.CreateWord(new CreateWordDto { TextId = 1, Term = "Perro", Status = 5 });

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<WordResponseDto>(ok.Value);
        Assert.False(dto.IsNew);
        Assert.Equal(1, dto.WordId);
        // No duplicate row was created and the existing word was upgraded.
        Assert.Equal(1, await context.Words.CountAsync());
        var word = await context.Words.SingleAsync();
        Assert.Equal(5, word.Status);
        Assert.Equal("perro", word.Term);
    }

    // --- Terms page search: case- and accent-insensitive ---

    private static Guid SeedSearchWords(AppDbContext context)
    {
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Portuguese", Code = "pt" });
        context.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "sanção", Status = 1 });
        context.Words.Add(new Word
        {
            WordId = 2, UserId = userId, LanguageId = 1, Term = "gatinho", Status = 2,
            Translation = new WordTranslation { Translation = "Kätzchen" }
        });
        context.Words.Add(new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "casa", Status = 1 });
        context.SaveChanges();
        context.ChangeTracker.Clear();
        return userId;
    }

    [Theory]
    [InlineData("SANCAO", "sanção")]
    [InlineData("sanção", "sanção")]
    [InlineData("katzchen", "gatinho")]
    public async Task GetWordsByLanguage_SearchIgnoresCaseAndAccents(string searchTerm, string expectedTerm)
    {
        using var context = CreateContext();
        var userId = SeedSearchWords(context);

        var words = (await CreateController(context, userId).GetWordsByLanguage(1, searchTerm: searchTerm)).Value!;

        Assert.Equal(new[] { expectedTerm }, words.Select(w => w.Term));
    }

    [Theory]
    [InlineData("SANCAO", "sanção")]
    [InlineData("sanção", "sanção")]
    [InlineData("katzchen", "gatinho")]
    public async Task GetPaginatedWordsByLanguage_SearchIgnoresCaseAndAccents(string searchTerm, string expectedTerm)
    {
        using var context = CreateContext();
        var userId = SeedSearchWords(context);

        var page = (await CreateController(context, userId).GetPaginatedWordsByLanguage(1, searchTerm: searchTerm)).Value!;

        Assert.Equal(new[] { expectedTerm }, page.Items.Select(w => w.Term));
        Assert.Equal(1, page.TotalCount);
    }

    private static readonly string Shy = ((char)0x00AD).ToString();

    [Fact]
    public async Task GetPaginatedWords_SentencesAreOptionalOrderedAndScopedToUserAndPage()
    {
        using var context = CreateContext();
        var (userId, wordId) = SeedWord(context, status: 2);
        var otherUser = Guid.NewGuid();
        context.Texts.AddRange(
            new Text { TextId = 10, UserId = userId, LanguageId = 1, Title = "Current title", Content = "El gato duerme." },
            new Text { TextId = 20, UserId = otherUser, LanguageId = 1, Title = "Private title", Content = "Private" });
        context.Words.Add(new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "perro", Status = 2 });
        var now = DateTime.UtcNow;
        context.SrsPhrases.AddRange(
            new SrsPhrase { SrsPhraseId = 1, WordId = wordId, UserId = userId, Sentence = "El gato duerme.", TextId = 10, TextTitle = "Old title", CreatedAt = now },
            new SrsPhrase { SrsPhraseId = 2, WordId = wordId, UserId = userId, Sentence = "Un gato.", TextTitle = "Deleted source", CreatedAt = now.AddDays(-1) },
            new SrsPhrase { SrsPhraseId = 3, WordId = wordId, UserId = otherUser, Sentence = "Private sentence", CreatedAt = now.AddDays(1) },
            new SrsPhrase { SrsPhraseId = 4, WordId = 2, UserId = userId, Sentence = "Un perro.", CreatedAt = now },
            new SrsPhrase { SrsPhraseId = 5, WordId = wordId, UserId = userId, Sentence = "Gato sin enlace.", TextId = 20, TextTitle = "Saved title", CreatedAt = now.AddDays(-2) },
            new SrsPhrase { SrsPhraseId = 6, WordId = wordId, UserId = userId, Sentence = "   ", CreatedAt = now });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);
        var compact = (await controller.GetPaginatedWordsByLanguage(1, pageSize: 1)).Value!;
        Assert.Empty(Assert.Single(compact.Items).Sentences);

        var page = (await controller.GetPaginatedWordsByLanguage(1, pageSize: 1, includeSentences: true)).Value!;
        Assert.Equal(2, page.TotalCount);
        var sentences = Assert.Single(page.Items).Sentences;
        Assert.Equal(new[] { "El gato duerme.", "Un gato.", "Gato sin enlace." }, sentences.Select(p => p.Sentence));
        Assert.Equal(10, sentences[0].TextId);
        Assert.Equal("Current title", sentences[0].TextTitle);
        Assert.Null(sentences[1].TextId);
        Assert.Equal("Deleted source", sentences[1].TextTitle);
        Assert.Null(sentences[2].TextId);
        Assert.Equal("Saved title", sentences[2].TextTitle);

        var next = (await controller.GetPaginatedWordsByLanguage(1, page: 2, pageSize: 1, includeSentences: true)).Value!;
        Assert.Equal("Un perro.", Assert.Single(Assert.Single(next.Items).Sentences).Sentence);
        var empty = (await controller.GetPaginatedWordsByLanguage(1, searchTerm: "missing", includeSentences: true)).Value!;
        Assert.Empty(empty.Items);
    }

    [Fact]
    public async Task GetPaginatedWords_SentencesKeepDeletedSourcesAndEmptyWords_InRelationalDatabase()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        await using var context = new AppDbContext(options);
        await context.Database.EnsureCreatedAsync();
        var (userId, wordId) = SeedWord(context, status: 2);
        var otherUserId = Guid.NewGuid();
        context.Users.Add(new User { Id = otherUserId, UserName = "other", Email = "other@example.com" });
        context.Languages.Add(new Language { LanguageId = 2, Name = "French", Code = "fr" });
        context.Words.AddRange(
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "perro", Status = 2 },
            new Word { WordId = 3, UserId = otherUserId, LanguageId = 1, Term = "ajeno", Status = 2 },
            new Word { WordId = 4, UserId = userId, LanguageId = 2, Term = "chat", Status = 2 });
        context.Texts.AddRange(
            new Text { TextId = 10, UserId = userId, LanguageId = 1, Title = "Current source", Content = "El gato." },
            new Text { TextId = 20, UserId = userId, LanguageId = 1, Title = "Deleted source", Content = "Un gato." });
        var now = DateTime.UtcNow;
        context.SrsPhrases.AddRange(
            new SrsPhrase { SrsPhraseId = 1, WordId = wordId, UserId = userId, Sentence = "Un gato.", TextId = 20, TextTitle = "Deleted source", CreatedAt = now },
            new SrsPhrase { SrsPhraseId = 2, WordId = wordId, UserId = userId, Sentence = "El gato.", TextId = 10, TextTitle = "Previous title", CreatedAt = now },
            new SrsPhrase { SrsPhraseId = 3, WordId = wordId, UserId = otherUserId, Sentence = "Another user's context.", CreatedAt = now },
            new SrsPhrase { SrsPhraseId = 4, WordId = wordId, UserId = userId, Sentence = " \n\t ", CreatedAt = now });
        await context.SaveChangesAsync();
        // Exercise the real SET NULL foreign key behavior, without EF relationship fix-up.
        await context.Texts.Where(t => t.TextId == 20).ExecuteDeleteAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);
        var page = (await controller.GetPaginatedWordsByLanguage(1, pageSize: 1, status: "2", includeSentences: true)).Value!;
        Assert.Equal(2, page.TotalCount);
        var sentences = Assert.Single(page.Items).Sentences;
        Assert.Equal(new[] { "El gato.", "Un gato." }, sentences.Select(p => p.Sentence));
        Assert.Equal(10, sentences[0].TextId);
        Assert.Equal("Current source", sentences[0].TextTitle);
        Assert.Null(sentences[1].TextId);
        Assert.Equal("Deleted source", sentences[1].TextTitle);

        var next = (await controller.GetPaginatedWordsByLanguage(1, page: 2, pageSize: 1, includeSentences: true)).Value!;
        Assert.Equal("perro", Assert.Single(next.Items).Term);
        Assert.Empty(Assert.Single(next.Items).Sentences);
    }

    private static Guid SeedPortugueseText(AppDbContext context)
    {
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Portuguese", Code = "pt" });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "T", Content = "Fazal Elahi reparava." });
        context.SaveChanges();
        return userId;
    }

    [Fact]
    public async Task CreateWord_TermThatNormalizesToNothing_IsRejected()
    {
        using var context = CreateContext();
        var userId = SeedPortugueseText(context);

        // [Required] accepts a lone soft hyphen; normalizing drops it.
        var result = await CreateController(context, userId)
            .CreateWord(new CreateWordDto { TextId = 1, Term = Shy, Status = 1 });

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(context.Words);
    }

    [Fact]
    public async Task CreateWord_SentenceMinedBeforeNormalizing_IsNotMinedAgain()
    {
        using var context = CreateContext();
        var userId = SeedPortugueseText(context);
        context.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "reparava", Status = 1 });
        // Mined before tokenizer v3: the reader's raw segment text.
        context.SrsPhrases.Add(new SrsPhrase { WordId = 1, UserId = userId, Sentence = $"Fazal Elahi repa{Shy}rava.", CreatedAt = DateTime.UtcNow });
        context.SaveChanges();

        // The reader now sends the same sentence normalized.
        await CreateController(context, userId).CreateWord(new CreateWordDto
        {
            TextId = 1, Term = "reparava", Status = 2, Sentence = "Fazal Elahi reparava."
        });

        Assert.Single(context.SrsPhrases);
    }

    // --- 1.2: status-only update must not erase the saved translation ---

    [Fact]
    public async Task UpdateWord_WithEmptyOrNullTranslation_PreservesExistingTranslation()
    {
        using var context = CreateContext();
        var (userId, wordId) = SeedWord(context, status: 1);
        context.WordTranslations.Add(new WordTranslation { WordId = wordId, Translation = "cat", CreatedAt = DateTime.UtcNow });
        context.SaveChanges();

        var controller = CreateController(context, userId);

        // Empty string (offline replay / online status-only save) leaves it unchanged.
        var r1 = await controller.UpdateWord(wordId, new UpdateWordDto { Status = 5, Translation = "" });
        Assert.IsType<NoContentResult>(r1);
        Assert.Equal("cat", (await context.WordTranslations.SingleAsync(t => t.WordId == wordId)).Translation);

        // Null likewise means "leave unchanged".
        var r2 = await controller.UpdateWord(wordId, new UpdateWordDto { Status = 4, Translation = null });
        Assert.IsType<NoContentResult>(r2);
        Assert.Equal("cat", (await context.WordTranslations.SingleAsync(t => t.WordId == wordId)).Translation);
    }

    [Fact]
    public async Task UpdateWord_WithNonEmptyTranslation_Updates()
    {
        using var context = CreateContext();
        var (userId, wordId) = SeedWord(context, status: 1);
        context.WordTranslations.Add(new WordTranslation { WordId = wordId, Translation = "cat", CreatedAt = DateTime.UtcNow });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        var result = await controller.UpdateWord(wordId, new UpdateWordDto { Status = 5, Translation = "feline" });

        Assert.IsType<NoContentResult>(result);
        Assert.Equal("feline", (await context.WordTranslations.SingleAsync(t => t.WordId == wordId)).Translation);
    }
}
