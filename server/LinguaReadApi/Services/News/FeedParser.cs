using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using AngleSharp.Html.Parser;

namespace LinguaReadApi.Services.News
{
    /// <summary>One entry of a feed. <see cref="Key"/> identifies it across fetches (guid/id, else link).</summary>
    public sealed record FeedEntry(string Key, Uri? Link, string Title, DateTimeOffset? PublishedAt, string? ContentHtml);

    public sealed record ParsedFeed(string? Title, string? Language, IReadOnlyList<FeedEntry> Entries);

    /// <summary>
    /// Reads RSS 2.0, RSS 1.0 (RDF) and Atom. Entries come back newest first (undated ones last, in
    /// feed order). Forgiving about what real feeds get wrong: an atom:link before the real link,
    /// relative links, titles with escaped CDATA, time zones written as names.
    /// </summary>
    public static class FeedParser
    {
        public const int MaxEntries = 200;

        private static readonly XNamespace Atom = "http://www.w3.org/2005/Atom";
        private static readonly XNamespace Rss1 = "http://purl.org/rss/1.0/";
        private static readonly XNamespace Rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
        private static readonly XNamespace Content = "http://purl.org/rss/1.0/modules/content/";
        private static readonly XNamespace Dc = "http://purl.org/dc/elements/1.1/";

        /// <summary>
        /// Parses <paramref name="body"/> as a feed. False when it isn't well-formed XML or its root
        /// isn't rss, rdf:RDF or an Atom feed (an HTML page, say).
        /// </summary>
        public static bool TryParse(byte[] body, Uri baseUrl, out ParsedFeed feed)
        {
            feed = new ParsedFeed(null, null, Array.Empty<FeedEntry>());
            XDocument document;
            try
            {
                var settings = new XmlReaderSettings
                {
                    // Feeds never need a DTD; ignoring it also rules out entity expansion attacks.
                    DtdProcessing = DtdProcessing.Ignore,
                    XmlResolver = null,
                    IgnoreComments = true,
                    IgnoreProcessingInstructions = true,
                    MaxCharactersInDocument = NewsFetcher.MaxBytes * 2L
                };
                using var reader = XmlReader.Create(new MemoryStream(body), settings);
                document = XDocument.Load(reader);
            }
            catch (XmlException)
            {
                return false;
            }

            var root = document.Root;
            if (root == null) return false;

            switch (root.Name.LocalName)
            {
                case "rss":
                    var channel = root.Element("channel");
                    if (channel == null) return false;
                    feed = Build(
                        Text(channel.Element("title")),
                        Text(channel.Element("language")) ?? Text(channel.Element(Dc + "language")),
                        channel.Elements("item").Select(item => RssEntry(item, baseUrl)));
                    return true;

                case "RDF":
                    var rdfChannel = root.Element(Rss1 + "channel");
                    feed = Build(
                        Text(rdfChannel?.Element(Rss1 + "title")),
                        Text(rdfChannel?.Element(Dc + "language")),
                        root.Elements(Rss1 + "item").Select(item => RdfEntry(item, baseUrl)));
                    return true;

                case "feed" when root.Name.Namespace == Atom:
                    feed = Build(
                        Text(root.Element(Atom + "title")),
                        (string?)root.Attribute(XNamespace.Xml + "lang"),
                        root.Elements(Atom + "entry").Select(entry => AtomEntry(entry, baseUrl)));
                    return true;

                default:
                    return false;
            }
        }

        /// <summary>
        /// The feeds a web page advertises (&lt;link rel="alternate" type="application/rss+xml"&gt;),
        /// so a site's home page can be given instead of its feed address.
        /// </summary>
        public static IReadOnlyList<Uri> DiscoverFeedLinks(string html, Uri pageUrl)
        {
            var document = new HtmlParser().ParseDocument(html);
            return document.QuerySelectorAll("link[href]")
                .Where(link => (link.GetAttribute("rel") ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Any(rel => rel.Equals("alternate", StringComparison.OrdinalIgnoreCase)))
                .Where(link => (link.GetAttribute("type") ?? "").ToLowerInvariant() is
                    "application/rss+xml" or "application/atom+xml" or "application/rdf+xml" or "application/xml" or "text/xml")
                .Select(link => ResolveLink(link.GetAttribute("href"), pageUrl))
                .Where(url => url != null)
                .Select(url => url!)
                .Distinct()
                .ToList();
        }

        private static ParsedFeed Build(string? title, string? language, IEnumerable<FeedEntry?> entries)
        {
            var ordered = entries
                .Where(e => e != null)
                .Select(e => e!)
                .Take(MaxEntries)
                .Select((entry, index) => (entry, index))
                .OrderByDescending(x => x.entry.PublishedAt.HasValue)
                .ThenByDescending(x => x.entry.PublishedAt)
                .ThenBy(x => x.index)
                .Select(x => x.entry)
                .ToList();
            return new ParsedFeed(CleanTitle(title), language?.Trim(), ordered);
        }

        private static FeedEntry? RssEntry(XElement item, Uri baseUrl)
        {
            var guid = item.Element("guid");
            var guidText = Text(guid);
            var guidIsLink = !string.Equals((string?)guid?.Attribute("isPermaLink"), "false", StringComparison.OrdinalIgnoreCase);

            var link = ResolveLink(Text(item.Element("link")), baseUrl)
                ?? ResolveLink(AtomLinkHref(item), baseUrl)
                ?? (guidIsLink ? ResolveLink(guidText, baseUrl) : null);

            return Entry(
                key: guidText ?? link?.AbsoluteUri,
                link: link,
                title: Text(item.Element("title")),
                published: ParseDate(Text(item.Element("pubDate")) ?? Text(item.Element(Dc + "date"))),
                content: Text(item.Element(Content + "encoded")));
        }

        private static FeedEntry? RdfEntry(XElement item, Uri baseUrl)
        {
            var link = ResolveLink(Text(item.Element(Rss1 + "link")), baseUrl)
                ?? ResolveLink((string?)item.Attribute(Rdf + "about"), baseUrl);
            return Entry(
                key: (string?)item.Attribute(Rdf + "about") ?? link?.AbsoluteUri,
                link: link,
                title: Text(item.Element(Rss1 + "title")),
                published: ParseDate(Text(item.Element(Dc + "date"))),
                content: Text(item.Element(Content + "encoded")));
        }

        private static FeedEntry? AtomEntry(XElement entry, Uri baseUrl)
        {
            var link = ResolveLink(AtomLinkHref(entry), baseUrl);
            var content = entry.Element(Atom + "content");
            return Entry(
                key: Text(entry.Element(Atom + "id")) ?? link?.AbsoluteUri,
                link: link,
                title: Text(entry.Element(Atom + "title")),
                published: ParseDate(Text(entry.Element(Atom + "published")) ?? Text(entry.Element(Atom + "updated"))),
                // Text content (type="text") is plain; html/xhtml content is markup either way.
                content: content == null ? null
                    : (string?)content.Attribute("type") == "xhtml" ? string.Concat(content.Nodes().Select(n => n.ToString()))
                    : (string?)content.Attribute("type") is null or "text" ? PlainTextToHtml(content.Value)
                    : content.Value);
        }

        private static FeedEntry? Entry(string? key, Uri? link, string? title, DateTimeOffset? published, string? content)
        {
            if (string.IsNullOrWhiteSpace(key) || (link == null && string.IsNullOrWhiteSpace(content)))
            {
                return null;
            }
            return new FeedEntry(key.Trim(), link, CleanTitle(title) ?? "", published, string.IsNullOrWhiteSpace(content) ? null : content);
        }

        // Plain text as paragraphs, so the article keeps its paragraph breaks.
        private static string PlainTextToHtml(string text) =>
            string.Concat(Regex.Split(text.Trim(), @"\r?\n\s*\r?\n")
                .Select(paragraph => "<p>" + WebUtility.HtmlEncode(paragraph.Trim()) + "</p>"));

        // The alternate (article) link of an Atom entry or of an RSS item that uses atom:link.
        private static string? AtomLinkHref(XElement parent)
        {
            var links = parent.Elements(Atom + "link").ToList();
            var alternate = links.FirstOrDefault(l => (string?)l.Attribute("rel") is null or "alternate");
            return (string?)alternate?.Attribute("href");
        }

        private static Uri? ResolveLink(string? value, Uri baseUrl)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            return Uri.TryCreate(baseUrl, value.Trim(), out var url) && NewsFetcher.IsWebUrl(url) ? url : null;
        }

        private static string? Text(XElement? element)
        {
            var value = element?.Value.Trim();
            return string.IsNullOrEmpty(value) ? null : value;
        }

        // Only things shaped like tags, so "x < y" in a plain-text title survives.
        private static readonly Regex Tags = new(@"</?[A-Za-z][^<>]*>", RegexOptions.CultureInvariant);
        private static readonly Regex EscapedCdata = new(@"^\s*<!\[CDATA\[(.*)\]\]>\s*$", RegexOptions.Singleline | RegexOptions.CultureInvariant);
        private static readonly Regex Whitespace = new(@"\s+", RegexOptions.CultureInvariant);

        /// <summary>A title as plain text: no tags or entities, whitespace collapsed.</summary>
        public static string? CleanTitle(string? title)
        {
            if (string.IsNullOrWhiteSpace(title)) return null;
            // Some feeds escape the CDATA wrapper itself, so it survives XML parsing as text.
            var match = EscapedCdata.Match(title);
            if (match.Success) title = match.Groups[1].Value;
            // Tags go before and after decoding: HTML titles are sometimes escaped twice.
            var decoded = WebUtility.HtmlDecode(Tags.Replace(title, " "));
            var text = Whitespace.Replace(Tags.Replace(decoded, " "), " ").Trim();
            return text.Length == 0 ? null : text;
        }

        private static readonly Dictionary<string, string> ZoneNames = new(StringComparer.OrdinalIgnoreCase)
        {
            ["UT"] = "+00:00", ["UTC"] = "+00:00", ["GMT"] = "+00:00", ["Z"] = "+00:00",
            ["WET"] = "+00:00", ["WEST"] = "+01:00", ["CET"] = "+01:00", ["CEST"] = "+02:00",
            ["EST"] = "-05:00", ["EDT"] = "-04:00", ["CST"] = "-06:00", ["CDT"] = "-05:00",
            ["MST"] = "-07:00", ["MDT"] = "-06:00", ["PST"] = "-08:00", ["PDT"] = "-07:00",
            ["BRT"] = "-03:00", ["BRST"] = "-02:00"
        };

        private static readonly Regex TrailingZone = new(@"\s([A-Za-z]{1,5})$", RegexOptions.CultureInvariant);
        private static readonly Regex LeadingWeekday = new(@"^[A-Za-z]{2,}\s*,\s*", RegexOptions.CultureInvariant);

        /// <summary>RFC 822 (RSS) or ISO 8601 (Atom, dc:date) dates; null when unreadable.</summary>
        public static DateTimeOffset? ParseDate(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var text = value.Trim();
            const DateTimeStyles styles = DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.AssumeUniversal;
            if (DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, styles, out var parsed))
            {
                return parsed;
            }

            // "Sun, 27 Sep 2026 12:42:56 BRT": replace the zone name with an offset, and drop the
            // weekday (a wrong or localised weekday otherwise fails the whole date).
            var zone = TrailingZone.Match(text);
            if (zone.Success && ZoneNames.TryGetValue(zone.Groups[1].Value, out var offset))
            {
                text = text[..zone.Index] + " " + offset;
            }
            text = LeadingWeekday.Replace(text, "");
            return DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, styles, out parsed) ? parsed : null;
        }
    }
}
