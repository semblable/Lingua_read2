using System.Text;

namespace LinguaReadApi.Authorization;

public static class JwtKeyValidation
{
    public static void Validate(string? key)
    {
        if (string.IsNullOrWhiteSpace(key) || Encoding.UTF8.GetByteCount(key) < 32 ||
            key.Contains("replace_this", StringComparison.OrdinalIgnoreCase) ||
            key.Contains("change_me", StringComparison.OrdinalIgnoreCase) ||
            key.Contains("changeme", StringComparison.OrdinalIgnoreCase) ||
            key.Distinct().Count() < 8)
            throw new InvalidOperationException("Jwt:Key must be a generated secret of at least 32 bytes, not an example or placeholder key.");
    }
}
