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

public class RecentTextsTests
{
    [Fact]
    public async Task RecentSummaries_IncludeSavedProgressWithoutChangingRecency_AndExcludeOtherUsers()
    {
        await using var context = CreateContext();
        var owner = Guid.NewGuid();
        var other = Guid.NewGuid();
        var accessed = DateTime.UtcNow.AddDays(-1);
        context.Users.AddRange(new User { Id = owner }, new User { Id = other });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Portuguese", Code = "pt" });
        context.Texts.AddRange(
            new Text { TextId = 1, UserId = owner, LanguageId = 1, Title = "Audio", Content = "<p>Olá &amp; bem-vindo.</p>",
                LastAccessedAt = accessed, IsAudioLesson = true, TotalWords = 1000, KnownWords = 970,
                ImagePath = "epub_assets/cover.jpg", SrtContent = "1\n00:00:00,000 --> 00:10:00,500\nOlá!\n" },
            new Text { TextId = 2, UserId = other, LanguageId = 1, Title = "Private", Content = "secret", LastAccessedAt = DateTime.UtcNow });
        context.UserAudioLessonProgresses.AddRange(
            new UserAudioLessonProgress { UserId = owner, TextId = 1, CurrentPosition = 120 },
            new UserAudioLessonProgress { UserId = other, TextId = 1, CurrentPosition = 400 });
        context.UserSentenceProgresses.Add(new UserSentenceProgress { UserId = owner, TextId = 1, CreditedWordCount = 200 });
        await context.SaveChangesAsync();

        var result = await CreateController(context, owner).GetRecentTexts();
        var summary = Assert.Single(result.Value!);
        Assert.Equal(1, summary.TextId);
        Assert.Equal("Olá & bem-vindo.", summary.Preview);
        Assert.Equal(970, summary.KnownWords);
        Assert.Equal(200, summary.ReadWords);
        Assert.Equal(120d, summary.AudioPositionSeconds);
        Assert.Equal(600.5d, summary.AudioDurationSeconds);
        Assert.Equal("epub_assets/cover.jpg", summary.CoverImagePath);
        Assert.Equal(accessed, (await context.Texts.FindAsync(1))!.LastAccessedAt);
    }

    [Fact]
    public async Task RecentSummaries_KeepOnePartPerBook_AndDoNotInventMissingProgress()
    {
        await using var context = CreateContext();
        var owner = Guid.NewGuid();
        context.Users.Add(new User { Id = owner });
        context.Languages.Add(new Language { LanguageId = 1, Name = "French", Code = "fr" });
        context.Books.Add(new Book { BookId = 1, UserId = owner, LanguageId = 1, Title = "A book", CoverImagePath = "cover.jpg" });
        for (var i = 1; i <= 8; i++)
            context.Texts.Add(new Text { TextId = i, UserId = owner, LanguageId = 1, Title = $"Part {i}",
                Content = "Une histoire.", LastAccessedAt = DateTime.UtcNow.AddDays(-i), BookId = i <= 2 ? 1 : null });
        await context.SaveChangesAsync();

        var result = await CreateController(context, owner).GetRecentTexts();
        var summaries = result.Value!.ToList();
        Assert.Equal(5, summaries.Count);
        Assert.Equal(new[] { 1, 3, 4, 5, 6 }, summaries.Select(summary => summary.TextId));
        Assert.Equal("cover.jpg", summaries[0].CoverImagePath);
        Assert.All(summaries, summary => { Assert.Null(summary.ReadWords); Assert.Null(summary.AudioPositionSeconds); Assert.Null(summary.AudioDurationSeconds); });
    }

    [Fact]
    public async Task RecentSummaries_StripCompleteMarkupAndDecodeEntitiesBeforeTruncating()
    {
        await using var context = CreateContext();
        var owner = Guid.NewGuid();
        context.Users.Add(new User { Id = owner });
        context.Languages.Add(new Language { LanguageId = 1, Name = "French", Code = "fr" });
        var prefix = new string('a', 310);
        context.Texts.Add(new Text { UserId = owner, LanguageId = 1, Title = "Markup",
            Content = prefix + "<span title='" + new string('x', 330) + "'>&amp;" + new string('b', 30) + "</span>",
            LastAccessedAt = DateTime.UtcNow });
        await context.SaveChangesAsync();

        var summary = Assert.Single((await CreateController(context, owner).GetRecentTexts()).Value!);
        Assert.Equal(prefix + " &" + new string('b', 8), summary.Preview);
        Assert.NotNull(summary.Preview);
        Assert.Equal(320, summary.Preview.Length);
    }

    private static AppDbContext CreateContext() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static TextsController CreateController(AppDbContext context, Guid owner)
    {
        var services = new ServiceCollection().AddSingleton(context).BuildServiceProvider();
        var stats = new StatsRecomputeService(services, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        return new TextsController(context, NullLogger<TextsController>.Instance,
            new UserActivityService(context, NullLogger<UserActivityService>.Instance), new WordLinkingChannel(), stats)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, owner.ToString()) }, "TestAuth"))
            } }
        };
    }
}
