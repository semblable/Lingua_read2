using System.Security.Claims;
using System.Text;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public sealed class AudiobookUploadStorageTests
{
    [Fact]
    public async Task Upload_DoesNotOverwriteAnOrphanFromAnEarlierUpload()
    {
        await using var h = await UploadHarness.CreateAsync();
        var orphan = h.WriteFile("audiobooks/1/track_1.mp3", "old orphan bytes");
        await using var context = h.NewContext();

        var result = await h.Controller(context).UploadAudiobook(1, Upload(Audio("chapter.mp3", "new upload bytes")));

        Assert.IsType<NoContentResult>(result);
        await using var verify = h.NewContext();
        var track = Assert.Single(await verify.AudiobookTracks.ToListAsync());
        Assert.Equal(1, track.TrackNumber);
        Assert.Null(track.Duration);
        Assert.NotEqual(orphan, h.FullPath(track.FilePath));
        Assert.Equal("new upload bytes", await File.ReadAllTextAsync(h.FullPath(track.FilePath)));
        Assert.Equal("old orphan bytes", await File.ReadAllTextAsync(orphan));
        Assert.Equal(2, Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories).Length);
    }

    [Fact]
    public async Task OverlappingUploads_WithTheSameNextNumber_KeepDistinctFilesAndBytes()
    {
        await using var h = await UploadHarness.CreateAsync();
        await using var firstContext = h.NewContext();
        await using var secondContext = h.NewContext();
        var firstCopied = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var secondCopied = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFirst = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseSecond = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = h.Controller(firstContext).UploadAudiobook(1, Upload(new InterceptedFormFile(
            Audio("first.mp3", "first upload"), async () =>
            {
                firstCopied.SetResult();
                await releaseFirst.Task;
            })));
        Task<IActionResult>? second = null;
        try
        {
            await firstCopied.Task.WaitAsync(TimeSpan.FromSeconds(10));
            second = h.Controller(secondContext).UploadAudiobook(1, Upload(new InterceptedFormFile(
                Audio("second.mp3", "second upload"), async () =>
                {
                    secondCopied.SetResult();
                    await releaseSecond.Task;
                })));
            await secondCopied.Task.WaitAsync(TimeSpan.FromSeconds(10));

            // Both requests have chosen their next number before either saves. Serialize the
            // SQLite writes so the test exercises file ownership without a database lock race.
            releaseFirst.SetResult();
            Assert.IsType<NoContentResult>(await first);
            releaseSecond.SetResult();
            Assert.IsType<NoContentResult>(await second);
        }
        finally
        {
            releaseFirst.TrySetResult();
            releaseSecond.TrySetResult();
            await first;
            if (second != null) await second;
        }

        await using var verify = h.NewContext();
        var tracks = await verify.AudiobookTracks.OrderBy(t => t.Id).ToListAsync();
        Assert.Equal(2, tracks.Count);
        Assert.All(tracks, track => Assert.Equal(1, track.TrackNumber));
        Assert.NotEqual(tracks[0].FilePath, tracks[1].FilePath);
        Assert.Equal("first upload", await File.ReadAllTextAsync(h.FullPath(tracks[0].FilePath)));
        Assert.Equal("second upload", await File.ReadAllTextAsync(h.FullPath(tracks[1].FilePath)));
        Assert.Equal(2, Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories).Length);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailedUpload_RemovesOnlyItsOwnFiles_AndDoesNotPersistTracks(bool failDuringSave)
    {
        await using var h = await UploadHarness.CreateAsync();
        await h.SeedLegacyStateAsync();
        var orphan = h.WriteFile("audiobooks/1/track_2.mp3", "same book orphan");
        var otherBook = h.WriteFile("audiobooks/2/track_2.mp3", "other book bytes");
        var originalFiles = Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories).Order().ToArray();
        await using var context = h.NewContext();
        if (failDuringSave)
        {
            // Reject the second insert: the first new track must also roll back.
            await context.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER reject_third_track BEFORE INSERT ON "AudiobookTracks"
                WHEN NEW."TrackNumber" = 3
                BEGIN SELECT RAISE(ABORT, 'synthetic save failure'); END;
                """);
        }
        IFormFile second = Audio("second.mp3", "second request-created file");
        if (!failDuringSave)
            second = new InterceptedFormFile((FormFile)second, () => throw new IOException("synthetic copy failure"));

        var result = await h.Controller(context).UploadAudiobook(1,
            Upload(Audio("first.mp3", "first request-created file"), second));

        Assert.Equal(StatusCodes.Status500InternalServerError, Assert.IsType<ObjectResult>(result).StatusCode);
        Assert.Equal(originalFiles, Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories).Order().ToArray());
        Assert.Equal("same book orphan", await File.ReadAllTextAsync(orphan));
        Assert.Equal("other book bytes", await File.ReadAllTextAsync(otherBook));
        await h.AssertLegacyStateAsync();
        await using var verify = h.NewContext();
        Assert.Single(await verify.AudiobookTracks.ToListAsync());
    }

    [Fact]
    public async Task Upload_PreservesLegacyTrackIdentityProgressAndEarnedActivity()
    {
        await using var h = await UploadHarness.CreateAsync();
        await h.SeedLegacyStateAsync();
        await using var context = h.NewContext();

        var result = await h.Controller(context).UploadAudiobook(1, Upload(Audio("new.M4B", "new chapter")));

        Assert.IsType<NoContentResult>(result);
        await h.AssertLegacyStateAsync();
        await using var verify = h.NewContext();
        var added = await verify.AudiobookTracks.SingleAsync(t => t.Id != UploadHarness.LegacyTrackId);
        Assert.Equal(2, added.TrackNumber);
        Assert.Null(added.Duration);
        Assert.Equal("new chapter", await File.ReadAllTextAsync(h.FullPath(added.FilePath)));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UnsupportedAndEmptyFiles_AreSkippedWithoutConsumingTrackNumbers(bool includeValidAudio)
    {
        await using var h = await UploadHarness.CreateAsync();
        var orphan = h.WriteFile("audiobooks/1/track_1.mp3", "existing bytes");
        var files = new List<IFormFile> { Audio("empty.mp3", ""), Audio("unsupported.txt", "not audio") };
        if (includeValidAudio) files.Add(Audio("valid.ogg", "valid bytes"));
        await using var context = h.NewContext();

        var result = await h.Controller(context).UploadAudiobook(1, new UploadAudiobookDto { Files = files });

        await using var verify = h.NewContext();
        var tracks = await verify.AudiobookTracks.ToListAsync();
        if (includeValidAudio)
        {
            Assert.IsType<NoContentResult>(result);
            var track = Assert.Single(tracks);
            Assert.Equal(1, track.TrackNumber);
            Assert.Equal("valid bytes", await File.ReadAllTextAsync(h.FullPath(track.FilePath)));
        }
        else
        {
            Assert.IsType<BadRequestObjectResult>(result);
            Assert.Empty(tracks);
        }
        Assert.Equal("existing bytes", await File.ReadAllTextAsync(orphan));
        Assert.Equal(includeValidAudio ? 2 : 1, Directory.GetFiles(h.WebRoot, "*", SearchOption.AllDirectories).Length);
    }

    private static UploadAudiobookDto Upload(params IFormFile[] files) => new() { Files = files.ToList() };

    private static FormFile Audio(string fileName, string content)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "files", fileName);
    }

    private sealed class InterceptedFormFile(FormFile file, Func<Task> afterCopy) : IFormFile
    {
        public string ContentType => file.ContentType;
        public string ContentDisposition => file.ContentDisposition;
        public IHeaderDictionary Headers => file.Headers;
        public long Length => file.Length;
        public string Name => file.Name;
        public string FileName => file.FileName;
        public Stream OpenReadStream() => file.OpenReadStream();
        public void CopyTo(Stream target) => throw new NotSupportedException();
        public async Task CopyToAsync(Stream target, CancellationToken cancellationToken = default)
        {
            await file.CopyToAsync(target, cancellationToken);
            await afterCopy();
        }
    }

    private sealed class UploadHarness(SqliteConnection connection, DbContextOptions<AppDbContext> options) : IAsyncDisposable
    {
        public const int LegacyTrackId = 41;
        private static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
        private static readonly DateTime RecordedAt = new(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc);
        private readonly string _tempRoot = Path.Combine(Path.GetTempPath(), "lingua-audiobook-tests", Guid.NewGuid().ToString("N"));
        public string WebRoot => Path.Combine(_tempRoot, "wwwroot");

        public static async Task<UploadHarness> CreateAsync()
        {
            var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
            var harness = new UploadHarness(connection, options);
            Directory.CreateDirectory(harness.WebRoot);
            await using var context = harness.NewContext();
            await context.Database.EnsureCreatedAsync();
            context.Users.Add(new User { Id = UserId, UserName = "reader", Email = "reader@example.com" });
            context.Languages.Add(new Language { LanguageId = 1, Name = "Portuguese", Code = "pt" });
            context.Books.AddRange(
                new Book { BookId = 1, UserId = UserId, LanguageId = 1, Title = "First book" },
                new Book { BookId = 2, UserId = UserId, LanguageId = 1, Title = "Other book" });
            await context.SaveChangesAsync();
            return harness;
        }

        public AppDbContext NewContext() => new(options);

        public BooksController Controller(AppDbContext context) =>
            new(context, NullLogger<BooksController>.Instance, new ChapterDetectionService())
            {
                WebRoot = WebRoot,
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity(
                            [new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "TestAuth"))
                    }
                }
            };

        public string FullPath(string relativePath) => Path.Combine(WebRoot, relativePath.Replace('/', Path.DirectorySeparatorChar));

        public string WriteFile(string relativePath, string content)
        {
            var path = FullPath(relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, content);
            return path;
        }

        public async Task SeedLegacyStateAsync()
        {
            WriteFile("audiobooks/1/track_1.mp3", "legacy audio bytes");
            await using var context = NewContext();
            context.AudiobookTracks.Add(new AudiobookTrack
            {
                Id = LegacyTrackId, BookId = 1, TrackNumber = 1, FilePath = "audiobooks/1/track_1.mp3", Duration = 120
            });
            context.UserBookProgresses.Add(new UserBookProgress
            {
                UserId = UserId, BookId = 1, CurrentAudiobookTrackId = LegacyTrackId,
                CurrentAudiobookPosition = 37.5, UpdatedAt = RecordedAt
            });
            context.UserActivities.Add(new UserActivity
            {
                UserId = UserId, LanguageId = 1, ActivityType = "listening",
                ListeningDurationSeconds = 53, Timestamp = RecordedAt, ClientEventId = "elapsed-listening"
            });
            context.LessonStudyEvents.Add(new LessonStudyEvent
            {
                UserId = UserId, LanguageId = 1, SourceTextId = 15, SourceTitle = "Existing lesson",
                SourceRevision = "legacy-revision", ClientEventId = "manual-pass", Kind = "listen",
                CreditedListeningSeconds = 120, CreatedAt = RecordedAt
            });
            await context.SaveChangesAsync();
        }

        public async Task AssertLegacyStateAsync()
        {
            await using var context = NewContext();
            var track = await context.AudiobookTracks.SingleAsync(t => t.Id == LegacyTrackId);
            Assert.Equal(1, track.BookId);
            Assert.Equal(1, track.TrackNumber);
            Assert.Equal("audiobooks/1/track_1.mp3", track.FilePath);
            Assert.Equal(120d, track.Duration);
            Assert.Equal("legacy audio bytes", await File.ReadAllTextAsync(FullPath(track.FilePath)));
            var progress = Assert.Single(await context.UserBookProgresses.ToListAsync());
            Assert.Equal(LegacyTrackId, progress.CurrentAudiobookTrackId);
            Assert.Equal(37.5, progress.CurrentAudiobookPosition);
            Assert.Equal(RecordedAt, progress.UpdatedAt);
            var activity = Assert.Single(await context.UserActivities.ToListAsync());
            Assert.Equal("listening", activity.ActivityType);
            Assert.Equal(53, activity.ListeningDurationSeconds);
            Assert.Equal("elapsed-listening", activity.ClientEventId);
            Assert.Equal(RecordedAt, activity.Timestamp);
            var manualPass = Assert.Single(await context.LessonStudyEvents.ToListAsync());
            Assert.Equal("manual-pass", manualPass.ClientEventId);
            Assert.Equal("legacy-revision", manualPass.SourceRevision);
            Assert.Equal("listen", manualPass.Kind);
            Assert.Equal(120, manualPass.CreditedListeningSeconds);
            Assert.Equal(RecordedAt, manualPass.CreatedAt);
        }

        public async ValueTask DisposeAsync()
        {
            await connection.DisposeAsync();
            Directory.Delete(_tempRoot, recursive: true);
        }
    }
}
