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

public class LessonLoadingOptimizationTests
{
    // --- GetText Tests ---

    [Fact]
    public async Task GetText_ReturnsTextWithWords()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserLanguageAndText(context, userId, textId: 1, content: "Hola mundo");

        var word = new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "hola", Status = 3 };
        context.Words.Add(word);
        context.WordTranslations.Add(new WordTranslation { WordId = 1, Translation = "hello" });
        context.TextWords.Add(new TextWord { TextWordId = 1, TextId = 1, WordId = 1, CreatedAt = DateTime.UtcNow });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateTextsController(context, userId);
        var result = await controller.GetText(1);

        var okResult = Assert.IsType<ActionResult<TextDetailDto>>(result);
        var dto = okResult.Value;
        Assert.NotNull(dto);
        Assert.Equal(1, dto!.TextId);
        Assert.Equal("Hola mundo", dto.Content);
        Assert.Single(dto.Words);
        Assert.Equal("hola", dto.Words[0].Term);
        Assert.Equal("hello", dto.Words[0].Translation);
        Assert.Equal(3, dto.Words[0].Status);
    }

    [Fact]
    public async Task GetText_ReturnsNotFound_ForOtherUsersText()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        SeedUserLanguageAndText(context, userId, textId: 1, content: "Private text");

        var controller = CreateTextsController(context, otherUserId);
        var result = await controller.GetText(1);

        Assert.IsType<NotFoundResult>(result.Result);
    }

    [Fact]
    public async Task GetText_UpdatesLastAccessedAt()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserLanguageAndText(context, userId, textId: 1, content: "Test");

        var controller = CreateTextsController(context, userId);
        var result = await controller.GetText(1);

        Assert.NotNull(result.Value);

        // The update is applied synchronously within the request.
        var textAfter = await context.Texts.AsNoTracking().SingleAsync(t => t.TextId == 1);
        Assert.True(textAfter.LastAccessedAt.HasValue,
            "LastAccessedAt should be set after GetText");
    }

    [Fact]
    public async Task GetText_ReturnsLanguageInfo()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserLanguageAndText(context, userId, textId: 1, content: "Test");

        var controller = CreateTextsController(context, userId);
        var result = await controller.GetText(1);

        var dto = result.Value;
        Assert.NotNull(dto);
        Assert.Equal("Spanish", dto!.LanguageName);
        Assert.Equal("ES", dto.LanguageCode);
        Assert.Equal(1, dto.LanguageId);
    }

    // --- GetWordsByLanguage skipSort Tests ---

    [Fact]
    public async Task GetWordsByLanguage_DefaultSort_ReturnsWordsSortedByTerm()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        SeedWords(context, userId);
        context.ChangeTracker.Clear();

        var controller = CreateWordsController(context, userId);
        var result = await controller.GetWordsByLanguage(1);

        var okResult = Assert.IsType<ActionResult<IEnumerable<WordResponseDto>>>(result);
        var words = okResult.Value!.ToList();
        Assert.Equal(3, words.Count);
        // Default sort is by term ascending
        Assert.Equal("alpha", words[0].Term);
        Assert.Equal("beta", words[1].Term);
        Assert.Equal("gamma", words[2].Term);
    }

    [Fact]
    public async Task GetWordsByLanguage_SkipSort_ReturnsAllWordsWithoutGuaranteedOrder()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        SeedWords(context, userId);
        context.ChangeTracker.Clear();

        var controller = CreateWordsController(context, userId);
        var result = await controller.GetWordsByLanguage(1, skipSort: true);

        var okResult = Assert.IsType<ActionResult<IEnumerable<WordResponseDto>>>(result);
        var words = okResult.Value!.ToList();
        Assert.Equal(3, words.Count);
        // All words should be present regardless of sort
        Assert.Contains(words, w => w.Term == "alpha");
        Assert.Contains(words, w => w.Term == "beta");
        Assert.Contains(words, w => w.Term == "gamma");
    }

    [Fact]
    public async Task GetWordsByLanguage_SkipSort_StillAppliesStatusFilter()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        SeedWords(context, userId);
        context.ChangeTracker.Clear();

        var controller = CreateWordsController(context, userId);
        var result = await controller.GetWordsByLanguage(1, status: "3", skipSort: true);

        var okResult = Assert.IsType<ActionResult<IEnumerable<WordResponseDto>>>(result);
        var words = okResult.Value!.ToList();
        Assert.Single(words);
        Assert.Equal("beta", words[0].Term);
    }

    [Fact]
    public async Task GetWordsByLanguage_ExplicitSort_IgnoresSkipSort()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        SeedWords(context, userId);
        context.ChangeTracker.Clear();

        var controller = CreateWordsController(context, userId);
        // skipSort=false (default) + explicit sort
        var result = await controller.GetWordsByLanguage(1, sortBy: "term_desc");

        var okResult = Assert.IsType<ActionResult<IEnumerable<WordResponseDto>>>(result);
        var words = okResult.Value!.ToList();
        Assert.Equal("gamma", words[0].Term);
        Assert.Equal("beta", words[1].Term);
        Assert.Equal("alpha", words[2].Term);
    }

    [Fact]
    public async Task GetWordsByLanguage_ReturnsOnlyOwnWords()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        // Add another user
        context.Users.Add(new User { Id = otherUserId, UserName = "other", Email = "other@test.com" });
        context.SaveChanges();

        SeedWords(context, userId);
        // Add a word for the other user
        context.Words.Add(new Word { WordId = 100, UserId = otherUserId, LanguageId = 1, Term = "othersword", Status = 1 });
        context.SaveChanges();
        context.ChangeTracker.Clear();

        var controller = CreateWordsController(context, userId);
        var result = await controller.GetWordsByLanguage(1, skipSort: true);

        var words = result.Value!.ToList();
        Assert.Equal(3, words.Count);
        Assert.DoesNotContain(words, w => w.Term == "othersword");
    }

    // --- Helpers ---

    private static TextsController CreateTextsController(AppDbContext context, Guid userId)
    {
        var sp = CreateContextProvider(context);
        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var stats = new StatsRecomputeService(sp, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        return new TextsController(context, NullLogger<TextsController>.Instance, service, new WordLinkingChannel(), stats)
        {
            ControllerContext = BuildControllerContext(userId)
        };
    }

    private static IServiceProvider CreateContextProvider(AppDbContext context)
    {
        var services = new ServiceCollection();
        services.AddSingleton(context);
        return services.BuildServiceProvider();
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

    private static void SeedUserLanguageAndText(AppDbContext context, Guid userId, int textId, string content)
    {
        SeedUserAndLanguage(context, userId);
        context.Texts.Add(new Text
        {
            TextId = textId,
            UserId = userId,
            LanguageId = 1,
            Title = "Test text",
            Content = content
        });
        context.SaveChanges();
    }

    private static void SeedWords(AppDbContext context, Guid userId)
    {
        context.Words.AddRange(
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "gamma", Status = 5 },
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "alpha", Status = 1 },
            new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "beta", Status = 3 }
        );
        context.SaveChanges();
    }

    // --- ETag / Last-Modified support (Feature 3) ---

    [Fact]
    public async Task GetText_SetsETagAndLastModifiedHeaders()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        context.Texts.Add(new Text
        {
            TextId = 1, UserId = userId, LanguageId = 1, Title = "T", Content = "hello",
            StatsUpdatedAt = new DateTime(2026, 5, 1, 10, 30, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 4, 1, 10, 0, 0, DateTimeKind.Utc),
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateTextsController(context, userId);
        var result = await controller.GetText(1);

        Assert.NotNull(result.Value);
        var etag = controller.Response.Headers.ETag.ToString();
        Assert.False(string.IsNullOrWhiteSpace(etag));
        Assert.StartsWith("\"text-1-", etag);
        var lastModified = controller.Response.Headers.LastModified.ToString();
        Assert.False(string.IsNullOrWhiteSpace(lastModified));
        // RFC 1123 ("Fri, 01 May 2026 10:30:00 GMT")
        Assert.Contains("2026", lastModified);
        Assert.EndsWith("GMT", lastModified);
    }

    [Fact]
    public async Task GetText_WithMatchingIfNoneMatch_Returns304()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        context.Texts.Add(new Text
        {
            TextId = 2, UserId = userId, LanguageId = 1, Title = "T", Content = "hello",
            StatsUpdatedAt = new DateTime(2026, 5, 1, 10, 30, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 4, 1, 10, 0, 0, DateTimeKind.Utc),
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        // First request: capture the ETag the server returns.
        var first = CreateTextsController(context, userId);
        await first.GetText(2);
        var etag = first.Response.Headers.ETag.ToString();
        Assert.False(string.IsNullOrEmpty(etag));

        // Give the background task a moment to complete to avoid DbContext concurrency conflicts
        await Task.Delay(250);

        // Second request: echo the ETag in If-None-Match → server should 304.
        var second = CreateTextsController(context, userId);
        second.Request.Headers.IfNoneMatch = etag;
        var result = await second.GetText(2);

        var status = Assert.IsType<StatusCodeResult>(result.Result);
        Assert.Equal(304, status.StatusCode);
        // Cache headers should still be present on the 304 response.
        Assert.Equal(etag, second.Response.Headers.ETag.ToString());
        Assert.False(string.IsNullOrEmpty(second.Response.Headers.LastModified.ToString()));
    }

    [Fact]
    public async Task GetText_WithStaleIfNoneMatch_ReturnsBody()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserAndLanguage(context, userId);
        context.Texts.Add(new Text
        {
            TextId = 3, UserId = userId, LanguageId = 1, Title = "T", Content = "hello",
            StatsUpdatedAt = new DateTime(2026, 5, 1, 10, 30, 0, DateTimeKind.Utc),
            CreatedAt = new DateTime(2026, 4, 1, 10, 0, 0, DateTimeKind.Utc),
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateTextsController(context, userId);
        controller.Request.Headers.IfNoneMatch = "\"text-3-9999999999\""; // never matches
        var result = await controller.GetText(3);

        // Full body, not 304.
        Assert.NotNull(result.Value);
        Assert.Equal(3, result.Value!.TextId);
    }
}
