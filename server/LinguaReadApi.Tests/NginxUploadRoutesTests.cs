using System.Reflection;
using System.Text.RegularExpressions;
using LinguaReadApi.Authorization;
using LinguaReadApi.Controllers;
using LinguaReadApi.Utilities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// nginx caps request bodies at Kestrel's 30 MB default and only raises the cap on the upload
/// routes it lists, after an auth subrequest. An endpoint that raises [RequestSizeLimit] without a
/// matching nginx route would be refused with 413 before reaching the API, so keep the two in step.
/// </summary>
public class NginxUploadRoutesTests
{
    // Program.cs: serverOptions.Limits.MaxRequestBodySize.
    private const long KestrelDefaultLimit = 30L * 1024 * 1024;
    private const string SessionCheck = "/api/internal/upload/session";
    private const string AdminCheck = "/api/internal/upload/admin";

    public static TheoryData<string> Configs => new() { "nginx.conf", "nginx.ssl.conf" };

    [Theory]
    [MemberData(nameof(Configs))]
    public void LargeUploadEndpoints_HaveMatchingAuthenticatedNginxRoutes(string configName)
    {
        var config = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "nginx", configName));
        Assert.Matches(@"^\s*client_max_body_size 30M;", config.Split('\n').First(line => line.Contains("client_max_body_size")));

        var locations = ParseUploadLocations(config);
        var endpoints = LargeUploadEndpoints().ToList();
        Assert.NotEmpty(endpoints);

        var subrequestBlock = Regex.Match(config, @"location\s+\^~\s+/api/internal/upload/\s*\{(?<body>[^{}]*)\}");
        Assert.True(subrequestBlock.Success, $"{configName}: missing /api/internal/upload/ block.");
        var subrequestLimitBytes = long.Parse(Regex.Match(subrequestBlock.Groups["body"].Value, @"client_max_body_size\s+(\d+)M;").Groups[1].Value) * 1024 * 1024;
        Assert.Equal(endpoints.Max(e => e.LimitBytes), subrequestLimitBytes);

        foreach (var endpoint in endpoints)
        {
            var location = Assert.Single(locations, l => Regex.IsMatch(endpoint.SamplePath, l.Pattern, RegexOptions.IgnoreCase));
            Assert.True(location.MaxBodyBytes == endpoint.LimitBytes,
                $"{configName}: {endpoint.SamplePath} allows {location.MaxBodyBytes} bytes in nginx but {endpoint.LimitBytes} in the API.");
            Assert.Equal(endpoint.AdminOnly ? AdminCheck : SessionCheck, location.AuthRequest);
            Assert.True(location.ForwardsPreflight, $"{configName}: {location.Pattern} must forward CORS preflights.");
        }

        foreach (var location in locations)
        {
            Assert.True(endpoints.Any(e => Regex.IsMatch(e.SamplePath, location.Pattern, RegexOptions.IgnoreCase)),
                $"{configName}: {location.Pattern} raises the body limit for no API upload endpoint.");
        }
    }

    [Theory]
    [InlineData(@"C:\fakepath\book.epub", "book.epub")]
    [InlineData("/tmp/audio.mp3", "audio.mp3")]
    [InlineData("plain.srt", "plain.srt")]
    public void UploadFileName_StripsWindowsAndUnixPaths(string rawFileName, string expected)
    {
        Assert.Equal(expected, UploadFileName.Get(rawFileName));
    }

    private sealed record UploadEndpoint(string SamplePath, long LimitBytes, bool AdminOnly);

    private sealed record UploadLocation(string Pattern, long MaxBodyBytes, string? AuthRequest, bool ForwardsPreflight);

    private static IEnumerable<UploadEndpoint> LargeUploadEndpoints()
    {
        var controllers = typeof(AuthController).Assembly.GetTypes()
            .Where(t => t.IsSubclassOf(typeof(ControllerBase)) && !t.IsAbstract);
        foreach (var controller in controllers)
        {
            var prefix = controller.GetCustomAttribute<RouteAttribute>()?.Template
                .Replace("[controller]", controller.Name[..^"Controller".Length]) ?? "";
            foreach (var action in controller.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly))
            {
                var limit = action.GetCustomAttributes().OfType<IRequestSizeLimitMetadata>().SingleOrDefault()?.MaxRequestBodySize;
                if (limit is not > KestrelDefaultLimit) continue;

                var adminOnly = controller.GetCustomAttributes<AuthorizeAttribute>()
                    .Concat(action.GetCustomAttributes<AuthorizeAttribute>())
                    .Any(a => a.Policy == AdminOnlyRequirement.PolicyName);
                foreach (var template in action.GetCustomAttributes<HttpMethodAttribute>().Select(a => a.Template))
                {
                    var route = string.IsNullOrEmpty(template) ? prefix : $"{prefix}/{template}";
                    yield return new UploadEndpoint("/" + Regex.Replace(route, @"\{[^}]+\}", "1"), limit.Value, adminOnly);
                }
            }
        }
    }

    private static List<UploadLocation> ParseUploadLocations(string config) =>
        Regex.Matches(config, @"location\s+~\*\s+(?<pattern>\S+)\s*\{(?<body>(?:[^{}]|\{[^{}]*\})*)\}")
            .Select(m => (Pattern: m.Groups["pattern"].Value, Body: m.Groups["body"].Value))
            .Where(l => l.Body.Contains("client_max_body_size"))
            .Select(l => new UploadLocation(
                l.Pattern,
                long.Parse(Regex.Match(l.Body, @"client_max_body_size\s+(\d+)M;").Groups[1].Value) * 1024 * 1024,
                Regex.Match(l.Body, @"auth_request\s+(\S+);") is { Success: true } auth ? auth.Groups[1].Value : null,
                l.Body.Contains("if ($request_method = OPTIONS) { rewrite ^ /_upload_options last; }")))
            .ToList();
}
