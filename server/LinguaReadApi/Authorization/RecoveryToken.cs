using Microsoft.Extensions.Configuration;

namespace LinguaReadApi.Authorization;

/// <summary>
/// The optional owner recovery code (Auth:RecoveryToken, LINGUAREAD_RECOVERY_TOKEN): 32 random
/// bytes written as 64 hex characters. Surrounding whitespace is ignored because values copied
/// into an .env file often pick up a trailing space or newline.
/// </summary>
public static class RecoveryToken
{
    public const string ConfigKey = "Auth:RecoveryToken";

    /// <summary>The configured code's bytes, or null when it is unset or malformed.</summary>
    public static byte[]? ReadConfigured(IConfiguration configuration) => TryDecode(configuration[ConfigKey]);

    /// <summary>True when a value is set but is not a valid code, so recovery is silently off.</summary>
    public static bool IsMisconfigured(IConfiguration configuration) =>
        !string.IsNullOrWhiteSpace(configuration[ConfigKey]) && ReadConfigured(configuration) == null;

    public static byte[]? TryDecode(string? token)
    {
        token = token?.Trim();
        return token is { Length: 64 } && token.All(Uri.IsHexDigit) ? Convert.FromHexString(token) : null;
    }
}
