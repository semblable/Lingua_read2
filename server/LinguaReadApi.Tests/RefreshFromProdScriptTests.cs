using System.Text.RegularExpressions;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// backup/refresh-from-prod.sh copies staging's encrypted UserSettings columns across the nightly
/// production restore and clears production's (which staging's key ring can't decrypt). It names
/// those columns itself, so a new encrypted column added to the model without updating the script
/// would silently carry production's undecryptable ciphertext onto staging, or drop staging's value.
/// </summary>
public class RefreshFromProdScriptTests
{
    [Fact]
    public void ScriptSecretColumns_MatchTheEncryptedUserSettingsColumns()
    {
        var script = File.ReadAllText(FindRepoFile("backup", "refresh-from-prod.sh"));
        var match = Regex.Match(script, "^SECRET_COLUMNS=\"([^\"]*)\"", RegexOptions.Multiline);
        Assert.True(match.Success, "SECRET_COLUMNS assignment not found in refresh-from-prod.sh");
        var scriptColumns = match.Groups[1].Value.Split(' ', StringSplitOptions.RemoveEmptyEntries).Order();

        Assert.Equal(EncryptedUserSettingsColumns().Order(), scriptColumns);
    }

    [Fact]
    public void TheOnlyEncryptedColumnOutsideUserSettings_IsTheAiProviderKey_WhichTheScriptKeeps()
    {
        // Step 4 handles "UserAiProviders"."ApiKey" by name; any other encrypted column elsewhere
        // needs the script taught about it.
        Assert.Equal(new[] { "UserAiProviders.ApiKey" }, EncryptedColumns().Where(c => !c.StartsWith("UserSettings.")));

        var script = File.ReadAllText(FindRepoFile("backup", "refresh-from-prod.sh"));
        Assert.Contains("UPDATE \\\"UserAiProviders\\\" SET \\\"ApiKey\\\" = NULL;", script);
        Assert.Contains("SELECT \\\"UserId\\\", \\\"Provider\\\", \\\"ApiKey\\\" FROM \\\"UserAiProviders\\\"", script);
    }

    // Properties that only get a value converter when a Data Protection provider is supplied.
    private static IEnumerable<string> EncryptedUserSettingsColumns() =>
        EncryptedColumns().Where(c => c.StartsWith("UserSettings.")).Select(c => c["UserSettings.".Length..]);

    // "Table.Column" of every property that only gets a value converter when a Data Protection
    // provider is supplied.
    private static List<string> EncryptedColumns()
    {
        // In memory, not SQLite: EF caches the encrypting model with the first protector it was
        // built with, which would leak into the SQLite-based re-encryption tests.
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        using var plain = new AppDbContext(options);
        using var encrypted = new AppDbContext(options, new EphemeralDataProtectionProvider());

        // The in-memory provider has no table names; tables are named after the DbSet properties.
        var tableByType = typeof(AppDbContext).GetProperties()
            .Where(p => p.PropertyType.IsGenericType && p.PropertyType.GetGenericTypeDefinition() == typeof(DbSet<>))
            .ToDictionary(p => p.PropertyType.GetGenericArguments()[0], p => p.Name);

        HashSet<string> Converted(AppDbContext context) =>
            context.Model.GetEntityTypes()
                .SelectMany(t => t.GetProperties().Select(p => (Type: t.ClrType, Property: p)))
                .Where(x => x.Property.GetValueConverter() != null)
                .Select(x => $"{tableByType[x.Type]}.{x.Property.GetColumnName()}")
                .ToHashSet();

        var columns = Converted(encrypted).Except(Converted(plain)).ToList();
        Assert.NotEmpty(columns);
        return columns;
    }

    private static string FindRepoFile(params string[] relative)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            var candidate = Path.Combine(new[] { dir.FullName }.Concat(relative).ToArray());
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException($"{Path.Combine(relative)} not found above {AppContext.BaseDirectory}");
    }
}
