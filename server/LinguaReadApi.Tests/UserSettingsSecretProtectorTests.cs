using System;
using LinguaReadApi.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LinguaReadApi.Tests;

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
}
