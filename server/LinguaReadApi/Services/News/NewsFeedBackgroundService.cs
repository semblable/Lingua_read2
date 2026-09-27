using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LinguaReadApi.Services.News
{
    public class NewsFeedOptions
    {
        public const string SectionName = "NewsFeeds";

        // Turns the background import off on this server; feeds can still be managed and fetched by hand.
        public bool Disabled { get; set; }

        // How often the service looks for due feeds.
        public int PollIntervalMinutes { get; set; } = 15;

        // How long a feed rests between checks (doubled per failure in a row, up to a day).
        public int CheckIntervalMinutes { get; set; } = 120;

        // Lets startup work (migrations, word-linking repair) go first.
        public int StartupDelaySeconds { get; set; } = 90;
    }

    /// <summary>
    /// Checks the due feeds of every user with news import on, one feed at a time, and deletes
    /// their old unopened articles (see <see cref="NewsFeedImporter"/>).
    /// </summary>
    public class NewsFeedBackgroundService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IOptionsMonitor<NewsFeedOptions> _options;
        private readonly ILogger<NewsFeedBackgroundService> _logger;
        private readonly TimeProvider _timeProvider;

        public NewsFeedBackgroundService(
            IServiceScopeFactory scopeFactory,
            IOptionsMonitor<NewsFeedOptions> options,
            ILogger<NewsFeedBackgroundService> logger,
            TimeProvider? timeProvider = null)
        {
            _scopeFactory = scopeFactory;
            _options = options;
            _logger = logger;
            _timeProvider = timeProvider ?? TimeProvider.System;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(Math.Max(0, _options.CurrentValue.StartupDelaySeconds)), _timeProvider, stoppingToken);
                while (!stoppingToken.IsCancellationRequested)
                {
                    if (!_options.CurrentValue.Disabled)
                    {
                        try
                        {
                            await RunOnceAsync(stoppingToken);
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            _logger.LogError(ex, "News feed import failed.");
                        }
                    }
                    await Task.Delay(TimeSpan.FromMinutes(Math.Max(1, _options.CurrentValue.PollIntervalMinutes)), _timeProvider, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // Shutting down.
            }
        }

        /// <summary>One pass: every due feed of every user with news import on, then the cleanup.</summary>
        public async Task RunOnceAsync(CancellationToken cancellationToken)
        {
            var interval = TimeSpan.FromMinutes(Math.Max(1, _options.CurrentValue.CheckIntervalMinutes));
            var now = _timeProvider.GetUtcNow().UtcDateTime;

            using var listScope = _scopeFactory.CreateScope();
            var context = listScope.ServiceProvider.GetRequiredService<AppDbContext>();
            var users = await context.UserSettings
                .Where(s => s.NewsImportEnabled)
                .Select(s => new { s.UserId, s.NewsDeleteUnreadAfterDays })
                .ToListAsync(cancellationToken);
            var userIds = users.Select(u => u.UserId).ToList();
            var feeds = await context.NewsFeeds
                .AsNoTracking()
                .Where(f => f.Enabled && userIds.Contains(f.UserId))
                .OrderBy(f => f.LastCheckedAt)
                .ToListAsync(cancellationToken);

            foreach (var feed in feeds.Where(f => NewsFeedImporter.IsDue(f, now, interval)))
            {
                // The importer reports feed and network problems in its result; anything else (a
                // database error, say) is caught here so the other feeds and the cleanup still run.
                try
                {
                    // A scope per feed: each check's texts and entries leave the change tracker after it.
                    using var scope = _scopeFactory.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<NewsFeedImporter>().ImportAsync(feed.NewsFeedId, cancellationToken);
                }
                catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
                {
                    _logger.LogError(ex, "News feed {FeedId} check failed.", feed.NewsFeedId);
                    await RecordFailureAsync(feed.NewsFeedId, now, cancellationToken);
                }
            }

            foreach (var user in users.Where(u => u.NewsDeleteUnreadAfterDays > 0))
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<NewsFeedImporter>()
                        .DeleteUnopenedArticlesAsync(user.UserId, user.NewsDeleteUnreadAfterDays, cancellationToken);
                }
                catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
                {
                    _logger.LogError(ex, "Deleting unopened news articles failed for user {UserId}.", user.UserId);
                }
            }
        }

        // The failed check's own changes were never saved, so without this the feed would stay due
        // and be retried every pass with no backoff.
        private async Task RecordFailureAsync(int newsFeedId, DateTime now, CancellationToken cancellationToken)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var feed = await context.NewsFeeds.FirstOrDefaultAsync(f => f.NewsFeedId == newsFeedId, cancellationToken);
                if (feed == null) return;
                feed.LastCheckedAt = now;
                feed.LastError = "The check failed on the server. It will be tried again later.";
                feed.ConsecutiveFailures++;
                await context.SaveChangesAsync(cancellationToken);
            }
            catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
            {
                _logger.LogError(ex, "Recording the failed check of news feed {FeedId} failed.", newsFeedId);
            }
        }
    }
}
