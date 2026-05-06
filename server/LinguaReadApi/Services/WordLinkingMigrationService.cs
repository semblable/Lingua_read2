using LinguaReadApi.Data;
using LinguaReadApi.Services.Tokenization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Runs once per app startup. Finds every Text whose
    /// <c>WordLinkingTokenizerVersion</c> is below
    /// <see cref="WordLinker.CurrentTokenizerVersion"/> and re-links it
    /// against the current tokenizer. Idempotent: subsequent restarts
    /// skip texts that are already current. Non-blocking to startup —
    /// the work runs in the background while the API serves requests.
    ///
    /// Existing behaviour preserved: the manual
    /// <c>POST /api/texts/admin/relink-all</c> endpoint still works for
    /// per-user manual fixes; this service handles the global migration.
    /// </summary>
    public class WordLinkingMigrationService : BackgroundService
    {
        private const int BatchSize = 25;

        // Wait this long after startup before scanning, so the API has
        // a chance to come up cleanly under load before we start
        // hammering the DB with re-link work.
        private static readonly TimeSpan StartupDelay = TimeSpan.FromSeconds(15);

        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<WordLinkingMigrationService> _logger;

        public WordLinkingMigrationService(
            IServiceProvider serviceProvider,
            ILogger<WordLinkingMigrationService> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try
            {
                await Task.Delay(StartupDelay, stoppingToken);
            }
            catch (TaskCanceledException)
            {
                return;
            }

            try
            {
                await RunMigration(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "WordLinkingMigrationService aborted unexpectedly.");
            }
        }

        private async Task RunMigration(CancellationToken stoppingToken)
        {
            int totalProcessed = 0;
            int totalErrors = 0;
            int reportedTotal = -1;
            var failedIds = new HashSet<int>();

            while (!stoppingToken.IsCancellationRequested)
            {
                List<(int TextId, string Content, int LanguageId, Guid UserId)> batch;

                using (var scope = _serviceProvider.CreateScope())
                {
                    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                    if (reportedTotal < 0)
                    {
                        reportedTotal = await context.Texts
                            .AsNoTracking()
                            .CountAsync(t =>
                                t.WordLinkingTokenizerVersion == null ||
                                t.WordLinkingTokenizerVersion < WordLinker.CurrentTokenizerVersion,
                                stoppingToken);

                        if (reportedTotal == 0)
                        {
                            _logger.LogInformation(
                                "WordLinkingMigrationService: all texts already at tokenizer version {V}; skipping relink pass.",
                                WordLinker.CurrentTokenizerVersion);
                            // Fall through to cleanup — orphans can still
                            // exist from a previous relink that pre-dated
                            // the cleanup feature.
                            break;
                        }

                        _logger.LogInformation(
                            "WordLinkingMigrationService: starting re-link of {Total} texts to tokenizer version {V}.",
                            reportedTotal, WordLinker.CurrentTokenizerVersion);
                    }

                    batch = await context.Texts
                        .AsNoTracking()
                        .Where(t =>
                            !failedIds.Contains(t.TextId) &&
                            (t.WordLinkingTokenizerVersion == null ||
                            t.WordLinkingTokenizerVersion < WordLinker.CurrentTokenizerVersion))
                        .OrderBy(t => t.TextId)
                        .Take(BatchSize)
                        .Select(t => new ValueTuple<int, string, int, Guid>(
                            t.TextId, t.Content, t.LanguageId, t.UserId))
                        .ToListAsync(stoppingToken);
                }

                if (batch.Count == 0) break;

                foreach (var (textId, content, languageId, userId) in batch)
                {
                    if (stoppingToken.IsCancellationRequested) return;

                    try
                    {
                        // Each text gets its own scope/context to keep
                        // change tracking small and to release memory
                        // promptly between texts.
                        using var itemScope = _serviceProvider.CreateScope();
                        var itemContext = itemScope.ServiceProvider.GetRequiredService<AppDbContext>();
                        await WordLinker.RelinkAsync(itemContext, textId, content, languageId, userId, stoppingToken);
                        totalProcessed++;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        totalErrors++;
                        failedIds.Add(textId);
                        _logger.LogError(ex,
                            "WordLinkingMigrationService: failed to re-link TextId={TextId}", textId);
                    }
                }

                _logger.LogInformation(
                    "WordLinkingMigrationService: progress {Processed}/{Total} (errors so far: {Errors})",
                    totalProcessed, reportedTotal, totalErrors);
            }

            if (totalProcessed > 0 || totalErrors > 0)
            {
                _logger.LogInformation(
                    "WordLinkingMigrationService: relink pass complete. Processed={Processed}, Errors={Errors}.",
                    totalProcessed, totalErrors);
            }

            // Cleanup runs unconditionally each startup. ExecuteDelete
            // is a single SQL statement filtered by Status + NOT EXISTS
            // subqueries against indexed FKs, so the no-op case is
            // effectively free. This handles orphans left over from a
            // relink that ran before the cleanup feature shipped.
            if (!stoppingToken.IsCancellationRequested)
            {
                await CleanupOrphans(stoppingToken);
            }
        }

        private async Task CleanupOrphans(CancellationToken stoppingToken)
        {
            try
            {
                using var scope = _serviceProvider.CreateScope();
                var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var deleted = await WordLinker.CleanupOrphanWordsAsync(context, stoppingToken);
                if (deleted > 0)
                {
                    _logger.LogInformation(
                        "WordLinkingMigrationService: cleaned up {Deleted} orphan Word rows " +
                        "(auto-created, never linked, never translated).",
                        deleted);
                }
                else
                {
                    // Once the DB is clean, idle restarts shouldn't keep
                    // logging at info level. Drop to debug.
                    _logger.LogDebug("WordLinkingMigrationService: no orphan Word rows to clean.");
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Cleanup is best-effort — orphans are harmless dead
                // weight, so a failure here should not surface as a
                // migration failure.
                _logger.LogWarning(ex,
                    "WordLinkingMigrationService: orphan cleanup failed (non-fatal).");
            }
        }
    }
}
