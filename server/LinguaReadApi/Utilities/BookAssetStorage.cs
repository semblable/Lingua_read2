using System;
using System.IO;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Utilities
{
    /// <summary>
    /// Removes the on-disk media a book owns: extracted EPUB assets, uploaded audiobook tracks and
    /// the downloaded Hardcover cover. Each of these lives on a persistent Docker volume that the
    /// backup sidecar mirrors offsite, so a book deleted from the database without this cleanup
    /// leaves its bytes behind permanently, in the volume and in every later backup.
    /// </summary>
    public static class BookAssetStorage
    {
        // The controllers resolve wwwroot this way rather than through IWebHostEnvironment; keep
        // the two in step so cleanup targets the same directories the upload paths wrote to.
        // `webRoot` exists so tests can point at a temp directory without mutating the process-wide
        // current directory, which would race the WebApplicationFactory-based tests running in
        // parallel.
        private static string ResolveWebRoot(string? webRoot)
            => webRoot ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");

        /// <summary>
        /// Best-effort cleanup. Callers invoke it after the database delete has committed, so a
        /// disk-level failure is logged and swallowed — it must not fail the request or leave the
        /// row in place.
        /// </summary>
        public static void DeleteBookAssets(Guid userId, int bookId, ILogger? logger = null, string? webRoot = null)
        {
            var root = ResolveWebRoot(webRoot);

            // Written by the EPUB import (BooksController) as epub_assets/{userId}/{bookId}.
            DeleteDirectory(Path.Combine(root, "epub_assets", userId.ToString(), bookId.ToString()), logger);

            // Written by the audiobook upload as audiobooks/{bookId}.
            DeleteDirectory(Path.Combine(root, "audiobooks", bookId.ToString()), logger);

            // Written by HardcoverService as hardcover-covers/{userId:N}/{bookId}{ext}; the
            // extension follows the downloaded content type, so match on any.
            DeleteCoverImages(root, userId, bookId, logger);
        }

        /// <summary>
        /// Deletes an uploaded audio-lesson file. <paramref name="relativeAudioPath"/> is stored
        /// relative to wwwroot with forward slashes; Path.Combine accepts those on every platform,
        /// so it must not be rewritten to backslashes — on Linux that produced a single filename
        /// with literal backslashes and the delete silently never happened.
        /// </summary>
        public static void DeleteAudioLessonFile(string? relativeAudioPath, ILogger? logger = null, string? webRoot = null)
        {
            if (string.IsNullOrEmpty(relativeAudioPath)) return;

            var root = ResolveWebRoot(webRoot);
            var fullPath = Path.GetFullPath(Path.Combine(root, relativeAudioPath));

            // The stored value is always server-generated and relative, but this method's only job
            // is deleting files — so refuse anything that resolves outside wwwroot (an absolute
            // path or one containing ..) rather than trusting the column.
            var rootPrefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!fullPath.StartsWith(rootPrefix, StringComparison.Ordinal))
            {
                logger?.LogWarning("Refusing to delete audio file outside the web root: {FilePath}", fullPath);
                return;
            }

            if (!File.Exists(fullPath))
            {
                logger?.LogWarning("Audio file to delete was not found on disk: {FilePath}", fullPath);
                return;
            }

            try
            {
                File.Delete(fullPath);
            }
            catch (Exception ex)
            {
                logger?.LogWarning(ex, "Failed to delete audio file: {FilePath}", fullPath);
            }
        }

        private static void DeleteDirectory(string path, ILogger? logger)
        {
            try
            {
                if (Directory.Exists(path))
                {
                    Directory.Delete(path, recursive: true);
                }
            }
            catch (Exception ex)
            {
                logger?.LogWarning(ex, "Failed to delete book asset directory {Path}", path);
            }
        }

        private static void DeleteCoverImages(string webRoot, Guid userId, int bookId, ILogger? logger)
        {
            var coverDirectory = Path.Combine(webRoot, "hardcover-covers", userId.ToString("N"));
            try
            {
                if (!Directory.Exists(coverDirectory)) return;

                foreach (var file in Directory.EnumerateFiles(coverDirectory, $"{bookId}.*"))
                {
                    File.Delete(file);
                }
            }
            catch (Exception ex)
            {
                logger?.LogWarning(ex, "Failed to delete Hardcover cover for book {BookId} in {Path}", bookId, coverDirectory);
            }
        }
    }
}
