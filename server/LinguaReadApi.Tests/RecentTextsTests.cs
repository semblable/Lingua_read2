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
    public async Task TextList_ExposesBookOrderAndCompletionForSuggestions_WithoutLosingFinishedParts()
    {
        await using var context = CreateContext();
        var owner = Guid.NewGuid();
        var other = Guid.NewGuid();
        context.Users.AddRange(new User { Id = owner }, new User { Id = other });
        context.Languages.Add(new Language { LanguageId = 1, Name = "French", Code = "fr" });
        context.Books.AddRange(
            new Book { BookId = 1, UserId = owner, LanguageId = 1, Title = "A journey" },
            new Book { BookId = 2, UserId = owner, LanguageId = 1, Title = "Finished book", IsFinished = true });
        context.Texts.AddRange(
            new Text { TextId = 1, UserId = owner, LanguageId = 1, BookId = 1, PartNumber = 1, IsFinished = true },
            new Text { TextId = 2, UserId = owner, LanguageId = 1, BookId = 1, PartNumber = 2, TotalWords = 100, KnownWords = 94 },
            new Text { TextId = 3, UserId = owner, LanguageId = 1, BookId = 2, PartNumber = 1 },
            new Text { TextId = 4, UserId = owner, LanguageId = 1, Title = "Standalone" },
            new Text { TextId = 5, UserId = other, LanguageId = 1, Title = "Private" },
            new Text { TextId = 6, UserId = owner, LanguageId = 1, Tag = "srs-story" });
        await context.SaveChangesAsync();

        var texts = (await CreateController(context, owner).GetTexts()).Value!.ToDictionary(text => text.TextId);

        Assert.Equal(new[] { 1, 2, 3, 4 }, texts.Keys.OrderBy(id => id));
        Assert.True(texts[1].IsFinished);
        Assert.Equal(1, texts[1].PartNumber);
        Assert.Equal(2, texts[2].PartNumber);
        Assert.Equal("A journey", texts[2].BookTitle);
        Assert.False(texts[2].BookIsFinished);
        Assert.Equal(94, texts[2].KnownWords);
        Assert.True(texts[3].BookIsFinished);
        Assert.False(texts[3].IsFinished);
        Assert.Null(texts[4].BookId);
        Assert.Null(texts[4].PartNumber);
    }

    [Theory]
    [InlineData("processing")]
    [InlineData("failed")]
    public async Task TextList_DoesNotConfirmEmptyStats_BeforeOrAfterLinkingAddsCountableWords(string linkingStatus)
    {
        await using var context = CreateContext();
        var owner = Guid.NewGuid();
        context.Users.Add(new User { Id = owner });
        context.Languages.Add(new Language { LanguageId = 1, Name = "French", Code = "fr" });
        context.Books.Add(new Book { BookId = 1, UserId = owner, LanguageId = 1, Title = "A journey" });
        context.Texts.Add(new Text { TextId = 1, UserId = owner, LanguageId = 1, BookId = 1, PartNumber = 1,
            Content = "Un chapitre dont le vocabulaire reste à analyser.", WordLinkingStatus = linkingStatus });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        using var services = new ServiceCollection().AddSingleton(context).BuildServiceProvider();
        var stats = new StatsRecomputeService(services, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());

        await stats.RecomputeAllAsync(CancellationToken.None);
        var text = Assert.Single((await CreateController(context, owner).GetTexts()).Value!);

        Assert.Equal(0, text.TotalWords);
        Assert.NotNull(text.StatsUpdatedAt);
        Assert.Equal(linkingStatus, text.WordLinkingStatus);
        Assert.False(text.HasNoCountableWords);

        // The worker completes linking before the debounced stats sweep. Its
        // new links must prevent the stale, timestamped zero from looking empty.
        context.Words.Add(new Word { WordId = 1, UserId = owner, LanguageId = 1, Term = "chapitre", Status = 5 });
        context.TextWords.Add(new TextWord { TextId = 1, WordId = 1, OccurrenceCount = 1 });
        (await context.Texts.FindAsync(1))!.WordLinkingStatus = "completed";
        await context.SaveChangesAsync();
        var linked = Assert.Single((await CreateController(context, owner).GetTexts()).Value!);
        Assert.Equal("completed", linked.WordLinkingStatus);
        Assert.Equal(0, linked.TotalWords);
        Assert.NotNull(linked.StatsUpdatedAt);
        Assert.False(linked.HasNoCountableWords);

        context.ChangeTracker.Clear();
        await stats.RecomputeAllAsync(CancellationToken.None);
        var refreshed = Assert.Single((await CreateController(context, owner).GetTexts()).Value!);
        Assert.Equal(1, refreshed.TotalWords);
        Assert.Equal(1, refreshed.KnownWords);
    }

    [Fact]
    public async Task TextList_ConfirmsCompletedEmptyAndAllIgnoredParts_HaveNoCountableWords()
    {
        await using var context = CreateContext();
        var owner = Guid.NewGuid();
        context.Users.Add(new User { Id = owner });
        context.Languages.Add(new Language { LanguageId = 1, Name = "French", Code = "fr" });
        context.Texts.AddRange(
            new Text { TextId = 1, UserId = owner, LanguageId = 1, Content = "...", WordLinkingStatus = "completed" },
            new Text { TextId = 2, UserId = owner, LanguageId = 1, Content = "chapitre", WordLinkingStatus = "completed" });
        context.Words.Add(new Word { WordId = 1, UserId = owner, LanguageId = 1, Term = "chapitre", Status = 6 });
        context.TextWords.Add(new TextWord { TextId = 2, WordId = 1, OccurrenceCount = 1 });
        await context.SaveChangesAsync();

        var texts = (await CreateController(context, owner).GetTexts()).Value!.ToList();
        Assert.Equal(2, texts.Count);
        Assert.All(texts, text => Assert.True(text.HasNoCountableWords));
    }

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
