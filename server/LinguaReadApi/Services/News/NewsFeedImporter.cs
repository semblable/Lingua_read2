using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Utilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services.News
{
    /// <summary>A feed found at an address the user gave: the feed itself, or one its page links to.</summary>
    public sealed record FeedDiscovery(Uri FeedUrl, ParsedFeed Feed);

    /// <summary>
    /// What a check or an import of picked entries did. <see cref="Entries"/> is only set for picked
    /// entries: what became of each.
    /// </summary>
    public sealed record NewsImportResult(bool Success, int Imported, int Skipped, string Message, IReadOnlyList<NewsEntryOutcome>? Entries = null);

    /// <summary>What the import made of a feed entry, as the article list shows it.</summary>
    public static class NewsEntryStatus
    {
        // Not imported or skipped yet.
        public const string New = "new";
        public const string Imported = "imported";
        // Too short or unreadable when it was tried.
        public const string Skipped = "skipped";
        // Picked, but imported already.
        public const string AlreadyImported = "alreadyImported";
        // Picked, but gone from the feed by the time of the import.
        public const string NotInFeed = "notInFeed";
    }

    /// <summary>
    /// A feed entry in the article list. <see cref="Key"/> is what <see cref="NewsFeedImporter.ImportSelectedAsync"/>
    /// takes; <see cref="TextId"/> is the imported article, while it's still in the Library.
    /// </summary>
    public sealed record NewsFeedEntryInfo(string Key, string Title, string? Link, DateTimeOffset? PublishedAt, string? Summary, string Status, int? TextId);

    /// <summary>What became of one picked entry (a <see cref="NewsEntryStatus"/>), and its text if imported.</summary>
    public sealed record NewsEntryOutcome(string Key, string Status, int? TextId = null);

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

        // Entries shown in the article list, and picked entries imported in one go, at most.
        public const int MaxBrowseEntries = 100;
        public const int MaxSelectedEntries = 20;

        public const string RootFolderName = "News";

        // Seen entries are forgotten once they have been out of the feed this long.
        public static readonly TimeSpan ForgetAfter = TimeSpan.FromDays(30);

        private readonly AppDbContext _context;
        private readonly NewsFetcher _fetcher;
        private readonly WordLinkingChannel _wordLinkingChannel;
        private readonly NewsFeedLocks _locks;
        private readonly ILogger<NewsFeedImporter> _logger;
        private readonly TimeProvider _timeProvider;

        // Same shape as the EPUB import writes (BooksController), so the reader treats both alike.
        private static readonly JsonSerializerOptions StructuredContentJsonOptions = new(JsonSerializerDefaults.Web)
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        private sealed record LeadPhoto(byte[] Bytes, string Extension, string? Caption);

        // A downloaded photo waiting for its article's id.
        private sealed record PendingPhoto(Text Text, IReadOnlyList<string> Paragraphs, LeadPhoto Photo);

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

        /// <summary>Where photos are stored; tests point it at a temp directory. Null is the app's wwwroot.</summary>
        internal string? WebRoot { get; init; }

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
        public Task<NewsImportResult> ImportAsync(int newsFeedId, CancellationToken cancellationToken) =>
            WithFeedLockAsync(newsFeedId, () => ImportLockedAsync(newsFeedId, cancellationToken), cancellationToken);

        /// <summary>
        /// Imports the entries the user picked (by <see cref="HashKey"/>), newest first, whatever the
        /// daily limit. One skipped before is tried again; one already imported is left alone. Never
        /// throws for feed or network problems; they end up in the result.
        /// </summary>
        public Task<NewsImportResult> ImportSelectedAsync(int newsFeedId, IReadOnlyCollection<string> keys, CancellationToken cancellationToken) =>
            WithFeedLockAsync(newsFeedId, () => ImportSelectedLockedAsync(newsFeedId, keys, cancellationToken), cancellationToken);

        private async Task<NewsImportResult> WithFeedLockAsync(int newsFeedId, Func<Task<NewsImportResult>> import, CancellationToken cancellationToken)
        {
            var gate = _locks.For(newsFeedId);
            if (!await gate.WaitAsync(0, cancellationToken))
            {
                return new NewsImportResult(false, 0, 0, "This feed is being checked right now. Try again in a minute.");
            }
            try
            {
                return await import();
            }
            finally
            {
                gate.Release();
            }
        }

        /// <summary>
        /// The feed's current entries, newest first (at most <see cref="MaxBrowseEntries"/>), each
        /// with what the import made of it, for choosing articles. Changes nothing. Throws
        /// <see cref="NewsFetchException"/> when the feed can't be loaded.
        /// </summary>
        public async Task<IReadOnlyList<NewsFeedEntryInfo>> BrowseAsync(int newsFeedId, CancellationToken cancellationToken)
        {
            var feed = await _context.NewsFeeds.AsNoTracking().FirstOrDefaultAsync(f => f.NewsFeedId == newsFeedId, cancellationToken)
                ?? throw new NewsFetchException("Feed not found.");
            var (parsed, _) = await LoadFeedAsync(feed, cancellationToken);

            var entries = Keyed(parsed).Take(MaxBrowseEntries).ToList();
            var keys = entries.Select(x => x.Key).ToList();
            var importedByKey = await _context.NewsFeedItems
                .AsNoTracking()
                .Where(i => i.NewsFeedId == feed.NewsFeedId && keys.Contains(i.ItemKey))
                .ToDictionaryAsync(i => i.ItemKey, i => i.Imported, cancellationToken);

            // An imported entry's article, if it's still in the Library: found by its address.
            var links = entries
                .Where(x => importedByKey.GetValueOrDefault(x.Key) && x.Entry.Link != null)
                .Select(x => x.Entry.Link!.AbsoluteUri)
                .ToList();
            var textIdByLink = (await _context.Texts
                    .AsNoTracking()
                    .Where(t => t.NewsFeedId == feed.NewsFeedId && t.SourceUrl != null && links.Contains(t.SourceUrl))
                    .Select(t => new { t.TextId, t.SourceUrl })
                    .ToListAsync(cancellationToken))
                .GroupBy(t => t.SourceUrl!)
                .ToDictionary(g => g.Key, g => g.Min(t => t.TextId));

            return entries.Select(x => new NewsFeedEntryInfo(
                    x.Key,
                    x.Entry.Title,
                    x.Entry.Link?.AbsoluteUri,
                    x.Entry.PublishedAt,
                    x.Entry.Summary,
                    !importedByKey.TryGetValue(x.Key, out var imported) ? NewsEntryStatus.New
                        : imported ? NewsEntryStatus.Imported
                        : NewsEntryStatus.Skipped,
                    x.Entry.Link != null && textIdByLink.TryGetValue(x.Entry.Link.AbsoluteUri, out var textId) ? textId : null))
                .ToList();
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
            Uri feedUrl;
            try
            {
                (parsed, feedUrl) = await LoadFeedAsync(feed, cancellationToken);
            }
            catch (NewsFetchException ex)
            {
                feed.LastError = Truncate(ex.Message, NewsFeed.MaxErrorLength);
                feed.ConsecutiveFailures++;
                await _context.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("News feed {FeedId} check failed: {Reason}", feed.NewsFeedId, ex.Message);
                return new NewsImportResult(false, 0, 0, ex.Message);
            }

            var entries = Keyed(parsed).ToList();
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

            var batch = new ImportBatch();
            var pagesFetched = 0;
            foreach (var (entry, key) in entries.Where(x => !knownKeys.Contains(x.Key)))
            {
                if (batch.Imported.Count >= room) break;

                var article = ArticleFromFeed(entry, feedUrl);
                if (article == null && entry.Link != null)
                {
                    if (pagesFetched >= MaxPagesPerCheck) break;
                    pagesFetched++;
                    article = await ReadPageAsync(entry.Link, entry.Title, cancellationToken);
                }

                var item = new NewsFeedItem { NewsFeedId = feed.NewsFeedId, ItemKey = key, FirstSeenAt = now, LastSeenAt = now };
                await AddArticleAsync(feed, entry, item, article, now, batch, cancellationToken);
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

            await SaveBatchAsync(batch, cancellationToken);

            if (batch.Imported.Count > 0 || batch.Skipped > 0)
            {
                _logger.LogInformation("News feed {FeedId}: imported {Imported}, skipped {Skipped}", feed.NewsFeedId, batch.Imported.Count, batch.Skipped);
            }
            return new NewsImportResult(true, batch.Imported.Count, batch.Skipped, ResultMessage(batch.Imported.Count, batch.Skipped, room, perDay));
        }

        private async Task<NewsImportResult> ImportSelectedLockedAsync(int newsFeedId, IReadOnlyCollection<string> keys, CancellationToken cancellationToken)
        {
            var feed = await _context.NewsFeeds.FirstOrDefaultAsync(f => f.NewsFeedId == newsFeedId, cancellationToken);
            if (feed == null)
            {
                return new NewsImportResult(false, 0, 0, "Feed not found.");
            }

            ParsedFeed parsed;
            Uri feedUrl;
            try
            {
                (parsed, feedUrl) = await LoadFeedAsync(feed, cancellationToken);
            }
            catch (NewsFetchException ex)
            {
                // The user sees this at once; the feed's own check status is left to the checks.
                return new NewsImportResult(false, 0, 0, ex.Message);
            }

            var now = UtcNow;
            var wanted = keys.ToHashSet(StringComparer.Ordinal);
            var entries = Keyed(parsed).Where(x => wanted.Contains(x.Key)).ToList();
            var entryKeys = entries.Select(x => x.Key).ToList();
            var existing = await _context.NewsFeedItems
                .Where(i => i.NewsFeedId == feed.NewsFeedId && entryKeys.Contains(i.ItemKey))
                .ToDictionaryAsync(i => i.ItemKey, cancellationToken);

            var batch = new ImportBatch();
            var outcomes = new List<NewsEntryOutcome>();
            var importedTexts = new Dictionary<string, Text>();
            foreach (var (entry, key) in entries)
            {
                var item = existing.GetValueOrDefault(key);
                if (item is { Imported: true })
                {
                    outcomes.Add(new NewsEntryOutcome(key, NewsEntryStatus.AlreadyImported));
                    continue;
                }

                var article = ArticleFromFeed(entry, feedUrl);
                if (article == null && entry.Link != null)
                {
                    article = await ReadPageAsync(entry.Link, entry.Title, cancellationToken);
                }

                if (item == null)
                {
                    item = new NewsFeedItem { NewsFeedId = feed.NewsFeedId, ItemKey = key, FirstSeenAt = now, LastSeenAt = now };
                }
                else
                {
                    // Skipped before and tried again. The "imported in the last 24 hours" count goes
                    // by FirstSeenAt, so an article imported now is counted from now.
                    item.FirstSeenAt = now;
                    item.LastSeenAt = now;
                }
                if (await AddArticleAsync(feed, entry, item, article, now, batch, cancellationToken) is { } text)
                {
                    importedTexts[key] = text;
                }
                else
                {
                    outcomes.Add(new NewsEntryOutcome(key, NewsEntryStatus.Skipped));
                }
            }

            await SaveBatchAsync(batch, cancellationToken);

            outcomes.AddRange(importedTexts.Select(pair => new NewsEntryOutcome(pair.Key, NewsEntryStatus.Imported, pair.Value.TextId)));
            var gone = wanted.Where(key => entries.All(x => x.Key != key)).ToList();
            outcomes.AddRange(gone.Select(key => new NewsEntryOutcome(key, NewsEntryStatus.NotInFeed)));

            if (batch.Imported.Count > 0 || batch.Skipped > 0)
            {
                _logger.LogInformation("News feed {FeedId}: imported {Imported} picked, skipped {Skipped}", feed.NewsFeedId, batch.Imported.Count, batch.Skipped);
            }
            return new NewsImportResult(true, batch.Imported.Count, batch.Skipped, SelectedResultMessage(batch.Imported.Count, batch.Skipped, gone.Count), outcomes);
        }

        // The feed's document, parsed; throws NewsFetchException (with a message for the user) when it can't be.
        private async Task<(ParsedFeed Feed, Uri Url)> LoadFeedAsync(NewsFeed feed, CancellationToken cancellationToken)
        {
            if (!Uri.TryCreate(feed.Url, UriKind.Absolute, out var url))
            {
                throw new NewsFetchException("The feed's address isn't valid.");
            }
            var document = await _fetcher.GetAsync(url, cancellationToken);
            if (!FeedParser.TryParse(document.Body, document.FinalUrl, out var parsed))
            {
                throw new NewsFetchException("The address no longer returns an RSS or Atom feed.");
            }
            return (parsed, document.FinalUrl);
        }

        // The feed's entries (newest first), each article once, with the key its NewsFeedItem is stored under.
        private static IEnumerable<(FeedEntry Entry, string Key)> Keyed(ParsedFeed parsed) =>
            parsed.Entries
                .Select(entry => (Entry: entry, Key: HashKey(EntryIdentity(entry.Key))))
                .DistinctBy(x => x.Key);

        /// <summary>
        /// What identifies an entry: its guid/id, without the fragment when it's a web address. BBC
        /// News Brasil lists some articles twice, as ".../articles/ck5ywwz0ld77o#2" and "...#5",
        /// both linking to the same page; told apart by the fragment, the article was imported twice.
        /// </summary>
        internal static string EntryIdentity(string key)
        {
            var hash = key.IndexOf('#');
            return hash > 0 && Uri.TryCreate(key, UriKind.Absolute, out var url) && NewsFetcher.IsWebUrl(url)
                ? key[..hash]
                : key;
        }

        // What one check or one import of picked entries has added, until it's saved.
        private sealed class ImportBatch
        {
            public List<Text> Imported { get; } = new();
            public List<PendingPhoto> Photos { get; } = new();
            public int Skipped { get; set; }
            public int? FolderId { get; set; }
        }

        /// <summary>
        /// Adds <paramref name="article"/> as a text in the feed's folder, with its lead photo
        /// downloaded, and records the entry as imported; or, when it's missing or too short,
        /// records the entry as skipped. <paramref name="item"/> may be new or already tracked.
        /// Returns the text, or null when skipped. Nothing is saved except a folder made for it.
        /// </summary>
        private async Task<Text?> AddArticleAsync(
            NewsFeed feed, FeedEntry entry, NewsFeedItem item, ExtractedArticle? article, DateTime now, ImportBatch batch, CancellationToken cancellationToken)
        {
            if (article == null || article.WordCount < MinArticleWords)
            {
                item.Imported = false;
                if (_context.Entry(item).State == EntityState.Detached) _context.NewsFeedItems.Add(item);
                batch.Skipped++;
                return null;
            }

            // The folder first: making it saves, and an imported entry saved before its text
            // would be lost for good if the check were cancelled before the end (a photo
            // download, an aborted "Fetch now"), while still counting toward the daily limit.
            batch.FolderId ??= await EnsureFolderAsync(feed, now, cancellationToken);
            item.Imported = true;
            if (_context.Entry(item).State == EntityState.Detached) _context.NewsFeedItems.Add(item);
            var text = new Text
            {
                Title = Truncate(
                    !string.IsNullOrEmpty(entry.Title) ? entry.Title : article.Title ?? entry.Link?.Host ?? feed.Title,
                    200),
                Content = article.Content,
                LanguageId = feed.LanguageId,
                UserId = feed.UserId,
                FolderId = batch.FolderId,
                CreatedAt = now,
                LastAccessedAt = null,
                WordLinkingStatus = "processing",
                NewsFeedId = feed.NewsFeedId,
                SourceUrl = entry.Link?.AbsoluteUri is { Length: <= NewsFeed.MaxUrlLength } link ? link : null
            };
            _context.Texts.Add(text);
            batch.Imported.Add(text);

            // Downloaded now, before anything is saved, so the article appears with its photo:
            // a text's ETag only changes with its stats, and a reader who opened it during a
            // slow download would keep the copy without one.
            if (await DownloadLeadPhotoAsync(LeadImage.Candidates(article, entry), cancellationToken) is { } photo)
            {
                batch.Photos.Add(new PendingPhoto(text, article.Paragraphs, photo));
            }
            return text;
        }

        /// <summary>
        /// Puts the batch's texts on top of their folder, saves everything tracked, then stores the
        /// photos and queues the texts for word linking.
        /// </summary>
        private async Task SaveBatchAsync(ImportBatch batch, CancellationToken cancellationToken)
        {
            if (batch.Imported.Count > 0)
            {
                // Newest on top of the folder in its manual order: a lower SortOrder than everything
                // already there (the query only sees saved texts), the newest lowest.
                var sortOrder = await _context.Texts
                    .Where(t => t.FolderId == batch.FolderId)
                    .MinAsync(t => (int?)t.SortOrder, cancellationToken) ?? 0;
                for (var i = batch.Imported.Count - 1; i >= 0; i--)
                {
                    batch.Imported[i].SortOrder = --sortOrder;
                }
            }

            await _context.SaveChangesAsync(cancellationToken);

            // The photo file is named after the text's id, so it's stored once the texts are saved.
            await StoreLeadPhotosAsync(batch.Photos);

            foreach (var text in batch.Imported)
            {
                await _wordLinkingChannel.Writer.WriteAsync(
                    new WordLinkingRequest(text.TextId, text.Content, text.LanguageId, text.UserId), cancellationToken);
            }
        }

        private static string ResultMessage(int imported, int skipped, int room, int perDay)
        {
            if (imported > 0)
            {
                return (imported == 1 ? "Imported 1 article." : $"Imported {imported} articles.") + SkippedNote(skipped);
            }
            if (room <= 0)
            {
                return $"Already imported {perDay} {(perDay == 1 ? "article" : "articles")} from this feed in the last 24 hours, the daily limit.";
            }
            return skipped > 0 ? "No new articles long enough to import." + SkippedNote(skipped) : "No new articles.";
        }

        private static string SelectedResultMessage(int imported, int skipped, int gone)
        {
            var goneNote = gone == 0 ? ""
                : gone == 1 ? " 1 is no longer in the feed."
                : $" {gone} are no longer in the feed.";
            if (imported > 0)
            {
                return (imported == 1 ? "Imported 1 article." : $"Imported {imported} articles.") + SkippedNote(skipped) + goneNote;
            }
            if (skipped > 0)
            {
                return "Nothing imported." + SkippedNote(skipped) + goneNote;
            }
            return gone > 0 ? "Nothing imported." + goneNote : "Those articles are already imported.";
        }

        private static string SkippedNote(int skipped) =>
            skipped == 0 ? ""
            : skipped == 1 ? " Skipped 1 that was too short or couldn't be read."
            : $" Skipped {skipped} that were too short or couldn't be read.";

        // Feeds that carry whole articles (content:encoded) spare fetching the page.
        private static ExtractedArticle? ArticleFromFeed(FeedEntry entry, Uri feedUrl)
        {
            if (entry.ContentHtml == null) return null;
            var article = new ExtractedArticle(entry.Title, ArticleExtractor.ToParagraphs(entry.ContentHtml, entry.Title))
            {
                FirstBodyImage = LeadImage.FirstInHtml(entry.ContentHtml, entry.Link ?? feedUrl, entry.Title)
            };
            return article.WordCount >= MinArticleWords || entry.Link == null ? article : null;
        }

        /// <summary>
        /// Stores the downloaded lead photos and shows each above its article and on its Library card
        /// (ImagePath): StructuredContent becomes the photo followed by the article's paragraphs,
        /// while Content stays as it was, so word linking and stats don't change. The reader gives a
        /// picture no sentence number, so bookmarks count sentences as they would without it. Only
        /// local writes, so no cancellation: the articles are saved already and still have to be
        /// queued for word linking. A photo that can't be stored is dropped; its article stays.
        /// </summary>
        private async Task StoreLeadPhotosAsync(List<PendingPhoto> photos)
        {
            var written = new List<string>();
            foreach (var (text, paragraphs, photo) in photos)
            {
                string? path = null;
                try
                {
                    var directory = BookAssetStorage.NewsImageDirectory(text.UserId, WebRoot);
                    Directory.CreateDirectory(directory);
                    path = Path.Combine(directory, text.TextId + photo.Extension);
                    await File.WriteAllBytesAsync(path, photo.Bytes);
                    written.Add(path);

                    var imageUrl = BookAssetStorage.NewsImageUrl(text.UserId, text.TextId, photo.Extension);
                    var blocks = new List<ReaderContentBlock>
                    {
                        new()
                        {
                            Type = ReaderContentBlockTypes.Image,
                            ImageUrl = imageUrl,
                            Caption = photo.Caption
                        }
                    };
                    blocks.AddRange(paragraphs.Select(paragraph => new ReaderContentBlock
                    {
                        Type = ReaderContentBlockTypes.Paragraph,
                        Text = paragraph
                    }));
                    text.StructuredContent = JsonSerializer.Serialize(blocks, StructuredContentJsonOptions);
                    // The Library's card shows it too.
                    text.ImagePath = imageUrl;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Couldn't store the photo of news article {TextId}", text.TextId);
                    if (path != null && !written.Contains(path)) TryDeleteFile(path);
                }
            }
            if (written.Count == 0) return;

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                // Photos their texts don't point to would never be shown.
                _logger.LogWarning(ex, "Couldn't save the photos of {Count} news articles", written.Count);
                foreach (var file in written) TryDeleteFile(file);
            }
        }

        // The first candidate that downloads as a real picture of a sensible size.
        private async Task<LeadPhoto?> DownloadLeadPhotoAsync(IReadOnlyList<ImageCandidate> candidates, CancellationToken cancellationToken)
        {
            foreach (var candidate in candidates)
            {
                try
                {
                    var image = await _fetcher.GetImageAsync(candidate.Url, LeadImage.MaxBytes, cancellationToken);
                    var extension = LeadImage.ExtensionFor(image.Body);
                    if (extension != null && image.Body.Length >= LeadImage.MinBytes)
                    {
                        return new LeadPhoto(image.Body, extension, candidate.Caption);
                    }
                    _logger.LogDebug("News photo {Url} skipped: not a JPEG, PNG, WebP, GIF or AVIF picture", candidate.Url);
                }
                catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
                {
                    // Whatever goes wrong with a picture, the article is imported without it.
                    _logger.LogDebug("News photo {Url} skipped: {Reason}", candidate.Url, ex.Message);
                }
            }
            return null;
        }

        private void TryDeleteFile(string path)
        {
            try
            {
                File.Delete(path);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Couldn't delete news photo {Path}", path);
            }
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
            BookAssetStorage.DeleteNewsImages(userId, stale.Select(t => t.TextId), _logger, WebRoot);
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
