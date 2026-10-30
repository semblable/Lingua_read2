using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Data.Migrations;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Tokenization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace LinguaReadApi.Tests;

public class ChineseRolloutTests
{
    [Fact]
    public async Task LegacyTexts_AndCreationWithoutAnExplicitProfile_StayLegacy()
    {
        await using var h = await Harness.Create();
        h.Context.Texts.Add(new Text { TextId = 10, UserId = h.UserId, LanguageId = 1,
            Title = "Legacy", Content = "我爱读书。", WordLinkingTokenizerVersion = 3 });
        await h.Context.SaveChangesAsync();
        var result = await h.Controller().CreateText(Request());
        Assert.IsType<CreatedAtActionResult>(result.Result);
        h.Context.ChangeTracker.Clear();
        Assert.All(await h.Context.Texts.ToArrayAsync(), t => Assert.Null(t.SegmentationProfile));
        Assert.Null((await h.Controller().GetText(10)).Value!.SegmentationProfile);
        Assert.Equal(3, (await h.Context.Texts.SingleAsync(t => t.TextId == 10)).WordLinkingTokenizerVersion);
        Assert.True(h.Channel.Reader.TryRead(out var queued));
        Assert.NotEqual(10, queued!.TextId);
        Assert.False(h.Channel.Reader.TryRead(out _));
    }

    [Theory]
    [InlineData("zh")]
    [InlineData("zh-CN")]
    [InlineData("zh-TW")]
    [InlineData("ZH-Hant")]
    [InlineData("zh_HK")]
    public async Task ExplicitChineseProfile_IsPersistedAndReturned(string code)
    {
        await using var h = await Harness.Create(code);
        var created = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateText(Request(ChineseSegmenter.Profile))).Result);
        var id = Assert.IsType<TextDto>(created.Value).TextId;
        h.Context.ChangeTracker.Clear();
        Assert.Equal(ChineseSegmenter.Profile, (await h.Context.Texts.SingleAsync()).SegmentationProfile);
        var dto = Assert.IsType<TextDetailDto>((await h.Controller().GetText(id)).Value);
        Assert.Equal(ChineseSegmenter.Profile, dto.SegmentationProfile);
        Assert.Equal(ChineseSegmenter.Profile, JsonSerializer.SerializeToElement(dto,
            new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("segmentationProfile").GetString());
    }

    [Theory]
    [InlineData("zh", "jieba")]
    [InlineData("zh", "jieba-v2")]
    [InlineData("zh", "JIEBA-V1")]
    [InlineData("zh", "")]
    [InlineData("en", "jieba-v1")]
    [InlineData("ja", "jieba-v1")]
    [InlineData("zho", "jieba-v1")]
    public async Task InvalidOrNonChineseProfiles_AreRejectedWithoutQueueing(string code, string profile)
    {
        await using var h = await Harness.Create(code);
        Assert.IsType<BadRequestObjectResult>((await h.Controller().CreateText(Request(profile))).Result);
        Assert.Empty(await h.Context.Texts.ToArrayAsync());
        Assert.False(h.Channel.Reader.TryRead(out _));
    }

    [Fact]
    public async Task ProfiledEdits_KeepTheProfileAndRelinkContent_ButRejectNonChineseLanguage()
    {
        await using var h = await Harness.Create();
        h.Context.Languages.AddRange(new Language { LanguageId = 2, Code = "en", Name = "English" },
            new Language { LanguageId = 3, Code = "zh-TW", Name = "Traditional Chinese" });
        await h.Context.SaveChangesAsync();
        var created = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateText(Request(ChineseSegmenter.Profile))).Result);
        var id = Assert.IsType<TextDto>(created.Value).TextId;
        Assert.True(h.Channel.Reader.TryRead(out _));
        Assert.IsType<NoContentResult>(await h.Controller().UpdateText(id, new UpdateTextDto {
            TextId = id, Title = "Edited", Content = "今天读书。", LanguageId = 3 }));
        h.Context.ChangeTracker.Clear();
        var updated = await h.Context.Texts.SingleAsync();
        Assert.Equal(ChineseSegmenter.Profile, updated.SegmentationProfile);
        Assert.Equal(3, updated.LanguageId);
        Assert.Equal("completed", updated.WordLinkingStatus);
        Assert.NotEmpty(await h.Context.TextWords.Where(w => w.TextId == id).ToArrayAsync());
        Assert.False(h.Channel.Reader.TryRead(out _));
        Assert.IsType<BadRequestObjectResult>(await h.Controller().UpdateText(id, new UpdateTextDto {
            TextId = id, Title = "Rejected", Content = "one two", LanguageId = 2 }));
        // Even the tracked entity remains unchanged after the rejected update.
        Assert.Equal("Edited", updated.Title);
        Assert.Equal("今天读书。", updated.Content);
        h.Context.ChangeTracker.Clear();
        Assert.Equal(3, (await h.Context.Texts.SingleAsync()).LanguageId);
        Assert.False(h.Channel.Reader.TryRead(out _));
    }

    [Fact]
    public async Task ProfiledContentEdit_RemovesOldLinksAndRecountsSharedTerms_PreservingLearnerHistory()
    {
        await using var h = await Harness.Create();
        await h.Controller().CreateText(Request(ChineseSegmenter.Profile));
        Assert.True(h.Channel.Reader.TryRead(out var initial));
        await WordLinker.LinkAsync(h.Context, initial!.TextId, initial.Content, initial.LanguageId, initial.UserId);
        var shared = await h.Context.Words.SingleAsync(w => w.Term == "读书");
        shared.Status = 5;
        var removed = await h.Context.Words.SingleAsync(w => w.Term == "爱");
        removed.Status = 3;
        h.Context.WordTranslations.Add(new WordTranslation { WordId = removed.WordId, Translation = "saved meaning" });
        h.Context.LessonStudyEvents.Add(new LessonStudyEvent { UserId = h.UserId, SourceTextId = initial.TextId,
            SourceTitle = "Synthetic", LanguageId = 1, ClientEventId = "saved-pass", SourceRevision = "before-edit",
            Kind = "read", CreditedWords = 17, IsCompletionCheckpoint = true });
        await h.Context.SaveChangesAsync();
        var preserved = await h.Preserved();

        Assert.IsType<NoContentResult>(await h.Controller().UpdateText(initial.TextId, new UpdateTextDto {
            TextId = initial.TextId, Title = "Edited", Content = "读书。读书。" }));
        h.Context.ChangeTracker.Clear();
        var link = Assert.Single(await h.Context.TextWords.Where(w => w.TextId == initial.TextId).Include(w => w.Word).ToArrayAsync());
        Assert.Equal(shared.WordId, link.WordId);
        Assert.Equal(2, link.OccurrenceCount);
        var edited = await h.Context.Texts.SingleAsync();
        Assert.Equal(ChineseSegmenter.Profile, edited.SegmentationProfile);
        Assert.Equal("completed", edited.WordLinkingStatus);
        Assert.Equal(2, edited.TotalWords);
        Assert.Equal(2, edited.KnownWords);
        Assert.Equal(3, (await h.Context.Words.SingleAsync(w => w.WordId == removed.WordId)).Status);
        Assert.Equal(preserved, await h.Preserved());
        Assert.False(h.Channel.Reader.TryRead(out _));

        // A delayed creation request must read the current profiled source,
        // rather than appending links from the old queued content.
        await WordLinker.LinkAsync(h.Context, initial.TextId, initial.Content, initial.LanguageId, initial.UserId);
        Assert.Equal(2, Assert.Single(await h.Context.TextWords.Where(w => w.TextId == initial.TextId).ToArrayAsync()).OccurrenceCount);
    }

    [Fact]
    public async Task InterruptedProfiledEdit_RollsBackContentLinksCountsAndStatus_ThenRetryWorks()
    {
        var failure = new FailSave();
        await using var h = await Harness.Create(failure: failure);
        await h.Controller().CreateText(Request(ChineseSegmenter.Profile));
        Assert.True(h.Channel.Reader.TryRead(out var initial));
        await WordLinker.LinkAsync(h.Context, initial!.TextId, initial.Content, initial.LanguageId, initial.UserId);
        var original = await h.Context.Texts.SingleAsync();
        original.WordLinkingStatus = "completed";
        original.TotalWords = 3;
        await h.Context.SaveChangesAsync();
        var oldLinks = await h.Context.TextWords.AsNoTracking().OrderBy(w => w.WordId)
            .Select(w => new { w.WordId, w.OccurrenceCount }).ToArrayAsync();
        var edit = new UpdateTextDto { TextId = initial.TextId, Title = "Edited", Content = "今天读书。" };
        // Fail after the edited content and old-link removal have reached SQLite.
        failure.FailOnSave = 3;
        await Assert.ThrowsAsync<InvalidOperationException>(() => h.Controller().UpdateText(initial.TextId, edit));
        h.Context.ChangeTracker.Clear();
        var rolledBack = await h.Context.Texts.SingleAsync();
        Assert.Equal(initial.Content, rolledBack.Content);
        Assert.Equal("Synthetic Chinese text", rolledBack.Title);
        Assert.Equal("completed", rolledBack.WordLinkingStatus);
        Assert.Equal(3, rolledBack.TotalWords);
        Assert.Equal(ChineseSegmenter.Profile, rolledBack.SegmentationProfile);
        Assert.Equal(oldLinks, await h.Context.TextWords.AsNoTracking().OrderBy(w => w.WordId)
            .Select(w => new { w.WordId, w.OccurrenceCount }).ToArrayAsync());
        Assert.DoesNotContain(await h.Context.Words.ToArrayAsync(), w => w.Term == "今天");
        Assert.IsType<NoContentResult>(await h.Controller().UpdateText(initial.TextId, edit));
        Assert.Equal("今天读书。", (await h.Context.Texts.SingleAsync()).Content);
        Assert.Equal("completed", (await h.Context.Texts.SingleAsync()).WordLinkingStatus);
        Assert.False(h.Channel.Reader.TryRead(out _));
    }

    [Fact]
    public async Task ProfileChangesInvalidateTheReaderETag_WithoutChangingHistoricalStudyRevision()
    {
        await using var h = await Harness.Create();
        h.Context.Texts.Add(new Text { TextId = 1, UserId = h.UserId, LanguageId = 1,
            Title = "Synthetic", Content = "我爱读书。" });
        await h.Context.SaveChangesAsync();
        var first = h.Controller();
        var original = (await first.GetText(1)).Value!;
        var etag = first.Response.Headers.ETag.ToString();
        (await h.Context.Texts.SingleAsync()).SegmentationProfile = ChineseSegmenter.Profile;
        await h.Context.SaveChangesAsync();
        var second = h.Controller();
        second.Request.Headers.IfNoneMatch = etag;
        var updated = (await second.GetText(1)).Value!;
        Assert.NotNull(updated);
        Assert.NotEqual(etag, second.Response.Headers.ETag.ToString());
        Assert.Equal(original.StudyRevision, updated.StudyRevision);
        var revalidate = h.Controller();
        revalidate.Request.Headers.IfNoneMatch = second.Response.Headers.ETag;
        Assert.Equal(304, Assert.IsType<StatusCodeResult>((await revalidate.GetText(1)).Result).StatusCode);
    }

    [Fact]
    public async Task CreatingAndLinkingAProfiledText_PreservesLegacyWordsAndEarnedPasses()
    {
        await using var h = await Harness.Create();
        h.Context.Texts.Add(new Text { TextId = 10, UserId = h.UserId, LanguageId = 1,
            Title = "Legacy", Content = "我爱读书。", WordLinkingTokenizerVersion = 3 });
        h.Context.Words.Add(new Word { WordId = 10, UserId = h.UserId, LanguageId = 1, Term = "我爱读书", Status = 5 });
        h.Context.TextWords.Add(new TextWord { TextId = 10, WordId = 10, OccurrenceCount = 7 });
        h.Context.WordTranslations.Add(new WordTranslation { WordId = 10, Translation = "my saved phrase" });
        h.Context.UserActivities.Add(new UserActivity { UserId = h.UserId, LanguageId = 1,
            ActivityType = "TextCompleted", WordCount = 123, Timestamp = DateTime.UtcNow.AddYears(-1) });
        h.Context.LessonStudyEvents.Add(new LessonStudyEvent { UserId = h.UserId, SourceTextId = 10,
            SourceTitle = "Legacy", LanguageId = 1, SourceRevision = "original-revision", ClientEventId = "manual-pass",
            Kind = "read", CreditedWords = 1, CountingVersion = 1, IsCompletionCheckpoint = true });
        await h.Context.SaveChangesAsync();
        var preserved = await h.Preserved();
        var created = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateText(Request(ChineseSegmenter.Profile))).Result);
        Assert.Equal(preserved, await h.Preserved());
        Assert.True(h.Channel.Reader.TryRead(out var request));
        await WordLinker.LinkAsync(h.Context, request!.TextId, request.Content, request.LanguageId, request.UserId);
        Assert.Equal(preserved, await h.Preserved());
        var newTerms = await h.Context.TextWords.Where(tw => tw.TextId == request.TextId)
            .Select(tw => new { tw.Word.Term, tw.Word.Status }).ToArrayAsync();
        Assert.Equal(new[] { "我", "爱", "读书" }.OrderBy(x => x), newTerms.Select(w => w.Term).OrderBy(x => x));
        Assert.All(newTerms, word => Assert.Equal(0, word.Status)); // Existing linker default: unknown.
        Assert.Null((await h.Context.Texts.SingleAsync(t => t.TextId == 10)).SegmentationProfile);
        Assert.Equal(3, WordLinker.CurrentTokenizerVersion);
    }

    [Fact]
    public async Task DictionaryEndpoint_ServesPinnedRawBytes_PublicImmutableAndConditionallyCached()
    {
        var controller = new ChineseDictionaryController { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };
        var file = Assert.IsType<FileStreamResult>(controller.GetDictionary());
        await using var body = new MemoryStream();
        await using (file.FileStream) await file.FileStream.CopyToAsync(body);
        Assert.Equal("text/plain; charset=utf-8", file.ContentType);
        Assert.Equal("b16011275c42955ccd81fc1adecc93a59dbb7926af69d93fc95d4943d40f6aad",
            Convert.ToHexStringLower(SHA256.HashData(body.ToArray())));
        Assert.Equal('"' + ChineseSegmenter.DictionarySha256 + '"', controller.Response.Headers.ETag);
        Assert.Equal("public, max-age=31536000, immutable", controller.Response.Headers.CacheControl);
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(ChineseDictionaryController), typeof(AllowAnonymousAttribute)));
        Assert.Equal("api/segmentation/jieba-v1/dictionary",
            ((RouteAttribute)Attribute.GetCustomAttribute(typeof(ChineseDictionaryController), typeof(RouteAttribute))!).Template);
        var cached = new ChineseDictionaryController { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };
        cached.Request.Headers.IfNoneMatch = "\"another\", W/" + controller.Response.Headers.ETag;
        Assert.Equal(304, Assert.IsType<StatusCodeResult>(cached.GetDictionary()).StatusCode);
    }

    [Fact]
    public async Task Migration_IsOnlyANullableColumnAndPreservesLegacyRows()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.ExecuteSqlRawAsync("CREATE TABLE \"Texts\" (\"TextId\" INTEGER PRIMARY KEY, \"Content\" TEXT NOT NULL); INSERT INTO \"Texts\" VALUES (1, 'synthetic legacy');");
        var migration = new AddTextSegmentationProfile();
        var addition = Assert.IsType<AddColumnOperation>(Assert.Single(migration.UpOperations));
        Assert.Equal("Texts", addition.Table);
        Assert.Equal("SegmentationProfile", addition.Name);
        Assert.True(addition.IsNullable);
        Assert.Equal(32, addition.MaxLength);
        Assert.Null(addition.DefaultValue);
        foreach (var sql in context.GetService<IMigrationsSqlGenerator>().Generate(migration.UpOperations))
            await context.Database.ExecuteSqlRawAsync(sql.CommandText);
        await using var query = connection.CreateCommand();
        query.CommandText = "SELECT \"Content\", \"SegmentationProfile\" FROM \"Texts\" WHERE \"TextId\" = 1";
        await using var reader = await query.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("synthetic legacy", reader.GetString(0));
        Assert.True(reader.IsDBNull(1));
        var property = context.Model.FindEntityType(typeof(Text))!.FindProperty(nameof(Text.SegmentationProfile))!;
        Assert.True(property.IsNullable);
        Assert.Equal(32, property.GetMaxLength());
        Assert.Collection(migration.DownOperations,
            guard => Assert.Contains("\"SegmentationProfile\" IS NOT NULL", Assert.IsType<SqlOperation>(guard).Sql),
            drop => Assert.Equal("SegmentationProfile", Assert.IsType<DropColumnOperation>(drop).Name));
    }

    [PostgresStudyFact]
    public async Task MigrationDowngrade_RefusesToDiscardAnyProfiledText()
    {
        var settings = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("LINGUA_STUDY_TEST_POSTGRES")!);
        Assert.Equal("studycheck", settings.Database);
        var schema = "chinese_rollout_" + Guid.NewGuid().ToString("N");
        await using var connection = new NpgsqlConnection(settings.ToString());
        await connection.OpenAsync();
        await new NpgsqlCommand($"CREATE SCHEMA {schema}", connection).ExecuteNonQueryAsync();
        try
        {
            settings.SearchPath = schema;
            await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(settings.ToString()).Options);
            await context.Database.ExecuteSqlRawAsync("CREATE TABLE \"Texts\" (\"TextId\" INTEGER PRIMARY KEY, \"Content\" TEXT NOT NULL); INSERT INTO \"Texts\" VALUES (1, 'synthetic legacy');");
            var migration = new AddTextSegmentationProfile();
            var generator = context.GetService<IMigrationsSqlGenerator>();
            foreach (var sql in generator.Generate(migration.UpOperations)) await context.Database.ExecuteSqlRawAsync(sql.CommandText);
            await context.Database.ExecuteSqlRawAsync("UPDATE \"Texts\" SET \"SegmentationProfile\" = 'jieba-v1'");
            await Assert.ThrowsAsync<PostgresException>(async () => {
                foreach (var sql in generator.Generate(migration.DownOperations)) await context.Database.ExecuteSqlRawAsync(sql.CommandText);
            });
            Assert.Equal(1, await context.Database.SqlQueryRaw<int>("SELECT COUNT(*)::integer AS \"Value\" FROM \"Texts\" WHERE \"SegmentationProfile\" = 'jieba-v1'").SingleAsync());
            await context.Database.ExecuteSqlRawAsync("UPDATE \"Texts\" SET \"SegmentationProfile\" = NULL");
            foreach (var sql in generator.Generate(migration.DownOperations)) await context.Database.ExecuteSqlRawAsync(sql.CommandText);
        }
        finally
        {
            await new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", connection).ExecuteNonQueryAsync();
        }
    }

    private static CreateTextDto Request(string? profile = null) => new() {
        Title = "Synthetic Chinese text", Content = "我爱读书。", LanguageId = 1, SegmentationProfile = profile };

    private sealed class Harness(SqliteConnection connection, AppDbContext context, ServiceProvider provider) : IAsyncDisposable
    {
        public Guid UserId { get; } = Guid.Parse("deadbeef-0000-0000-0000-000000000088");
        public AppDbContext Context => context;
        public WordLinkingChannel Channel { get; } = new();

        public static async Task<Harness> Create(string code = "zh", FailSave? failure = null)
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection);
            if (failure != null) options.AddInterceptors(failure);
            var context = new AppDbContext(options.Options);
            await context.Database.EnsureCreatedAsync();
            var provider = new ServiceCollection().AddSingleton(context).BuildServiceProvider();
            var h = new Harness(connection, context, provider);
            context.Users.Add(new User { Id = h.UserId, UserName = "synthetic" });
            context.Languages.Add(new Language { LanguageId = 1, Code = code, Name = "Synthetic language", ParserType = "jieba" });
            await context.SaveChangesAsync();
            return h;
        }

        public TextsController Controller() => new(context, NullLogger<TextsController>.Instance,
            new UserActivityService(context, NullLogger<UserActivityService>.Instance), Channel,
            new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal())) {
                ControllerContext = new() { HttpContext = new DefaultHttpContext {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test")) } } };

        public async Task<string> Preserved()
        {
            context.ChangeTracker.Clear();
            Array[] rows = [await context.Words.Where(w => w.WordId == 10).ToArrayAsync(),
                await context.TextWords.Where(w => w.TextId == 10).ToArrayAsync(), await context.WordTranslations.ToArrayAsync(),
                await context.UserActivities.ToArrayAsync(), await context.LessonStudyEvents.ToArrayAsync()];
            return JsonSerializer.Serialize(rows.Select(a => a.Cast<object>().Select(e => context.Entry(e).Properties
                .ToDictionary(p => p.Metadata.Name, p => p.CurrentValue)).ToArray()).ToArray());
        }

        public async ValueTask DisposeAsync()
        {
            await provider.DisposeAsync();
            await context.DisposeAsync();
            await connection.DisposeAsync();
        }
    }

    private sealed class FailSave : SaveChangesInterceptor
    {
        public int FailOnSave { get; set; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (FailOnSave > 0 && --FailOnSave == 0) throw new InvalidOperationException("synthetic edit interruption");
            return ValueTask.FromResult(result);
        }
    }
}
