using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
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

    private static readonly string Shy = ((char)0x00AD).ToString();

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
