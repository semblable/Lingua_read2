using System.Net;
using LinguaReadApi.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace LinguaReadApi.Tests;

public class ProxyTrustTests
{
    [Theory]
    [InlineData("203.0.113.20", false)]
    [InlineData("172.20.0.5", true)]
    [InlineData("::ffff:172.20.0.5", true)]
    [InlineData("127.0.0.1", true)]
    public async Task ForwardedHeaders_AreAcceptedOnlyFromTrustedPeers(string peer, bool trusted)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["ReverseProxy:KnownNetworks:0"] = "172.20.0.0/16"
        }).Build();
        var context = new DefaultHttpContext();
        context.Request.Scheme = "http";
        context.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        context.Request.Headers["X-Forwarded-For"] = "198.51.100.2";
        context.Request.Headers["X-Forwarded-Proto"] = "https";
        var middleware = new ForwardedHeadersMiddleware(_ => Task.CompletedTask, NullLoggerFactory.Instance,
            Options.Create(ProxyTrust.CreateOptions(config)));
        await middleware.Invoke(context);
        Assert.Equal(trusted ? "https" : "http", context.Request.Scheme);
        Assert.Equal(trusted ? "198.51.100.2" : peer, context.Connection.RemoteIpAddress!.ToString());
    }
}
