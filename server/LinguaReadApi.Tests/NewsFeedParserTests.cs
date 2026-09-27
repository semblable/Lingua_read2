using System.Text;
using LinguaReadApi.Services.News;
using Xunit;

namespace LinguaReadApi.Tests;

public class NewsFeedParserTests
{
    private static readonly Uri FeedUrl = new("https://news.example.com/rss");

    [Fact]
    public void Rss_TakesTheRealLinkOverAnEarlierAtomLink_AndUnwrapsEscapedCdataTitles()
    {
        // Correio da Manhã's feed, as served: ISO-8859-1, an empty atom:link before <link>, and the
        // title's CDATA wrapper escaped so it survives XML parsing as text.
        var xml = """
            <?xml version="1.0" encoding="iso-8859-1"?>
            <rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">
              <channel>
                <title>Correio da Manhã</title>
                <language>pt-pt</language>
                <item>
                  <guid isPermaLink="false">cm-1</guid>
                  <title>&lt;![CDATA[ Pelo menos 19 mortos por consumo de álcool adulterado na Índia ]]&gt;</title>
                  <pubDate>Sun, 27 Sep 2026 12:42:56 +0100</pubDate>
                  <atom:link href="https://www.cmjornal.pt/mundo/detalhe/pelo-menos-19-mortos" />
                  <link>https://www.cmjornal.pt/mundo/detalhe/pelo-menos-19-mortos</link>
                </item>
              </channel>
            </rss>
            """;

        Assert.True(FeedParser.TryParse(Encoding.Latin1.GetBytes(xml), FeedUrl, out var feed));

        Assert.Equal("Correio da Manhã", feed.Title);
        Assert.Equal("pt-pt", feed.Language);
        var entry = Assert.Single(feed.Entries);
        Assert.Equal("cm-1", entry.Key);
        Assert.Equal("Pelo menos 19 mortos por consumo de álcool adulterado na Índia", entry.Title);
        Assert.Equal(new Uri("https://www.cmjornal.pt/mundo/detalhe/pelo-menos-19-mortos"), entry.Link);
        Assert.Equal(new DateTimeOffset(2026, 9, 27, 11, 42, 56, TimeSpan.Zero), entry.PublishedAt);
    }

    [Fact]
    public void Rss_OrdersNewestFirst_ResolvesRelativeLinks_AndKeepsContentEncoded()
    {
        var xml = """
            <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
              <channel>
                <title>Example</title>
                <item><title>Old</title><link>/old</link><pubDate>Fri, 25 Sep 2026 08:00:00 GMT</pubDate></item>
                <item><title>Undated</title><link>/undated</link></item>
                <item>
                  <title>New</title><link>https://news.example.com/new</link>
                  <pubDate>Sun, 27 Sep 2026 08:00:00 BRT</pubDate>
                  <content:encoded><![CDATA[<p>Full text.</p>]]></content:encoded>
                </item>
                <item><title>No link or content</title><guid isPermaLink="false">x</guid></item>
              </channel>
            </rss>
            """;

        Assert.True(FeedParser.TryParse(Encoding.UTF8.GetBytes(xml), FeedUrl, out var feed));

        Assert.Equal(["New", "Old", "Undated"], feed.Entries.Select(e => e.Title));
        Assert.Equal(new Uri("https://news.example.com/old"), feed.Entries[1].Link);
        // No guid: the link is the key.
        Assert.Equal("https://news.example.com/old", feed.Entries[1].Key);
        Assert.Equal("<p>Full text.</p>", feed.Entries[0].ContentHtml);
        Assert.Equal(new DateTimeOffset(2026, 9, 27, 11, 0, 0, TimeSpan.Zero), feed.Entries[0].PublishedAt);
    }

    [Fact]
    public void Rss_UsesAPermalinkGuidWhenThereIsNoLink()
    {
        var xml = """
            <rss version="2.0"><channel><title>T</title>
              <item><title>A</title><guid>https://news.example.com/a</guid></item>
            </channel></rss>
            """;

        Assert.True(FeedParser.TryParse(Encoding.UTF8.GetBytes(xml), FeedUrl, out var feed));

        Assert.Equal(new Uri("https://news.example.com/a"), Assert.Single(feed.Entries).Link);
    }

    [Fact]
    public void Atom_ReadsAlternateLinksIdsDatesAndContent()
    {
        var xml = """
            <feed xmlns="http://www.w3.org/2005/Atom" xml:lang="fr">
              <title type="text">Le Blog</title>
              <entry>
                <id>tag:example.com,2026:1</id>
                <title type="html">Premier &lt;b&gt;article&lt;/b&gt;</title>
                <link rel="self" href="https://example.com/api/1"/>
                <link rel="alternate" href="https://example.com/1"/>
                <updated>2026-09-26T10:00:00Z</updated>
                <content type="html">&lt;p&gt;Bonjour.&lt;/p&gt;</content>
              </entry>
              <entry>
                <id>tag:example.com,2026:2</id>
                <title>Deuxième</title>
                <link href="https://example.com/2"/>
                <published>2026-09-27T10:00:00+02:00</published>
                <content>Ligne un.

            Ligne deux.</content>
              </entry>
            </feed>
            """;

        Assert.True(FeedParser.TryParse(Encoding.UTF8.GetBytes(xml), FeedUrl, out var feed));

        Assert.Equal("Le Blog", feed.Title);
        Assert.Equal("fr", feed.Language);
        Assert.Equal(["Deuxième", "Premier article"], feed.Entries.Select(e => e.Title));
        Assert.Equal(new Uri("https://example.com/1"), feed.Entries[1].Link);
        Assert.Equal("tag:example.com,2026:1", feed.Entries[1].Key);
        Assert.Equal("<p>Bonjour.</p>", feed.Entries[1].ContentHtml);
        // Plain-text content keeps its paragraphs.
        Assert.Equal("<p>Ligne un.</p><p>Ligne deux.</p>", feed.Entries[0].ContentHtml);
    }

    [Fact]
    public void Rdf_ReadsRss1Items()
    {
        var xml = """
            <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
                     xmlns:dc="http://purl.org/dc/elements/1.1/">
              <channel rdf:about="https://example.org/"><title>RDF news</title><dc:language>de</dc:language></channel>
              <item rdf:about="https://example.org/a">
                <title>Ein Artikel</title><link>https://example.org/a</link><dc:date>2026-09-27T06:00:00Z</dc:date>
              </item>
            </rdf:RDF>
            """;

        Assert.True(FeedParser.TryParse(Encoding.UTF8.GetBytes(xml), FeedUrl, out var feed));

        Assert.Equal("RDF news", feed.Title);
        Assert.Equal("de", feed.Language);
        var entry = Assert.Single(feed.Entries);
        Assert.Equal("https://example.org/a", entry.Key);
        Assert.Equal(new DateTimeOffset(2026, 9, 27, 6, 0, 0, TimeSpan.Zero), entry.PublishedAt);
    }

    [Theory]
    [InlineData("<!DOCTYPE html><html><head><title>Not a feed</title></head><body></body></html>")]
    [InlineData("{\"items\": []}")]
    [InlineData("<rss><broken></rss>")]
    [InlineData("<html><body>An XHTML page</body></html>")]
    public void TryParse_RejectsWhatIsNotAFeed(string body)
    {
        Assert.False(FeedParser.TryParse(Encoding.UTF8.GetBytes(body), FeedUrl, out _));
    }

    [Fact]
    public void TryParse_DoesNotExpandEntitiesFromADtd()
    {
        var xml = """
            <?xml version="1.0"?>
            <!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>
            <rss version="2.0"><channel><title>&b;</title></channel></rss>
            """;

        // The DTD is ignored, so its entities are undeclared: not a usable feed.
        Assert.False(FeedParser.TryParse(Encoding.UTF8.GetBytes(xml), FeedUrl, out _));
    }

    [Fact]
    public void DiscoverFeedLinks_FindsAdvertisedFeeds()
    {
        var html = """
            <html><head>
              <link rel="stylesheet" href="/site.css">
              <link rel="alternate" type="application/rss+xml" title="Últimas" href="/rss/ultimas.xml">
              <link rel="alternate" type="application/atom+xml" href="https://news.example.com/atom">
              <link rel="alternate" hreflang="en" href="/en/">
            </head><body></body></html>
            """;

        var links = FeedParser.DiscoverFeedLinks(html, new Uri("https://news.example.com/portugues/"));

        Assert.Equal(
            [new Uri("https://news.example.com/rss/ultimas.xml"), new Uri("https://news.example.com/atom")],
            links);
    }

    [Theory]
    [InlineData("Sun, 27 Sep 2026 12:42:56 +0100", "2026-09-27T11:42:56Z")]
    [InlineData("Sun, 27 Sep 2026 12:42:56 GMT", "2026-09-27T12:42:56Z")]
    [InlineData("Sun, 27 Sep 2026 12:42:56 EST", "2026-09-27T17:42:56Z")]
    [InlineData("Mon, 27 Sep 2026 12:42:56 +0000", "2026-09-27T12:42:56Z")] // wrong weekday
    [InlineData("2026-09-27T12:42:56-03:00", "2026-09-27T15:42:56Z")]
    [InlineData("2026-09-27 12:42", "2026-09-27T12:42:00Z")]
    public void ParseDate_ReadsFeedDates(string value, string expectedUtc)
    {
        Assert.Equal(DateTimeOffset.Parse(expectedUtc), FeedParser.ParseDate(value));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("yesterday")]
    public void ParseDate_ReturnsNullForUnreadableDates(string? value)
    {
        Assert.Null(FeedParser.ParseDate(value));
    }

    [Fact]
    public void Rss_ReadsEachEntrysPicture_FromMediaRssAndImageEnclosures()
    {
        // Shapes from g1 (media:content medium="image"), Le Monde (media:content with only a size),
        // BBC (a 240 px media:thumbnail) and Correio da Manhã (an image enclosure).
        var xml = """
            <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:m2="http://search.yahoo.com/mrss">
              <channel>
                <title>Pictures</title>
                <item><guid>g1</guid><link>/g1</link>
                  <media:content url="https://img.example.com/g1.jpg?a=1&amp;b=2" medium="image"/></item>
                <item><guid>lemonde</guid><link>/lemonde</link>
                  <media:content width="644" height="322" url="/img/lemonde.JPG"/></item>
                <item><guid>bbc</guid><link>/bbc</link>
                  <media:thumbnail width="240" height="135" url="https://img.example.com/bbc-240.jpg"/></item>
                <item><guid>cm</guid><link>/cm</link>
                  <enclosure url="https://img.example.com/cm.jpg" length="0" type="image/jpeg"/></item>
                <item><guid>podcast</guid><link>/podcast</link>
                  <enclosure url="https://img.example.com/episode.mp3" length="1000" type="audio/mpeg"/></item>
                <item><guid>video</guid><link>/video</link>
                  <media:content url="https://img.example.com/clip.mp4" medium="video"/>
                  <media:content url="https://img.example.com/clip.m3u8" type="application/x-mpegURL"/>
                  <media:thumbnail width="640" height="360" url="https://img.example.com/clip.jpg"/></item>
                <item><guid>group</guid><link>/group</link>
                  <media:group>
                    <media:content url="https://img.example.com/small.jpg" width="320" medium="image"/>
                    <media:content url="https://img.example.com/large.jpg" width="1280" medium="image"/>
                  </media:group></item>
                <item><guid>no-slash</guid><link>/no-slash</link>
                  <m2:content url="https://img.example.com/no-slash.jpg" type="image/jpeg"/></item>
              </channel>
            </rss>
            """;

        Assert.True(FeedParser.TryParse(Encoding.UTF8.GetBytes(xml), FeedUrl, out var feed));

        var images = feed.Entries.ToDictionary(e => e.Key, e => e.ImageUrl?.AbsoluteUri);
        Assert.Equal("https://img.example.com/g1.jpg?a=1&b=2", images["g1"]);
        Assert.Equal("https://news.example.com/img/lemonde.JPG", images["lemonde"]);
        Assert.Null(images["bbc"]); // too small to show
        Assert.Equal("https://img.example.com/cm.jpg", images["cm"]);
        Assert.Null(images["podcast"]);
        Assert.Equal("https://img.example.com/clip.jpg", images["video"]);
        Assert.Equal("https://img.example.com/large.jpg", images["group"]);
        Assert.Equal("https://img.example.com/no-slash.jpg", images["no-slash"]);
    }

    [Fact]
    public void Atom_ReadsAnImageEnclosureLink()
    {
        var xml = """
            <feed xmlns="http://www.w3.org/2005/Atom">
              <title>Atom pictures</title>
              <entry>
                <id>tag:example.com,2026:1</id><title>One</title>
                <link rel="alternate" href="https://news.example.com/1"/>
                <link rel="enclosure" type="image/png" href="https://img.example.com/1.png"/>
              </entry>
            </feed>
            """;

        Assert.True(FeedParser.TryParse(Encoding.UTF8.GetBytes(xml), FeedUrl, out var feed));

        var entry = Assert.Single(feed.Entries);
        Assert.Equal(new Uri("https://news.example.com/1"), entry.Link);
        Assert.Equal(new Uri("https://img.example.com/1.png"), entry.ImageUrl);
    }
}
