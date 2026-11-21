using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LinguaReadApi.Services;

public sealed class HardcoverSyncBackgroundService : BackgroundService
{
    public const int DefaultWorkerCount = 4;
    public static readonly TimeSpan DefaultItemTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan PendingSyncRetryInterval = TimeSpan.FromMinutes(5);

    private readonly HardcoverSyncChannel _channel;
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<HardcoverSyncBackgroundService> _logger;
    private readonly int _workerCount;
    private readonly TimeSpan _itemTimeout;

    public HardcoverSyncBackgroundService(
        HardcoverSyncChannel channel,
        IServiceProvider serviceProvider,
        ILogger<HardcoverSyncBackgroundService> logger)
        : this(channel, serviceProvider, logger, DefaultWorkerCount, DefaultItemTimeout)
    {
    }

    internal HardcoverSyncBackgroundService(
        HardcoverSyncChannel channel,
        IServiceProvider serviceProvider,
        ILogger<HardcoverSyncBackgroundService> logger,
        int workerCount,
        TimeSpan itemTimeout)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(workerCount, 0);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(itemTimeout, TimeSpan.Zero);

        _channel = channel;
        _serviceProvider = serviceProvider;
        _logger = logger;
        _workerCount = workerCount;
        _itemTimeout = itemTimeout;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("HardcoverSyncBackgroundService started with {WorkerCount} workers.", _workerCount);

        var workers = new Task[_workerCount + 1];
        for (var i = 0; i < _workerCount; i++)
        {
            workers[i] = RunWorkerAsync(stoppingToken);
        }
        workers[^1] = RecoverPendingSyncAsync(stoppingToken);

        return Task.WhenAll(workers);
    }

    private async Task RecoverPendingSyncAsync(CancellationToken stoppingToken)
    {
        if (_serviceProvider.GetService<IOptions<ExternalWritesOptions>>()?.Value.Disabled == true)
        {
            return;
        }

        using var timer = new PeriodicTimer(PendingSyncRetryInterval);
        try
        {
            do
            {
                try
                {
                    using var scope = _serviceProvider.CreateScope();
                    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    var pending = await context.Books
                        .Where(book => (book.HardcoverPendingRatingId != null || book.HardcoverPendingFinishAfterReadId != null) &&
                            !book.HardcoverAutoMatchDisabled && (book.IsFinished || book.RereadStartedAt == null) &&
                            context.UserSettings.Any(settings => settings.UserId == book.UserId && settings.HardcoverSyncEnabled &&
                                settings.HardcoverApiToken != null))
                        .OrderBy(book => book.BookId)
                        .Select(book => new HardcoverSyncRequest(book.UserId, book.BookId))
                        .ToListAsync(stoppingToken);

                    foreach (var request in pending)
                    {
                        if (!_channel.TryEnqueue(request)) break;
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
                {
                    _logger.LogWarning(ex, "Could not recover pending Hardcover sync requests.");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
    }

    private async Task RunWorkerAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var request in _channel.Reader.ReadAllAsync(stoppingToken))
            {
                using var itemCts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                itemCts.CancelAfter(_itemTimeout);

                try
                {
                    using var scope = _serviceProvider.CreateScope();
                    var hardcoverService = scope.ServiceProvider.GetRequiredService<IHardcoverService>();
                    await hardcoverService.SyncProgressAsync(
                        request.UserId,
                        request.BookId,
                        requireSyncEnabled: true,
                        cancellationToken: itemCts.Token);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (OperationCanceledException)
                {
                    _logger.LogWarning(
                        "Background Hardcover progress sync timed out after {TimeoutSeconds}s for user {UserId}, book {BookId}",
                        _itemTimeout.TotalSeconds,
                        request.UserId,
                        request.BookId);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex,
                        "Background Hardcover progress sync failed for user {UserId}, book {BookId}",
                        request.UserId,
                        request.BookId);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
    }
}
