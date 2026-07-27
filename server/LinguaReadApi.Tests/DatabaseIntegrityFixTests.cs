using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class DatabaseIntegrityFixTests
{
    [Fact]
    public async Task DeleteLanguageAsync_ReturnsBlocked_WhenUserActivitiesReferenceLanguage()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        context.UserActivities.Add(new UserActivity
        {
            UserId = userId,
            LanguageId = 1,
            ActivityType = "Reading",
            WordCount = 25,
            Timestamp = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var service = new LanguageService(context, new MemoryCache(new MemoryCacheOptions()));

        var result = await service.DeleteLanguageAsync(1);

        Assert.Equal(DeleteLanguageStatus.BlockedByDependencies, result.Status);
        Assert.Equal(1, result.Dependencies.UserActivities);
        Assert.True(await context.Languages.AnyAsync(l => l.LanguageId == 1));
    }

    [Fact]
    public async Task DeleteLanguageAsync_ReturnsNotFound_WhenLanguageDoesNotExist()
    {
        await using var context = CreateContext();
        var service = new LanguageService(context, new MemoryCache(new MemoryCacheOptions()));

        var result = await service.DeleteLanguageAsync(404);

        Assert.Equal(DeleteLanguageStatus.NotFound, result.Status);
    }

    [Fact]
    public async Task DeleteLanguage_ReturnsConflict_WhenLanguageHasDependencies()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        context.UserActivities.Add(new UserActivity
        {
            UserId = userId,
            LanguageId = 1,
            ActivityType = "Reading",
            WordCount = 25,
            Timestamp = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var controller = new LanguagesController(new LanguageService(context, new MemoryCache(new MemoryCacheOptions())), NullLogger<LanguagesController>.Instance);

        var result = await controller.DeleteLanguage(1);

        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task ResetLanguageContentAsync_RemovesOnlyTargetUserLanguageData()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;

        await using var context = new AppDbContext(options);
        await context.Database.EnsureCreatedAsync();

        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();

        context.Users.AddRange(
            new User { Id = userId, UserName = "tester", Email = "tester@example.com" },
            new User { Id = otherUserId, UserName = "other", Email = "other@example.com" });
        context.Languages.AddRange(
            new Language { LanguageId = 1, Name = "Spanish", Code = "ES" },
            new Language { LanguageId = 2, Name = "French", Code = "FR" });
        context.Books.AddRange(
            new Book { UserId = userId, LanguageId = 1, Title = "Target Book" },
            new Book { UserId = userId, LanguageId = 2, Title = "Other Language Book" },
            new Book { UserId = otherUserId, LanguageId = 1, Title = "Other User Book" });
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = 1, Title = "Target Text", Content = "hola" },
            new Text { UserId = userId, LanguageId = 2, Title = "Other Language Text", Content = "bonjour" },
            new Text { UserId = otherUserId, LanguageId = 1, Title = "Other User Text", Content = "hola" });
        context.Words.AddRange(
            new Word { UserId = userId, LanguageId = 1, Term = "hola", Status = 1 },
            new Word { UserId = userId, LanguageId = 2, Term = "bonjour", Status = 1 },
            new Word { UserId = otherUserId, LanguageId = 1, Term = "hola", Status = 1 });
        context.UserActivities.AddRange(
            new UserActivity { UserId = userId, LanguageId = 1, ActivityType = "Reading", WordCount = 10, Timestamp = DateTime.UtcNow },
            new UserActivity { UserId = userId, LanguageId = 2, ActivityType = "Reading", WordCount = 20, Timestamp = DateTime.UtcNow },
            new UserActivity { UserId = otherUserId, LanguageId = 1, ActivityType = "Reading", WordCount = 30, Timestamp = DateTime.UtcNow });
        context.UserLanguageStatistics.AddRange(
            new UserLanguageStatistics { UserId = userId, LanguageId = 1, LastUpdatedAt = DateTime.UtcNow },
            new UserLanguageStatistics { UserId = userId, LanguageId = 2, LastUpdatedAt = DateTime.UtcNow },
            new UserLanguageStatistics { UserId = otherUserId, LanguageId = 1, LastUpdatedAt = DateTime.UtcNow });
        await context.SaveChangesAsync();

        var targetWordId = await context.Words
            .Where(w => w.UserId == userId && w.LanguageId == 1)
            .Select(w => w.WordId)
            .SingleAsync();
        var otherLanguageWordId = await context.Words
            .Where(w => w.UserId == userId && w.LanguageId == 2)
            .Select(w => w.WordId)
            .SingleAsync();
        var otherUserWordId = await context.Words
            .Where(w => w.UserId == otherUserId && w.LanguageId == 1)
            .Select(w => w.WordId)
            .SingleAsync();

        context.SrsPhrases.AddRange(
            new SrsPhrase { UserId = userId, WordId = targetWordId, Sentence = "Target phrase" },
            new SrsPhrase { UserId = userId, WordId = otherLanguageWordId, Sentence = "Other language phrase" },
            new SrsPhrase { UserId = otherUserId, WordId = otherUserWordId, Sentence = "Other user phrase" });
        await context.SaveChangesAsync();

        var service = new LanguageService(context, new MemoryCache(new MemoryCacheOptions()));

        var result = await service.ResetLanguageContentAsync(1, userId);

        Assert.True(result);
        context.ChangeTracker.Clear();
        Assert.False(await context.Texts.AnyAsync(t => t.UserId == userId && t.LanguageId == 1));
        Assert.False(await context.Books.AnyAsync(b => b.UserId == userId && b.LanguageId == 1));
        Assert.False(await context.Words.AnyAsync(w => w.UserId == userId && w.LanguageId == 1));
        Assert.False(await context.UserActivities.AnyAsync(ua => ua.UserId == userId && ua.LanguageId == 1));
        Assert.False(await context.UserLanguageStatistics.AnyAsync(uls => uls.UserId == userId && uls.LanguageId == 1));
        Assert.False(await context.SrsPhrases.AnyAsync(sp => sp.UserId == userId && sp.WordId == targetWordId));

        Assert.True(await context.Texts.AnyAsync(t => t.UserId == userId && t.LanguageId == 2));
        Assert.True(await context.Texts.AnyAsync(t => t.UserId == otherUserId && t.LanguageId == 1));
        Assert.True(await context.Books.AnyAsync(b => b.UserId == userId && b.LanguageId == 2));
        Assert.True(await context.Books.AnyAsync(b => b.UserId == otherUserId && b.LanguageId == 1));
        Assert.True(await context.Words.AnyAsync(w => w.UserId == userId && w.LanguageId == 2));
        Assert.True(await context.Words.AnyAsync(w => w.UserId == otherUserId && w.LanguageId == 1));
        Assert.True(await context.UserActivities.AnyAsync(ua => ua.UserId == userId && ua.LanguageId == 2));
        Assert.True(await context.UserActivities.AnyAsync(ua => ua.UserId == otherUserId && ua.LanguageId == 1));
        Assert.True(await context.UserLanguageStatistics.AnyAsync(uls => uls.UserId == userId && uls.LanguageId == 2));
        Assert.True(await context.UserLanguageStatistics.AnyAsync(uls => uls.UserId == otherUserId && uls.LanguageId == 1));
        Assert.True(await context.SrsPhrases.AnyAsync(sp => sp.UserId == userId && sp.WordId == otherLanguageWordId));
        Assert.True(await context.SrsPhrases.AnyAsync(sp => sp.UserId == otherUserId && sp.WordId == otherUserWordId));
    }

    [Fact]
    public async Task UpdateWord_UpsertsTranslation_WhenCalledRepeatedly()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        context.Words.Add(new Word
        {
            WordId = 1,
            UserId = userId,
            LanguageId = 1,
            Term = "hola",
            Status = 1
        });
        await context.SaveChangesAsync();

        var controller = CreateWordsController(context, userId);

        await controller.UpdateWord(1, new UpdateWordDto { Status = 2, Translation = "hello" });
        await controller.UpdateWord(1, new UpdateWordDto { Status = 3, Translation = "hi" });

        var translations = await context.WordTranslations.AsNoTracking().ToListAsync();
        Assert.Single(translations);
        Assert.Equal(1, translations[0].WordId);
        Assert.Equal("hi", translations[0].Translation);
        Assert.NotNull(translations[0].UpdatedAt);
    }

    [Fact]
    public async Task DeleteWord_RemovesOwnedWordAndDependencies_OnlyForCurrentUser()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        context.Users.Add(new User { Id = otherUserId, UserName = "other", Email = "other@example.com" });
        context.Texts.Add(new Text
        {
            TextId = 1,
            UserId = userId,
            LanguageId = 1,
            Title = "Target Text",
            Content = "hola"
        });
        context.Words.AddRange(
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "hola", Status = 2 },
            new Word { WordId = 2, UserId = otherUserId, LanguageId = 1, Term = "hola", Status = 2 });
        context.TextWords.Add(new TextWord { TextId = 1, WordId = 1 });
        context.WordTranslations.Add(new WordTranslation { WordId = 1, Translation = "hello" });
        context.SrsPhrases.Add(new SrsPhrase { UserId = userId, WordId = 1, Sentence = "hola mundo" });
        context.SrsCardReviews.Add(new SrsCardReview { SrsCardReviewId = 1, UserId = userId, WordId = 1 });
        context.SrsReviewLogs.Add(new SrsReviewLog
        {
            UserId = userId,
            SrsCardReviewId = 1,
            Grade = 2,
            OldNextReviewAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var controller = CreateWordsController(context, userId);

        var deleteResult = await controller.DeleteWord(1);
        var otherUserDeleteResult = await controller.DeleteWord(2);

        Assert.IsType<NoContentResult>(deleteResult);
        Assert.IsType<NotFoundResult>(otherUserDeleteResult);
        Assert.False(await context.Words.AnyAsync(w => w.WordId == 1));
        Assert.False(await context.TextWords.AnyAsync(tw => tw.WordId == 1));
        Assert.False(await context.WordTranslations.AnyAsync(wt => wt.WordId == 1));
        Assert.False(await context.SrsPhrases.AnyAsync(sp => sp.WordId == 1));
        Assert.False(await context.SrsCardReviews.AnyAsync(scr => scr.WordId == 1));
        Assert.False(await context.SrsReviewLogs.AnyAsync(log => log.SrsCardReviewId == 1));
        Assert.True(await context.Words.AnyAsync(w => w.WordId == 2 && w.UserId == otherUserId));
    }

    private static WordsController CreateWordsController(AppDbContext context, Guid userId)
    {
        return new WordsController(context, NullLogger<WordsController>.Instance)
        {
            ControllerContext = BuildControllerContext(userId)
        };
    }

    private static ControllerContext BuildControllerContext(Guid userId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                ], "TestAuth"))
            }
        };
    }

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new AppDbContext(options);
    }

    private static void SeedUserAndLanguage(AppDbContext context, Guid userId)
    {
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
        context.SaveChanges();
    }
}
