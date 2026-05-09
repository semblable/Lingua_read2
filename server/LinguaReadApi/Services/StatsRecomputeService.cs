using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using LinguaReadApi.Data;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Nightly sweep that refreshes the cached running-word stats
    /// (TotalWords/KnownWords/LearningWords) on every Book and the
    /// (TotalWords/KnownWords) pair on every Text. Counts are token
    /// counts (sum of TextWord.OccurrenceCount), not unique-word
    /// counts, so book-level numbers stay consistent with per-text
    /// numbers (no long-tail dedup inflation). Stats are also updated
    /// on the lesson-completion path; this job catches drift from
    /// word-status changes that happen outside that flow (e.g. marking
    /// a word known via the dictionary panel mid-text).
    /// </summary>
    public class StatsRecomputeService : BackgroundService
    {
        private static readonly TimeOnly RunAtUtc = new TimeOnly(3, 0); // 03:00 UTC

        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<StatsRecomputeService> _logger;
        private readonly MigrationSignal _migrationSignal;

        public StatsRecomputeService(
            IServiceProvider serviceProvider,
            ILogger<StatsRecomputeService> logger,
            MigrationSignal migrationSignal)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
            _migrationSignal = migrationSignal;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("StatsRecomputeService started; nightly sweep at {RunAt} UTC.", RunAtUtc);

            // Wait for WordLinkingMigrationService to finish before sweeping
            // so real OccurrenceCount values are in place. Without this,
            // the sweep would read placeholder OccurrenceCount=1 rows for
            // texts still pending re-link and persist wrong stats until the
            // next nightly run.
            try
            {
                await _migrationSignal.Completed.WaitAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            try
            {
                _logger.LogInformation("StatsRecomputeService running startup sweep.");
                await RecomputeAllAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "StatsRecomputeService startup sweep failed.");
            }

            while (!stoppingToken.IsCancellationRequested)
            {
                var delay = TimeUntilNextRun(DateTime.UtcNow);
                try
                {
                    await Task.Delay(delay, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                try
                {
                    _logger.LogInformation("StatsRecomputeService nightly sweep starting.");
                    await RecomputeAllAsync(stoppingToken);
                    _logger.LogInformation("StatsRecomputeService nightly sweep complete.");
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "StatsRecomputeService nightly sweep failed.");
                }
            }
        }

        private static TimeSpan TimeUntilNextRun(DateTime nowUtc)
        {
            var todayRun = new DateTime(nowUtc.Year, nowUtc.Month, nowUtc.Day,
                RunAtUtc.Hour, RunAtUtc.Minute, 0, DateTimeKind.Utc);
            var next = nowUtc < todayRun ? todayRun : todayRun.AddDays(1);
            var delta = next - nowUtc;
            return delta < TimeSpan.FromMinutes(1) ? TimeSpan.FromMinutes(1) : delta;
        }

        public async Task RecomputeAllAsync(CancellationToken ct)
        {
            using var scope = _serviceProvider.CreateScope();
            var ctx = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var now = DateTime.UtcNow;

            var textRows = await ctx.TextWords
                .AsNoTracking()
                .GroupBy(tw => new { tw.TextId, tw.Word.Status })
                .Select(g => new { g.Key.TextId, g.Key.Status, Count = g.Sum(x => x.OccurrenceCount) })
                .ToListAsync(ct);

            var textAgg = textRows
                .GroupBy(r => r.TextId)
                .ToDictionary(
                    g => g.Key,
                    g => new { Total = g.Sum(r => r.Count), Known = g.Where(r => r.Status >= 4).Sum(r => r.Count) });

            var allTexts = await ctx.Texts.ToListAsync(ct);
            int textChanged = 0;
            foreach (var t in allTexts)
            {
                int total = 0, known = 0;
                if (textAgg.TryGetValue(t.TextId, out var s)) { total = s.Total; known = s.Known; }
                if (t.TotalWords != total || t.KnownWords != known || t.StatsUpdatedAt == null)
                {
                    t.TotalWords = total;
                    t.KnownWords = known;
                    t.StatsUpdatedAt = now;
                    textChanged++;
                }
            }

            var bookRows = await ctx.TextWords
                .AsNoTracking()
                .Where(tw => tw.Text.BookId != null)
                .GroupBy(tw => new { BookId = tw.Text.BookId!.Value, tw.Word.Status })
                .Select(g => new { g.Key.BookId, g.Key.Status, Count = g.Sum(x => x.OccurrenceCount) })
                .ToListAsync(ct);

            var bookAgg = bookRows
                .GroupBy(r => r.BookId)
                .ToDictionary(
                    g => g.Key,
                    g => new
                    {
                        Total = g.Sum(r => r.Count),
                        Known = g.Where(r => r.Status >= 4).Sum(r => r.Count),
                        Learning = g.Where(r => r.Status == 2 || r.Status == 3).Sum(r => r.Count),
                    });

            var allBooks = await ctx.Books.ToListAsync(ct);
            int bookChanged = 0;
            foreach (var b in allBooks)
            {
                int total = 0, known = 0, learning = 0;
                if (bookAgg.TryGetValue(b.BookId, out var s))
                {
                    total = s.Total; known = s.Known; learning = s.Learning;
                }
                if (b.TotalWords != total || b.KnownWords != known || b.LearningWords != learning || b.StatsUpdatedAt == null)
                {
                    b.TotalWords = total;
                    b.KnownWords = known;
                    b.LearningWords = learning;
                    b.StatsUpdatedAt = now;
                    bookChanged++;
                }
            }

            if (textChanged > 0 || bookChanged > 0)
            {
                await ctx.SaveChangesAsync(ct);
            }

            _logger.LogInformation(
                "Stats sweep updated {TextCount} text(s) and {BookCount} book(s).",
                textChanged, bookChanged);
        }
    }
}
