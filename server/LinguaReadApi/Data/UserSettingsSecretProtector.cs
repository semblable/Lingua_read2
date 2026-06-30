using System;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Data
{
    /// <summary>
    /// Encrypts the secret columns of <see cref="Models.UserSettings"/> (API keys, tokens, the
    /// Discord webhook URL) at rest using ASP.NET Core Data Protection. Wired into the EF model as a
    /// value converter, so encryption/decryption is transparent to every reader and writer.
    ///
    /// The decrypt side tolerates values that were stored as plaintext before this was introduced:
    /// rows that fail to unprotect are returned unchanged and get encrypted on their next save.
    /// A value that *is* a protected payload but can no longer be decrypted (lost key ring) is
    /// treated as unset instead — see <see cref="Unprotect"/>.
    /// </summary>
    public static class UserSettingsSecretProtector
    {
        // Versioned purpose string; bump the suffix only if the protection scheme ever changes.
        public const string Purpose = "LinguaReadApi.UserSettings.Secrets.v1";

        // Every Data Protection payload starts with the magic header 0x09F0C9F0, which
        // base64url-encodes to this prefix. Lets us tell legacy plaintext apart from a
        // protected payload we can no longer decrypt (lost/rotated key ring). Internal so the
        // startup re-encryption pass can reuse the same "is this already protected?" test.
        internal const string DataProtectionPayloadPrefix = "CfDJ8";

        /// <summary>
        /// Set once at startup so decryption failures are visible in the logs. A static hook
        /// because the EF value converter lives in the cached model, which outlives any single
        /// scoped context (so a per-context ILogger can't be captured safely).
        /// </summary>
        public static ILogger? Logger { get; set; }

        public static string? Protect(IDataProtector protector, string? value) =>
            value == null ? null : protector.Protect(value);

        public static string? Unprotect(IDataProtector protector, string? stored)
        {
            if (stored == null)
            {
                return null;
            }

            try
            {
                return protector.Unprotect(stored);
            }
            catch (Exception ex) when (ex is CryptographicException or FormatException)
            {
                if (stored.StartsWith(DataProtectionPayloadPrefix, StringComparison.Ordinal))
                {
                    // This was written by Protect but the current key ring can't decrypt it —
                    // most likely the Data Protection keys directory was lost (e.g. the keys
                    // volume wasn't mounted). Surface the secret as unset rather than handing
                    // the ciphertext blob to a provider as an "API key": the user gets a clear
                    // "key not configured" failure and can re-enter it.
                    Logger?.LogError(ex,
                        "A protected user-settings secret could not be decrypted. The Data Protection " +
                        "key ring has likely been lost (check the keys volume / DATA_PROTECTION_KEYS_PATH). " +
                        "The secret is treated as unset and must be re-entered in Settings.");
                    return null;
                }

                // Legacy plaintext from before encryption was introduced: pass it through so the
                // app keeps working. It re-encrypts on the next write.
                return stored;
            }
        }

        /// <summary>EF value converter that encrypts on write and decrypts (with plaintext fallback) on read.</summary>
        public static ValueConverter<string?, string?> CreateConverter(IDataProtector protector) =>
            new(value => Protect(protector, value), stored => Unprotect(protector, stored));
    }
}
