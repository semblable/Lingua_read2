using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace LinguaReadApi.Authorization;

/// <summary>The request boundary for an explicitly enabled, single-owner local install.</summary>
public static class LocalMode
{
    public const string Scheme = "LocalOwner";
    public static readonly Guid OwnerId = new("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5");

    public static bool IsEnabled(IConfiguration configuration) => configuration.GetValue<bool>("Auth:LocalMode");
    public static bool UsesProxy(IConfiguration configuration) => configuration.GetValue<bool>("Auth:LocalProxy");

    public static string ListenUrl(IConfiguration configuration) =>
        IsEnabled(configuration) && !UsesProxy(configuration) ? "http://127.0.0.1:5000" : "http://0.0.0.0:5000";

    public static bool IsLoopbackHost(string host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
        (IPAddress.TryParse(host.Trim('[', ']'), out var address) && IsLoopback(address));

    private static bool IsLoopback(IPAddress address) => IPAddress.IsLoopback(address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address);

    public static bool AcceptsRequest(HttpContext context, IConfiguration configuration)
    {
        // Validate the original socket peer BEFORE ForwardedHeaders can replace it.
        // X-Original-For supplied by a caller is never evidence of proxy trust.
        var peer = context.Connection.RemoteIpAddress;
        if (peer == null) return false;
        if (!UsesProxy(configuration))
        {
            // A same-machine development proxy can reach the loopback listener
            // on behalf of a LAN client. Vite forwards the actual client address;
            // require every hop to remain local, including appended/spoofed lists.
            foreach (var forwarded in context.Request.Headers["X-Forwarded-For"])
                foreach (var hop in (forwarded ?? "").Split(','))
                    if (!IPAddress.TryParse(hop.Trim(), out var address) || !IsLoopback(address)) return false;
        }
        if (!IsLoopback(peer))
        {
            if (!UsesProxy(configuration) || !IsTrustedProxy(peer, ProxyTrust.CreateOptions(configuration)) ||
                string.IsNullOrWhiteSpace(context.Request.Headers["X-Forwarded-For"])) return false;
        }

        // A loopback listener alone does not prevent browser DNS rebinding.
        if (!IsLoopbackHost(context.Request.Host.Host)) return false;
        var origin = context.Request.Headers.Origin;
        if (origin.Count > 0 && (origin.Count != 1 || !Uri.TryCreate(origin[0], UriKind.Absolute, out var uri) ||
            (uri.Scheme != "http" && uri.Scheme != "https") || !IsLoopbackHost(uri.Host))) return false;
        if (string.Equals(context.Request.Headers["Sec-Fetch-Site"], "cross-site", StringComparison.OrdinalIgnoreCase)) return false;

        // Local authentication has no cookie, so the ordinary cookie-only CSRF
        // gate is insufficient. Cross-origin forms cannot supply this header.
        return HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method) ||
            HttpMethods.IsOptions(context.Request.Method) || context.Request.Headers["X-Requested-With"] == "XMLHttpRequest";
    }

    private static bool IsTrustedProxy(IPAddress address, ForwardedHeadersOptions options)
    {
        var normalized = address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
        return options.KnownProxies.Any(known => known.Equals(address) || known.Equals(normalized)) ||
            options.KnownIPNetworks.Any(network => network.Contains(address) || network.Contains(normalized));
    }
}

public sealed class LocalModeBoundaryMiddleware(RequestDelegate next, IConfiguration configuration)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (LocalMode.IsEnabled(configuration) && !LocalMode.AcceptsRequest(context, configuration))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsync("Local mode accepts only local requests with the required request headers.");
            return;
        }
        await next(context);
    }
}
