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
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

[Collection("Postgres study database")]
public class ThaiRolloutTests
{
    [Fact]
    public void SharedFixtures_MatchExpectedThaiUtf16Spans()
    {
        var segmenter = ThaiSegmenter.Default;
        var fixturePath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,
            "../../../../../verification/language-support/thai-cases.json"));
        using var fixture = JsonDocument.Parse(File.ReadAllText(fixturePath));
        Assert.Equal(ThaiSegmenter.Profile, fixture.RootElement.GetProperty("profile").GetString());
        Assert.Equal(ThaiSegmenter.DictionarySha256, fixture.RootElement.GetProperty("dictionarySha256").GetString());

        foreach (var testCase in fixture.RootElement.GetProperty("cases").EnumerateArray())
        {
            var id = testCase.GetProperty("id").GetString()!;
            var text = testCase.GetProperty("text").GetString()!;
            var expected = testCase.GetProperty("thaiSpans").EnumerateArray()
                .Select(span => new ThaiWordSpan(
                    span.GetProperty("text").GetString()!,
                    span.GetProperty("start").GetInt32(),
                    span.GetProperty("end").GetInt32()))
                .ToArray();

            var actual = SegmentRuns(segmenter, text);
            Assert.True(expected.SequenceEqual(actual),
                $"Fixture {id}: expected [{string.Join("|", expected.Select(x => $"{x.Text}@{x.Start}..{x.End}"))}] " +
                $"but got [{string.Join("|", actual.Select(x => $"{x.Text}@{x.Start}..{x.End}"))}]");

            foreach (var span in actual)
            {
                Assert.Equal(span.Text, text[span.Start..span.End]);
            }
        }
    }

    [Fact]
    public void DictionarySha256_MatchesEmbeddedDictionary()
    {
        var content = ThaiSegmenter.ReadEmbeddedDictionary();
        Assert.Equal(ThaiSegmenter.DictionarySha256, ThaiDictionaryController.DictionarySha256);
        Assert.Equal(62107, ThaiSegmenter.Default.EntryCount);
        Assert.Equal(81, ThaiSegmenter.Default.MaxWordLength);
    }

    [Fact]
    public void Paiyannoi_And_Maiyamok_StayAttached()
    {
        var segmenter = ThaiSegmenter.Default;

        // Paiyannoi in Bangkok: กรุงเทพฯ
        var bangkok = segmenter.SegmentThaiRun("กรุงเทพฯ", 0, 8);
        var b = Assert.Single(bangkok);
        Assert.Equal("กรุงเทพฯ", b.Text);
        Assert.Equal(0, b.Start);
        Assert.Equal(8, b.End);

        // Maiyamok in เร็วๆ
        var quickly = segmenter.SegmentThaiRun("เร็วๆ", 0, 5);
        var q = Assert.Single(quickly);
        Assert.Equal("เร็วๆ", q.Text);
        Assert.Equal(0, q.Start);
        Assert.Equal(5, q.End);
    }

    [Fact]
    public void ThaiDigits_TreatedAsNumberTokens()
    {
        var segmenter = ThaiSegmenter.Default;

        Assert.True(ThaiSegmenter.IsThaiDigit('๐'));
        Assert.True(ThaiSegmenter.IsThaiDigit('๒'));
        Assert.True(ThaiSegmenter.IsThaiDigit('๙'));
        Assert.False(ThaiSegmenter.IsThaiDigit('A'));

        var spans = SegmentRuns(segmenter, "ชั้น ๒");
        Assert.Equal(2, spans.Count);
        Assert.Equal("ชั้น", spans[0].Text);
        Assert.Equal(0, spans[0].Start);
        Assert.Equal(4, spans[0].End);
        Assert.Equal("๒", spans[1].Text);
        Assert.Equal(5, spans[1].Start);
        Assert.Equal(6, spans[1].End);
    }

    [Fact]
    public void OutOfVocabularyClusters_CoalescedIntoSingleTokens()
    {
        var segmenter = ThaiSegmenter.Default;
        var text = "ฉันชอบปปปปป";
        var spans = segmenter.SegmentThaiRun(text, 0, text.Length);

        Assert.Equal(3, spans.Count);
        Assert.Equal("ฉัน", spans[0].Text);
        Assert.Equal("ชอบ", spans[1].Text);
        Assert.Equal("ปปปปป", spans[2].Text);
        Assert.Equal(6, spans[2].Start);
        Assert.Equal(11, spans[2].End);
    }

    [Fact]
    public async Task LegacyThaiTexts_AndCreationWithoutExplicitProfile_StayLegacy()
    {
        await using var h = await Harness.Create();
        h.Context.Texts.Add(new Text
        {
            TextId = 10,
            UserId = h.UserId,
            LanguageId = 1,
            Title = "Legacy Thai",
            Content = "ฉันชอบอ่านหนังสือที่กรุงเทพฯ",
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
    [InlineData("th")]
    [InlineData("th-TH")]
    [InlineData("TH-TH")]
    [InlineData("th_TH")]
    public async Task ExplicitThaiProfile_IsPersistedAndReturned(string code)
    {
        await using var h = await Harness.Create(code);
        var created = Assert.IsType<CreatedAtActionResult>((await h.Controller().CreateText(Request(ThaiSegmenter.Profile))).Result);
        var id = Assert.IsType<TextDto>(created.Value).TextId;
        h.Context.ChangeTracker.Clear();
        Assert.Equal(ThaiSegmenter.Profile, (await h.Context.Texts.SingleAsync()).SegmentationProfile);
        var dto = Assert.IsType<TextDetailDto>((await h.Controller().GetText(id)).Value);
        Assert.Equal(ThaiSegmenter.Profile, dto.SegmentationProfile);
        Assert.Equal(ThaiSegmenter.Profile, JsonSerializer.SerializeToElement(dto,
            new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("segmentationProfile").GetString());
    }

    [Theory]
    [InlineData("th", "jieba-v1")]
    [InlineData("th", "tinysegmenter-ja-v1")]
    [InlineData("en", "thai-dict-v1")]
    [InlineData("ja", "thai-dict-v1")]
    [InlineData("zh", "thai-dict-v1")]
    [InlineData("th", "thai")]
    [InlineData("th", "thai-dict-v2")]
    [InlineData("th", "THAI-DICT-V1")]
    [InlineData("th", "")]
    public async Task InvalidOrMismatchedProfiles_AreRejectedBeforeSaving(string code, string profile)
    {
        await using var h = await Harness.Create(code);

        Assert.IsType<BadRequestObjectResult>((await h.Controller().CreateText(Request(profile))).Result);

        Assert.IsType<BadRequestObjectResult>((await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Rejected Book",
            LanguageId = 1,
            Content = "ฉันชอบอ่านหนังสือที่กรุงเทพฯ",
            SplitMethod = "paragraph",
            MaxSegmentSize = 500,
            SegmentationProfile = profile
        })).Result);

        Assert.Empty(await h.Context.Texts.ToArrayAsync());
        Assert.False(h.Channel.Reader.TryRead(out _));
    }

    [Fact]
    public async Task ThaiDictionaryController_ReturnsImmutableCachedStreamWithMatchingETag()
    {
        var controller = new ThaiDictionaryController
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        var response = Assert.IsType<FileStreamResult>(controller.GetDictionary());
        Assert.Equal("text/plain; charset=utf-8", response.ContentType);
        Assert.Equal($"\"{ThaiSegmenter.DictionarySha256}\"", controller.Response.Headers.ETag.ToString());
        Assert.Equal("public, max-age=31536000, immutable", controller.Response.Headers.CacheControl.ToString());

        controller.Request.Headers.IfNoneMatch = $"\"{ThaiSegmenter.DictionarySha256}\"";
        Assert.Equal(StatusCodes.Status304NotModified, Assert.IsType<StatusCodeResult>(controller.GetDictionary()).StatusCode);
    }

    [Fact]
    public async Task BookCreation_AndReSplit_PreservesThaiProfile()
    {
        await using var h = await Harness.Create();
        var bookResult = await h.Books().CreateBook(new CreateBookDto
        {
            Title = "Thai Book",
            LanguageId = 1,
            Content = "ฉันชอบอ่านหนังสือที่กรุงเทพฯ\n\nน้ำดื่มสะอาดอยู่ที่ออฟฟิศชั้น ๒",
            SplitMethod = "paragraph",
            MaxSegmentSize = 500,
            SegmentationProfile = ThaiSegmenter.Profile
        });

        var createdBook = Assert.IsType<BookDto>(Assert.IsType<CreatedAtActionResult>(bookResult.Result).Value);
        h.Context.ChangeTracker.Clear();
        var texts = await h.Context.Texts.Where(t => t.BookId == createdBook.BookId).OrderBy(t => t.PartNumber).ToListAsync();
        Assert.All(texts, t => Assert.Equal(ThaiSegmenter.Profile, t.SegmentationProfile));

        // ReSplitBook preserves thai-dict-v1
        var resplitResult = await h.Books().ReSplitBook(createdBook.BookId, new ReSplitRequestDto
        {
            SplitMethod = "paragraph",
            MaxSegmentSize = 500
        });
        Assert.IsType<NoContentResult>(resplitResult);

        h.Context.ChangeTracker.Clear();
        var resplitTexts = await h.Context.Texts.Where(t => t.BookId == createdBook.BookId).ToListAsync();
        Assert.NotEmpty(resplitTexts);
        Assert.All(resplitTexts, t => Assert.Equal(ThaiSegmenter.Profile, t.SegmentationProfile));
    }

    [Fact]
    public async Task AudioLessons_SingleAndBatch_PreserveThaiProfile()
    {
        await using var h = await Harness.Create();

        // Single audio lesson with thai-dict-v1
        var audioResult = await h.Controller().CreateAudioLesson(new CreateAudioLessonDto
        {
            Title = "Thai Lesson",
            LanguageId = 1,
            AudioFile = FormFileFromBytes([1, 2, 3], "sample.mp3", "audio/mpeg"),
            SrtFile = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\nฉันชอบอ่านหนังสือที่กรุงเทพฯ\n"), "sample.srt", "text/plain"),
            SegmentationProfile = ThaiSegmenter.Profile
        });
        var audioText = Assert.IsType<TextDto>(Assert.IsType<CreatedAtActionResult>(audioResult.Result).Value);
        h.Context.ChangeTracker.Clear();
        Assert.Equal(ThaiSegmenter.Profile, (await h.Context.Texts.SingleAsync(t => t.TextId == audioText.TextId)).SegmentationProfile);

        // Batch audio lessons with thai-dict-v1
        var batchMp3 = FormFileFromBytes([1, 2, 3], "batch1.mp3", "audio/mpeg");
        var batchSrt = FormFileFromBytes(Encoding.UTF8.GetBytes("1\n00:00:00,000 --> 00:00:02,000\nน้ำดื่มสะอาดอยู่ที่ออฟฟิศชั้น ๒\n"), "batch1.srt", "text/plain");
        Assert.IsType<OkObjectResult>(await h.Controller().CreateAudioLessonsBatch(
            new CreateAudioLessonsBatchDto
            {
                LanguageId = 1,
                SegmentationProfile = ThaiSegmenter.Profile,
                Tag = "th-batch"
            },
            [batchMp3, batchSrt]));
        var batchLesson = await h.Context.Texts.AsNoTracking().SingleAsync(t => t.Tag == "th-batch");
        Assert.Equal(ThaiSegmenter.Profile, batchLesson.SegmentationProfile);
    }

    [Fact]
    public void Tokenizer_TokenizesThaiRunAndExtractsKeys()
    {
        var lang = new Language { Code = "th", ParserType = ThaiSegmenter.Profile, WordCharacters = Language.DefaultWordCharacters };
        var res = Tokenizer.Tokenize("ฉันชอบอ่านหนังสือที่กรุงเทพฯ", lang);

        Assert.Equal(6, res.Tokens.Count);
        Assert.All(res.Tokens, t => Assert.True(t.IsWord));
        Assert.Equal(new[] { "ฉัน", "ชอบ", "อ่าน", "หนังสือ", "ที่", "กรุงเทพฯ" }, res.Tokens.Select(t => t.Text));

        var keys = Tokenizer.ExtractLookupKeys("ฉันชอบอ่านหนังสือที่กรุงเทพฯ", lang).ToArray();
        Assert.Equal(new[] { "ฉัน", "ชอบ", "อ่าน", "หนังสือ", "ที่", "กรุงเทพฯ" }, keys);
    }

    private static IReadOnlyList<ThaiWordSpan> SegmentRuns(ThaiSegmenter segmenter, string text)
    {
        var spans = new List<ThaiWordSpan>();
        for (var position = 0; position < text.Length;)
        {
            if (!ThaiSegmenter.IsThaiAt(text, position))
            {
                position++;
                continue;
            }
            var end = ThaiSegmenter.FindThaiRunEnd(text, position);
            spans.AddRange(segmenter.SegmentThaiRun(text, position, end));
            position = end;
        }
        return spans;
    }

    private static CreateTextDto Request(string? profile = null) => new()
    {
        Title = "Synthetic Thai",
        Content = "ฉันชอบอ่านหนังสือที่กรุงเทพฯ",
        LanguageId = 1,
        SegmentationProfile = profile
    };

    private static FormFile FormFileFromBytes(byte[] bytes, string fileName, string contentType) =>
        new(new MemoryStream(bytes), 0, bytes.Length, "file", fileName)
        {
            Headers = new HeaderDictionary(),
            ContentType = contentType
        };

    private sealed class Harness(SqliteConnection connection, AppDbContext context, ServiceProvider provider, string webRoot) : IAsyncDisposable
    {
        public Guid UserId { get; } = Guid.Parse("deadbeef-0000-0000-0000-000000000077");
        public AppDbContext Context => context;
        public WordLinkingChannel Channel { get; } = new();
        public string WebRoot => webRoot;

        public static async Task<Harness> Create(string code = "th")
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection);
            var context = new AppDbContext(options.Options);
            await context.Database.EnsureCreatedAsync();
            var provider = new ServiceCollection()
                .AddTransient(_ => new AppDbContext(options.Options))
                .BuildServiceProvider();
            var webRoot = Path.Combine(Path.GetTempPath(), "thai-rollout-wwwroot-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(webRoot);
            var h = new Harness(connection, context, provider, webRoot);
            context.Users.Add(new User { Id = h.UserId, UserName = "synthetic-th" });
            context.Languages.Add(new Language { LanguageId = 1, Code = code, Name = "Thai", ParserType = "spacedel" });
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

        public StatsRecomputeService Stats() =>
            new(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());

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
}
