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

    // Properties that only get a value converter when a Data Protection provider is supplied.
    private static IEnumerable<string> EncryptedUserSettingsColumns()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        using var plain = new AppDbContext(options);
        using var encrypted = new AppDbContext(options, new EphemeralDataProtectionProvider());

        static HashSet<string> Converted(AppDbContext context) =>
            context.Model.FindEntityType(typeof(UserSettings))!.GetProperties()
                .Where(p => p.GetValueConverter() != null)
                .Select(p => p.GetColumnName())
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
