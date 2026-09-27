using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;

namespace LinguaReadApi.Services.News
{
    /// <summary>
    /// Feed and article URLs come from users and from feeds, so the server must not fetch them from
    /// its own network: the database, the monitoring ports on the host, a cloud metadata endpoint.
    /// The handler this builds checks every address it connects to, at connect time, so a redirect
    /// or a host name that resolves to a private address is refused as well.
    /// </summary>
    public static class PublicAddressGuard
    {
        public static SocketsHttpHandler CreateHandler() => new()
        {
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 5,
            AutomaticDecompression = DecompressionMethods.All,
            ConnectTimeout = TimeSpan.FromSeconds(10),
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            // A proxy would be the address checked instead of the site.
            UseProxy = false,
            ConnectCallback = ConnectAsync
        };

        private static async ValueTask<Stream> ConnectAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
        {
            var host = context.DnsEndPoint.Host;
            var addresses = IPAddress.TryParse(host, out var literal)
                ? new[] { literal }
                : await Dns.GetHostAddressesAsync(host, cancellationToken);
            var allowed = addresses.Where(IsPublic).ToArray();
            if (allowed.Length == 0)
            {
                throw new NotPublicAddressException($"{host} is not a public internet address.");
            }

            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(allowed, context.DnsEndPoint.Port, cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        }

        /// <summary>
        /// False for loopback, private, link-local, carrier-grade NAT, multicast, documentation and
        /// other reserved ranges, IPv4 and IPv6 alike (including IPv4 addresses embedded in IPv6).
        /// </summary>
        public static bool IsPublic(IPAddress address)
        {
            if (address.IsIPv4MappedToIPv6)
            {
                address = address.MapToIPv4();
            }

            if (address.AddressFamily == AddressFamily.InterNetwork)
            {
                var b = address.GetAddressBytes();
                return !(b[0] == 0                                   // 0.0.0.0/8 "this network"
                    || b[0] == 10                                    // 10/8 private
                    || b[0] == 127                                   // loopback
                    || (b[0] == 100 && b[1] >= 64 && b[1] <= 127)    // 100.64/10 carrier-grade NAT
                    || (b[0] == 169 && b[1] == 254)                  // link-local, cloud metadata
                    || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)     // 172.16/12 private (Docker)
                    || (b[0] == 192 && b[1] == 0 && b[2] == 0)       // 192.0.0/24 IETF
                    || (b[0] == 192 && b[1] == 0 && b[2] == 2)       // TEST-NET-1
                    || (b[0] == 192 && b[1] == 168)                  // 192.168/16 private
                    || (b[0] == 198 && (b[1] == 18 || b[1] == 19))   // 198.18/15 benchmarking
                    || (b[0] == 198 && b[1] == 51 && b[2] == 100)    // TEST-NET-2
                    || (b[0] == 203 && b[1] == 0 && b[2] == 113)     // TEST-NET-3
                    || b[0] >= 224);                                 // multicast, reserved, broadcast
            }

            if (address.AddressFamily == AddressFamily.InterNetworkV6)
            {
                if (address.Equals(IPAddress.IPv6Any) || address.Equals(IPAddress.IPv6Loopback)
                    || address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast)
                {
                    return false;
                }

                var b = address.GetAddressBytes();
                if ((b[0] & 0xFE) == 0xFC) return false;                               // fc00::/7 unique local
                if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0D && b[3] == 0xB8) return false; // 2001:db8::/32 documentation
                if (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x00 && b[3] == 0x00) return false; // 2001::/32 Teredo
                if (b[0] == 0x20 && b[1] == 0x02)                                      // 2002::/16 6to4 embeds an IPv4
                {
                    return IsPublic(new IPAddress(b[2..6]));
                }
                if (b[0] == 0x00 && b[1] == 0x64 && b[2] == 0xFF && b[3] == 0x9B)      // 64:ff9b::/96 NAT64 embeds an IPv4
                {
                    return IsPublic(new IPAddress(b[12..16]));
                }
                // Anything else outside 2000::/3 (global unicast) is reserved.
                return (b[0] & 0xE0) == 0x20;
            }

            return false;
        }
    }

    /// <summary>The guard's refusal: the address isn't on the public internet, so it never will be fetched.</summary>
    public sealed class NotPublicAddressException : HttpRequestException
    {
        public NotPublicAddressException(string message) : base(message) { }
    }
}
