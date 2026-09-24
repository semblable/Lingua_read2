using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Staging turns outside writes off with ExternalWrites__Disabled=true (written by _deploy.yml).
/// The service tests construct the services by hand; these resolve them from the real app's DI
/// container, so they fail if the setting stops reaching the services the app actually uses.
/// </summary>
public class ExternalWritesWiringTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public ExternalWritesWiringTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task DisabledSetting_ReachesHardcoverAndDiscordServices()
    {
        using var scope = CreateApp(disabled: true).Services.CreateScope();
        var hardcover = scope.ServiceProvider.GetRequiredService<IHardcoverService>();
        var discord = scope.ServiceProvider.GetRequiredService<DiscordReportService>();

        var sync = await hardcover.SyncAllAsync(Guid.NewGuid());
        var report = await discord.SendReportForUserAsync(
            new UserSettings { UserId = Guid.NewGuid(), DiscordWebhookUrl = "https://discord.com/api/webhooks/1/abc" },
            DateTime.UtcNow.AddDays(-7), DateTime.UtcNow, dryRun: false, CancellationToken.None);

        Assert.Equal(ExternalWritesOptions.DisabledMessage, sync.Message);
        Assert.True(report.Skipped);
        Assert.Equal(ExternalWritesOptions.DisabledMessage, report.Reason);
    }

    [Fact]
    public void ExternalWrites_AreEnabledByDefault()
    {
        using var scope = CreateApp(disabled: null).Services.CreateScope();

        Assert.False(scope.ServiceProvider.GetRequiredService<IOptions<ExternalWritesOptions>>().Value.Disabled);
    }

    private WebApplicationFactory<Program> CreateApp(bool? disabled) =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                var settings = new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = "test-jwt-key-1234567890",
                    ["Jwt:Issuer"] = "LinguaRead.Tests",
                    ["Jwt:Audience"] = "LinguaRead.Tests",
                    ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=tests;Username=tests;Password=tests",
                    // DiscordReportService depends on the database admin service, which reads these.
                    ["PGDATABASE"] = "tests",
                    ["PGUSER"] = "tests",
                    ["PGPASSWORD"] = "tests"
                };
                if (disabled.HasValue)
                {
                    settings["ExternalWrites:Disabled"] = disabled.Value ? "true" : "false";
                }
                config.AddInMemoryCollection(settings);
            });
            builder.ConfigureServices(services =>
            {
                // Same swap as CompressionPipelineTests: drop every Npgsql registration, not just the options.
                var efDescriptors = services
                    .Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>)
                             || d.ServiceType == typeof(DbContextOptions)
                             || (d.ServiceType.IsGenericType
                                 && d.ServiceType.GetGenericTypeDefinition().Name
                                     .StartsWith("IDbContextOptionsConfiguration", StringComparison.Ordinal)))
                    .ToList();
                foreach (var d in efDescriptors)
                {
                    services.Remove(d);
                }
                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase("LinguaReadExternalWritesTests"));
            });
        });
}
