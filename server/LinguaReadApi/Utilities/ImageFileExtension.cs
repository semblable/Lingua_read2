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
        private static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase)
        {
            ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".avif"
        };

        public static string From(string? pathOrUrl, string? mimeType)
        {
            var extension = Path.GetExtension(pathOrUrl ?? string.Empty);
            if (Allowed.Contains(extension))
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
