using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;

namespace LinguaReadApi.Services
{
    public class WordLinkingBackgroundService : BackgroundService
    {
        // Debounce window for the post-link stats sweep. Long enough
        // that a multi-text import (e.g. 247 parts) coalesces into a
        // single sweep at the end, short enough that a one-off import
        // shows its % within a few seconds.
        private static readonly TimeSpan PostLinkSweepDebounce = TimeSpan.FromSeconds(15);

        private readonly WordLinkingChannel _channel;
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<WordLinkingBackgroundService> _logger;
        private readonly StatsRecomputeService _statsRecompute;

        public WordLinkingBackgroundService(
            WordLinkingChannel channel,
            IServiceProvider serviceProvider,
            ILogger<WordLinkingBackgroundService> logger,
            StatsRecomputeService statsRecompute)
        {
            _channel = channel;
            _serviceProvider = serviceProvider;
            _logger = logger;
            _statsRecompute = statsRecompute;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("WordLinkingBackgroundService started.");

            await foreach (var request in _channel.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    _logger.LogInformation(
                        "Processing word linking for TextId={TextId}, UserId={UserId}",
                        request.TextId, request.UserId);

                    using var scope = _serviceProvider.CreateScope();
                    var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

                    await LinkWordsToText(context, request);

                    // Mark as completed
                    var text = await context.Texts.FindAsync(new object[] { request.TextId }, stoppingToken);
                    if (text != null)
                    {
                        text.WordLinkingStatus = "completed";
                        await context.SaveChangesAsync(stoppingToken);
                    }

                    _logger.LogInformation("Word linking completed for TextId={TextId}", request.TextId);

                    // Re-arm the debounced stats sweep so the new
                    // TextWord rows are picked up without waiting for
                    // 03:00 UTC. Coalesces across bursty imports.
                    _statsRecompute.RequestSweep(PostLinkSweepDebounce);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Word linking failed for TextId={TextId}", request.TextId);

                    // Mark as failed
                    try
                    {
                        using var scope = _serviceProvider.CreateScope();
                        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                        var text = await context.Texts.FindAsync(new object[] { request.TextId }, stoppingToken);
                        if (text != null)
                        {
                            text.WordLinkingStatus = "failed";
                            await context.SaveChangesAsync(stoppingToken);
                        }
                    }
                    catch (Exception innerEx)
                    {
                        _logger.LogError(innerEx, "Failed to update WordLinkingStatus to 'failed' for TextId={TextId}", request.TextId);
                    }
                }
            }
        }

        private static Task LinkWordsToText(AppDbContext context, WordLinkingRequest request)
        {
            return WordLinker.LinkAsync(
                context, request.TextId, request.Content, request.LanguageId, request.UserId);
        }
    }
}
