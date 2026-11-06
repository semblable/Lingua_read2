using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using LinguaReadApi.Authorization;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LinguaReadApi.Tests;

public class LocalModeTests
{
    [Theory]
    [InlineData("localhost", "127.0.0.1", null, null, true)]
    [InlineData("127.0.0.1:5000", "127.0.0.1", "http://127.0.0.1:3000", "same-site", true)]
    [InlineData("[::1]:5000", "::1", "http://[::1]:5000", "same-origin", true)]
    [InlineData("localhost", "::ffff:127.0.0.1", null, "none", true)]
    [InlineData("evil.example", "127.0.0.1", null, null, false)]
    [InlineData("localhost.evil.example", "127.0.0.1", null, null, false)]
    [InlineData("192.168.1.2", "127.0.0.1", null, null, false)]
    [InlineData("localhost", "192.168.1.2", null, null, false)]
    [InlineData("localhost", "127.0.0.1", "https://evil.example", null, false)]
    [InlineData("localhost", "127.0.0.1", "null", null, false)]
    [InlineData("localhost", "127.0.0.1", "http://localhost", "cross-site", false)]
    public void NativeBoundary_RejectsRemotePeersRebindingAndBrowserCrossSiteRequests(
        string host, string peer, string? origin, string? fetchSite, bool accepted)
    {
        var context = Request(host, peer);
        if (origin != null) context.Request.Headers.Origin = origin;
        if (fetchSite != null) context.Request.Headers["Sec-Fetch-Site"] = fetchSite;
        Assert.Equal(accepted, LocalMode.AcceptsRequest(context, Configuration()));
    }

    [Theory]
    [InlineData("172.20.0.5", true)]
    [InlineData("::ffff:172.20.0.5", true)]
    [InlineData("172.21.0.5", false)]
    [InlineData("203.0.113.3", false)]
    public void ProxyBoundary_UsesOriginalSocketPeer_NotSpoofedForwardingHeaders(string peer, bool accepted)
    {
        var context = Request("localhost", peer);
        context.Request.Headers["X-Forwarded-For"] = "127.0.0.1";
        context.Request.Headers["X-Original-For"] = "127.0.0.1";
        Assert.Equal(accepted, LocalMode.AcceptsRequest(context, Configuration(proxy: true)));
        Assert.False(LocalMode.AcceptsRequest(context, Configuration(proxy: false)));
        context.Request.Headers.Remove("X-Forwarded-For");
        Assert.False(LocalMode.AcceptsRequest(context, Configuration(proxy: true)));
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    [InlineData("PATCH")]
    public void LocalMutations_RequireCsrfHeaderWithoutCookie(string method)
    {
        var context = Request("localhost", "127.0.0.1");
        context.Request.Method = method;
        Assert.False(LocalMode.AcceptsRequest(context, Configuration()));
        context.Request.Headers["X-Requested-With"] = "XMLHttpRequest";
        Assert.True(LocalMode.AcceptsRequest(context, Configuration()));
    }

    [Theory]
    [InlineData("127.0.0.1", true)]
    [InlineData("::1", true)]
    [InlineData("::ffff:127.0.0.1, 127.0.0.1", true)]
    [InlineData("198.51.100.9", false)]
    [InlineData("127.0.0.1, 198.51.100.9", false)]
    [InlineData("198.51.100.9, 127.0.0.1", false)]
    [InlineData("not-an-address", false)]
    public void NativeDevelopmentProxy_CannotTurnRemoteClientsIntoLocalOnes(string forwarded, bool accepted)
    {
        var context = Request("localhost", "127.0.0.1");
        context.Request.Headers["X-Forwarded-For"] = forwarded;
        Assert.Equal(accepted, LocalMode.AcceptsRequest(context, Configuration()));
    }

    [Fact]
    public async Task NativePipeline_RejectsLanClientForwardedThroughLoopbackDevelopmentProxy()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/status");
        request.Headers.Add("X-Forwarded-For", "127.0.0.1, 198.51.100.9");
        request.Headers.Add("Sec-Fetch-Site", "same-origin");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(request)).StatusCode);
        var local = new HttpRequestMessage(HttpMethod.Get, "/api/auth/status");
        local.Headers.Add("X-Forwarded-For", "::1");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(local)).StatusCode);
    }

    [Fact]
    public void LocalMode_IsOptIn_AndNativeListenerIsLoopbackOnly()
    {
        var defaults = new ConfigurationBuilder().Build();
        Assert.False(LocalMode.IsEnabled(defaults));
        Assert.False(LocalMode.UsesProxy(defaults));
        Assert.Equal("http://0.0.0.0:5000", LocalMode.ListenUrl(defaults));
        Assert.Equal("http://127.0.0.1:5000", LocalMode.ListenUrl(Configuration()));
        Assert.Equal("http://0.0.0.0:5000", LocalMode.ListenUrl(Configuration(proxy: true)));
    }

    [Fact]
    public async Task FreshLocalInstall_AuthenticatesOwnerWithoutPasswordJwtOrSetup_AndKeepsOwnershipGates()
    {
        using var factory = Factory();
        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/auth/status");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Set-Cookie"));
        var status = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(status.GetProperty("authenticated").GetBoolean());
        Assert.True(status.GetProperty("localMode").GetBoolean());
        Assert.False(status.GetProperty("needsSetup").GetBoolean());
        Assert.Equal(LocalMode.OwnerId.ToString(), status.GetProperty("user").GetProperty("id").GetString());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/Words/export")).StatusCode);
        // Invalid create proves that both authentication and AdminOnly passed,
        // without creating data or executing an operational admin action.
        var create = new HttpRequestMessage(HttpMethod.Post, "/api/Languages") { Content = JsonContent.Create(new { }) };
        create.Headers.Add("X-Requested-With", "XMLHttpRequest");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(create)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/audio_lessons/{LocalMode.OwnerId}/local-mode-fixture-missing.mp3")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/audio_lessons/b9b9b9b9-c8c8-d7d7-e6e6-f5f5f5f5f5f5/fixture.mp3")).StatusCode);
        using var scope = factory.Services.CreateScope();
        Assert.Equal(LocalMode.Scheme, (await scope.ServiceProvider.GetRequiredService<IAuthenticationSchemeProvider>().GetDefaultAuthenticateSchemeAsync())!.Name);
        Assert.Null((await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.FindAsync(LocalMode.OwnerId))!.PasswordHash);
    }

    [Fact]
    public async Task LocalPipeline_RejectsUnsafeNoCookieRequests_AndDoesNotChangeExistingCredentials()
    {
        using var factory = Factory(password: true);
        using var client = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var owner = (await db.Users.FindAsync(LocalMode.OwnerId))!;
        var hash = owner.PasswordHash;
        var stamp = owner.SecurityStamp;
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/auth/logout", new { })).StatusCode);
        foreach (var action in new[] { "login", "setup", "change-password", "logout" })
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/" + action) {
                Content = JsonContent.Create(new { password = Password, newPassword = "replacement-fixture-password", currentPassword = Password })
            };
            request.Headers.Add("X-Requested-With", "XMLHttpRequest");
            var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.False(response.Headers.Contains("Set-Cookie"));
        }
        await db.Entry(owner).ReloadAsync();
        Assert.Equal(hash, owner.PasswordHash);
        Assert.Equal(stamp, owner.SecurityStamp);
    }

    [Theory]
    [InlineData("203.0.113.9", "localhost", false, HttpStatusCode.Forbidden)]
    [InlineData("172.20.0.5", "localhost", true, HttpStatusCode.OK)]
    [InlineData("172.21.0.5", "localhost", true, HttpStatusCode.Forbidden)]
    [InlineData("127.0.0.1", "evil.example", false, HttpStatusCode.Forbidden)]
    public async Task Pipeline_ValidatesBoundaryBeforeForwardingCanReplaceThePeer(string peer, string host, bool proxy, HttpStatusCode expected)
    {
        using var factory = Factory(peer: peer, proxy: proxy);
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/status");
        request.Headers.Host = host;
        request.Headers.Add("X-Forwarded-For", "127.0.0.1");
        request.Headers.Add("X-Original-For", "172.20.0.5");
        Assert.Equal(expected, (await client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task MissingOwner_IsNeverAutomaticallyAuthorized()
    {
        using var factory = Factory(seedOwner: false);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/Words/export")).StatusCode);
        var status = await client.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.False(status.GetProperty("authenticated").GetBoolean());
        Assert.Equal(JsonValueKind.Null, status.GetProperty("user").ValueKind);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DisablingLocalMode_RestoresNormalPasswordOrSetupFlow(bool hasPassword)
    {
        using var factory = Factory(local: false, password: hasPassword);
        using var client = factory.CreateClient();
        var status = await client.GetFromJsonAsync<JsonElement>("/api/auth/status");
        Assert.False(status.GetProperty("localMode").GetBoolean());
        Assert.False(status.GetProperty("authenticated").GetBoolean());
        Assert.Equal(!hasPassword, status.GetProperty("needsSetup").GetBoolean());
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/Words/export")).StatusCode);
        if (hasPassword)
        {
            var login = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login") { Content = JsonContent.Create(new { password = Password }) };
            login.Headers.Add("X-Requested-With", "XMLHttpRequest");
            Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(login)).StatusCode);
        }
    }

    private const string Password = "local-mode-existing-fixture-password";

    private static DefaultHttpContext Request(string host, string peer)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = "GET";
        context.Request.Host = new HostString(host);
        context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        return context;
    }

    private static IConfiguration Configuration(bool proxy = false) => new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
        ["Auth:LocalMode"] = "true", ["Auth:LocalProxy"] = proxy.ToString(), ["ReverseProxy:KnownNetworks:0"] = "172.20.0.0/16"
    }).Build();

    private static WebApplicationFactory<Program> Factory(bool local = true, bool proxy = false,
        string peer = "127.0.0.1", bool password = false, bool seedOwner = true)
    {
        var dbName = Guid.NewGuid().ToString();
        var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["Auth:LocalMode"] = local.ToString(), ["Auth:LocalProxy"] = proxy.ToString(),
                ["ReverseProxy:KnownNetworks:0"] = "172.20.0.0/16",
                ["Jwt:Key"] = local ? "" : "synthetic-normal-auth-fixture-key-at-least32bytes",
                ["Jwt:Issuer"] = "fixture", ["Jwt:Audience"] = "fixture",
                ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=unused"
            }));
            builder.ConfigureServices(services => {
                foreach (var descriptor in services.Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>) ||
                    d.ServiceType == typeof(DbContextOptions) || (d.ServiceType.IsGenericType &&
                    d.ServiceType.GetGenericTypeDefinition().Name.StartsWith("IDbContextOptionsConfiguration", StringComparison.Ordinal))).ToList()) services.Remove(descriptor);
                services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(dbName));
                services.AddSingleton<IStartupFilter>(new PeerFilter(peer));
            });
        });
        using var scope = factory.Services.CreateScope();
        if (seedOwner)
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var owner = new User { Id = LocalMode.OwnerId, UserName = "fixture", Email = "local@example.test", SecurityStamp = "preserved-fixture-stamp" };
            if (password) owner.PasswordHash = new PasswordHasher<User>().HashPassword(owner, Password);
            db.Users.Add(owner);
            db.SaveChanges();
        }
        return factory;
    }

    private sealed class PeerFilter(string peer) : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app => {
            app.Use((context, continuation) => {
                context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
                return continuation(context);
            });
            next(app);
        };
    }
}
