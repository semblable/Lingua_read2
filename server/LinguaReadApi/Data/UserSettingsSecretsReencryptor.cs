using System;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Data
{
    /// <summary>
    /// One-shot startup pass that encrypts <see cref="Models.UserSettings"/> secret columns left as
    /// plaintext by the <c>EncryptUserSettingsSecrets</c> migration. That migration only widened the
    /// column types; it never rewrote existing values. The EF value converter encrypts transparently
    /// on write, but only when a secret's value actually changes — so a secret stored before
    /// encryption was introduced (or re-entered unchanged) would stay in cleartext indefinitely.
    /// This closes that gap.
    ///
    /// Idempotent: it reads the raw stored bytes (via a context built without a protector, so the
    /// value converter is not applied) and only rewrites values that are not already a Data
    /// Protection payload. Best-effort and safe to run on every startup.
    /// </summary>
    public static class UserSettingsSecretsReencryptor
    {
        public static async Task EncryptLegacyPlaintextAsync(
            DbContextOptions<AppDbContext> rawOptions,
            IDataProtectionProvider dataProtectionProvider,
            ILogger logger,
            CancellationToken ct = default)
        {
            var protector = dataProtectionProvider.CreateProtector(UserSettingsSecretProtector.Purpose);

            // A context constructed without a Data Protection provider applies no value converter to
            // the secret columns, so they are read and written as their raw stored form — exactly
            // what we need to inspect the on-disk value and rewrite it as ciphertext.
            await using var raw = new AppDbContext(rawOptions);

            var rows = await raw.UserSettings.ToListAsync(ct);
            var encrypted = 0;

            foreach (var s in rows)
            {
                encrypted += Encrypt(protector, s.AzureTranslatorKey, v => s.AzureTranslatorKey = v);
                encrypted += Encrypt(protector, s.GoogleTranslateApiKey, v => s.GoogleTranslateApiKey = v);
                encrypted += Encrypt(protector, s.WiktionaryAccessToken, v => s.WiktionaryAccessToken = v);
                encrypted += Encrypt(protector, s.OpenRouterApiKey, v => s.OpenRouterApiKey = v);
                encrypted += Encrypt(protector, s.HardcoverApiToken, v => s.HardcoverApiToken = v);
                encrypted += Encrypt(protector, s.DiscordWebhookUrl, v => s.DiscordWebhookUrl = v);
            }

            if (encrypted > 0)
            {
                await raw.SaveChangesAsync(ct);
                logger.LogInformation(
                    "Encrypted {Count} legacy plaintext user-settings secret value(s) at rest.", encrypted);
            }
        }

        // Encrypts and stores 'current' when it is non-empty plaintext; no-op (returns 0) when it is
        // null/empty or already a Data Protection payload.
        private static int Encrypt(IDataProtector protector, string? current, Action<string?> apply)
        {
            if (string.IsNullOrEmpty(current) ||
                current.StartsWith(UserSettingsSecretProtector.DataProtectionPayloadPrefix, StringComparison.Ordinal))
            {
                return 0;
            }

            apply(protector.Protect(current));
            return 1;
        }
    }
}
