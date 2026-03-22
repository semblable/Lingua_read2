using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class UserActivityControllerTests
{
    [Fact]
    public async Task LogListeningActivity_CreatesActivityAndInitializesLanguageStats()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, languageId: 1);

        var controller = CreateController(context, userId);

        var result = await controller.LogListeningActivity(new UserActivityController.LogListeningRequest
        {
            LanguageId = 1,
            DurationSeconds = 45
        });

        Assert.IsType<OkObjectResult>(result);

        var activity = await context.UserActivities.SingleAsync();
        Assert.Equal("Listening", activity.ActivityType);
        Assert.Equal(45, activity.ListeningDurationSeconds);
        Assert.Equal(0, activity.WordCount);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(45, stats.TotalSecondsListened);
    }

    [Fact]
    public async Task LogListeningActivity_UpdatesSameStatsRow_OnSecondCall()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId, languageId: 1);

        var controller = CreateController(context, userId);

        await controller.LogListeningActivity(new UserActivityController.LogListeningRequest
        {
            LanguageId = 1,
            DurationSeconds = 20
        });
        await controller.LogListeningActivity(new UserActivityController.LogListeningRequest
        {
            LanguageId = 1,
            DurationSeconds = 30
        });

        Assert.Equal(2, await context.UserActivities.CountAsync());

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(50, stats.TotalSecondsListened);
    }

    [Fact]
    public async Task UpdateAudioLessonProgress_UpsertsProgress_ForOwnedText()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 99;
        SeedUserLanguageAndText(context, userId, textId, "lesson content");

        var controller = CreateController(context, userId);

        var first = await controller.UpdateAudioLessonProgress(new UserActivityController.UpdateAudioLessonProgressRequest
        {
            TextId = textId,
            CurrentPosition = 12.5
        });
        Assert.IsType<OkObjectResult>(first);

        var row = await context.UserAudioLessonProgresses.SingleAsync();
        Assert.Equal(12.5, row.CurrentPosition);

        var second = await controller.UpdateAudioLessonProgress(new UserActivityController.UpdateAudioLessonProgressRequest
        {
            TextId = textId,
            CurrentPosition = 99.0
        });
        Assert.IsType<OkObjectResult>(second);

        row = await context.UserAudioLessonProgresses.SingleAsync();
        Assert.Equal(99.0, row.CurrentPosition);
    }

    [Fact]
    public async Task UpdateAudioLessonProgress_ReturnsNotFound_WhenTextBelongsToAnotherUser()
    {
        await using var context = CreateContext();
        var ownerId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        const int textId = 77;

        SeedUserLanguageAndText(context, ownerId, textId, "private");

        var controller = CreateController(context, otherId);

        var result = await controller.UpdateAudioLessonProgress(new UserActivityController.UpdateAudioLessonProgressRequest
        {
            TextId = textId,
            CurrentPosition = 1.0
        });

        Assert.IsType<NotFoundObjectResult>(result);
        Assert.Empty(context.UserAudioLessonProgresses);
    }

    [Fact]
    public async Task GetReadingStats_SumsOnlyReadingManualReadingAndTextCompleted()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var language = SeedUserAndLanguage(context, userId, languageId: 1);
        var now = DateTime.UtcNow;

        context.UserActivities.AddRange(
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "Reading",
                WordCount = 10,
                Timestamp = now,
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "ManualReading",
                WordCount = 5,
                Timestamp = now,
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "TextCompleted",
                WordCount = 3,
                Timestamp = now,
                ListeningDurationSeconds = 0
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "Listening",
                WordCount = 999,
                Timestamp = now,
                ListeningDurationSeconds = 60
            });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);

        var result = await controller.GetReadingStats("all");
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<UserActivityController.ReadingStatsDto>(ok.Value);

        Assert.Equal(18, dto.TotalWordsRead);
        Assert.Equal(18, dto.ActivityByDate.Values.Sum());
        Assert.Single(dto.ActivityByLanguage);
        Assert.Equal(18, dto.ActivityByLanguage[0].TotalWords);
    }

    [Fact]
    public async Task GetListeningStats_SumsOnlyListeningAndManualListening()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var language = SeedUserAndLanguage(context, userId, languageId: 1);
        var now = DateTime.UtcNow;

        context.UserActivities.AddRange(
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "Listening",
                WordCount = 0,
                Timestamp = now,
                ListeningDurationSeconds = 40
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "ManualListening",
                WordCount = 0,
                Timestamp = now,
                ListeningDurationSeconds = 35
            },
            new UserActivity
            {
                UserId = userId,
                LanguageId = language.LanguageId,
                Language = language,
                ActivityType = "Reading",
                WordCount = 100,
                Timestamp = now,
                ListeningDurationSeconds = 0
            });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateController(context, userId);

        var result = await controller.GetListeningStats("all");
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var dto = Assert.IsType<UserActivityController.ListeningStatsDto>(ok.Value);

        Assert.Equal(75, dto.TotalListeningSeconds);
        Assert.Equal(75, dto.ListeningByDate.Values.Sum());
        Assert.Single(dto.ListeningByLanguage);
        Assert.Equal(75, dto.ListeningByLanguage[0].TotalSeconds);
    }

    private static UserActivityController CreateController(AppDbContext context, Guid userId)
    {
        return new UserActivityController(context, null!, NullLogger<UserActivityController>.Instance)
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

    private static Language SeedUserAndLanguage(AppDbContext context, Guid userId, int languageId)
    {
        var user = new User
        {
            Id = userId,
            UserName = "tester",
            Email = "tester@example.com"
        };
        var language = new Language
        {
            LanguageId = languageId,
            Name = "Spanish",
            Code = "ES"
        };
        context.Users.Add(user);
        context.Languages.Add(language);
        context.SaveChanges();
        return language;
    }

    private static void SeedUserLanguageAndText(AppDbContext context, Guid userId, int textId, string content)
    {
        var user = new User
        {
            Id = userId,
            UserName = "owner",
            Email = "owner@example.com"
        };
        var language = new Language
        {
            LanguageId = 1,
            Name = "Spanish",
            Code = "ES"
        };
        var text = new Text
        {
            TextId = textId,
            UserId = userId,
            LanguageId = 1,
            Title = "Lesson",
            Content = content
        };

        context.Users.Add(user);
        context.Languages.Add(language);
        context.Texts.Add(text);
        context.SaveChanges();
    }
}
