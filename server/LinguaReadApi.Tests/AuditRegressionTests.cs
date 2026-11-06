using System.Reflection;
using System.Security.Claims;
using LinguaReadApi.Authorization;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Tokenization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class AuditRegressionTests
{
    [Fact]
    public async Task LanguageReset_ArchivesScopedGoals_AndRebasesActiveGlobalGoals()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "reset-audit" });
        context.Languages.AddRange(new Language { LanguageId = 1, Code = "en", Name = "English" },
            new Language { LanguageId = 2, Code = "es", Name = "Spanish" });
        context.UserActivities.AddRange(new UserActivity { UserId = userId, LanguageId = 1, ActivityType = "Reading", WordCount = 500 },
            new UserActivity { UserId = userId, LanguageId = 2, ActivityType = "Reading", WordCount = 20 });
        context.UserGoals.AddRange(new UserGoal { GoalId = 1, UserId = userId, LanguageId = 1, GoalType = GoalType.WordsRead, BaselineValue = 500, TargetValue = 100 },
            new UserGoal { GoalId = 2, UserId = userId, GoalType = GoalType.WordsRead, BaselineValue = 500, CurrentPeriodBaseline = 500, TargetValue = 100 },
            new UserGoal { GoalId = 3, UserId = userId, LanguageId = 2, GoalType = GoalType.WordsRead, BaselineValue = 10, TargetValue = 100 });
        await context.SaveChangesAsync();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        Assert.True(await new LanguageService(context, cache).ResetLanguageContentAsync(1, userId));
        context.ChangeTracker.Clear();
        var goals = await context.UserGoals.OrderBy(g => g.GoalId).ToListAsync();
        Assert.NotNull(goals[0].ArchivedAt);
        Assert.Null(goals[1].ArchivedAt);
        Assert.Equal(20, goals[1].BaselineValue);
        Assert.Equal(20, goals[1].CurrentPeriodBaseline);
        Assert.Null(goals[2].ArchivedAt);
        Assert.Equal(10, goals[2].BaselineValue);
    }

    [Fact]
    public async Task BookDelete_RemovesCascadedLessonAudio_AfterCommit()
    {
        var webRoot = Path.Combine(Path.GetTempPath(), "lingua-audit-audio", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(webRoot, "audio_lessons"));
        var audioPath = Path.Combine(webRoot, "audio_lessons", "lesson.mp3");
        await File.WriteAllTextAsync(audioPath, "audio fixture");
        try
        {
            await using var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
            await context.Database.EnsureCreatedAsync();
            var userId = Guid.NewGuid();
            context.Users.Add(new User { Id = userId, UserName = "audio-delete" });
            context.Languages.Add(new Language { LanguageId = 1, Code = "en", Name = "English" });
            context.Books.Add(new Book { BookId = 1, UserId = userId, LanguageId = 1, Title = "book" });
            context.Texts.Add(new Text { TextId = 1, BookId = 1, UserId = userId, LanguageId = 1,
                Title = "lesson", Content = "text", IsAudioLesson = true, AudioFilePath = "audio_lessons/lesson.mp3" });
            await context.SaveChangesAsync();
            var controller = new BooksController(context, NullLogger<BooksController>.Instance, null!) {
                WebRoot = webRoot, ControllerContext = Identity(userId)
            };
            Assert.IsType<NoContentResult>(await controller.DeleteBook(1));
            Assert.False(File.Exists(audioPath));
            Assert.Empty(await context.Texts.ToListAsync());
        }
        finally { Directory.Delete(webRoot, true); }
    }
    private static ControllerContext Identity(Guid userId) => new() { HttpContext = new DefaultHttpContext {
        User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test")) } };

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OrdinaryTextEdits_RelinkTokensAndCounts(bool changeLanguage)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "audit" });
        context.Languages.AddRange(new Language { LanguageId = 1, Code = "en", Name = "English" },
            new Language { LanguageId = 2, Code = "es", Name = "Spanish" });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "old", Content = "old word" });
        await context.SaveChangesAsync();
        await WordLinker.RelinkAsync(context, 1, "old word", 1, userId);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, null!, new WordLinkingChannel(), null!)
            { ControllerContext = Identity(userId) };
        Assert.IsType<NoContentResult>(await controller.UpdateText(1, new UpdateTextDto {
            TextId = 1, Title = "new", Content = "new new token", LanguageId = changeLanguage ? 2 : 1 }));
        var linked = await context.TextWords.Where(tw => tw.TextId == 1).Include(tw => tw.Word).ToListAsync();
        Assert.Equal(new[] { "new", "token" }, linked.Select(tw => tw.Word.Term).Order().ToArray());
        Assert.All(linked, tw => Assert.Equal(changeLanguage ? 2 : 1, tw.Word.LanguageId));
        var text = await context.Texts.SingleAsync();
        Assert.Null(text.SegmentationProfile);
        Assert.Equal(3, text.TotalWords);
        Assert.Equal("completed", text.WordLinkingStatus);
    }

    [Fact]
    public async Task FolderCreateAndMove_AppendAfterMixedSiblings()
    {
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var userId = Guid.NewGuid();
        context.Books.Add(new Book { BookId = 1, UserId = userId, LanguageId = 1, Title = "book", SortOrder = 12 });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Title = "text", Content = "text", SortOrder = 20 });
        context.Folders.Add(new Folder { FolderId = 1, UserId = userId, Name = "destination" });
        context.Books.Add(new Book { BookId = 2, UserId = userId, LanguageId = 1, FolderId = 1, Title = "inside", SortOrder = 42 });
        await context.SaveChangesAsync();
        var controller = new FoldersController(context, NullLogger<FoldersController>.Instance) { ControllerContext = Identity(userId) };
        var created = await controller.CreateFolder(new CreateFolderDto { Name = "created" });
        var dto = Assert.IsType<FolderDto>(Assert.IsType<CreatedAtActionResult>(created.Result).Value);
        Assert.Equal(21, dto.SortOrder);
        await controller.UpdateFolder(dto.FolderId, new UpdateFolderDto { ParentFolderId = 1 });
        var folder = await context.Folders.SingleAsync(f => f.FolderId == dto.FolderId);
        Assert.Equal(43, folder.SortOrder);
        await controller.UpdateFolder(dto.FolderId, new UpdateFolderDto { ParentFolderId = 1 });
        Assert.Equal(43, folder.SortOrder);
    }

    [Theory]
    [InlineData("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5", null, true)]
    [InlineData("00000000-0000-0000-0000-000000000001", null, false)]
    [InlineData("00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000001", true)]
    [InlineData("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5", "00000000-0000-0000-0000-000000000001", false)]
    public async Task AdminPolicy_DefaultsToOwner_AndHonorsAnExplicitList(string id, string? allowed, bool expected)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Admin:AllowedUserIds"] = allowed }).Build();
        var requirement = new AdminOnlyRequirement();
        var auth = new AuthorizationHandlerContext([requirement], Identity(Guid.Parse(id)).HttpContext.User, null);
        await new AdminOnlyHandler(config, NullLogger<AdminOnlyHandler>.Instance).HandleAsync(auth);
        Assert.Equal(expected, auth.HasSucceeded);
    }

    [Theory]
    [InlineData(0, 7)]
    [InlineData(1, 7)]
    [InlineData(2, 0)]
    [InlineData(180, 0)]
    public async Task SrsStats_ExpireInactiveStreaks_WithoutChangingTheRecord(int daysAgo, int expected)
    {
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var userId = Guid.NewGuid();
        context.UserSettings.Add(new UserSettings { UserId = userId, SrsCurrentStreak = 7,
            SrsLongestStreak = 12, SrsDailyStudyDate = DateTime.UtcNow.Date.AddDays(-daysAgo), SrsDayStartHour = 0 });
        await context.SaveChangesAsync();
        var controller = new SrsController(context, null!) { ControllerContext = Identity(userId) };
        var result = (await controller.GetStats()).Value!;
        Assert.Equal(expected, result.CurrentStreak);
        Assert.Equal(12, result.LongestStreak);
        Assert.Equal(7, (await context.UserSettings.SingleAsync()).SrsCurrentStreak);
    }

    [Theory]
    [InlineData(typeof(AdminController))]
    [InlineData(typeof(DataManagementController))]
    public void DatabaseBackups_RequirePost(Type controller)
    {
        var action = controller.GetMethod("BackupDatabase")!;
        Assert.NotNull(action.GetCustomAttribute<HttpPostAttribute>());
        Assert.Null(action.GetCustomAttribute<HttpGetAttribute>());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("short")]
    [InlineData("replace_this_with_your_very_long_and_secure_random_jwt_key")]
    [InlineData("CHANGE_ME_IN_PRODUCTION_with_at_least_32_characters")]
    [InlineData("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")]
    public void JwtKeys_RejectPlaceholdersAndShortSecrets(string? key) =>
        Assert.Throws<InvalidOperationException>(() => JwtKeyValidation.Validate(key));

    [Fact]
    public void JwtKeys_AcceptGeneratedSecrets() => JwtKeyValidation.Validate(Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)));
}
