using System;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Verifies the startup pass that encrypts UserSettings secrets left as plaintext by the
/// column-widening migration. Uses SQLite (a real relational provider) so the EF value converter
/// is actually applied on read/write — the EF InMemory provider does not round-trip converters
/// faithfully enough to tell ciphertext from plaintext.
/// </summary>
public class UserSettingsSecretsReencryptorTests
{
    private static DbContextOptions<AppDbContext> Options(SqliteConnection conn) =>
        new DbContextOptionsBuilder<AppDbContext>().UseSqlite(conn).Options;

    [Fact]
    public async Task EncryptsLegacyPlaintext_RoundTrips_AndIsIdempotent()
    {
        // A shared open connection keeps the in-memory database alive across contexts.
        using var conn = new SqliteConnection("DataSource=:memory:");
        conn.Open();
        var options = Options(conn);

        var userId = Guid.NewGuid();

        // Seed a row through a context WITHOUT a protector, so the secrets are stored as the literal
        // plaintext a pre-encryption install would have left behind.
        using (var seed = new AppDbContext(options))
        {
            seed.Database.EnsureCreated();
            seed.Users.Add(new User { Id = userId, UserName = "t", Email = "t@example.com" });
            seed.UserSettings.Add(new UserSettings
            {
                UserId = userId,
                OpenRouterApiKey = "sk-or-legacy-plaintext",
                DiscordWebhookUrl = "https://discord.com/api/webhooks/legacy",
                CreatedAt = DateTime.UtcNow
            });
            await seed.SaveChangesAsync();
        }

        var dataProtection = new EphemeralDataProtectionProvider();

        await UserSettingsSecretsReencryptor.EncryptLegacyPlaintextAsync(options, dataProtection, NullLogger.Instance);

        // Raw read (no protector) sees the on-disk form: it is now a Data Protection payload.
        using (var raw = new AppDbContext(options))
        {
            var s = await raw.UserSettings.SingleAsync();
            Assert.StartsWith("CfDJ8", s.OpenRouterApiKey);
            Assert.StartsWith("CfDJ8", s.DiscordWebhookUrl);
        }

        // A protector-backed context transparently decrypts back to the original plaintext.
        using (var protectedCtx = new AppDbContext(options, dataProtection))
        {
            var s = await protectedCtx.UserSettings.SingleAsync();
            Assert.Equal("sk-or-legacy-plaintext", s.OpenRouterApiKey);
            Assert.Equal("https://discord.com/api/webhooks/legacy", s.DiscordWebhookUrl);
        }

        // Second pass must be a no-op: an already-protected value is left exactly as-is (a re-encrypt
        // would produce different ciphertext, since Data Protection is non-deterministic).
        string cipherBefore;
        using (var raw = new AppDbContext(options))
        {
            cipherBefore = (await raw.UserSettings.SingleAsync()).OpenRouterApiKey!;
        }

        await UserSettingsSecretsReencryptor.EncryptLegacyPlaintextAsync(options, dataProtection, NullLogger.Instance);

        using (var raw = new AppDbContext(options))
        {
            Assert.Equal(cipherBefore, (await raw.UserSettings.SingleAsync()).OpenRouterApiKey);
        }
    }

    [Fact]
    public async Task LeavesNullSecrets_Untouched()
    {
        using var conn = new SqliteConnection("DataSource=:memory:");
        conn.Open();
        var options = Options(conn);

        var userId = Guid.NewGuid();
        using (var seed = new AppDbContext(options))
        {
            seed.Database.EnsureCreated();
            seed.Users.Add(new User { Id = userId, UserName = "t", Email = "t@example.com" });
            seed.UserSettings.Add(new UserSettings { UserId = userId, CreatedAt = DateTime.UtcNow });
            await seed.SaveChangesAsync();
        }

        await UserSettingsSecretsReencryptor.EncryptLegacyPlaintextAsync(
            options, new EphemeralDataProtectionProvider(), NullLogger.Instance);

        using (var raw = new AppDbContext(options))
        {
            var s = await raw.UserSettings.SingleAsync();
            Assert.Null(s.OpenRouterApiKey);
            Assert.Null(s.DiscordWebhookUrl);
        }
    }
}
