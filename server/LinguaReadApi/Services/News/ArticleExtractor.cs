using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using SmartReader;

namespace LinguaReadApi.Services.News
{
    public sealed record ExtractedArticle(string? Title, IReadOnlyList<string> Paragraphs)
    {
        public int WordCount => Paragraphs.Sum(ArticleExtractor.CountWords);

        /// <summary>The text as stored: paragraphs separated by blank lines, as the reader splits them.</summary>
        public string Content => string.Join("\n\n", Paragraphs);

        /// <summary>The lead photo the page names in its metadata (og:image and the like), best first.</summary>
        public IReadOnlyList<ImageCandidate> MetadataImages { get; init; } = Array.Empty<ImageCandidate>();

        /// <summary>The first picture in the article itself, the last resort for a lead photo.</summary>
        public ImageCandidate? FirstBodyImage { get; init; }
    }

    /// <summary>
    /// Turns a news page into reading text. SmartReader (a port of Firefox's Reader View) finds the
    /// article; the rules here then drop what still isn't prose: photos and captions, bylines and
    /// "most read" boxes, lines that are only links, short labels like "LEIA TAMBÉM:".
    /// </summary>
    public static class ArticleExtractor
    {
        private const string BlockSelector = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dt, dd, div";

        // Elements that end a paragraph when the text is read as a whole (the fallback).
        private const string FallbackBreakSelector = BlockSelector + ", section, article, main";

        private const string AlwaysRemovedSelector =
            "script, style, noscript, template, iframe, object, embed, video, audio, picture, img, svg, canvas, " +
            "figure, figcaption, form, button, input, select, textarea, nav, aside, footer, header, table, " +
            "[hidden], [aria-hidden=true]";

        // Page furniture such as bylines and "most read" lists. Only removed while small next to
        // the article, in case a site wraps the story itself in one.
        private const string BoxSelector =
            "[role=region], [role=navigation], [role=complementary], [role=contentinfo], [role=banner], [role=dialog], [role=alert]";

        private static readonly Regex Words = new(@"\p{L}+", RegexOptions.CultureInvariant);
        private static readonly Regex Spaces = new(@"[ \t\u00A0\u2007\u202F\f\v]+", RegexOptions.CultureInvariant);
        private static readonly Regex ParagraphBreak = new(@"\n\s*\n", RegexOptions.CultureInvariant);

        // A photo caption that sits outside its <figure>: "… — Foto: Divulgação", "(Photo : AFP)".
        private static readonly Regex PhotoCredit = new(
            @"(?:^|[\s(\[—–|-])(?:fotos?|fotografia|photos?|imagem|imagens|imagen|image|cr[ée]dito?|credit|bild)\s*:\s*[^.!?]{1,100}[)\]]?$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public static int CountWords(string text) => Words.Count(text);

        /// <summary>
        /// Extracts the article of a downloaded page. Never throws on odd HTML; may return no
        /// paragraphs. <paramref name="knownTitle"/> (the feed's title for the entry) is dropped
        /// from the text like the page's own title, which often carries the site name.
        /// </summary>
        public static ExtractedArticle FromPage(string html, Uri url, string? knownTitle = null)
        {
            Article article;
            try
            {
                article = new Reader(url.AbsoluteUri, html).GetArticle();
            }
            catch (Exception)
            {
                return new ExtractedArticle(null, Array.Empty<string>());
            }
            var title = FeedParser.CleanTitle(article.Title);
            return new ExtractedArticle(title, ToParagraphs(article.Content, title, knownTitle))
            {
                MetadataImages = LeadImage.FromMetadata(html, url, article.FeaturedImage, title, knownTitle),
                // SmartReader's article HTML still has its pictures; only the text drops them.
                FirstBodyImage = LeadImage.FirstInHtml(article.Content, url, title, knownTitle)
            };
        }

        /// <summary>
        /// The paragraphs of an HTML fragment (an article body, or a feed's content:encoded).
        /// Blocks equal to one of <paramref name="titles"/> are dropped, since the title is kept separately.
        /// </summary>
        public static IReadOnlyList<string> ToParagraphs(string? html, params string?[] titles)
        {
            if (string.IsNullOrWhiteSpace(html)) return Array.Empty<string>();

            var document = new HtmlParser().ParseDocument("<!DOCTYPE html><html><body>" + html + "</body></html>");
            var body = document.Body;
            if (body == null) return Array.Empty<string>();

            foreach (var element in body.QuerySelectorAll(AlwaysRemovedSelector).ToList())
            {
                element.Remove();
            }
            var totalLength = body.TextContent.Length;
            foreach (var box in body.QuerySelectorAll(BoxSelector).ToList())
            {
                if (box.TextContent.Length < totalLength * 0.3)
                {
                    box.Remove();
                }
            }
            // Line breaks become newlines so <br><br> inside one element still splits paragraphs.
            foreach (var br in body.QuerySelectorAll("br").ToList())
            {
                br.Replace(document.CreateTextNode("\n"));
            }

            var blocks = new List<(string Text, bool IsHeading)>();
            foreach (var element in body.QuerySelectorAll(BlockSelector))
            {
                if (element.QuerySelector(BlockSelector) != null) continue; // only innermost blocks
                if (IsMostlyLinks(element)) continue;
                var isHeading = element.LocalName.Length == 2 && element.LocalName[0] == 'h' && char.IsDigit(element.LocalName[1]);
                foreach (var text in SplitParagraphs(element.TextContent))
                {
                    blocks.Add((text, isHeading));
                }
            }

            // Text outside any block element (a bare <article> of text and <br>s) would be missed
            // above; fall back to the whole body when the blocks hold much less than it does.
            var bodyWords = CountWords(body.TextContent);
            if (bodyWords > 0 && blocks.Sum(b => CountWords(b.Text)) < bodyWords * 0.4)
            {
                foreach (var element in body.QuerySelectorAll(FallbackBreakSelector).ToList())
                {
                    element.After(document.CreateTextNode("\n\n"));
                }
                blocks = SplitParagraphs(body.TextContent)
                    .Select(text => (text, false))
                    .ToList();
            }

            return Clean(blocks, titles);
        }

        private static IReadOnlyList<string> Clean(List<(string Text, bool IsHeading)> blocks, string?[] titles)
        {
            var kept = new List<(string Text, bool IsHeading)>();
            // Titles count as seen, so a block repeating one is dropped like any repeat.
            var seen = new HashSet<string>(titles.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t!.Trim()), StringComparer.OrdinalIgnoreCase);
            foreach (var block in blocks)
            {
                if (IsLabel(block.Text)) continue;
                if (PhotoCredit.IsMatch(block.Text)) continue;
                if (!seen.Add(block.Text)) continue;
                kept.Add(block);
            }

            // A heading or "…:" lead-in with nothing after it introduced something that was removed.
            while (kept.Count > 0 && (kept[^1].IsHeading || kept[^1].Text.EndsWith(':')))
            {
                kept.RemoveAt(kept.Count - 1);
            }
            return kept.Select(b => b.Text).ToList();
        }

        // Short text that isn't a sentence: "Mais lidas", "LEIA TAMBÉM:", "Author,", a tag name.
        private static bool IsLabel(string text)
        {
            if (CountWords(text) >= 4) return false;
            var last = text[^1];
            return !(last is '.' or '!' or '?' or '…' or '"' or '\'' or '”' or '’' or '»' or ')' or ']');
        }

        // "Pule Mais lidas e continue lendo", "Leia mais: <headline>", a list of related links.
        private static bool IsMostlyLinks(IElement element)
        {
            var textLength = element.TextContent.Trim().Length;
            if (textLength == 0) return false;
            var linkLength = element.QuerySelectorAll("a").Sum(a => a.TextContent.Trim().Length);
            return linkLength >= textLength * 0.7;
        }

        private static IEnumerable<string> SplitParagraphs(string text)
        {
            foreach (var part in ParagraphBreak.Split(text.Replace("\r\n", "\n")))
            {
                var paragraph = Spaces.Replace(part.Replace('\n', ' '), " ").Trim();
                if (paragraph.Length > 0 && CountWords(paragraph) > 0)
                {
                    yield return paragraph;
                }
            }
        }
    }
}
