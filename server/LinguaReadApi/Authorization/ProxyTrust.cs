using Microsoft.AspNetCore.HttpOverrides;

namespace LinguaReadApi.Authorization;

public static class ProxyTrust
{
    public static ForwardedHeadersOptions CreateOptions(IConfiguration configuration)
    {
        var options = new ForwardedHeadersOptions {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto
        };
        // Retain framework loopback defaults. Docker/LAN proxies opt in by CIDR.
        foreach (var network in configuration.GetSection("ReverseProxy:KnownNetworks").Get<string[]>() ?? [])
            if (!string.IsNullOrWhiteSpace(network)) options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(network));
        return options;
    }
}
