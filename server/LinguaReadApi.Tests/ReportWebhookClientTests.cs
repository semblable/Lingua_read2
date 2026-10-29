using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LinguaReadApi.Tests;

public class ReportWebhookClientTests
{
    [Fact]
    public async Task ReportClient_RefusesPrivateDestinationBeforeSending()
    {
        using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = "synthetic-webhook-wiring-key-at-least-32-bytes",
                ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=unused"
            }));
        });
        var clients = factory.Services.GetRequiredService<IHttpClientFactory>();
        using var client = clients.CreateClient("ReportWebhook");
        var error = await Assert.ThrowsAsync<HttpRequestException>(() =>
            client.PostAsync("https://127.0.0.1/webhook/report/synthetic", new StringContent("fixture")));
        Assert.Contains("not a public internet address", error.GetBaseException().Message);

        // Verify the actual named client's redirect policy, rather than a separate test handler.
        var handler = factory.Services.GetRequiredService<IHttpMessageHandlerFactory>().CreateHandler("ReportWebhook");
        while (handler is DelegatingHandler wrapper) handler = wrapper.InnerHandler!;
        var socketHandler = Assert.IsType<SocketsHttpHandler>(handler);
        Assert.False(socketHandler.AllowAutoRedirect);
        Assert.False(socketHandler.UseProxy);
    }
}
