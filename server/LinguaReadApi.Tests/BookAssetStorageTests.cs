using LinguaReadApi.Utilities;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// The delete paths used to build the on-disk path as
/// Path.Combine("wwwroot", storedPath.Replace("/", "\\")). On Linux that produced a single
/// filename containing literal backslashes, File.Exists was always false, and every deleted audio
/// lesson, book cover and EPUB asset stayed on the volume — and in the offsite backup — forever.
/// These tests run against real temp directories so the path handling is exercised, not mocked.
/// Note they only fail on Linux — on Windows a backslash is a separator too, which is precisely why
/// the original bug survived local development. CI runs on ubuntu-latest, so it is the one that
/// catches a reintroduction.
///
/// Each test passes its own webRoot rather than changing the process current directory: xUnit runs
/// test classes in parallel, and the WebApplicationFactory-based suites resolve their content root
/// from that directory.
/// </summary>
public class BookAssetStorageTests : IDisposable
{
    private readonly string _root;
    private readonly string _webRoot;

    public BookAssetStorageTests()
    {
        _root = Path.Combine(Path.GetTempPath(), "lingua-asset-tests", Guid.NewGuid().ToString("N"));
        _webRoot = Path.Combine(_root, "wwwroot");
        Directory.CreateDirectory(_webRoot);
    }

    public void Dispose()
    {
        try { Directory.Delete(_root, recursive: true); } catch { /* temp cleanup is best effort */ }
    }

    [Fact]
    public void DeleteAudioLessonFile_DeletesPathStoredWithForwardSlashes()
    {
        // Exactly the shape CreateAudioLesson persists: relative to wwwroot, forward slashes.
        var relativePath = $"audio_lessons/{Guid.NewGuid()}/lesson.mp3";
        var absolutePath = Path.Combine(_webRoot, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)!);
        File.WriteAllText(absolutePath, "audio");

        BookAssetStorage.DeleteAudioLessonFile(relativePath, webRoot: _webRoot);

        Assert.False(File.Exists(absolutePath));
    }

    [Fact]
    public void DeleteAudioLessonFile_IsSafe_WhenPathIsNullOrMissing()
    {
        BookAssetStorage.DeleteAudioLessonFile(null, webRoot: _webRoot);
        BookAssetStorage.DeleteAudioLessonFile("", webRoot: _webRoot);
        BookAssetStorage.DeleteAudioLessonFile("audio_lessons/nope/missing.mp3", webRoot: _webRoot);
    }

    [Fact]
    public void DeleteBookAssets_RemovesEpubAssetsAudiobookTracksAndCover()
    {
        var userId = Guid.NewGuid();
        const int bookId = 42;

        var epubDir = Path.Combine(_webRoot, "epub_assets", userId.ToString(), bookId.ToString());
        Directory.CreateDirectory(epubDir);
        File.WriteAllText(Path.Combine(epubDir, "image1.png"), "png");

        var audiobookDir = Path.Combine(_webRoot, "audiobooks", bookId.ToString());
        Directory.CreateDirectory(audiobookDir);
        File.WriteAllText(Path.Combine(audiobookDir, "track_1.mp3"), "mp3");

        var coverDir = Path.Combine(_webRoot, "hardcover-covers", userId.ToString("N"));
        Directory.CreateDirectory(coverDir);
        var coverPath = Path.Combine(coverDir, $"{bookId}.jpg");
        File.WriteAllText(coverPath, "jpg");

        BookAssetStorage.DeleteBookAssets(userId, bookId, webRoot: _webRoot);

        Assert.False(Directory.Exists(epubDir));
        Assert.False(Directory.Exists(audiobookDir));
        Assert.False(File.Exists(coverPath));
    }

    [Fact]
    public void DeleteBookAssets_LeavesOtherBooksAlone()
    {
        var userId = Guid.NewGuid();

        var coverDir = Path.Combine(_webRoot, "hardcover-covers", userId.ToString("N"));
        Directory.CreateDirectory(coverDir);
        // Book 1's cover must survive a delete of book 12 — a naive prefix match would eat it.
        var keptCover = Path.Combine(coverDir, "1.jpg");
        var deletedCover = Path.Combine(coverDir, "12.jpg");
        File.WriteAllText(keptCover, "jpg");
        File.WriteAllText(deletedCover, "jpg");

        var otherAudiobookDir = Path.Combine(_webRoot, "audiobooks", "1");
        Directory.CreateDirectory(otherAudiobookDir);
        File.WriteAllText(Path.Combine(otherAudiobookDir, "track_1.mp3"), "mp3");

        BookAssetStorage.DeleteBookAssets(userId, 12, webRoot: _webRoot);

        Assert.True(File.Exists(keptCover));
        Assert.False(File.Exists(deletedCover));
        Assert.True(Directory.Exists(otherAudiobookDir));
    }

    [Fact]
    public void DeleteBookAssets_DoesNotPrefixMatchLongerBookIds()
    {
        // The cover glob is "{bookId}.*" — deleting book 1 must not take 12.jpg with it.
        var userId = Guid.NewGuid();
        var coverDir = Path.Combine(_webRoot, "hardcover-covers", userId.ToString("N"));
        Directory.CreateDirectory(coverDir);
        var deletedCover = Path.Combine(coverDir, "1.jpg");
        var keptCover = Path.Combine(coverDir, "12.jpg");
        File.WriteAllText(deletedCover, "jpg");
        File.WriteAllText(keptCover, "jpg");

        BookAssetStorage.DeleteBookAssets(userId, 1, webRoot: _webRoot);

        Assert.False(File.Exists(deletedCover));
        Assert.True(File.Exists(keptCover));
    }

    [Fact]
    public void DeleteAudioLessonFile_RefusesPathsThatEscapeTheWebRoot()
    {
        // The path comes out of a database column. Deleting is this method's whole job, so a value
        // that resolves outside wwwroot must be refused rather than trusted.
        var outsideFile = Path.Combine(_root, "outside.mp3");
        File.WriteAllText(outsideFile, "audio");

        BookAssetStorage.DeleteAudioLessonFile("../outside.mp3", webRoot: _webRoot);
        Assert.True(File.Exists(outsideFile));

        BookAssetStorage.DeleteAudioLessonFile(outsideFile, webRoot: _webRoot);
        Assert.True(File.Exists(outsideFile));
    }

    [Fact]
    public void DeleteBookAssets_IsSafe_WhenNothingWasEverWritten()
    {
        BookAssetStorage.DeleteBookAssets(Guid.NewGuid(), 99, webRoot: _webRoot);
    }
}
