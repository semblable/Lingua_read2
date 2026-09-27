using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Utilities
{
    /// <summary>
    /// Removes the on-disk media a book owns: extracted EPUB assets, uploaded audiobook tracks and
    /// the downloaded Hardcover cover; and the lead photo of an imported news article. Each of
    /// these lives on a persistent Docker volume that the backup sidecar mirrors offsite, so a book
    /// or text deleted from the database without this cleanup leaves its bytes behind permanently,
    /// in the volume and in every later backup.
    /// </summary>
    public static class BookAssetStorage
    {
        // News photos share the EPUB assets volume, so they are gated, backed up and copied to
        // staging like EPUB images: epub_assets/{userId}/news/{textId}{ext}. Book folders there are
        // named by the integer book id, so no book's folder can be "news".
        public const string NewsImageFolder = "news";

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

        /// <summary>Where the news import stores a user's article photos.</summary>
        public static string NewsImageDirectory(Guid userId, string? webRoot = null) =>
            Path.Combine(ResolveWebRoot(webRoot), "epub_assets", userId.ToString(), NewsImageFolder);

        /// <summary>The photo's address as the reader loads it (relative to wwwroot, like EPUB image URLs).</summary>
        public static string NewsImageUrl(Guid userId, int textId, string extension) =>
            $"epub_assets/{userId}/{NewsImageFolder}/{textId}{extension}";

        /// <summary>
        /// Deletes the lead photos of these texts. Best-effort and after the database delete has
        /// committed, like <see cref="DeleteBookAssets"/>. Texts without a photo (most of them) are
        /// simply not found, so callers pass every text they deleted rather than tracking which
        /// ones were news articles: an article whose feed was removed is no longer marked as one.
        /// </summary>
        public static void DeleteNewsImages(Guid userId, IEnumerable<int> textIds, ILogger? logger = null, string? webRoot = null)
        {
            var directory = NewsImageDirectory(userId, webRoot);
            List<string> files;
            try
            {
                if (!Directory.Exists(directory)) return;
                var ids = textIds.ToHashSet();
                if (ids.Count == 0) return;
                // The extension follows the downloaded image's type, so match on the name alone.
                files = Directory.EnumerateFiles(directory)
                    .Where(file => int.TryParse(Path.GetFileNameWithoutExtension(file), NumberStyles.None, CultureInfo.InvariantCulture, out var textId)
                                   && ids.Contains(textId))
                    .ToList();
            }
            catch (Exception ex)
            {
                logger?.LogWarning(ex, "Failed to list news photos in {Path}", directory);
                return;
            }

            foreach (var file in files)
            {
                try
                {
                    File.Delete(file);
                }
                catch (Exception ex)
                {
                    logger?.LogWarning(ex, "Failed to delete news photo {Path}", file);
                }
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
