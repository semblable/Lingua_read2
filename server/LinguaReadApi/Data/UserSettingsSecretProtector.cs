using System;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace LinguaReadApi.Data
{
    /// <summary>
    /// Encrypts the secret columns of <see cref="Models.UserSettings"/> (API keys, tokens, the
    /// Discord webhook URL) at rest using ASP.NET Core Data Protection. Wired into the EF model as a
    /// value converter, so encryption/decryption is transparent to every reader and writer.
    ///
    /// The decrypt side tolerates values that were stored as plaintext before this was introduced:
    /// rows that fail to unprotect are returned unchanged and get encrypted on their next save.
    /// </summary>
    public static class UserSettingsSecretProtector
    {
        // Versioned purpose string; bump the suffix only if the protection scheme ever changes.
        public const string Purpose = "LinguaReadApi.UserSettings.Secrets.v1";

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
            catch (CryptographicException)
            {
                // Legacy plaintext (or a value protected with a now-missing key): pass it through so
                // the app keeps working. It re-encrypts on the next write.
                return stored;
            }
            catch (FormatException)
            {
                // Not a base64url payload at all → definitely legacy plaintext.
                return stored;
            }
        }

        /// <summary>EF value converter that encrypts on write and decrypts (with plaintext fallback) on read.</summary>
        public static ValueConverter<string?, string?> CreateConverter(IDataProtector protector) =>
            new(value => Protect(protector, value), stored => Unprotect(protector, stored));
    }
}
