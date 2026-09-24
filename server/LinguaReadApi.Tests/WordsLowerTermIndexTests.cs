using LinguaReadApi.Data;
using LinguaReadApi.Data.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// The case-insensitive term lookups only use IX_Words_UserId_LanguageId_LowerTerm while the SQL EF
/// generates for <c>Term.ToLower()</c> matches the index expression, <c>lower("Term")</c>. Nothing
/// fails if that drifts — the queries just go back to reading the whole language's vocabulary — so
/// these tests pin both sides.
/// </summary>
public class WordsLowerTermIndexTests
{
    [Fact]
    public void Migration_CreatesNonUniqueLowerTermExpressionIndex()
    {
        var sql = Assert.Single(new AddWordsLowerTermIndex().UpOperations.OfType<SqlOperation>()).Sql;

        Assert.Contains("CREATE INDEX", sql);
        Assert.Contains(@"(""UserId"", ""LanguageId"", lower(""Term""))", sql);
        // Case-only duplicate Word rows exist in real data; a unique build would fail and, since
        // Migrate() runs at startup, keep the API from starting.
        Assert.DoesNotContain("UNIQUE", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void TermLookups_TranslateToLowerTermExpression()
    {
        using var context = CreateNpgsqlContext();
        var userId = Guid.NewGuid();
        var key = "hola";
        var keys = new List<string> { "hola", "amigo" };

        // Shape of WordsController.CreateWord's existing-word probe.
        var single = context.Words
            .Where(w => w.Term.ToLower() == key && w.UserId == userId && w.LanguageId == 1)
            .ToQueryString();
        // Shape of WordLinker's batch probe and SrsUnknownWordCounter's vocabulary query.
        var batch = context.Words
            .Where(w => w.UserId == userId && w.LanguageId == 1 && keys.Contains(w.Term.ToLower()))
            .ToQueryString();

        Assert.Contains(@"lower(w.""Term"")", single);
        Assert.Contains(@"lower(w.""Term"")", batch);
    }

    private static AppDbContext CreateNpgsqlContext()
    {
        // ToQueryString() compiles the real Npgsql translation without opening a connection.
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=translation-check;Username=none;Password=none")
            .Options;
        return new AppDbContext(options);
    }
}
