using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace LinguaReadApi.Services.News
{
    /// <summary>A picture that may be an article's lead photo, with a caption when the page gives a usable one.</summary>
    public sealed record ImageCandidate(Uri Url, string? Caption = null);

    /// <summary>
    /// Picks an article's lead photo and checks what was downloaded. The photo is stored by the
    /// server like EPUB images: the CSP only allows same-origin images, and hot-linking would tell
    /// the site when you read.
    /// </summary>
    public static class LeadImage
    {
        public const int MaxBytes = 2 * 1024 * 1024;

        // Smaller files are spacers and tracking pixels, not photos.
        public const int MinBytes = 1024;

        // A declared size below this is a thumbnail or an icon (a feed's 100×100 enclosure).
        public const int MinWidth = 300;
        public const int MinHeight = 150;

        // Candidates tried per article at most, so a site whose pictures all fail can't hold up the check.
        public const int MaxAttempts = 3;

        public const int MaxCaptionLength = 300;

        private static readonly string[] MetadataImageKeys =
            ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"];

        private static readonly string[] MetadataAltKeys = ["og:image:alt", "twitter:image:alt"];

        // The stand-in a site shows when a story has no photo of its own: RTP's "antena1_default.png",
        // "logo-share.jpg". Whole words only, so "logotipo" or "defaults2026" stay.
        private static readonly Regex Placeholder = new(
            @"(?:^|[^a-z])(?:default|placeholder|fallback|logo)(?:[^a-z]|$)",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        /// <summary>
        /// The pictures to try, best first: the page's own choice (<paramref name="article"/>'s
        /// metadata), then the feed's, then the first picture in the article. Stand-ins and repeats
        /// are left out.
        /// </summary>
        public static IReadOnlyList<ImageCandidate> Candidates(ExtractedArticle article, FeedEntry entry)
        {
            var candidates = new List<ImageCandidate>(article.MetadataImages);
            if (entry.ImageUrl != null) candidates.Add(new ImageCandidate(entry.ImageUrl));
            if (article.FirstBodyImage != null) candidates.Add(article.FirstBodyImage);
            return candidates
                .Where(c => !IsPlaceholder(c.Url))
                .DistinctBy(c => c.Url.AbsoluteUri)
                .Take(MaxAttempts)
                .ToList();
        }

        /// <summary>
        /// The lead photo the page names for sharing: SmartReader's featured image, then og:image,
        /// then twitter:image. Parsed as HTML, so an address written with "&amp;amp;" comes out right.
        /// </summary>
        public static IReadOnlyList<ImageCandidate> FromMetadata(string html, Uri pageUrl, string? featuredImage, params string?[] titles)
        {
            try
            {
                var metas = new HtmlParser().ParseDocument(html).QuerySelectorAll("meta[content]")
                    .Select(meta => (Key: (meta.GetAttribute("property") ?? meta.GetAttribute("name") ?? "").Trim().ToLowerInvariant(),
                                     Value: meta.GetAttribute("content")!.Trim()))
                    .Where(m => m.Key.Length > 0 && m.Value.Length > 0)
                    .ToList();
                string? Meta(string key) => metas.FirstOrDefault(m => m.Key == key).Value;

                // The alt text describes the shared picture, which is what all of these name.
                var caption = CleanCaption(MetadataAltKeys.Select(Meta).FirstOrDefault(alt => alt != null), titles);
                // SmartReader may hand the attribute back still encoded.
                var addresses = new List<string?> { featuredImage == null ? null : WebUtility.HtmlDecode(featuredImage) };
                addresses.AddRange(MetadataImageKeys.Select(Meta));
                return addresses
                    .Select(address => Resolve(address, pageUrl))
                    .Where(url => url != null)
                    .DistinctBy(url => url!.AbsoluteUri)
                    .Select(url => new ImageCandidate(url!, caption))
                    .ToList();
            }
            catch (Exception)
            {
                // A photo is optional; odd markup must never cost the article.
                return Array.Empty<ImageCandidate>();
            }
        }

        /// <summary>
        /// The first picture in an article body (the extracted article, or a feed's content:encoded)
        /// that isn't declared tiny. Its caption is the figure's, else its alt text.
        /// </summary>
        public static ImageCandidate? FirstInHtml(string? html, Uri baseUrl, params string?[] titles)
        {
            if (string.IsNullOrWhiteSpace(html)) return null;
            try
            {
                var document = new HtmlParser().ParseDocument("<!DOCTYPE html><html><body>" + html + "</body></html>");
                foreach (var image in document.QuerySelectorAll("img").Take(10))
                {
                    if (IsTiny(Dimension(image.GetAttribute("width")), Dimension(image.GetAttribute("height")))) continue;
                    // data-src: a lazy-loaded picture whose src is still a blank placeholder or missing.
                    var url = Resolve(image.GetAttribute("data-src"), baseUrl) ?? Resolve(image.GetAttribute("src"), baseUrl);
                    if (url == null) continue;
                    var figureCaption = image.Closest("figure")?.QuerySelector("figcaption")?.TextContent;
                    return new ImageCandidate(url, CleanCaption(figureCaption, titles) ?? CleanCaption(image.GetAttribute("alt"), titles));
                }
                return null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// The file extension for a downloaded picture, from its first bytes (the Content-Type
        /// header is often wrong or generic), or null when it isn't JPEG, PNG, WebP, GIF or AVIF.
        /// Nothing else is stored: an SVG could carry script, and other types don't show everywhere.
        /// </summary>
        public static string? ExtensionFor(ReadOnlySpan<byte> bytes)
        {
            if (bytes.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF])) return ".jpg";
            if (bytes.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return ".png";
            if (bytes.StartsWith("GIF87a"u8) || bytes.StartsWith("GIF89a"u8)) return ".gif";
            if (bytes.Length >= 12 && bytes.StartsWith("RIFF"u8) && bytes[8..12].SequenceEqual("WEBP"u8)) return ".webp";
            return IsAvif(bytes) ? ".avif" : null;
        }

        // An ISO media file whose "ftyp" box names AVIF as its brand or a compatible brand. HEIC
        // shares the container but not the brand, and browsers other than Safari don't show it.
        private static bool IsAvif(ReadOnlySpan<byte> bytes)
        {
            if (bytes.Length < 16 || !bytes[4..8].SequenceEqual("ftyp"u8)) return false;
            var boxSize = (int)Math.Min((uint)(bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]), (uint)bytes.Length);
            if (IsAvifBrand(bytes[8..12])) return true;
            // After the major brand comes a 4-byte minor version, then the compatible brands.
            for (var offset = 16; offset + 4 <= boxSize; offset += 4)
            {
                if (IsAvifBrand(bytes[offset..(offset + 4)])) return true;
            }
            return false;
        }

        private static bool IsAvifBrand(ReadOnlySpan<byte> brand) => brand.SequenceEqual("avif"u8) || brand.SequenceEqual("avis"u8);

        /// <summary>Whether a declared width or height marks a picture as a thumbnail or icon.</summary>
        public static bool IsTiny(int? width, int? height) =>
            width is int w && w < MinWidth || height is int h && h < MinHeight;

        internal static bool IsPlaceholder(Uri url)
        {
            var path = url.AbsolutePath;
            var fileName = path[(path.LastIndexOf('/') + 1)..];
            return Placeholder.IsMatch(Uri.UnescapeDataString(fileName));
        }

        /// <summary>
        /// A caption worth showing: plain text of at least three words that doesn't just repeat the
        /// headline. Shorter ones are mostly stand-ins ("image name") or a bare credit.
        /// </summary>
        internal static string? CleanCaption(string? text, params string?[] titles)
        {
            var caption = FeedParser.CleanTitle(text);
            if (caption == null || ArticleExtractor.CountWords(caption) < 3) return null;
            if (titles.Any(title => string.Equals(FeedParser.CleanTitle(title), caption, StringComparison.OrdinalIgnoreCase))) return null;
            return caption.Length <= MaxCaptionLength ? caption : caption[..(MaxCaptionLength - 1)].TrimEnd() + "…";
        }

        internal static int? Dimension(string? value) =>
            int.TryParse(value?.Trim().TrimEnd('x', 'p', 'X', 'P'), out var number) && number > 0 ? number : null;

        private static Uri? Resolve(string? value, Uri baseUrl)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            return Uri.TryCreate(baseUrl, value.Trim(), out var url) && NewsFetcher.IsWebUrl(url) ? url : null;
        }
    }
}
