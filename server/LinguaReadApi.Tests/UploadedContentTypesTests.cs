using LinguaReadApi.Utilities;
using Xunit;

namespace LinguaReadApi.Tests;

public class UploadedContentTypesTests
{
    [Theory]
    [InlineData("/audio_lessons", "x_lesson.mp3", "audio/mpeg")]
    [InlineData("/audiobooks", "track_1.m4b", "audio/mp4")] // accepted by the audiobook upload, missing from .NET's default map
    [InlineData("/audiobooks", "track_2.FLAC", "audio/flac")]
    [InlineData("/audio_lessons", "x_memo.aiff", "audio/aiff")] // served by the default map before
    [InlineData("/epub_assets", "scan.tif", "image/tiff")] // stored by EPUB imports before sanitizing
    [InlineData("/epub_assets", "img_0001.jpg", "image/jpeg")]
    [InlineData("/hardcover-covers", "7.webp", "image/webp")]
    [InlineData("/epub_assets", "diagram.svg", "image/svg+xml")]
    public void ServesTheMediaTypesOfItsPrefix(string prefix, string fileName, string expected)
    {
        Assert.True(UploadedContentTypes.For(prefix).TryGetContentType(fileName, out var contentType));
        Assert.Equal(expected, contentType);
    }

    [Theory]
    [InlineData("/audio_lessons", "x_lesson.js")]
    [InlineData("/audio_lessons", "x_lesson.html")]
    [InlineData("/audiobooks", "track_1.svg")]
    [InlineData("/epub_assets", "evil.html")]
    [InlineData("/epub_assets", "evil.xhtml")]
    [InlineData("/epub_assets", "evil.js")]
    [InlineData("/epub_assets", "evil.svgz")] // gzipped SVG: scriptable, and never stored by the importer
    [InlineData("/hardcover-covers", "7.mp3")]
    public void RejectsEverythingElse(string prefix, string fileName)
    {
        Assert.False(UploadedContentTypes.For(prefix).TryGetContentType(fileName, out _));
    }

    [Fact]
    public void UnknownPrefix_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => UploadedContentTypes.For("/new_uploads"));
    }
}
