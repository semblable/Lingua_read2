using System.IO.Compression;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
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

[Collection("Postgres study database")]
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

    [Fact]
    public async Task CreateBook_AndUploadBook_PersistProfileBeforeQueueing_AndLinkSegmentedChineseParts()
    {
        await using var h = await Harness.Create();
        var profilesWhenProcessingSaved = new List<string?[]>();
        h.Context.SavingChanges += (_, _) =>
        {
            var modifiedParts = h.Context.ChangeTracker.Entries<Text>()
                .Where(e => e.State == EntityState.Modified && e.Property(t => t.WordLinkingStatus).IsModified && e.Entity.WordLinkingStatus == "processing")
                .Select(e => e.Entity.SegmentationProfile)
                .ToArray();
            if (modifiedParts.Length > 0)
            {
                Assert.Equal(0, h.Channel.Reader.Count);
                profilesWhenProcessingSaved.Add(modifiedParts);
            }
        };

        // 1. CreateBook with explicit profile
        var bookCreated = Assert.IsType<CreatedAtActionResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Profiled Chinese Book",
            Description = "Synthetic",
            LanguageId = 1,
            Content = "我爱读书。\n\n今天在图书馆学习中文。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 5,
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var bookId = Assert.IsType<BookDto>(bookCreated.Value).BookId;

        var queuedBook = await h.DrainAndLinkAsync();
        Assert.Equal(2, queuedBook.Count);
        var bookParts = await h.Context.Texts.AsNoTracking().Where(t => t.BookId == bookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.Equal(2, bookParts.Count);
        Assert.All(bookParts, p => Assert.Equal(ChineseSegmenter.Profile, p.SegmentationProfile));
        Assert.Equal(new[] { "我", "爱", "读书" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == bookParts[0].TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));
        Assert.Equal(new[] { "今天", "在", "图书馆", "学习", "中文" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == bookParts[1].TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        // 2. UploadBook (.txt) with explicit profile
        var txtCreated = Assert.IsType<CreatedAtActionResult>((await h.Books().UploadBook(new UploadBookDto
        {
            LanguageId = 1,
            File = FormFileFromBytes(Encoding.UTF8.GetBytes("我爱读书。\n\n今天学习中文。"), "book.txt", "text/plain"),
            SplitMethod = "paragraph",
            MaxSegmentSize = 5,
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var txtBookId = Assert.IsType<BookDto>(txtCreated.Value).BookId;
        var queuedTxt = await h.DrainAndLinkAsync();
        Assert.Equal(2, queuedTxt.Count);
        var txtParts = await h.Context.Texts.AsNoTracking().Where(t => t.BookId == txtBookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.All(txtParts, p => Assert.Equal(ChineseSegmenter.Profile, p.SegmentationProfile));

        // 3. UploadBook (.epub) with explicit profile
        var epubCreated = Assert.IsType<CreatedAtActionResult>((await h.Books().UploadBook(new UploadBookDto
        {
            LanguageId = 1,
            File = CreateSyntheticEpub("第一章", "我爱读书。", "第二章", "今天学习中文。"),
            SplitMethod = "chapter",
            MaxSegmentSize = 500,
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var epubBookId = Assert.IsType<BookDto>(epubCreated.Value).BookId;
        var queuedEpub = await h.DrainAndLinkAsync();
        Assert.Equal(2, queuedEpub.Count);
        var epubParts = await h.Context.Texts.AsNoTracking().Where(t => t.BookId == epubBookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.Equal(2, epubParts.Count);
        Assert.All(epubParts, p =>
        {
            Assert.Equal(ChineseSegmenter.Profile, p.SegmentationProfile);
            Assert.False(string.IsNullOrWhiteSpace(p.StructuredContent));
        });
        Assert.Equal(3, profilesWhenProcessingSaved.Count);
        Assert.All(profilesWhenProcessingSaved, batch => Assert.All(batch, p => Assert.Equal(ChineseSegmenter.Profile, p)));

        // 4. CreateBook & UploadBook without SegmentationProfile stay null (legacy)
        var legacyBook = Assert.IsType<CreatedAtActionResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Legacy Book",
            LanguageId = 1,
            Content = "我爱读书。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 500
        })).Result);
        var legacyBookId = Assert.IsType<BookDto>(legacyBook.Value).BookId;
        while (h.Channel.Reader.TryRead(out _)) { }
        var legacyUpload = Assert.IsType<CreatedAtActionResult>((await h.Books().UploadBook(new UploadBookDto
        {
            LanguageId = 1,
            File = FormFileFromBytes(Encoding.UTF8.GetBytes("我爱读书。"), "legacy.txt", "text/plain"),
            SplitMethod = "paragraph",
            MaxSegmentSize = 500
        })).Result);
        var legacyUploadId = Assert.IsType<BookDto>(legacyUpload.Value).BookId;
        while (h.Channel.Reader.TryRead(out _)) { }
        Assert.All(await h.Context.Texts.AsNoTracking().Where(t => t.BookId == legacyBookId || t.BookId == legacyUploadId).ToListAsync(),
            t => Assert.Null(t.SegmentationProfile));
    }

    [Theory]
    [InlineData("zh", "jieba")]
    [InlineData("zh", "jieba-v2")]
    [InlineData("zh", "")]
    [InlineData("en", "jieba-v1")]
    [InlineData("ja", "jieba-v1")]
    [InlineData("zho", "jieba-v1")]
    public async Task InvalidOrNonChineseBookAndAudioProfiles_AreRejectedBeforeSavingFilesEntitiesOrQueueItems(string code, string profile)
    {
        await using var h = await Harness.Create(code);

        Assert.IsType<BadRequestObjectResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Rejected Book",
            LanguageId = 1,
            Content = "我爱读书。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 500,
            SegmentationProfile = profile
        })).Result);

        Assert.IsType<BadRequestObjectResult>((await h.Books().UploadBook(new UploadBookDto
        {
            LanguageId = 1,
            File = CreateSyntheticEpub("第一章", "我爱读书。", "第二章", "今天学习中文。"),
            SplitMethod = "chapter",
            MaxSegmentSize = 500,
            SegmentationProfile = profile
        })).Result);

        Assert.IsType<BadRequestObjectResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Rejected Audio",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3, 4], "lesson.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n我爱读书。\n"), "lesson.srt", "text/plain"),
            SegmentationProfile = profile
        })).Result);

        var mp3File = FormFileFromBytes([1, 2, 3, 4], "lesson_01.mp3", "audio/mpeg");
        var srtFile = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n我爱读书。\n"), "lesson_01.srt", "text/plain");
        Assert.IsType<BadRequestObjectResult>(await h.Controller().CreateAudioLessonsBatch(
            new CreateAudioLessonsBatchDto { LanguageId = 1, SegmentationProfile = profile },
            [mp3File, srtFile]));

        Assert.Empty(await h.Context.Books.ToArrayAsync());
        Assert.Empty(await h.Context.Texts.ToArrayAsync());
        Assert.False(h.Channel.Reader.TryRead(out _));
        Assert.Empty(Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task ReSplitBook_PreservesProfileOnProfiledChineseBook_AndKeepsLegacyBookUnprofiled()
    {
        await using var h = await Harness.Create();

        // 1. Profiled Chinese book
        var profiledCreated = Assert.IsType<CreatedAtActionResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Profiled ReSplit",
            LanguageId = 1,
            Content = "我爱读书。\n\n今天在图书馆学习中文。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 5000,
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var profiledBookId = Assert.IsType<BookDto>(profiledCreated.Value).BookId;
        await h.DrainAndLinkAsync();

        Assert.IsType<NoContentResult>(await h.Books().ReSplitBook(profiledBookId, new ReSplitRequestDto
        {
            SplitMethod = "paragraph",
            MaxSegmentSize = 5,
            ChapterTitles = ["Part A", "Part B"]
        }));

        var resplitParts = await h.Context.Texts.AsNoTracking().Where(t => t.BookId == profiledBookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.Equal(2, resplitParts.Count);
        Assert.All(resplitParts, p =>
        {
            Assert.Equal(ChineseSegmenter.Profile, p.SegmentationProfile);
            Assert.Equal("processing", p.WordLinkingStatus);
        });

        var queuedResplit = await h.DrainAndLinkAsync();
        Assert.Equal(2, queuedResplit.Count);
        Assert.Equal(new[] { "我", "爱", "读书" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == resplitParts[0].TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));
        Assert.Equal(new[] { "今天", "在", "图书馆", "学习", "中文" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == resplitParts[1].TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        // 2. Legacy Chinese book stays null on re-split
        var legacyCreated = Assert.IsType<CreatedAtActionResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Legacy ReSplit",
            LanguageId = 1,
            Content = "我爱读书。\n\n今天学习中文。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 5000
        })).Result);
        var legacyBookId = Assert.IsType<BookDto>(legacyCreated.Value).BookId;
        await h.DrainAndLinkAsync();

        Assert.IsType<NoContentResult>(await h.Books().ReSplitBook(legacyBookId, new ReSplitRequestDto
        {
            SplitMethod = "paragraph",
            MaxSegmentSize = 5
        }));
        await h.DrainAndLinkAsync();

        var legacyParts = await h.Context.Texts.AsNoTracking().Where(t => t.BookId == legacyBookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.Equal(2, legacyParts.Count);
        Assert.All(legacyParts, p => Assert.Null(p.SegmentationProfile));
        Assert.Equal(["我爱读书"], await h.Context.TextWords.Where(tw => tw.TextId == legacyParts[0].TextId).Select(tw => tw.Word.Term).ToListAsync());
    }

    [Fact]
    public async Task CreateAudioLesson_AndBatch_PersistProfileKeepRawSrtAndLinkSegmentedWords()
    {
        await using var h = await Harness.Create();
        const string rawSrt = "1\r\n00:00:00,000 --> 00:00:02,000\r\n我爱读书。\r\n\r\n2\r\n00:00:02,500 --> 00:00:05,000\r\n今天在图书馆学习中文。\r\n";

        // 1. Single audio lesson with jieba-v1
        var singleCreated = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Chinese Audio Lesson",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3, 4], "lesson1.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes(rawSrt), "lesson1.srt", "text/plain"),
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var singleId = Assert.IsType<TextDto>(singleCreated.Value).TextId;

        var singleBeforeWorker = await h.Context.Texts.AsNoTracking().SingleAsync(t => t.TextId == singleId);
        Assert.Equal(ChineseSegmenter.Profile, singleBeforeWorker.SegmentationProfile);
        Assert.Equal("processing", singleBeforeWorker.WordLinkingStatus);
        Assert.Equal("我爱读书。 今天在图书馆学习中文。", singleBeforeWorker.Content);
        Assert.Equal(rawSrt, singleBeforeWorker.SrtContent);

        var srtResponse = Assert.IsType<ContentResult>((await h.Controller().GetSrtContent(singleId)).Result);
        Assert.Equal(rawSrt, srtResponse.Content);

        await h.DrainAndLinkAsync();
        var singleWords = await h.Context.TextWords.Where(tw => tw.TextId == singleId).Select(tw => tw.Word.Term).ToListAsync();
        Assert.Equal(new[] { "我", "爱", "读书", "今天", "在", "图书馆", "学习", "中文" }.OrderBy(x => x), singleWords.OrderBy(x => x));

        // 2. Batch audio lessons with jieba-v1
        var batchMp3 = FormFileFromBytes([5, 6, 7, 8], "podcast_ep01.mp3", "audio/mpeg");
        var batchSrt = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n今天学习中文。\n"), "podcast_ep01.srt", "text/plain");
        Assert.IsType<OkObjectResult>(await h.Controller().CreateAudioLessonsBatch(
            new CreateAudioLessonsBatchDto { LanguageId = 1, SegmentationProfile = ChineseSegmenter.Profile, Tag = "batch" },
            [batchMp3, batchSrt]));

        var batchLesson = await h.Context.Texts.AsNoTracking().SingleAsync(t => t.Tag == "batch");
        Assert.Equal(ChineseSegmenter.Profile, batchLesson.SegmentationProfile);
        Assert.Equal("processing", batchLesson.WordLinkingStatus);
        await h.DrainAndLinkAsync();
        Assert.Equal(new[] { "今天", "学习", "中文" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == batchLesson.TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        // 3. Single & batch audio lessons without profile stay null (legacy)
        var legacyAudio = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Legacy Audio",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([9, 10], "legacy.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n我爱读书。\n"), "legacy.srt", "text/plain")
        })).Result);
        var legacyAudioId = Assert.IsType<TextDto>(legacyAudio.Value).TextId;
        Assert.Null((await h.Context.Texts.AsNoTracking().SingleAsync(t => t.TextId == legacyAudioId)).SegmentationProfile);
    }

    [Fact]
    public async Task InterruptedProfiledImport_IsRecoveredOnStartupMigration_WithoutTouchingLegacyTexts()
    {
        await using var h = await Harness.Create();
        // Legacy Chinese text already linked at CurrentTokenizerVersion
        h.Context.Texts.Add(new Text
        {
            TextId = 10,
            UserId = h.UserId,
            LanguageId = 1,
            Title = "Legacy",
            Content = "我爱读书。",
            WordLinkingTokenizerVersion = WordLinker.CurrentTokenizerVersion
        });
        h.Context.Words.Add(new Word { WordId = 10, UserId = h.UserId, LanguageId = 1, Term = "我爱读书", Status = 5 });
        h.Context.TextWords.Add(new TextWord { TextId = 10, WordId = 10, OccurrenceCount = 7 });
        h.Context.WordTranslations.Add(new WordTranslation { WordId = 10, Translation = "legacy phrase" });
        await h.Context.SaveChangesAsync();
        var preserved = await h.Preserved();

        // Create a profiled book part and a profiled audio lesson, then drop the channel items to simulate a crash/restart before background worker processed them
        var bookResult = Assert.IsType<CreatedAtActionResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Interrupted Book",
            LanguageId = 1,
            Content = "我爱读书。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 500,
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var bookId = Assert.IsType<BookDto>(bookResult.Value).BookId;

        var audioResult = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Interrupted Audio",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3], "interrupted.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n今天学习中文。\n"), "interrupted.srt", "text/plain"),
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var audioId = Assert.IsType<TextDto>(audioResult.Value).TextId;

        // Discard in-memory channel messages (simulating server restart)
        while (h.Channel.Reader.TryRead(out _)) { }

        // Run startup migration + stats sweep
        await h.Migration().RunMigration(CancellationToken.None);
        await h.Stats().RecomputeAllAsync(CancellationToken.None);

        h.Context.ChangeTracker.Clear();
        Assert.Equal(preserved, await h.Preserved());
        Assert.Null((await h.Context.Texts.SingleAsync(t => t.TextId == 10)).SegmentationProfile);

        var bookPart = await h.Context.Texts.SingleAsync(t => t.BookId == bookId);
        Assert.Equal(ChineseSegmenter.Profile, bookPart.SegmentationProfile);
        Assert.Equal("completed", bookPart.WordLinkingStatus);
        Assert.Equal(WordLinker.CurrentTokenizerVersion, bookPart.WordLinkingTokenizerVersion);
        Assert.Equal(3, bookPart.TotalWords);
        Assert.Equal(new[] { "我", "爱", "读书" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == bookPart.TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        var audioLesson = await h.Context.Texts.SingleAsync(t => t.TextId == audioId);
        Assert.Equal(ChineseSegmenter.Profile, audioLesson.SegmentationProfile);
        Assert.Equal("completed", audioLesson.WordLinkingStatus);
        Assert.Equal(WordLinker.CurrentTokenizerVersion, audioLesson.WordLinkingTokenizerVersion);
        Assert.Equal(3, audioLesson.TotalWords);
        Assert.Equal(new[] { "今天", "学习", "中文" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == audioId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));
    }

    [Fact]
    public async Task EditingProfiledBookPartOrAudioLesson_PreservesProfileAndMetadata_AndRelinksAtomically()
    {
        await using var h = await Harness.Create();
        const string rawSrt = "1\n00:00:00,000 --> 00:00:02,000\n我爱读书。\n";

        var bookResult = Assert.IsType<CreatedAtActionResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Book For Edit",
            LanguageId = 1,
            Content = "我爱读书。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 500,
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var bookId = Assert.IsType<BookDto>(bookResult.Value).BookId;
        var bookPartId = (await h.Context.Texts.SingleAsync(t => t.BookId == bookId)).TextId;

        var audioResult = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Audio For Edit",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3], "edit.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes(rawSrt), "edit.srt", "text/plain"),
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var audioId = Assert.IsType<TextDto>(audioResult.Value).TextId;
        await h.DrainAndLinkAsync();

        Assert.IsType<NoContentResult>(await h.Controller().UpdateText(bookPartId, new UpdateTextDto
        {
            TextId = bookPartId,
            Title = "Edited Part 1",
            Content = "今天学习中文。"
        }));
        Assert.IsType<NoContentResult>(await h.Controller().UpdateText(audioId, new UpdateTextDto
        {
            TextId = audioId,
            Title = "Edited Audio",
            Content = "图书馆读书。"
        }));

        h.Context.ChangeTracker.Clear();
        var updatedBookPart = await h.Context.Texts.SingleAsync(t => t.TextId == bookPartId);
        Assert.Equal(ChineseSegmenter.Profile, updatedBookPart.SegmentationProfile);
        Assert.Equal(bookId, updatedBookPart.BookId);
        Assert.Equal(1, updatedBookPart.PartNumber);
        Assert.Equal("completed", updatedBookPart.WordLinkingStatus);
        Assert.Equal(new[] { "今天", "学习", "中文" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == bookPartId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        var updatedAudio = await h.Context.Texts.SingleAsync(t => t.TextId == audioId);
        Assert.Equal(ChineseSegmenter.Profile, updatedAudio.SegmentationProfile);
        Assert.True(updatedAudio.IsAudioLesson);
        Assert.Equal(rawSrt, updatedAudio.SrtContent);
        Assert.Equal("completed", updatedAudio.WordLinkingStatus);
        Assert.Equal(new[] { "图书馆", "读书" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == audioId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));
    }

    [Fact]
    public async Task FailedSaveDuringBookOrAudioImport_CleansUpFilesAndEntitiesWithoutQueueing_AndRetrySucceeds()
    {
        var failure = new FailSave();
        await using var h = await Harness.Create(failure: failure);
        const string rawSrt = "1\n00:00:00,000 --> 00:00:02,000\n我爱读书。\n";

        // 1. UploadBook (.epub) fails when saving Text parts (2nd SaveChanges after Book row)
        failure.FailOnSave = 2;
        var failedEpub = Assert.IsType<ObjectResult>((await h.Books().UploadBook(new UploadBookDto
        {
            LanguageId = 1,
            File = CreateSyntheticEpub("第一章", "我爱读书。", "第二章", "今天学习中文。"),
            SplitMethod = "chapter",
            MaxSegmentSize = 500,
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        Assert.Equal(500, failedEpub.StatusCode);
        h.Context.ChangeTracker.Clear();
        Assert.Empty(await h.Context.Books.ToArrayAsync());
        Assert.Empty(await h.Context.Texts.ToArrayAsync());
        Assert.False(h.Channel.Reader.TryRead(out _));
        Assert.Empty(Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories));

        // 2. CreateAudioLesson fails on SaveChanges -> cleans up written audio file and queues nothing
        failure.FailOnSave = 1;
        var failedSingleAudio = Assert.IsType<ObjectResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Failed Audio",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3, 4], "failed_single.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes(rawSrt), "failed_single.srt", "text/plain"),
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        Assert.Equal(500, failedSingleAudio.StatusCode);
        h.Context.ChangeTracker.Clear();
        Assert.Empty(await h.Context.Texts.ToArrayAsync());
        Assert.False(h.Channel.Reader.TryRead(out _));
        Assert.Empty(Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories));

        // 3. CreateAudioLessonsBatch fails on SaveChanges -> cleans up written batch audio files and queues nothing
        failure.FailOnSave = 1;
        var failedBatchAudio = Assert.IsType<ObjectResult>(await h.Controller().CreateAudioLessonsBatch(
            new CreateAudioLessonsBatchDto { LanguageId = 1, SegmentationProfile = ChineseSegmenter.Profile },
            [
                FormFileFromBytes([5, 6, 7], "batch_01.mp3", "audio/mpeg"),
                FormFileFromBytes(Encoding.UTF8.GetBytes(rawSrt), "batch_01.srt", "text/plain")
            ]));
        Assert.Equal(500, failedBatchAudio.StatusCode);
        h.Context.ChangeTracker.Clear();
        Assert.Empty(await h.Context.Texts.ToArrayAsync());
        Assert.False(h.Channel.Reader.TryRead(out _));
        Assert.Empty(Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories));

        // 4. Retry after transient failure succeeds and links segmented Chinese tokens
        failure.FailOnSave = 0;
        var retryAudio = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Retried Audio",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3, 4], "retried.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes(rawSrt), "retried.srt", "text/plain"),
            SegmentationProfile = ChineseSegmenter.Profile
        })).Result);
        var retryId = Assert.IsType<TextDto>(retryAudio.Value).TextId;
        await h.DrainAndLinkAsync();

        // Repeated worker LinkAsync (simulating worker retry) is idempotent on occurrence counts and TotalWords
        await WordLinker.LinkAsync(h.Context, retryId, "我爱读书。", 1, h.UserId);
        await h.Stats().RecomputeAllAsync(CancellationToken.None);
        h.Context.ChangeTracker.Clear();
        var retriedText = await h.Context.Texts.SingleAsync(t => t.TextId == retryId);
        Assert.Equal(ChineseSegmenter.Profile, retriedText.SegmentationProfile);
        Assert.Equal(3, retriedText.TotalWords);
        var links = await h.Context.TextWords.Where(tw => tw.TextId == retryId).Include(tw => tw.Word).ToListAsync();
        Assert.Equal(new[] { "我", "爱", "读书" }.OrderBy(x => x), links.Select(l => l.Word.Term).OrderBy(x => x));
        Assert.All(links, l => Assert.Equal(1, l.OccurrenceCount));
    }

    private static CreateTextDto Request(string? profile = null) => new() {
        Title = "Synthetic Chinese text", Content = "我爱读书。", LanguageId = 1, SegmentationProfile = profile };

    private static IFormFile FormFileFromBytes(byte[] bytes, string fileName, string contentType) =>
        new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };

    private static IFormFile CreateSyntheticEpub(string title1, string text1, string title2, string text2)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteZipEntry(zip, "META-INF/container.xml", """
                <?xml version="1.0" encoding="UTF-8"?>
                <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
                  <rootfiles>
                    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
                  </rootfiles>
                </container>
                """);
            WriteZipEntry(zip, "OEBPS/content.opf", """
                <?xml version="1.0" encoding="UTF-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
                  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                    <dc:title>Synthetic Chinese EPUB</dc:title>
                    <dc:language>zh</dc:language>
                    <dc:identifier id="bookid">urn:uuid:12345678-1234-1234-1234-1234567890ab</dc:identifier>
                    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
                  </metadata>
                  <manifest>
                    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
                    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
                    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
                  </manifest>
                  <spine>
                    <itemref idref="ch1"/>
                    <itemref idref="ch2"/>
                  </spine>
                </package>
                """);
            WriteZipEntry(zip, "OEBPS/nav.xhtml", $"<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><body><nav epub:type=\"toc\"><ol><li><a href=\"ch1.xhtml\">{title1}</a></li><li><a href=\"ch2.xhtml\">{title2}</a></li></ol></nav></body></html>");
            WriteZipEntry(zip, "OEBPS/ch1.xhtml", $"<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>{title1}</h1><p>{text1}</p></body></html>");
            WriteZipEntry(zip, "OEBPS/ch2.xhtml", $"<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>{title2}</h1><p>{text2}</p></body></html>");
        }
        return FormFileFromBytes(ms.ToArray(), "synthetic.epub", "application/epub+zip");
    }

    private static void WriteZipEntry(ZipArchive zip, string path, string content)
    {
        var entry = zip.CreateEntry(path);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }

    private sealed class Harness(SqliteConnection connection, AppDbContext context, ServiceProvider provider, string webRoot) : IAsyncDisposable
    {
        public Guid UserId { get; } = Guid.Parse("deadbeef-0000-0000-0000-000000000088");
        public AppDbContext Context => context;
        public WordLinkingChannel Channel { get; } = new();
        public string WebRoot => webRoot;

        public static async Task<Harness> Create(string code = "zh", FailSave? failure = null)
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection);
            if (failure != null) options.AddInterceptors(failure);
            var context = new AppDbContext(options.Options);
            await context.Database.EnsureCreatedAsync();
            var provider = new ServiceCollection()
                .AddTransient(_ => new AppDbContext(options.Options))
                .BuildServiceProvider();
            var webRoot = Path.Combine(Path.GetTempPath(), "chinese-rollout-wwwroot-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(webRoot);
            var h = new Harness(connection, context, provider, webRoot);
            context.Users.Add(new User { Id = h.UserId, UserName = "synthetic" });
            context.Languages.Add(new Language { LanguageId = 1, Code = code, Name = "Synthetic language", ParserType = "jieba" });
            await context.SaveChangesAsync();
            return h;
        }

        public TextsController Controller() => new(context, NullLogger<TextsController>.Instance,
            new UserActivityService(context, NullLogger<UserActivityService>.Instance), Channel,
            Stats()) {
                WebRoot = WebRoot,
                ControllerContext = new() { HttpContext = new DefaultHttpContext {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test")) } } };

        public BooksController Books() => new(context, NullLogger<BooksController>.Instance,
            new ChapterDetectionService(), hardcoverService: null, wordLinkingChannel: Channel) {
                WebRoot = WebRoot,
                ControllerContext = new() { HttpContext = new DefaultHttpContext {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test")) } } };

        public WordLinkingMigrationService Migration() =>
            new(provider, NullLogger<WordLinkingMigrationService>.Instance, new MigrationSignal());

        public StatsRecomputeService Stats() =>
            new(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());

        public async Task<List<WordLinkingRequest>> DrainAndLinkAsync()
        {
            var requests = new List<WordLinkingRequest>();
            while (Channel.Reader.TryRead(out var req))
            {
                requests.Add(req);
                await WordLinker.LinkAsync(context, req.TextId, req.Content, req.LanguageId, req.UserId);
                var text = await context.Texts.FindAsync(req.TextId);
                if (text != null)
                {
                    text.WordLinkingStatus = "completed";
                    await context.SaveChangesAsync();
                }
            }
            context.ChangeTracker.Clear();
            return requests;
        }

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
            if (Directory.Exists(webRoot))
            {
                try { Directory.Delete(webRoot, recursive: true); } catch { }
            }
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
