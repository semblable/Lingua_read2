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

public class SentenceModeActivityTests
{
    [Fact]
    public async Task LogSentenceRead_CreditsOnlyNewSegments()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserLanguageAndText(context, userId, textId: 10, content: "Alpha beta. Gamma delta.");

        var controller = CreateUserActivityController(context, userId);

        var firstResult = await controller.LogSentenceRead(new UserActivityController.LogSentenceReadRequest
        {
            TextId = 10,
            CurrentSegmentIndex = 1,
            Segments =
            [
                new UserActivityController.SentenceSegmentDto { SegmentIndex = 0, SegmentText = "Alpha beta." },
                new UserActivityController.SentenceSegmentDto { SegmentIndex = 1, SegmentText = "Gamma delta." }
            ]
        });

        var firstOk = Assert.IsType<OkObjectResult>(firstResult.Result);
        var firstDto = Assert.IsType<UserActivityController.SentenceProgressDto>(firstOk.Value);
        Assert.Equal(new[] { 0, 1 }, firstDto.CreditedSegmentIndices);
        Assert.Equal(4, firstDto.CreditedWordCount);
        Assert.Equal(1, firstDto.LastSegmentIndex);

        var secondResult = await controller.LogSentenceRead(new UserActivityController.LogSentenceReadRequest
        {
            TextId = 10,
            CurrentSegmentIndex = 0,
            Segments =
            [
                new UserActivityController.SentenceSegmentDto { SegmentIndex = 0, SegmentText = "Alpha beta." }
            ]
        });

        var secondOk = Assert.IsType<OkObjectResult>(secondResult.Result);
        var secondDto = Assert.IsType<UserActivityController.SentenceProgressDto>(secondOk.Value);
        Assert.Equal(4, secondDto.CreditedWordCount);
        Assert.Equal(0, secondDto.LastSegmentIndex);

        var readingActivities = await context.UserActivities
            .Where(activity => activity.ActivityType == "Reading")
            .ToListAsync();
        Assert.Single(readingActivities);
        Assert.Equal(4, readingActivities[0].WordCount);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
    }

    [Fact]
    public async Task CompleteText_OnlyCreditsRemainingWordsAfterSentenceMode()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var textId = 22;
        const int languageId = 1;

        SeedUserLanguageAndText(context, userId, textId, "one two three four");

        var words = new[]
        {
            new Word { WordId = 100, UserId = userId, LanguageId = languageId, Term = "one", Status = 5 },
            new Word { WordId = 101, UserId = userId, LanguageId = languageId, Term = "two", Status = 4 },
            new Word { WordId = 102, UserId = userId, LanguageId = languageId, Term = "three", Status = 3 },
            new Word { WordId = 103, UserId = userId, LanguageId = languageId, Term = "four", Status = 2 }
        };
        await context.Words.AddRangeAsync(words);
        await context.TextWords.AddRangeAsync(words.Select((word, index) => new TextWord
        {
            TextWordId = 200 + index,
            TextId = textId,
            WordId = word.WordId,
            CreatedAt = DateTime.UtcNow
        }));
        await context.UserSentenceProgresses.AddAsync(new UserSentenceProgress
        {
            UserId = userId,
            TextId = textId,
            CreditedSegmentIndicesJson = "[0]",
            CreditedWordCount = 2,
            LastSegmentIndex = 0,
            UpdatedAt = DateTime.UtcNow
        });
        await context.UserLanguageStatistics.AddAsync(new UserLanguageStatistics
        {
            UserId = userId,
            LanguageId = languageId,
            TotalWordsRead = 2,
            LastUpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service)
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.CompleteText(textId);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.NotNull(ok.Value);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
        Assert.Equal(1, stats.TotalTextsCompleted);

        var completionActivity = await context.UserActivities.SingleAsync(activity => activity.ActivityType == "TextCompleted");
        Assert.Equal(2, completionActivity.WordCount);
    }

    private static UserActivityController CreateUserActivityController(AppDbContext context, Guid userId)
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

    private static void SeedUserLanguageAndText(AppDbContext context, Guid userId, int textId, string content)
    {
        var user = new User
        {
            Id = userId,
            UserName = "tester",
            Email = "tester@example.com"
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
            Title = "Test text",
            Content = content
        };

        context.Users.Add(user);
        context.Languages.Add(language);
        context.Texts.Add(text);
        context.SaveChanges();
    }
}
