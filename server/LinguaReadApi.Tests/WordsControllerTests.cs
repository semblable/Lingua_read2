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
        return new WordsController(context)
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
            IsSuspended = true
        });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        var result = await controller.UpdateWord(wordId, new UpdateWordDto { Status = 2 });

        Assert.IsType<NoContentResult>(result);
        var card = await context.SrsCardReviews.SingleAsync(c => c.WordId == wordId);
        Assert.False(card.IsSuspended);
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
}
