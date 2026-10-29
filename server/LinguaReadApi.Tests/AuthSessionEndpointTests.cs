using System.Net;
using System.Net.Http.Json;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LinguaReadApi.Tests;

public class AuthSessionEndpointTests
{
    private const string Password = "synthetic-fixture-password";
    private const string SetupToken = "synthetic-operator-setup-token";

    [Fact]
    public async Task Setup_RequiresOperatorToken_AndCannotBeRepeated()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(client, "setup", new { password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post(client, "setup", new { password = Password, setupToken = "wrong" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "setup", new { password = Password, setupToken = SetupToken })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "setup", new { password = "different", setupToken = SetupToken })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "login", new { password = Password })).StatusCode);
    }

    [Fact]
    public async Task Logout_RevokesCopiedCookies_AndNewLoginWorks()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var cookie = Cookie(await Post(client, "setup", new { password = Password, setupToken = SetupToken }));
        foreach (var format in new[] { "simple", "context", "anki" })
            Assert.Equal(HttpStatusCode.OK, (await Get(client, "/api/Words/export?format=" + format, cookie)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "logout", new { }, cookie)).StatusCode);
        foreach (var format in new[] { "simple", "context", "anki" })
            Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, "/api/Words/export?format=" + format, cookie)).StatusCode);
        var freshCookie = Cookie(await Post(client, "login", new { password = Password }));
        Assert.Equal(HttpStatusCode.OK, (await Get(client, "/api/Words/export", freshCookie)).StatusCode);
    }

    [Fact]
    public async Task ChangePassword_RequiresCurrentPassword_RevokesOldSessions()
    {
        using var factory = CreateFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var cookie = Cookie(await Post(client, "setup", new { password = Password, setupToken = SetupToken }));
        var body = new { currentPassword = Password, newPassword = "replacement-fixture-password" };
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "change-password", body)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "change-password", new { currentPassword = "wrong", body.newPassword }, cookie)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post(client, "change-password", new { currentPassword = Password, newPassword = "123" }, cookie)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Get(client, "/api/Words/export", cookie)).StatusCode);
        var changed = await Post(client, "change-password", body, cookie);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, "/api/Words/export", cookie)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Get(client, "/api/Words/export", Cookie(changed))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post(client, "login", new { password = Password })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post(client, "login", new { password = body.newPassword })).StatusCode);
    }

    private static string Cookie(HttpResponseMessage response) => response.Headers.GetValues("Set-Cookie").Single().Split(';')[0];
    private static Task<HttpResponseMessage> Post(HttpClient client, string action, object body, string? cookie = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/" + action) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Requested-With", "XMLHttpRequest");
        if (cookie != null) request.Headers.Add("Cookie", cookie);
        return client.SendAsync(request);
    }
    private static Task<HttpResponseMessage> Get(HttpClient client, string path, string cookie)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("Cookie", cookie);
        return client.SendAsync(request);
    }
    private static WebApplicationFactory<Program> CreateFactory()
    {
        var dbName = Guid.NewGuid().ToString();
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "synthetic-auth-session-key-at-least-32-bytes",
                ["Jwt:Issuer"] = "fixture", ["Jwt:Audience"] = "fixture",
                ["Auth:SetupToken"] = SetupToken,
                ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=unused"
            }));
            builder.ConfigureServices(services =>
            {
                foreach (var descriptor in services.Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>) ||
                    d.ServiceType == typeof(DbContextOptions) || (d.ServiceType.IsGenericType &&
                    d.ServiceType.GetGenericTypeDefinition().Name.StartsWith("IDbContextOptionsConfiguration", StringComparison.Ordinal))).ToList())
                    services.Remove(descriptor);
                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(dbName));
            });
        });
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        db.Users.Add(new User { Id = Guid.Parse("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5"), UserName = "fixture" });
        db.SaveChanges();
        return factory;
    }
}
