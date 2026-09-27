using LinguaReadApi.Data;
using LinguaReadApi.Services.News;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// The fetcher tests build their own HttpClient; this resolves the one the app really uses, so it
/// fails if the registration ever loses the public-address guard.
/// </summary>
public class NewsFeedWiringTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public NewsFeedWiringTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task AppsFetcher_RefusesPrivateAddresses()
    {
        using var scope = CreateApp().Services.CreateScope();
        var fetcher = scope.ServiceProvider.GetRequiredService<NewsFetcher>();

        var ex = await Assert.ThrowsAsync<NewsFetchException>(() =>
            fetcher.GetAsync(new Uri("http://127.0.0.1:5432/"), CancellationToken.None));

        Assert.Contains("is not a public internet address", ex.Message);
        Assert.NotNull(scope.ServiceProvider.GetRequiredService<NewsFeedImporter>());
    }

    private WebApplicationFactory<Program> CreateApp() =>
        _factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = "test-jwt-key-1234567890",
                    ["Jwt:Issuer"] = "LinguaRead.Tests",
                    ["Jwt:Audience"] = "LinguaRead.Tests",
                    ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=tests;Username=tests;Password=tests",
                    ["PGDATABASE"] = "tests",
                    ["PGUSER"] = "tests",
                    ["PGPASSWORD"] = "tests",
                    ["NewsFeeds:Disabled"] = "true"
                });
            });
            builder.ConfigureServices(services =>
            {
                // Same swap as ExternalWritesWiringTests: drop every Npgsql registration.
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
                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase("LinguaReadNewsFeedWiringTests"));
            });
        });
}
