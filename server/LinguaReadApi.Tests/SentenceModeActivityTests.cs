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
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service, CreateScopeFactory(context), new WordLinkingChannel(), CreateStatsRecompute(context))
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.CompleteText(textId);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.NotNull(ok.Value);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
        Assert.Equal(1, stats.TotalTextsCompleted);
        Assert.Equal(1, stats.TotalTextCompletions);

        var completionActivity = await context.UserActivities.SingleAsync(activity => activity.ActivityType == "TextCompleted");
        Assert.Equal(2, completionActivity.WordCount);
    }

    [Fact]
    public async Task CompleteText_CreditsZeroWords_WhenSentenceProgressAlreadyCoversFullText()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var textId = 30;
        const int languageId = 1;

        SeedUserLanguageAndText(context, userId, textId, "one two three four");

        var words = new[]
        {
            new Word { WordId = 110, UserId = userId, LanguageId = languageId, Term = "one", Status = 5 },
            new Word { WordId = 111, UserId = userId, LanguageId = languageId, Term = "two", Status = 4 },
            new Word { WordId = 112, UserId = userId, LanguageId = languageId, Term = "three", Status = 3 },
            new Word { WordId = 113, UserId = userId, LanguageId = languageId, Term = "four", Status = 2 }
        };
        await context.Words.AddRangeAsync(words);
        await context.TextWords.AddRangeAsync(words.Select((word, index) => new TextWord
        {
            TextWordId = 210 + index,
            TextId = textId,
            WordId = word.WordId,
            CreatedAt = DateTime.UtcNow
        }));
        await context.UserSentenceProgresses.AddAsync(new UserSentenceProgress
        {
            UserId = userId,
            TextId = textId,
            CreditedSegmentIndicesJson = "[0,1]",
            CreditedWordCount = 4,
            LastSegmentIndex = 1,
            UpdatedAt = DateTime.UtcNow
        });
        await context.UserLanguageStatistics.AddAsync(new UserLanguageStatistics
        {
            UserId = userId,
            LanguageId = languageId,
            TotalWordsRead = 4,
            LastUpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service, CreateScopeFactory(context), new WordLinkingChannel(), CreateStatsRecompute(context))
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.CompleteText(textId);

        Assert.IsType<OkObjectResult>(result.Result);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
        Assert.Equal(1, stats.TotalTextsCompleted);
        Assert.Equal(1, stats.TotalTextCompletions);

        var completionActivity = await context.UserActivities.SingleAsync(a => a.ActivityType == "TextCompleted");
        Assert.Equal(0, completionActivity.WordCount);
    }

    [Fact]
    public async Task CompleteText_CountsRepeatCompletionsWithoutDoubleCountingUniqueTexts()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var textId = 35;
        const int languageId = 1;

        SeedUserLanguageAndText(context, userId, textId, "hello world");
        var words = new[]
        {
            new Word { WordId = 115, UserId = userId, LanguageId = languageId, Term = "hello", Status = 5 },
            new Word { WordId = 116, UserId = userId, LanguageId = languageId, Term = "world", Status = 4 }
        };
        await context.Words.AddRangeAsync(words);
        await context.TextWords.AddRangeAsync(words.Select((word, index) => new TextWord
        {
            TextWordId = 215 + index,
            TextId = textId,
            WordId = word.WordId,
            CreatedAt = DateTime.UtcNow
        }));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service, CreateScopeFactory(context), new WordLinkingChannel(), CreateStatsRecompute(context))
        {
            ControllerContext = BuildControllerContext(userId)
        };

        await controller.CompleteText(textId);
        context.ChangeTracker.Clear();
        await controller.CompleteText(textId);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
        Assert.Equal(1, stats.TotalTextsCompleted);
        Assert.Equal(2, stats.TotalTextCompletions);
    }

    [Fact]
    public async Task CompleteText_SetsTagToFinished_WhenAutoMoveFinishedLessonsEnabled()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var textId = 40;
        const int languageId = 1;

        SeedUserLanguageAndText(context, userId, textId, "hello");
        await context.UserSettings.AddAsync(new UserSettings
        {
            UserId = userId,
            AutoMoveFinishedLessons = true,
            CreatedAt = DateTime.UtcNow
        });

        var word = new Word { WordId = 120, UserId = userId, LanguageId = languageId, Term = "hello", Status = 5 };
        await context.Words.AddAsync(word);
        await context.TextWords.AddAsync(new TextWord
        {
            TextWordId = 220,
            TextId = textId,
            WordId = word.WordId,
            CreatedAt = DateTime.UtcNow
        });
        await context.UserSentenceProgresses.AddAsync(new UserSentenceProgress
        {
            UserId = userId,
            TextId = textId,
            CreditedSegmentIndicesJson = "[0]",
            CreditedWordCount = 1,
            LastSegmentIndex = 0,
            UpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service, CreateScopeFactory(context), new WordLinkingChannel(), CreateStatsRecompute(context))
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.CompleteText(textId);

        Assert.IsType<OkObjectResult>(result.Result);

        var textAfter = await context.Texts.AsNoTracking().SingleAsync(t => t.TextId == textId);
        Assert.True(textAfter.IsFinished);
        Assert.Equal("Finished", textAfter.Tag);
    }

    [Fact]
    public async Task ResetStatistics_ClearsTotalTextCompletions()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        await context.UserLanguageStatistics.AddAsync(new UserLanguageStatistics
        {
            UserId = userId,
            LanguageId = 1,
            TotalWordsRead = 100,
            TotalTextsCompleted = 3,
            TotalTextCompletions = 7,
            TotalBooksCompleted = 2,
            TotalSecondsListened = 60,
            LastUpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var controller = new UsersController(context, NullLogger<UsersController>.Instance)
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.ResetStatistics();

        Assert.IsType<OkObjectResult>(result);
        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(0, stats.TotalWordsRead);
        Assert.Equal(0, stats.TotalTextsCompleted);
        Assert.Equal(0, stats.TotalTextCompletions);
        Assert.Equal(0, stats.TotalBooksCompleted);
        Assert.Equal(0, stats.TotalSecondsListened);
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

    private static IServiceScopeFactory CreateScopeFactory(AppDbContext context)
    {
        var services = new ServiceCollection();
        services.AddSingleton(context);
        services.AddSingleton<AppDbContext>(context);
        return services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
    }

    private static StatsRecomputeService CreateStatsRecompute(AppDbContext context)
    {
        var services = new ServiceCollection();
        services.AddSingleton(context);
        return new StatsRecomputeService(services.BuildServiceProvider(), NullLogger<StatsRecomputeService>.Instance);
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
