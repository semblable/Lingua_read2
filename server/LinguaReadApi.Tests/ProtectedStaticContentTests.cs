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
using LinguaReadApi.Models;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// User-uploaded content under wwwroot (/audio_lessons, /audiobooks, /epub_assets) has
/// guessable paths, so the pipeline gates those prefixes behind authentication AND ownership.
/// These tests pin that gate: anonymous → 401; authenticated but not the owner → 403; the
/// owner passes through to the static-file middleware (404 here because the file doesn't exist —
/// the point is it's neither 401 nor 403).
/// </summary>
public class ProtectedStaticContentTests : IClassFixture<WebApplicationFactory<Program>>
{
    // 32+ bytes: HS256 signing requires a 256-bit key.
    private const string JwtKey = "test-jwt-key-1234567890-abcdefgh";
    private const string JwtIssuer = "LinguaRead.Tests";
    private const string JwtAudience = "LinguaRead.Tests";
    // The authenticated caller in these tests; ownership is checked against this id.
    private const string UserId = "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5";
    private const string OtherUserId = "b9b9b9b9-c8c8-d7d7-e6e6-f5f5f5f5f5f5";

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
                // Remove the app's Npgsql registration — both the built options and the EF Core 9+
                // options-configuration service — so the InMemory provider below is the only one;
                // otherwise EF sees two providers and throws when the context is first queried.
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

    [Theory]
    // Both prefixes embed the owner's user id as the first path segment.
    [InlineData("/audio_lessons/" + UserId + "/does-not-exist.mp3")]
    [InlineData("/epub_assets/" + UserId + "/1/cover.jpg")]
    public async Task OwnedContent_WithAuthCookie_PassesTheGate(string path)
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Cookie", $".LinguaRead.Auth={CreateJwt()}");

        var response = await client.SendAsync(request);

        // Caller owns the content; the file doesn't exist, so static middleware yields 404
        // (not 401/403) — the gate let us through.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task OwnedAudiobook_WithAuthCookie_PassesTheGate()
    {
        // Audiobooks key on an int book id, so ownership is a DB lookup. Seed a book owned by the
        // caller and confirm the request reaches the (empty) static middleware → 404.
        await SeedBookAsync(bookId: 4242, ownerId: UserId);
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/audiobooks/4242/track_1.mp3");
        request.Headers.Add("Cookie", $".LinguaRead.Auth={CreateJwt()}");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("/audio_lessons/" + OtherUserId + "/secret.mp3")]
    [InlineData("/epub_assets/" + OtherUserId + "/1/cover.jpg")]
    [InlineData("/audiobooks/999999/track_1.mp3")] // no such book owned by the caller
    public async Task OtherUsersContent_WithAuthCookie_Returns403(string path)
    {
        var client = _factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Cookie", $".LinguaRead.Auth={CreateJwt()}");

        var response = await client.SendAsync(request);

        // Authenticated, but the content belongs to another user (or no such owned book): 403,
        // not 404 — ownership is enforced, not just authentication.
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private async Task SeedBookAsync(int bookId, string ownerId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (!await db.Books.AnyAsync(b => b.BookId == bookId))
        {
            db.Books.Add(new Book { BookId = bookId, Title = "Owned", UserId = Guid.Parse(ownerId), LanguageId = 1 });
            await db.SaveChangesAsync();
        }
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
            claims: new[] { new Claim(ClaimTypes.NameIdentifier, UserId) },
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
