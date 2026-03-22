using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace LinguaReadApi.Services
{
    public class WeeklyDiscordReportHostedService : BackgroundService
    {
        private static readonly TimeSpan DisabledPollInterval = TimeSpan.FromMinutes(30);

        private readonly IServiceProvider _serviceProvider;
        private readonly IOptionsMonitor<DiscordReportOptions> _optionsMonitor;
        private readonly ILogger<WeeklyDiscordReportHostedService> _logger;

        public WeeklyDiscordReportHostedService(
            IServiceProvider serviceProvider,
            IOptionsMonitor<DiscordReportOptions> optionsMonitor,
            ILogger<WeeklyDiscordReportHostedService> logger)
        {
            _serviceProvider = serviceProvider;
            _optionsMonitor = optionsMonitor;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var options = _optionsMonitor.CurrentValue;
                if (!options.WeeklyReportEnabled)
                {
                    _logger.LogDebug("Discord weekly reporting is disabled (Discord:WeeklyReportEnabled=false).");
                    await Task.Delay(DisabledPollInterval, stoppingToken);
                    continue;
                }

                try
                {
                    using var scope = _serviceProvider.CreateScope();
                    var reportService = scope.ServiceProvider.GetRequiredService<DiscordReportService>();
                    var nowUtc = DateTime.UtcNow;
                    var result = await reportService.SendDueWeeklyReportsAsync(options, nowUtc, false, stoppingToken);

                    _logger.LogInformation(
                        "Discord weekly report completed. Targets={Targets} Prepared={Prepared} Sent={Sent} Failed={Failed} Skipped={Skipped}",
                        result.TargetCount,
                        result.PreparedCount,
                        result.SentCount,
                        result.FailedCount,
                        result.SkippedCount);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Discord weekly report execution failed.");
                }

                var pollMinutes = options.PollIntervalMinutes;
                if (pollMinutes <= 0)
                {
                    pollMinutes = 30;
                }

                await Task.Delay(TimeSpan.FromMinutes(pollMinutes), stoppingToken);
            }
        }
    }
}
