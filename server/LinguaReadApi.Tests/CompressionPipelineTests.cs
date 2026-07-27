using System.IdentityModel.Tokens.Jwt;
using System.IO.Compression;
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
/// Pins the interplay between response compression and the reader hot path:
/// - GET /api/texts/{id} must come back compressed AND keep its strong ETag (the whole point
///   of compressing at the app instead of nginx is that nginx's gzip filter strips ETags).
/// - Conditional requests (If-None-Match) must still short-circuit to 304 with compression on.
/// - Audio static files must NOT be compressed: Content-Encoding on media would break byte-range
///   seeking in the player.
/// </summary>
public class CompressionPipelineTests : IClassFixture<WebApplicationFactory<Program>>
{
    private const string JwtKey = "test-jwt-key-1234567890-abcdefgh";
    private const string JwtIssuer = "LinguaRead.Tests";
    private const string JwtAudience = "LinguaRead.Tests";
    private const string UserId = "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5";
    private const int TextId = 7777;

    private readonly WebApplicationFactory<Program> _factory;

    public CompressionPipelineTests(WebApplicationFactory<Program> factory)
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
                    options.UseInMemoryDatabase("LinguaReadCompressionTests");
                });
            });
        });
    }

    [Fact]
    public async Task GetText_WithAcceptEncodingBrotli_ReturnsCompressedJson_AndKeepsETag()
    {
        await SeedTextAsync();
        var client = _factory.CreateClient();

        var response = await SendGetTextAsync(client, acceptEncoding: "br");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("br", response.Content.Headers.ContentEncoding);
        Assert.NotNull(response.Headers.ETag); // strong ETag survives app-level compression

        // The compressed bytes must round-trip to the same JSON payload.
        await using var body = await response.Content.ReadAsStreamAsync();
        await using var brotli = new BrotliStream(body, CompressionMode.Decompress);
        using var reader = new StreamReader(brotli, Encoding.UTF8);
        var json = await reader.ReadToEndAsync();
        Assert.Contains("Compression fixture text", json);
    }

    [Fact]
    public async Task GetText_WithIfNoneMatch_StillReturns304_WhenCompressionIsActive()
    {
        await SeedTextAsync();
        var client = _factory.CreateClient();

        var first = await SendGetTextAsync(client, acceptEncoding: "br");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var etag = first.Headers.ETag!.ToString();

        var second = await SendGetTextAsync(client, acceptEncoding: "br", ifNoneMatch: etag);

        Assert.Equal(HttpStatusCode.NotModified, second.StatusCode);
    }

    [Fact]
    public async Task AudioStaticFiles_AreNotCompressed_AndStaySeekable()
    {
        var env = _factory.Services.GetRequiredService<IWebHostEnvironment>();
        var audioDir = Path.Combine(env.ContentRootPath, "wwwroot", "audio_lessons", UserId);
        Directory.CreateDirectory(audioDir);
        var audioFile = Path.Combine(audioDir, "compression-regression.mp3");
        // Content > gzip_min_length-style thresholds so "not compressed" is a real assertion,
        // not just a small-response accident.
        await File.WriteAllBytesAsync(audioFile, Encoding.ASCII.GetBytes(new string('a', 4096)));

        try
        {
            var client = _factory.CreateClient();
            var request = new HttpRequestMessage(
                HttpMethod.Get, $"/audio_lessons/{UserId}/compression-regression.mp3");
            request.Headers.Add("Cookie", $".LinguaRead.Auth={CreateJwt()}");
            request.Headers.AcceptEncoding.ParseAdd("br");
            request.Headers.AcceptEncoding.ParseAdd("gzip");

            var response = await client.SendAsync(request);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Empty(response.Content.Headers.ContentEncoding);
            Assert.Contains("bytes", response.Headers.AcceptRanges);
        }
        finally
        {
            File.Delete(audioFile);
        }
    }

    private static async Task<HttpResponseMessage> SendGetTextAsync(
        HttpClient client, string acceptEncoding, string? ifNoneMatch = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"/api/texts/{TextId}");
        request.Headers.Add("Cookie", $".LinguaRead.Auth={CreateJwt()}");
        request.Headers.AcceptEncoding.ParseAdd(acceptEncoding);
        if (ifNoneMatch != null)
        {
            request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        }
        return await client.SendAsync(request);
    }

    private async Task SeedTextAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        if (!await db.Texts.AnyAsync(t => t.TextId == TextId))
        {
            if (!await db.Languages.AnyAsync(l => l.LanguageId == 1))
            {
                db.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
            }
            db.Texts.Add(new Text
            {
                TextId = TextId,
                UserId = Guid.Parse(UserId),
                LanguageId = 1,
                Title = "Compression fixture",
                Content = "Compression fixture text " + new string('x', 2048),
                CreatedAt = new DateTime(2026, 5, 1, 10, 0, 0, DateTimeKind.Utc)
            });
            await db.SaveChangesAsync();
        }
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
