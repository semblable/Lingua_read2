using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class CompleteTextTests
{
    [Fact]
    public async Task CompleteText_Default_LogsActivityAndIncrementsStats()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedStandaloneText(context, userId, textId: 1, content: "hola amigo mundo");

        var controller = CreateController(context, userId);
        var result = await controller.CompleteText(1);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.IsType<TextStatsDto>(ok.Value);

        context.ChangeTracker.Clear();

        var text = await context.Texts.SingleAsync();
        Assert.True(text.IsFinished);

        var activities = await context.UserActivities.ToListAsync();
        Assert.Single(activities);
        Assert.Equal("TextCompleted", activities[0].ActivityType);
        Assert.Equal(3, activities[0].WordCount);

        var langStats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(3, langStats.TotalWordsRead);
        Assert.Equal(1, langStats.TotalTextsCompleted);
        Assert.Equal(1, langStats.TotalTextCompletions);
    }

    [Fact]
    public async Task CompleteText_SkipStats_MarksFinishedButLeavesStatsUntouched()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedStandaloneText(context, userId, textId: 1, content: "hola amigo mundo");

        var controller = CreateController(context, userId);
        var result = await controller.CompleteText(1, skipStats: true);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.IsType<TextStatsDto>(ok.Value);

        context.ChangeTracker.Clear();

        var text = await context.Texts.SingleAsync();
        Assert.True(text.IsFinished);

        Assert.Empty(await context.UserActivities.ToListAsync());
        Assert.Empty(await context.UserLanguageStatistics.ToListAsync());
    }

    [Fact]
    public async Task CompleteText_PersistsCachedWordStats_FromTextWordStatuses()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedStandaloneText(context, userId, textId: 1, content: "hola amigo mundo");

        // Three TextWords, statuses 5, 1, 3 → unique total=3, known(>=4)=1.
        context.Words.AddRange(
            new Word { WordId = 10, UserId = userId, LanguageId = 1, Term = "hola", Status = 5 },
            new Word { WordId = 11, UserId = userId, LanguageId = 1, Term = "amigo", Status = 1 },
            new Word { WordId = 12, UserId = userId, LanguageId = 1, Term = "mundo", Status = 3 });
        context.TextWords.AddRange(
            new TextWord { TextWordId = 100, TextId = 1, WordId = 10 },
            new TextWord { TextWordId = 101, TextId = 1, WordId = 11 },
            new TextWord { TextWordId = 102, TextId = 1, WordId = 12 });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);
        await controller.CompleteText(1);

        context.ChangeTracker.Clear();
        var text = await context.Texts.SingleAsync();
        Assert.Equal(3, text.TotalWords);
        Assert.Equal(1, text.KnownWords);
        Assert.NotNull(text.StatsUpdatedAt);
    }

    [Fact]
    public async Task CompleteText_SkipStats_HonoursAutoMoveFinishedLessons()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedStandaloneText(context, userId, textId: 1, content: "hola");
        context.UserSettings.Add(new UserSettings { UserId = userId, AutoMoveFinishedLessons = true });
        await context.SaveChangesAsync();

        var controller = CreateController(context, userId);
        await controller.CompleteText(1, skipStats: true);

        context.ChangeTracker.Clear();
        var text = await context.Texts.SingleAsync();
        Assert.True(text.IsFinished);
        Assert.Equal("Finished", text.Tag);
    }

    // --- Helpers ---

    private static TextsController CreateController(AppDbContext context, Guid userId)
    {
        var scopeFactory = CreateScopeFactory(context);
        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        return new TextsController(context, NullLogger<TextsController>.Instance, service, scopeFactory, new WordLinkingChannel())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                    ], "TestAuth"))
                }
            }
        };
    }

    private static IServiceScopeFactory CreateScopeFactory(AppDbContext context)
    {
        var services = new ServiceCollection();
        services.AddSingleton(context);
        return services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
    }

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static void SeedStandaloneText(AppDbContext context, Guid userId, int textId, string content)
    {
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES", WordsRead = 0 });
        context.Texts.Add(new Text
        {
            TextId = textId,
            UserId = userId,
            LanguageId = 1,
            Title = "Standalone",
            Content = content,
            IsAudioLesson = true
        });
        context.SaveChanges();
        context.ChangeTracker.Clear();
    }
}
