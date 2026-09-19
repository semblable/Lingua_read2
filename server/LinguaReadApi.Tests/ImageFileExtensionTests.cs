using LinguaReadApi.Utilities;
using Xunit;

namespace LinguaReadApi.Tests;

public class ImageFileExtensionTests
{
    [Theory]
    [InlineData("OEBPS/images/cover.jpg", null, ".jpg")]
    [InlineData("OEBPS/images/Figure.PNG", null, ".png")]
    [InlineData("/covers/1.webp", null, ".webp")] // HardcoverService passes Uri.AbsolutePath
    [InlineData("OEBPS/images/diagram.svg", "image/svg+xml", ".svg")]
    [InlineData("OEBPS/images/scan.TIF", "image/tiff", ".tif")]
    public void KeepsImageExtensions(string path, string? mimeType, string expected)
    {
        Assert.Equal(expected, ImageFileExtension.From(path, mimeType));
    }

    [Theory]
    // A manifest can label any archive entry as an image; its own extension must not survive.
    [InlineData("OEBPS/evil.html", "image/png", ".png")]
    [InlineData("OEBPS/evil.xhtml", "image/svg+xml", ".svg")]
    [InlineData("OEBPS/evil.js", null, ".jpg")]
    [InlineData("/cover.html", "text/html", ".jpg")]
    public void ReplacesNonImageExtensions(string path, string? mimeType, string expected)
    {
        Assert.Equal(expected, ImageFileExtension.From(path, mimeType));
    }

    [Theory]
    [InlineData(null, "image/webp", ".webp")]
    [InlineData("cover", "IMAGE/GIF", ".gif")]
    [InlineData("cover", null, ".jpg")]
    public void FallsBackToMimeTypeWithoutExtension(string? path, string? mimeType, string expected)
    {
        Assert.Equal(expected, ImageFileExtension.From(path, mimeType));
    }
}
