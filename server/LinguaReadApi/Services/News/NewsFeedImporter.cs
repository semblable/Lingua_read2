using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services.News
{
    /// <summary>A feed found at an address the user gave: the feed itself, or one its page links to.</summary>
    public sealed record FeedDiscovery(Uri FeedUrl, ParsedFeed Feed);

    public sealed record NewsImportResult(bool Success, int Imported, int Skipped, string Message);

    /// <summary>
    /// One check per feed at a time: the background service and "Fetch now" could otherwise import
    /// the same entries twice. A singleton, shared by every importer.
    /// </summary>
    public sealed class NewsFeedLocks
    {
        private readonly ConcurrentDictionary<int, SemaphoreSlim> _locks = new();

        public SemaphoreSlim For(int newsFeedId) => _locks.GetOrAdd(newsFeedId, _ => new SemaphoreSlim(1, 1));
    }

    /// <summary>
    /// Imports new articles of one feed as texts: newest first, at most the user's daily number per
    /// feed, each entry only once (<see cref="NewsFeedItem"/>). Articles go to News › &lt;feed title&gt;
    /// and are word-linked in the background like any pasted text.
    /// </summary>
    public sealed class NewsFeedImporter
    {
        // Shorter extracts are usually a teaser in front of a paywall, a video page or a gallery.
        public const int MinArticleWords = 120;

        // Article pages fetched per check at most, so a feed full of paywalled or broken links
        // can't keep the importer busy.
        public const int MaxPagesPerCheck = 10;

        public const string RootFolderName = "News";

        // Seen entries are forgotten once they have been out of the feed this long.
        public static readonly TimeSpan ForgetAfter = TimeSpan.FromDays(30);

        private readonly AppDbContext _context;
        private readonly NewsFetcher _fetcher;
        private readonly WordLinkingChannel _wordLinkingChannel;
        private readonly NewsFeedLocks _locks;
        private readonly ILogger<NewsFeedImporter> _logger;
        private readonly TimeProvider _timeProvider;

        public NewsFeedImporter(
            AppDbContext context,
            NewsFetcher fetcher,
            WordLinkingChannel wordLinkingChannel,
            NewsFeedLocks locks,
            ILogger<NewsFeedImporter> logger,
            TimeProvider? timeProvider = null)
        {
            _context = context;
            _fetcher = fetcher;
            _wordLinkingChannel = wordLinkingChannel;
            _locks = locks;
            _logger = logger;
            _timeProvider = timeProvider ?? TimeProvider.System;
        }

        private DateTime UtcNow => _timeProvider.GetUtcNow().UtcDateTime;

        /// <summary>
        /// Loads the feed at <paramref name="url"/>, or, for a web page, the first feed it links to.
        /// Throws <see cref="NewsFetchException"/> with a message for the user when there is none.
        /// </summary>
        public async Task<FeedDiscovery> DiscoverAsync(Uri url, CancellationToken cancellationToken)
        {
            var document = await _fetcher.GetAsync(url, cancellationToken);
            if (FeedParser.TryParse(document.Body, document.FinalUrl, out var feed))
            {
                return new FeedDiscovery(document.FinalUrl, feed);
            }

            foreach (var link in FeedParser.DiscoverFeedLinks(document.DecodeText(), document.FinalUrl).Take(3))
            {
                try
                {
                    var linked = await _fetcher.GetAsync(link, cancellationToken);
                    if (FeedParser.TryParse(linked.Body, linked.FinalUrl, out var linkedFeed))
                    {
                        return new FeedDiscovery(linked.FinalUrl, linkedFeed);
                    }
                }
                catch (NewsFetchException)
                {
                    // Try the page's next feed link.
                }
            }
            throw new NewsFetchException("That address isn't an RSS or Atom feed, and the page doesn't link to one.");
        }

        /// <summary>Checks one feed now. Never throws for feed or network problems; they end up in the result.</summary>
        public async Task<NewsImportResult> ImportAsync(int newsFeedId, CancellationToken cancellationToken)
        {
            var gate = _locks.For(newsFeedId);
            if (!await gate.WaitAsync(0, cancellationToken))
            {
                return new NewsImportResult(false, 0, 0, "This feed is being checked right now. Try again in a minute.");
            }
            try
            {
                return await ImportLockedAsync(newsFeedId, cancellationToken);
            }
            finally
            {
                gate.Release();
            }
        }

        private async Task<NewsImportResult> ImportLockedAsync(int newsFeedId, CancellationToken cancellationToken)
        {
            var feed = await _context.NewsFeeds.FirstOrDefaultAsync(f => f.NewsFeedId == newsFeedId, cancellationToken);
            if (feed == null)
            {
                return new NewsImportResult(false, 0, 0, "Feed not found.");
            }
            var perDay = Math.Clamp(
                await _context.UserSettings
                    .Where(s => s.UserId == feed.UserId)
                    .Select(s => (int?)s.NewsArticlesPerFeedPerDay)
                    .FirstOrDefaultAsync(cancellationToken) ?? 3,
                1, 20);

            var now = UtcNow;
            feed.LastCheckedAt = now;

            ParsedFeed parsed;
            try
            {
                var document = await _fetcher.GetAsync(new Uri(feed.Url), cancellationToken);
                if (!FeedParser.TryParse(document.Body, document.FinalUrl, out parsed))
                {
                    throw new NewsFetchException("The address no longer returns an RSS or Atom feed.");
                }
            }
            catch (Exception ex) when (ex is NewsFetchException or UriFormatException)
            {
                feed.LastError = Truncate(ex.Message, NewsFeed.MaxErrorLength);
                feed.ConsecutiveFailures++;
                await _context.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("News feed {FeedId} check failed: {Reason}", feed.NewsFeedId, ex.Message);
                return new NewsImportResult(false, 0, 0, ex.Message);
            }

            var entries = parsed.Entries
                .Select(entry => (Entry: entry, Key: HashKey(entry.Key)))
                .DistinctBy(x => x.Key)
                .ToList();
            var keys = entries.Select(x => x.Key).ToList();
            var known = await _context.NewsFeedItems
                .Where(i => i.NewsFeedId == feed.NewsFeedId && keys.Contains(i.ItemKey))
                .ToListAsync(cancellationToken);
            foreach (var item in known)
            {
                item.LastSeenAt = now;
            }
            var knownKeys = known.Select(i => i.ItemKey).ToHashSet();

            var dayAgo = now.AddDays(-1);
            var importedLastDay = await _context.NewsFeedItems.CountAsync(
                i => i.NewsFeedId == feed.NewsFeedId && i.Imported && i.FirstSeenAt > dayAgo, cancellationToken);
            var room = perDay - importedLastDay;

            var imported = new List<Text>();
            var skipped = 0;
            var pagesFetched = 0;
            int? folderId = null;
            foreach (var (entry, key) in entries.Where(x => !knownKeys.Contains(x.Key)))
            {
                if (imported.Count >= room) break;

                var article = ArticleFromFeed(entry);
                if (article == null && entry.Link != null)
                {
                    if (pagesFetched >= MaxPagesPerCheck) break;
                    pagesFetched++;
                    article = await ReadPageAsync(entry.Link, entry.Title, cancellationToken);
                }

                var item = new NewsFeedItem { NewsFeedId = feed.NewsFeedId, ItemKey = key, FirstSeenAt = now, LastSeenAt = now };
                _context.NewsFeedItems.Add(item);
                if (article == null || article.WordCount < MinArticleWords)
                {
                    skipped++;
                    continue;
                }

                item.Imported = true;
                folderId ??= await EnsureFolderAsync(feed, now, cancellationToken);
                var text = new Text
                {
                    Title = Truncate(
                        !string.IsNullOrEmpty(entry.Title) ? entry.Title : article.Title ?? entry.Link?.Host ?? feed.Title,
                        200),
                    Content = article.Content,
                    LanguageId = feed.LanguageId,
                    UserId = feed.UserId,
                    FolderId = folderId,
                    CreatedAt = now,
                    LastAccessedAt = null,
                    WordLinkingStatus = "processing",
                    NewsFeedId = feed.NewsFeedId,
                    SourceUrl = entry.Link?.AbsoluteUri is { Length: <= NewsFeed.MaxUrlLength } link ? link : null
                };
                _context.Texts.Add(text);
                imported.Add(text);
            }

            if (imported.Count > 0)
            {
                // Newest on top of the folder in its manual order: a lower SortOrder than everything
                // already there (the query only sees saved texts), the newest lowest.
                var sortOrder = await _context.Texts
                    .Where(t => t.FolderId == folderId)
                    .MinAsync(t => (int?)t.SortOrder, cancellationToken) ?? 0;
                for (var i = imported.Count - 1; i >= 0; i--)
                {
                    imported[i].SortOrder = --sortOrder;
                }
            }

            feed.LastSuccessAt = now;
            feed.LastError = null;
            feed.ConsecutiveFailures = 0;

            // The database still has the old LastSeenAt of the entries touched above, so those are
            // excluded by key.
            var forgetBefore = now - ForgetAfter;
            _context.NewsFeedItems.RemoveRange(await _context.NewsFeedItems
                .Where(i => i.NewsFeedId == feed.NewsFeedId && i.LastSeenAt < forgetBefore && !keys.Contains(i.ItemKey))
                .ToListAsync(cancellationToken));

            await _context.SaveChangesAsync(cancellationToken);

            foreach (var text in imported)
            {
                await _wordLinkingChannel.Writer.WriteAsync(
                    new WordLinkingRequest(text.TextId, text.Content, text.LanguageId, text.UserId), cancellationToken);
            }

            if (imported.Count > 0 || skipped > 0)
            {
                _logger.LogInformation("News feed {FeedId}: imported {Imported}, skipped {Skipped}", feed.NewsFeedId, imported.Count, skipped);
            }
            return new NewsImportResult(true, imported.Count, skipped, ResultMessage(imported.Count, skipped, room, perDay));
        }

        private static string ResultMessage(int imported, int skipped, int room, int perDay)
        {
            var skippedNote = skipped == 0 ? ""
                : skipped == 1 ? " Skipped 1 that was too short or couldn't be read."
                : $" Skipped {skipped} that were too short or couldn't be read.";
            if (imported > 0)
            {
                return (imported == 1 ? "Imported 1 article." : $"Imported {imported} articles.") + skippedNote;
            }
            if (room <= 0)
            {
                return $"Already imported {perDay} {(perDay == 1 ? "article" : "articles")} from this feed in the last 24 hours, the daily limit.";
            }
            return skipped > 0 ? "No new articles long enough to import." + skippedNote : "No new articles.";
        }

        // Feeds that carry whole articles (content:encoded) spare fetching the page.
        private static ExtractedArticle? ArticleFromFeed(FeedEntry entry)
        {
            if (entry.ContentHtml == null) return null;
            var article = new ExtractedArticle(entry.Title, ArticleExtractor.ToParagraphs(entry.ContentHtml, entry.Title));
            return article.WordCount >= MinArticleWords || entry.Link == null ? article : null;
        }

        private async Task<ExtractedArticle?> ReadPageAsync(Uri link, string title, CancellationToken cancellationToken)
        {
            try
            {
                var page = await _fetcher.GetAsync(link, cancellationToken);
                if (page.MediaType != null && !page.MediaType.Contains("html", StringComparison.OrdinalIgnoreCase))
                {
                    return null;
                }
                return ArticleExtractor.FromPage(page.DecodeText(), page.FinalUrl, title);
            }
            catch (NewsFetchException ex)
            {
                _logger.LogDebug("News article {Url} skipped: {Reason}", link, ex.Message);
                return null;
            }
        }

        /// <summary>
        /// The folder the feed's articles go to: its own, else News › &lt;feed title&gt; (made if
        /// missing, reused if the user already has one by that name).
        /// </summary>
        private async Task<int> EnsureFolderAsync(NewsFeed feed, DateTime now, CancellationToken cancellationToken)
        {
            if (feed.FolderId is int existing &&
                await _context.Folders.AnyAsync(f => f.FolderId == existing && f.UserId == feed.UserId, cancellationToken))
            {
                return existing;
            }

            var root = await _context.Folders
                .Where(f => f.UserId == feed.UserId && f.ParentFolderId == null && f.Name == RootFolderName)
                .OrderBy(f => f.FolderId)
                .FirstOrDefaultAsync(cancellationToken);
            if (root == null)
            {
                root = new Folder
                {
                    Name = RootFolderName,
                    UserId = feed.UserId,
                    SortOrder = await NextFolderSortOrderAsync(feed.UserId, null, cancellationToken),
                    CreatedAt = now
                };
                _context.Folders.Add(root);
                await _context.SaveChangesAsync(cancellationToken);
            }

            var name = Truncate(feed.Title, NewsFeed.MaxTitleLength);
            var folder = await _context.Folders
                .Where(f => f.UserId == feed.UserId && f.ParentFolderId == root.FolderId && f.Name == name)
                .OrderBy(f => f.FolderId)
                .FirstOrDefaultAsync(cancellationToken);
            if (folder == null)
            {
                folder = new Folder
                {
                    Name = name,
                    ParentFolderId = root.FolderId,
                    LanguageId = feed.LanguageId,
                    UserId = feed.UserId,
                    SortOrder = await NextFolderSortOrderAsync(feed.UserId, root.FolderId, cancellationToken),
                    CreatedAt = now
                };
                _context.Folders.Add(folder);
                await _context.SaveChangesAsync(cancellationToken);
            }

            feed.FolderId = folder.FolderId;
            return folder.FolderId;
        }

        private async Task<int> NextFolderSortOrderAsync(Guid userId, int? parentFolderId, CancellationToken cancellationToken) =>
            (await _context.Folders
                .Where(f => f.UserId == userId && f.ParentFolderId == parentFolderId)
                .MaxAsync(f => (int?)f.SortOrder, cancellationToken) ?? -1) + 1;

        /// <summary>
        /// Deletes the user's imported articles that were never opened and are older than
        /// <paramref name="days"/> days. Opened or finished ones stay, and so do articles of a
        /// removed feed (they no longer count as imported).
        /// </summary>
        public async Task<int> DeleteUnopenedArticlesAsync(Guid userId, int days, CancellationToken cancellationToken)
        {
            if (days <= 0) return 0;
            var cutoff = UtcNow.AddDays(-days);
            var stale = await _context.Texts
                .Where(t => t.UserId == userId && t.NewsFeedId != null && t.LastAccessedAt == null && !t.IsFinished && t.CreatedAt < cutoff)
                .ToListAsync(cancellationToken);
            if (stale.Count == 0) return 0;
            _context.Texts.RemoveRange(stale);
            await _context.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Deleted {Count} unopened news articles older than {Days} days for user {UserId}", stale.Count, days, userId);
            return stale.Count;
        }

        /// <summary>
        /// Whether a feed is due for a check: <paramref name="interval"/> after the last one, doubled
        /// for each failure in a row (at most a day).
        /// </summary>
        public static bool IsDue(NewsFeed feed, DateTime now, TimeSpan interval)
        {
            if (feed.LastCheckedAt is not DateTime last) return true;
            var backoff = 1L << Math.Min(feed.ConsecutiveFailures, 4);
            var wait = TimeSpan.FromTicks(Math.Min(interval.Ticks * backoff, TimeSpan.FromDays(1).Ticks));
            return now - last >= wait;
        }

        public static string HashKey(string key) =>
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key.Trim())));

        private static string Truncate(string value, int maxLength) =>
            value.Length <= maxLength ? value : value[..(maxLength - 1)].TrimEnd() + "…";
    }
}
