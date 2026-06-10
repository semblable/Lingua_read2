using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using LinguaReadApi.Data;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// User-uploaded content under wwwroot (/audio_lessons, /audiobooks, /epub_assets) has
/// guessable paths, so the pipeline gates those prefixes behind authentication. These tests
/// pin that gate: anonymous requests get 401; authenticated requests pass through to the
/// static-file middleware (404 here because the file doesn't exist — the point is it's not 401).
/// </summary>
public class ProtectedStaticContentTests : IClassFixture<WebApplicationFactory<Program>>
{
    // 32+ bytes: HS256 signing requires a 256-bit key.
    private const string JwtKey = "test-jwt-key-1234567890-abcdefgh";
    private const string JwtIssuer = "LinguaRead.Tests";
    private const string JwtAudience = "LinguaRead.Tests";

    private readonly WebApplicationFactory<Program> _factory;

    public ProtectedStaticContentTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                var settings = new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = JwtKey,
                    ["Jwt:Issuer"] = JwtIssuer,
                    ["Jwt:Audience"] = JwtAudience,
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
                    options.UseInMemoryDatabase("LinguaReadStaticGateTests");
                });
            });
        });
    }

    [Theory]
    [InlineData("/audio_lessons/lesson.mp3")]
    [InlineData("/audiobooks/1/track_1.mp3")]
    [InlineData("/epub_assets/a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5/1/cover.jpg")]
    public async Task UploadedContent_WithoutAuth_Returns401(string path)
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UploadedContent_WithAuthCookie_PassesTheGate()
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/audio_lessons/does-not-exist.mp3");
        request.Headers.Add("Cookie", $".LinguaRead.Auth={CreateJwt()}");

        var response = await client.SendAsync(request);

        // The file doesn't exist, so the static middleware yields 404 — the gate let us through.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task OtherEndpoints_RemainReachableAnonymously()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/Health");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static string CreateJwt()
    {
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey));
        var token = new JwtSecurityToken(
            issuer: JwtIssuer,
            audience: JwtAudience,
            claims: new[] { new Claim(ClaimTypes.NameIdentifier, "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5") },
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
