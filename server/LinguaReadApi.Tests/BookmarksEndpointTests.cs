using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// The bookmark endpoints over real HTTP: routing, camelCase JSON binding (what the
/// client and the offline queue send), auth and the CSRF header. Controller logic is
/// covered in BookmarksControllerTests.
/// </summary>
public class BookmarksEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private const string JwtKey = "test-jwt-key-1234567890-abcdefgh";
    private const string JwtIssuer = "LinguaRead.Tests";
    private const string JwtAudience = "LinguaRead.Tests";
    private static readonly Guid UserId = Guid.Parse("c3c3c3c3-d4d4-e5e5-f6f6-a7a7a7a7a7a7");
    private static readonly Guid OtherUserId = Guid.Parse("d4d4d4d4-e5e5-f6f6-a7a7-b8b8b8b8b8b8");

    private readonly WebApplicationFactory<Program> _factory;

    public BookmarksEndpointTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = JwtKey,
                    ["Jwt:Issuer"] = JwtIssuer,
                    ["Jwt:Audience"] = JwtAudience,
                    ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=tests;Username=tests;Password=tests"
                });
            });
            builder.ConfigureServices(services =>
            {
                // Swap Npgsql for InMemory (see ProtectedStaticContentTests).
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
                    options.UseInMemoryDatabase("LinguaReadBookmarkEndpointTests");
                });
            });
        });
    }

    [Fact]
    public async Task WithoutAuth_Returns401()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/bookmarks/1");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Put_WithoutTheCsrfHeader_IsRejected()
    {
        var textId = await SeedTextAsync(UserId);
        var request = Authed(HttpMethod.Put, $"/api/bookmarks/{textId}/1", new { bookmarked = true }, csrfHeader: false);

        var response = await _factory.CreateClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SetGetAndImport_RoundTripAsTheClientSendsThem()
    {
        var textId = await SeedTextAsync(UserId);
        var otherTextId = await SeedTextAsync(UserId);
        var client = _factory.CreateClient();

        // Same body shape as setTextBookmark and the offline replay handler.
        var put = await client.SendAsync(Authed(HttpMethod.Put, $"/api/bookmarks/{textId}/3",
            new { bookmarked = true, clientUpdatedAt = DateTime.UtcNow.AddSeconds(-5).ToString("O") }));
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var afterPut = await ReadJson(put);
        Assert.Equal(textId, afterPut.GetProperty("textId").GetInt32());
        Assert.Equal(new[] { 3 }, afterPut.GetProperty("sentenceIndices").EnumerateArray().Select(e => e.GetInt32()));
        Assert.Equal(3, afterPut.GetProperty("lastSentenceIndex").GetInt32());

        // A timestamp with an offset instead of Z binds too.
        var offsetPut = await client.SendAsync(Authed(HttpMethod.Put, $"/api/bookmarks/{textId}/5",
            new { bookmarked = true, clientUpdatedAt = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(2)).ToString("O") }));
        Assert.Equal(HttpStatusCode.OK, offsetPut.StatusCode);

        var import = await client.SendAsync(Authed(HttpMethod.Post, "/api/bookmarks/import", new
        {
            texts = new object[]
            {
                new { textId = otherTextId, sentenceIndices = new[] { 0, 4 }, lastSentenceIndex = 4 },
                new { textId = 987654, sentenceIndices = new[] { 1 }, lastSentenceIndex = (int?)null }
            }
        }));
        Assert.Equal(HttpStatusCode.OK, import.StatusCode);
        var summary = await ReadJson(import);
        Assert.Equal(2, summary.GetProperty("imported").GetInt32());
        Assert.Equal(1, summary.GetProperty("skippedTexts").GetInt32());

        var get = await client.SendAsync(Authed(HttpMethod.Get, $"/api/bookmarks/{otherTextId}"));
        var imported = await ReadJson(get);
        Assert.Equal(new[] { 0, 4 }, imported.GetProperty("sentenceIndices").EnumerateArray().Select(e => e.GetInt32()));
        Assert.Equal(4, imported.GetProperty("lastSentenceIndex").GetInt32());
    }

    [Fact]
    public async Task AnotherUsersText_Returns404()
    {
        var theirTextId = await SeedTextAsync(OtherUserId);
        var client = _factory.CreateClient();

        var get = await client.SendAsync(Authed(HttpMethod.Get, $"/api/bookmarks/{theirTextId}"));
        var put = await client.SendAsync(Authed(HttpMethod.Put, $"/api/bookmarks/{theirTextId}/1", new { bookmarked = true }));

        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, put.StatusCode);
    }

    private static int _nextTextId = 3_000_000;

    private async Task<int> SeedTextAsync(Guid ownerId)
    {
        var textId = Interlocked.Increment(ref _nextTextId);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Texts.Add(new Text { TextId = textId, UserId = ownerId, LanguageId = 1, Title = "Bookmarks", Content = "Uno. Dos." });
        await db.SaveChangesAsync();
        return textId;
    }

    private static HttpRequestMessage Authed(HttpMethod method, string path, object? body = null, bool csrfHeader = true)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add("Cookie", $".LinguaRead.Auth={CreateJwt()}");
        if (csrfHeader) request.Headers.Add("X-Requested-With", "XMLHttpRequest");
        if (body != null) request.Content = JsonContent.Create(body);
        return request;
    }

    private static async Task<JsonElement> ReadJson(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static string CreateJwt()
    {
        var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey));
        var token = new JwtSecurityToken(
            issuer: JwtIssuer,
            audience: JwtAudience,
            claims: new[] { new Claim(ClaimTypes.NameIdentifier, UserId.ToString()) },
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
