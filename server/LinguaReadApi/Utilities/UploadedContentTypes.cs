using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.StaticFiles;

namespace LinguaReadApi.Utilities
{
    /// <summary>
    /// What each uploaded-content static mount may serve. The static-file middleware picks the
    /// Content-Type from the file extension and 404s any extension its provider doesn't know, so
    /// limiting each mount to its own media types means a stored "x.html" or "x.js" (an audio
    /// lesson keeps the uploader's file name) is never served as a same-origin page or script,
    /// whichever code path wrote it.
    /// </summary>
    public static class UploadedContentTypes
    {
        // Audiobook uploads accept .mp3/.m4b/.m4a/.ogg/.flac/.wav (BooksController). Audio lessons
        // keep the uploader's name, so this also keeps the audio types the framework's default map
        // served before these mounts had their own list (.aiff, .wma, .mp4, ...): existing lessons
        // with those names must not start 404ing.
        private static readonly FileExtensionContentTypeProvider Audio = new(
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                [".mp3"] = "audio/mpeg",
                [".m4a"] = "audio/mp4",
                [".m4b"] = "audio/mp4",
                [".mp4"] = "audio/mp4",
                [".aac"] = "audio/aac",
                [".ogg"] = "audio/ogg",
                [".oga"] = "audio/ogg",
                [".opus"] = "audio/ogg",
                [".spx"] = "audio/ogg",
                [".flac"] = "audio/flac",
                [".wav"] = "audio/wav",
                [".aif"] = "audio/aiff",
                [".aifc"] = "audio/aiff",
                [".aiff"] = "audio/aiff",
                [".webm"] = "audio/webm",
                [".weba"] = "audio/webm",
                [".wma"] = "audio/x-ms-wma",
                [".3gp"] = "audio/3gpp",
            });

        private static readonly FileExtensionContentTypeProvider Images = new(
            new Dictionary<string, string>(ImageFileExtension.ContentTypes, StringComparer.OrdinalIgnoreCase));

        // An SVG opened directly is a same-origin document that can run script. Sandboxing it
        // (opaque origin, no script) keeps <img src="x.svg"> working without relying on nginx's CSP.
        private const string SvgPolicy = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; sandbox";

        /// <summary>
        /// The content types served under a protected static prefix. Throws for a prefix with no
        /// types chosen, so a newly gated prefix can't silently serve every extension.
        /// </summary>
        public static IContentTypeProvider For(string prefix) => prefix switch
        {
            "/audio_lessons" or "/audiobooks" => Audio,
            "/epub_assets" or "/hardcover-covers" => Images,
            _ => throw new ArgumentOutOfRangeException(nameof(prefix), prefix, "No content types are defined for this static prefix."),
        };

        /// <summary>StaticFileOptions.OnPrepareResponse hook: sandboxes SVG responses.</summary>
        public static void SandboxScriptableFiles(StaticFileResponseContext context)
        {
            if (context.File.Name.EndsWith(".svg", StringComparison.OrdinalIgnoreCase))
            {
                context.Context.Response.Headers.ContentSecurityPolicy = SvgPolicy;
            }
        }
    }
}
