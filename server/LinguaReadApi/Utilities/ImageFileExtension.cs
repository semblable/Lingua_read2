using System;
using System.Collections.Generic;
using System.IO;

namespace LinguaReadApi.Utilities
{
    /// <summary>
    /// Picks the extension for an image written under wwwroot. The static-file middleware derives
    /// the Content-Type from that extension, so taking it verbatim from an uploaded EPUB or a
    /// remote URL could store ".html" or ".js" and have it served as a same-origin page or script.
    /// Only image extensions are kept; anything else falls back to the MIME type, then ".jpg".
    /// </summary>
    public static class ImageFileExtension
    {
        /// <summary>
        /// The extensions images may be stored with, and the Content-Type each is served as.
        /// The image static mounts serve exactly these (see <see cref="UploadedContentTypes"/>),
        /// so the rarer raster types stay listed: images stored before extensions were
        /// sanitized keep them, and dropping one would turn those into 404s.
        /// </summary>
        public static readonly IReadOnlyDictionary<string, string> ContentTypes =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                [".jpg"] = "image/jpeg",
                [".jpeg"] = "image/jpeg",
                [".jpe"] = "image/jpeg",
                [".jfif"] = "image/jpeg",
                [".png"] = "image/png",
                [".gif"] = "image/gif",
                [".webp"] = "image/webp",
                [".svg"] = "image/svg+xml",
                [".bmp"] = "image/bmp",
                [".avif"] = "image/avif",
                [".tif"] = "image/tiff",
                [".tiff"] = "image/tiff",
                [".ico"] = "image/x-icon",
            };

        public static string From(string? pathOrUrl, string? mimeType)
        {
            var extension = Path.GetExtension(pathOrUrl ?? string.Empty);
            if (ContentTypes.ContainsKey(extension))
            {
                return extension.ToLowerInvariant();
            }

            return mimeType?.Trim().ToLowerInvariant() switch
            {
                "image/png" => ".png",
                "image/gif" => ".gif",
                "image/webp" => ".webp",
                "image/svg+xml" => ".svg",
                "image/bmp" => ".bmp",
                "image/avif" => ".avif",
                _ => ".jpg"
            };
        }
    }
}
