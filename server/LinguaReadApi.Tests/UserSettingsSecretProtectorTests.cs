using System;
using System.Security.Cryptography;
using LinguaReadApi.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// <see cref="UserSettingsSecretProtector.Logger"/> is process-wide and every WebApplicationFactory
/// host overwrites it on startup. Tests that set or assert on it belong to this collection: xUnit runs
/// it alone, after the parallel collections (and their host fixtures) have finished.
/// </summary>
[CollectionDefinition(Name, DisableParallelization = true)]
public class SecretProtectorLoggerCollection
{
    public const string Name = "UserSettingsSecretProtector.Logger";
}

[Collection(SecretProtectorLoggerCollection.Name)]
public class UserSettingsSecretProtectorTests
{
    private static IDataProtector CreateProtector() =>
        new EphemeralDataProtectionProvider().CreateProtector(UserSettingsSecretProtector.Purpose);

    [Fact]
    public void Protect_ProducesCiphertext_ThatRoundTrips()
    {
        var protector = CreateProtector();
        const string secret = "sk-or-super-secret-value";

        var stored = UserSettingsSecretProtector.Protect(protector, secret);

        Assert.NotNull(stored);
        Assert.NotEqual(secret, stored); // stored value is ciphertext, not the plaintext key
        Assert.Equal(secret, UserSettingsSecretProtector.Unprotect(protector, stored));
    }

    [Fact]
    public void Unprotect_PassesThroughLegacyPlaintext()
    {
        var protector = CreateProtector();

        // A value written before encryption was introduced cannot be unprotected; it must be
        // returned unchanged so existing rows keep working (they re-encrypt on next save).
        Assert.Equal("legacy-plaintext-token", UserSettingsSecretProtector.Unprotect(protector, "legacy-plaintext-token"));
    }

    [Fact]
    public void NullValues_PassThrough()
    {
        var protector = CreateProtector();
        Assert.Null(UserSettingsSecretProtector.Protect(protector, null));
        Assert.Null(UserSettingsSecretProtector.Unprotect(protector, null));
    }

    [Fact]
    public void Unprotect_TreatsUndecryptableProtectedPayloadAsUnset()
    {
        // Use our own logger rather than whatever host last set the static.
        var logger = new Mock<ILogger>();
        var previousLogger = UserSettingsSecretProtector.Logger;
        UserSettingsSecretProtector.Logger = logger.Object;
        try
        {
            // Two ephemeral providers = two unrelated key rings, simulating a lost keys volume.
            var stored = UserSettingsSecretProtector.Protect(CreateProtector(), "sk-or-super-secret-value");

            // The payload is recognizable as protected (Data Protection magic prefix) but cannot be
            // decrypted; it must NOT be passed through as if it were the secret itself.
            Assert.Null(UserSettingsSecretProtector.Unprotect(CreateProtector(), stored));

            // ...and the lost key ring is reported rather than silently swallowed.
            logger.Verify(l => l.Log(
                LogLevel.Error,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<CryptographicException>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
        }
        finally
        {
            UserSettingsSecretProtector.Logger = previousLogger;
        }
    }

    [Fact]
    public async Task StoppingTheHost_UnhooksItsLoggerFromTheStatic()
    {
        await using var factory = new TestingHostFactory();
        _ = factory.Services; // starts the host, which installs its logger

        Assert.NotNull(UserSettingsSecretProtector.Logger);

        await factory.DisposeAsync();

        // The host's logger factory is disposed with it (on Windows its EventLog provider then
        // throws), so the static must not keep pointing at it. The app's own Run() may be the one
        // firing ApplicationStopped, on another thread, hence the wait.
        Assert.True(
            SpinWait.SpinUntil(() => UserSettingsSecretProtector.Logger is null, TimeSpan.FromSeconds(10)),
            "UserSettingsSecretProtector.Logger still references a stopped host's logger.");
    }

    [Fact]
    public void AppDbContext_ResolvedFromDI_WithDataProtection_EnablesSecretEncryption()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDataProtection();
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase(Guid.NewGuid().ToString()));

        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        // DI must fill the optional IDataProtectionProvider constructor parameter so the running
        // app encrypts the secret columns. (Other unit tests new the context up with options only,
        // which intentionally leaves encryption off.)
        Assert.True(context.SecretsEncryptionEnabled);
    }

    [Fact]
    public void AppDbContext_NewedWithOptionsOnly_DisablesSecretEncryption()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        using var context = new AppDbContext(options);
        Assert.False(context.SecretsEncryptionEnabled);
    }

    private sealed class TestingHostFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.ConfigureAppConfiguration((_, config) =>
            {
                config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["Jwt:Key"] = "test-jwt-key-1234567890-abcdefgh",
                    ["Jwt:Issuer"] = "LinguaRead.Tests",
                    ["Jwt:Audience"] = "LinguaRead.Tests",
                    ["ConnectionStrings:DefaultConnection"] = "Host=localhost;Database=tests;Username=tests;Password=tests"
                });
            });
            builder.ConfigureServices(services =>
            {
                // Swap Npgsql for InMemory (see ProtectedStaticContentTests) in case a hosted
                // service touches the context while the host is up.
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
                    options.UseInMemoryDatabase("LinguaReadSecretProtectorLoggerTests");
                });
            });
        }
    }
}
