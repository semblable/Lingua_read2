using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using LinguaReadApi.Data;
using Xunit;

namespace LinguaReadApi.Tests;

public class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthEndpointTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                var settings = new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = "test-jwt-key-1234567890",
                    ["Jwt:Issuer"] = "LinguaRead.Tests",
                    ["Jwt:Audience"] = "LinguaRead.Tests",
                    ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=tests;Username=tests;Password=tests"
                };
                config.AddInMemoryCollection(settings);
            });
            builder.ConfigureServices(services =>
            {
                var descriptor = services.SingleOrDefault(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>));
                if (descriptor != null)
                {
                    services.Remove(descriptor);
                }

                services.AddDbContext<AppDbContext>(options =>
                {
                    options.UseInMemoryDatabase("LinguaReadTests");
                });
            });
        });
    }

    [Fact]
    public async Task GetHealth_ReturnsHealthyPayload()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/Health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var content = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"Status\":\"healthy\"", content);
    }
}
