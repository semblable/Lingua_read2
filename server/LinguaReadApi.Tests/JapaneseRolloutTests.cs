using System.IO.Compression;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Tokenization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace LinguaReadApi.Tests;

[Collection("Postgres study database")]
public class JapaneseRolloutTests
{
    [Fact]
    public async Task LegacyJapaneseTexts_AndCreationWithoutExplicitProfile_StayLegacy()
    {
        await using var h = await Harness.Create();
        h.Context.Texts.Add(new Text
        {
            TextId = 10,
            UserId = h.UserId,
            LanguageId = 1,
            Title = "Legacy Japanese",
            Content = "猫は魚を食べます。",
            WordLinkingTokenizerVersion = WordLinker.CurrentTokenizerVersion
        });
        await h.Context.SaveChangesAsync();

        var result = await h.Controller().CreateText(Request());
        Assert.IsType<CreatedAtActionResult>(result.Result);
        h.Context.ChangeTracker.Clear();
        Assert.All(await h.Context.Texts.ToArrayAsync(), t => Assert.Null(t.SegmentationProfile));
        Assert.Null((await h.Controller().GetText(10)).Value!.SegmentationProfile);
        Assert.Equal(WordLinker.CurrentTokenizerVersion, (await h.Context.Texts.SingleAsync(t => t.TextId == 10)).WordLinkingTokenizerVersion);
        Assert.True(h.Channel.Reader.TryRead(out var queued));
        Assert.NotEqual(10, queued!.TextId);
        Assert.False(h.Channel.Reader.TryRead(out _));
    }

    [Theory]
    [InlineData("ja")]
    [InlineData("ja-JP")]
    [InlineData("JA-JP")]
    [InlineData("ja_JP")]
    public async Task ExplicitJapaneseProfile_IsPersistedAndReturned(string code)
    {
        await using var h = await Harness.Create(code);
        var created = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateText(Request(JapaneseSegmenter.Profile))).Result);
        var id = Assert.IsType<TextDto>(created.Value).TextId;
        h.Context.ChangeTracker.Clear();
        Assert.Equal(JapaneseSegmenter.Profile, (await h.Context.Texts.SingleAsync()).SegmentationProfile);
        var dto = Assert.IsType<TextDetailDto>((await h.Controller().GetText(id)).Value);
        Assert.Equal(JapaneseSegmenter.Profile, dto.SegmentationProfile);
        Assert.Equal(JapaneseSegmenter.Profile, JsonSerializer.SerializeToElement(dto,
            new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("segmentationProfile").GetString());
    }

    [Theory]
    [InlineData("ja", "jieba-v1")]
    [InlineData("zh", "tinysegmenter-ja-v1")]
    [InlineData("en", "tinysegmenter-ja-v1")]
    [InlineData("jpn", "tinysegmenter-ja-v1")]
    [InlineData("ja", "tinysegmenter")]
    [InlineData("ja", "TINYSEGMENTER-JA-V1")]
    [InlineData("ja", "")]
    public async Task InvalidOrMismatchedProfiles_AreRejectedBeforeSavingFilesEntitiesOrQueueItems(string code, string profile)
    {
        await using var h = await Harness.Create(code);

        Assert.IsType<BadRequestObjectResult>((await h.Controller().CreateText(Request(profile))).Result);

        Assert.IsType<BadRequestObjectResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Rejected Book",
            LanguageId = 1,
            Content = "猫は魚を食べます。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 500,
            SegmentationProfile = profile
        })).Result);

        Assert.IsType<BadRequestObjectResult>((await h.Books().UploadBook(new UploadBookDto
        {
            LanguageId = 1,
            File = CreateSyntheticEpub("第一章", "<p>猫は魚を食べます。</p>", "第二章", "<p>本を読みました。</p>"),
            SplitMethod = "chapter",
            MaxSegmentSize = 500,
            SegmentationProfile = profile
        })).Result);

        Assert.IsType<BadRequestObjectResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Rejected Audio",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3, 4], "lesson.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n猫は魚を食べます。\n"), "lesson.srt", "text/plain"),
            SegmentationProfile = profile
        })).Result);

        var mp3File = FormFileFromBytes([1, 2, 3, 4], "lesson_01.mp3", "audio/mpeg");
        var srtFile = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n猫は魚を食べます。\n"), "lesson_01.srt", "text/plain");
        Assert.IsType<BadRequestObjectResult>(await h.Controller().CreateAudioLessonsBatch(
            new CreateAudioLessonsBatchDto { LanguageId = 1, SegmentationProfile = profile },
            [mp3File, srtFile]));

        Assert.Empty(await h.Context.Books.ToArrayAsync());
        Assert.Empty(await h.Context.Texts.ToArrayAsync());
        Assert.False(h.Channel.Reader.TryRead(out _));
        Assert.Empty(Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task ProfiledEdits_KeepProfileAndRelinkContent_AllowJaVariant_AndRejectEnglishOrChinese()
    {
        await using var h = await Harness.Create();
        h.Context.Languages.AddRange(
            new Language { LanguageId = 2, Code = "en", Name = "English" },
            new Language { LanguageId = 3, Code = "zh", Name = "Chinese", ParserType = "jieba" },
            new Language { LanguageId = 4, Code = "ja-JP", Name = "Japanese (Japan)", ParserType = "mecab" });
        await h.Context.SaveChangesAsync();

        var created = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateText(Request(JapaneseSegmenter.Profile))).Result);
        var id = Assert.IsType<TextDto>(created.Value).TextId;
        Assert.True(h.Channel.Reader.TryRead(out _));

        Assert.IsType<NoContentResult>(await h.Controller().UpdateText(id, new UpdateTextDto
        {
            TextId = id,
            Title = "Edited",
            Content = "𠮷野家で食べる。",
            LanguageId = 4
        }));

        h.Context.ChangeTracker.Clear();
        var updated = await h.Context.Texts.SingleAsync();
        Assert.Equal(JapaneseSegmenter.Profile, updated.SegmentationProfile);
        Assert.Equal(4, updated.LanguageId);
        Assert.Equal("completed", updated.WordLinkingStatus);
        var linkedTerms = await h.Context.TextWords.Where(w => w.TextId == id).Select(w => w.Word.Term).ToListAsync();
        Assert.Equal(new[] { "𠮷野家", "で", "食べる" }.OrderBy(x => x), linkedTerms.OrderBy(x => x));
        Assert.False(h.Channel.Reader.TryRead(out _));

        // Reject switching to English (LanguageId = 2) or Chinese (LanguageId = 3)
        Assert.IsType<BadRequestObjectResult>(await h.Controller().UpdateText(id, new UpdateTextDto
        {
            TextId = id,
            Title = "Rejected English",
            Content = "one two",
            LanguageId = 2
        }));
        Assert.IsType<BadRequestObjectResult>(await h.Controller().UpdateText(id, new UpdateTextDto
        {
            TextId = id,
            Title = "Rejected Chinese",
            Content = "我爱读书。",
            LanguageId = 3
        }));

        // Tracked entity and stored row remain untouched
        Assert.Equal("Edited", updated.Title);
        Assert.Equal("𠮷野家で食べる。", updated.Content);
        h.Context.ChangeTracker.Clear();
        Assert.Equal(4, (await h.Context.Texts.SingleAsync()).LanguageId);
        Assert.False(h.Channel.Reader.TryRead(out _));
    }

    [Fact]
    public async Task EpubRubyFurigana_IsStrippedFromHeadingsParagraphsCaptionsPreviewAndReSplit_AndLinksBaseWords()
    {
        await using var h = await Harness.Create();

        const string ch1TitleHtml = "<ruby>第一章<rp>（</rp><rt>だいいっしょう</rt><rp>）</rp></ruby>";
        const string ch1BodyHtml =
            "<p><ruby>漢字<rp>（</rp><rt>かんじ</rt><rp>）</rp></ruby>と" +
            "<ruby>漢<rt>かん<rb>字<rt>じ</ruby>と" +
            "<ruby><rb>東京</rb><rtc><rt>とう</rt><rt>きょう</rt></rtc><rtc>トウキョウ</rtc></ruby>と" +
            "<ruby>勉強<rt><span>べん</span>きょう</rt></ruby>。</p>" +
            "<figure><figcaption><ruby>挿絵<rt>さしえ</rt></ruby></figcaption></figure>";
        const string ch2TitleHtml = "第二章";
        const string ch2BodyHtml = "<p><ruby>𠮷野家<rt>よしのや</rt></ruby>で食べる。</p>";
        const string descriptionHtml = "<p><ruby>日本語<rp>（</rp><rt>にほんご</rt><rp>）</rp></ruby>の<ruby>小説<rt>しょうせつ</ruby></p>";

        var epubFileForPreview = CreateSyntheticEpub(ch1TitleHtml, ch1BodyHtml, ch2TitleHtml, ch2BodyHtml, descriptionHtml);
        var previewResult = Assert.IsType<OkObjectResult>((await h.Books().PreviewSplit(new UploadBookDto
        {
            LanguageId = 1,
            File = epubFileForPreview,
            SplitMethod = "chapter",
            MaxSegmentSize = 5000
        })).Result);
        var preview = Assert.IsType<SplitPreviewDto>(previewResult.Value);
        Assert.Equal(2, preview.Chapters.Count);
        Assert.Equal("第一章", preview.Chapters[0].Title);
        Assert.Contains("漢字と漢字と東京と勉強。", preview.Chapters[0].Snippet);
        Assert.DoesNotContain("かんじ", preview.Chapters[0].Snippet);
        Assert.DoesNotContain("だいいっしょう", preview.Chapters[0].Snippet);
        Assert.DoesNotContain("とうきょう", preview.Chapters[0].Snippet);
        Assert.DoesNotContain("トウキョウ", preview.Chapters[0].Snippet);
        Assert.DoesNotContain("べんきょう", preview.Chapters[0].Snippet);
        Assert.DoesNotContain("さしえ", preview.Chapters[0].Snippet);
        Assert.DoesNotContain("（", preview.Chapters[0].Snippet);
        Assert.Equal("第二章\n\n𠮷野家で食べる。", preview.Chapters[1].Snippet);
        Assert.DoesNotContain("よしのや", preview.Chapters[1].Snippet);

        var epubFileForUpload = CreateSyntheticEpub(ch1TitleHtml, ch1BodyHtml, ch2TitleHtml, ch2BodyHtml, descriptionHtml);
        var uploadResult = Assert.IsType<CreatedAtActionResult>((await h.Books().UploadBook(new UploadBookDto
        {
            LanguageId = 1,
            File = epubFileForUpload,
            SplitMethod = "chapter",
            MaxSegmentSize = 5000,
            SegmentationProfile = JapaneseSegmenter.Profile
        })).Result);
        var bookDto = Assert.IsType<BookDto>(uploadResult.Value);
        Assert.Equal("日本語の小説", bookDto.Description);

        await h.DrainAndLinkAsync();

        var parts = await h.Context.Texts.AsNoTracking().Where(t => t.BookId == bookDto.BookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.Equal(2, parts.Count);
        Assert.All(parts, p => Assert.Equal(JapaneseSegmenter.Profile, p.SegmentationProfile));

        Assert.Equal("第一章\n\n漢字と漢字と東京と勉強。\n\n挿絵", parts[0].Content);
        Assert.DoesNotContain("かんじ", parts[0].Content);
        Assert.DoesNotContain("とうきょう", parts[0].Content);
        Assert.DoesNotContain("トウキョウ", parts[0].Content);
        Assert.DoesNotContain("べんきょう", parts[0].Content);
        Assert.DoesNotContain("さしえ", parts[0].Content);

        var ch1Blocks = JsonSerializer.Deserialize<List<ReaderContentBlock>>(parts[0].StructuredContent!,
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(new[] { "第一章", "漢字と漢字と東京と勉強。", "挿絵" }, ch1Blocks.Select(b => b.Text).ToArray());

        Assert.Equal("第二章\n\n𠮷野家で食べる。", parts[1].Content);
        var ch2Terms = await h.Context.TextWords.Where(tw => tw.TextId == parts[1].TextId).Select(tw => tw.Word.Term).ToListAsync();
        Assert.Contains("𠮷野家", ch2Terms);
        Assert.Contains("で", ch2Terms);
        Assert.Contains("食べる", ch2Terms);
        Assert.DoesNotContain(ch2Terms, t => t.Contains("よしのや"));

        // ReSplitBook preserves both the ruby-free structured blocks and tinysegmenter-ja-v1
        Assert.IsType<NoContentResult>(await h.Books().ReSplitBook(bookDto.BookId, new ReSplitRequestDto
        {
            SplitMethod = "paragraph",
            MaxSegmentSize = 500
        }));
        await h.DrainAndLinkAsync();

        var resplitParts = await h.Context.Texts.AsNoTracking().Where(t => t.BookId == bookDto.BookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.NotEmpty(resplitParts);
        Assert.All(resplitParts, p =>
        {
            Assert.Equal(JapaneseSegmenter.Profile, p.SegmentationProfile);
            Assert.DoesNotContain("かんじ", p.Content);
            Assert.DoesNotContain("よしのや", p.Content);
        });
    }

    [Fact]
    public async Task CreateBook_UploadTxt_CreateAudioLesson_AndBatch_LinkSegmentedJapaneseWords()
    {
        await using var h = await Harness.Create();

        // 1. CreateBook
        var bookCreated = Assert.IsType<CreatedAtActionResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Japanese Book",
            LanguageId = 1,
            Content = "猫は魚を食べます。\n\n𠮷野家で食べる。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 10,
            SegmentationProfile = JapaneseSegmenter.Profile
        })).Result);
        var bookId = Assert.IsType<BookDto>(bookCreated.Value).BookId;
        await h.DrainAndLinkAsync();

        var bookParts = await h.Context.Texts.AsNoTracking().Where(t => t.BookId == bookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.Equal(2, bookParts.Count);
        Assert.All(bookParts, p => Assert.Equal(JapaneseSegmenter.Profile, p.SegmentationProfile));
        Assert.Equal(new[] { "猫", "は", "魚", "を", "食べ", "ます" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == bookParts[0].TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));
        Assert.Equal(new[] { "𠮷野家", "で", "食べる" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == bookParts[1].TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        // 2. UploadBook (.txt)
        var txtCreated = Assert.IsType<CreatedAtActionResult>((await h.Books().UploadBook(new UploadBookDto
        {
            LanguageId = 1,
            File = FormFileFromBytes(Encoding.UTF8.GetBytes("猫は魚を食べます。"), "book.txt", "text/plain"),
            SplitMethod = "paragraph",
            MaxSegmentSize = 500,
            SegmentationProfile = JapaneseSegmenter.Profile
        })).Result);
        var txtBookId = Assert.IsType<BookDto>(txtCreated.Value).BookId;
        await h.DrainAndLinkAsync();
        var txtPart = await h.Context.Texts.AsNoTracking().SingleAsync(t => t.BookId == txtBookId);
        Assert.Equal(JapaneseSegmenter.Profile, txtPart.SegmentationProfile);

        // 3. CreateAudioLesson
        const string rawSrt = "1\r\n00:00:00,000 --> 00:00:02,000\r\n猫は魚を食べます。\r\n\r\n2\r\n00:00:02,500 --> 00:00:05,000\r\n𠮷野家で食べる。\r\n";
        var singleCreated = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Japanese Audio Lesson",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3, 4], "lesson1.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes(rawSrt), "lesson1.srt", "text/plain"),
            SegmentationProfile = JapaneseSegmenter.Profile
        })).Result);
        var singleId = Assert.IsType<TextDto>(singleCreated.Value).TextId;
        await h.DrainAndLinkAsync();
        Assert.Equal(new[] { "猫", "は", "魚", "を", "食べ", "ます", "𠮷野家", "で", "食べる" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == singleId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        // 4. CreateAudioLessonsBatch
        var batchMp3 = FormFileFromBytes([5, 6, 7, 8], "podcast_ep01_ja.mp3", "audio/mpeg");
        var batchSrt = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n𠮷野家で食べる。\n"), "podcast_ep01_ja.srt", "text/plain");
        Assert.IsType<OkObjectResult>(await h.Controller().CreateAudioLessonsBatch(
            new CreateAudioLessonsBatchDto { LanguageId = 1, SegmentationProfile = JapaneseSegmenter.Profile, Tag = "ja-batch" },
            [batchMp3, batchSrt]));
        var batchLesson = await h.Context.Texts.AsNoTracking().SingleAsync(t => t.Tag == "ja-batch");
        Assert.Equal(JapaneseSegmenter.Profile, batchLesson.SegmentationProfile);
        await h.DrainAndLinkAsync();
        Assert.Equal(new[] { "𠮷野家", "で", "食べる" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == batchLesson.TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));
    }

    [Fact]
    public async Task InterruptedProfiledJapaneseImports_RecoverOnStartupMigration_WithoutTouchingLegacyJapaneseTexts()
    {
        await using var h = await Harness.Create();
        h.Context.Texts.Add(new Text
        {
            TextId = 10,
            UserId = h.UserId,
            LanguageId = 1,
            Title = "Legacy Japanese",
            Content = "猫は魚を食べます。",
            WordLinkingTokenizerVersion = WordLinker.CurrentTokenizerVersion
        });
        h.Context.Words.Add(new Word { WordId = 10, UserId = h.UserId, LanguageId = 1, Term = "猫は魚を食べます", Status = 5 });
        h.Context.TextWords.Add(new TextWord { TextId = 10, WordId = 10, OccurrenceCount = 4 });
        h.Context.WordTranslations.Add(new WordTranslation { WordId = 10, Translation = "saved legacy sentence" });
        await h.Context.SaveChangesAsync();
        var preserved = await h.Preserved();

        // 1. Interrupted standalone profiled text
        var textCreated = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateText(Request(JapaneseSegmenter.Profile))).Result);
        var textId = Assert.IsType<TextDto>(textCreated.Value).TextId;

        // 2. Interrupted profiled book part
        var bookResult = Assert.IsType<CreatedAtActionResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Interrupted Japanese Book",
            LanguageId = 1,
            Content = "𠮷野家で食べる。",
            SplitMethod = "paragraph",
            MaxSegmentSize = 500,
            SegmentationProfile = JapaneseSegmenter.Profile
        })).Result);
        var bookId = Assert.IsType<BookDto>(bookResult.Value).BookId;

        // 3. Interrupted profiled audio lesson marked failed before version stamp
        var audioResult = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Interrupted Japanese Audio",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3], "interrupted.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\n東京スカイツリーに行きたいです。\n"), "interrupted.srt", "text/plain"),
            SegmentationProfile = JapaneseSegmenter.Profile
        })).Result);
        var audioId = Assert.IsType<TextDto>(audioResult.Value).TextId;

        // Drop all in-memory channel items to simulate a crash/restart
        while (h.Channel.Reader.TryRead(out _)) { }

        await h.Migration().RunMigration(CancellationToken.None);
        await h.Stats().RecomputeAllAsync(CancellationToken.None);

        h.Context.ChangeTracker.Clear();
        Assert.Equal(preserved, await h.Preserved());
        Assert.Null((await h.Context.Texts.SingleAsync(t => t.TextId == 10)).SegmentationProfile);

        var recoveredText = await h.Context.Texts.SingleAsync(t => t.TextId == textId);
        Assert.Equal(JapaneseSegmenter.Profile, recoveredText.SegmentationProfile);
        Assert.Equal("completed", recoveredText.WordLinkingStatus);
        Assert.Equal(WordLinker.CurrentTokenizerVersion, recoveredText.WordLinkingTokenizerVersion);
        Assert.Equal(6, recoveredText.TotalWords);
        Assert.Equal(new[] { "猫", "は", "魚", "を", "食べ", "ます" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == textId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        var bookPart = await h.Context.Texts.SingleAsync(t => t.BookId == bookId);
        Assert.Equal(JapaneseSegmenter.Profile, bookPart.SegmentationProfile);
        Assert.Equal("completed", bookPart.WordLinkingStatus);
        Assert.Equal(3, bookPart.TotalWords);
        Assert.Equal(new[] { "𠮷野家", "で", "食べる" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == bookPart.TextId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));

        var audioLesson = await h.Context.Texts.SingleAsync(t => t.TextId == audioId);
        Assert.Equal(JapaneseSegmenter.Profile, audioLesson.SegmentationProfile);
        Assert.Equal("completed", audioLesson.WordLinkingStatus);
        Assert.Equal(6, audioLesson.TotalWords);
        Assert.Equal(new[] { "東京", "スカイツリー", "に", "行き", "たい", "です" }.OrderBy(x => x),
            (await h.Context.TextWords.Where(tw => tw.TextId == audioId).Select(tw => tw.Word.Term).ToListAsync()).OrderBy(x => x));
    }

    [PostgresStudyFact]
    public async Task ConcurrentQueuedLinkAndEdit_OnlyCurrentJapaneseSourceRemainsLinked()
    {
        var settings = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("LINGUA_STUDY_TEST_POSTGRES")!);
        Assert.Equal("studycheck", settings.Database);
        var schema = "japanese_links_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(settings.ToString());
        await admin.OpenAsync();
        await new NpgsqlCommand($"CREATE SCHEMA {schema}", admin).ExecuteNonQueryAsync();
        try
        {
            settings.SearchPath = schema;
            AppDbContext NewContext() => new(new DbContextOptionsBuilder<AppDbContext>()
                .UseNpgsql(settings.ToString(), pg => pg.EnableRetryOnFailure(6)).Options);
            var userId = Guid.NewGuid();
            await using (var seed = NewContext())
            {
                await seed.GetService<IRelationalDatabaseCreator>().CreateTablesAsync();
                seed.Users.Add(new User { Id = userId, UserName = "synthetic-ja" });
                seed.Languages.Add(new Language { LanguageId = 1, Code = "ja", Name = "Japanese", ParserType = "mecab" });
                seed.Texts.Add(new Text
                {
                    TextId = 1,
                    UserId = userId,
                    LanguageId = 1,
                    Content = "𠮷野家で食べる。",
                    Title = "Synthetic Japanese",
                    SegmentationProfile = JapaneseSegmenter.Profile
                });
                await seed.SaveChangesAsync();
            }

            foreach (var (content, expectedTerm) in new[]
            {
                ("猫は猫。", "猫"),
                ("魚は魚。", "魚"),
                ("猫は猫。", "猫")
            })
            {
                await using var queued = NewContext();
                await using var edited = NewContext();
                await Task.WhenAll(
                    WordLinker.LinkAsync(queued, 1, "𠮷野家で食べる。", 1, userId),
                    LessonStudyActivity.AtomicAsync(edited, userId, async () =>
                    {
                        var text = await edited.Texts.SingleAsync();
                        text.Content = content;
                        await edited.SaveChangesAsync();
                        await WordLinker.RelinkAsync(edited, 1, content, 1, userId);
                        return true;
                    }));
                await using var verify = NewContext();
                var links = await verify.TextWords.Include(link => link.Word).ToListAsync();
                Assert.Equal(2, links.Count);
                Assert.Contains(links, l => l.Word.Term == expectedTerm && l.OccurrenceCount == 2);
                Assert.Contains(links, l => l.Word.Term == "は" && l.OccurrenceCount == 1);
                Assert.Empty(await verify.UserActivities.ToListAsync());
            }
        }
        finally
        {
            await new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", admin).ExecuteNonQueryAsync();
        }
    }

    private static CreateTextDto Request(string? profile = null) => new()
    {
        Title = "Synthetic Japanese text",
        Content = "猫は魚を食べます。",
        LanguageId = 1,
        SegmentationProfile = profile
    };

    private static IFormFile FormFileFromBytes(byte[] bytes, string fileName, string contentType) =>
        new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };

    private static IFormFile CreateSyntheticEpub(string title1Html, string body1Html, string title2Html, string body2Html, string? descriptionHtml = null)
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
            var descriptionElement = descriptionHtml != null
                ? $"<dc:description>{System.Net.WebUtility.HtmlEncode(descriptionHtml)}</dc:description>"
                : string.Empty;
            WriteZipEntry(zip, "OEBPS/content.opf", $"""
                <?xml version="1.0" encoding="UTF-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
                  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                    <dc:title>Synthetic Japanese EPUB</dc:title>
                    <dc:language>ja</dc:language>
                    {descriptionElement}
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
            WriteZipEntry(zip, "OEBPS/nav.xhtml", $"<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\"><body><nav epub:type=\"toc\"><ol><li><a href=\"ch1.xhtml\">第一章</a></li><li><a href=\"ch2.xhtml\">第二章</a></li></ol></nav></body></html>");
            WriteZipEntry(zip, "OEBPS/ch1.xhtml", $"<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>{title1Html}</h1>{body1Html}</body></html>");
            WriteZipEntry(zip, "OEBPS/ch2.xhtml", $"<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>{title2Html}</h1>{body2Html}</body></html>");
        }
        return FormFileFromBytes(ms.ToArray(), "synthetic-ja.epub", "application/epub+zip");
    }

    private static void WriteZipEntry(ZipArchive zip, string path, string content)
    {
        var entry = zip.CreateEntry(path);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }

    private sealed class Harness(SqliteConnection connection, AppDbContext context, ServiceProvider provider, string webRoot) : IAsyncDisposable
    {
        public Guid UserId { get; } = Guid.Parse("deadbeef-0000-0000-0000-000000000099");
        public AppDbContext Context => context;
        public WordLinkingChannel Channel { get; } = new();
        public string WebRoot => webRoot;

        public static async Task<Harness> Create(string code = "ja", FailSave? failure = null)
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
            var webRoot = Path.Combine(Path.GetTempPath(), "japanese-rollout-wwwroot-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(webRoot);
            var h = new Harness(connection, context, provider, webRoot);
            context.Users.Add(new User { Id = h.UserId, UserName = "synthetic-ja" });
            context.Languages.Add(new Language { LanguageId = 1, Code = code, Name = "Japanese", ParserType = "mecab" });
            await context.SaveChangesAsync();
            return h;
        }

        public TextsController Controller() => new(context, NullLogger<TextsController>.Instance,
            new UserActivityService(context, NullLogger<UserActivityService>.Instance), Channel,
            Stats())
        {
            WebRoot = WebRoot,
            ControllerContext = new()
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test"))
                }
            }
        };

        public BooksController Books() => new(context, NullLogger<BooksController>.Instance,
            new ChapterDetectionService(), hardcoverService: null, wordLinkingChannel: Channel)
        {
            WebRoot = WebRoot,
            ControllerContext = new()
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test"))
                }
            }
        };

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
            Array[] rows = [
                await context.Words.Where(w => w.WordId == 10).ToArrayAsync(),
                await context.TextWords.Where(w => w.TextId == 10).ToArrayAsync(),
                await context.WordTranslations.ToArrayAsync(),
                await context.UserActivities.ToArrayAsync(),
                await context.LessonStudyEvents.ToArrayAsync()
            ];
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
