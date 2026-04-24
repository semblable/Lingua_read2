using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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

        var service = new LanguageService(context);

        var result = await service.DeleteLanguageAsync(1);

        Assert.Equal(DeleteLanguageStatus.BlockedByDependencies, result.Status);
        Assert.Equal(1, result.Dependencies.UserActivities);
        Assert.True(await context.Languages.AnyAsync(l => l.LanguageId == 1));
    }

    [Fact]
    public async Task DeleteLanguageAsync_ReturnsNotFound_WhenLanguageDoesNotExist()
    {
        await using var context = CreateContext();
        var service = new LanguageService(context);

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

        var controller = new LanguagesController(new LanguageService(context), NullLogger<LanguagesController>.Instance);

        var result = await controller.DeleteLanguage(1);

        Assert.IsType<ConflictObjectResult>(result);
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

    private static WordsController CreateWordsController(AppDbContext context, Guid userId)
    {
        return new WordsController(context)
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
