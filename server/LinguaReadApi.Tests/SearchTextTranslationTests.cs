using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Data.Migrations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// On Postgres the searches must fold both the column and the query with
/// <c>unaccent(lower(...))</c> in SQL. Nothing fails if that drifts (say Fold stops being mapped and
/// EF runs it on the query in C# only): accented rows just stop matching. So these tests pin the
/// SQL the real search predicates compile to, and the migration that installs unaccent.
/// </summary>
public class SearchTextTranslationTests
{
    [Fact]
    public void WordsSearch_FoldsTermTranslationAndQueryInSql()
    {
        using var context = CreateNpgsqlContext();

        var sql = WordsController.WhereTermOrTranslationContains(context.Words, "sancao").ToQueryString();

        Assert.Contains(@"strpos(unaccent(lower(w.""Term"")), unaccent(lower(@searchTerm))) > 0", sql);
        Assert.Contains(@"strpos(unaccent(lower(w0.""Translation"")), unaccent(lower(@searchTerm))) > 0", sql);
    }

    [Fact]
    public void LibrarySearch_FoldsNamesTitlesAuthorsAndQueryInSql()
    {
        using var context = CreateNpgsqlContext();

        var folders = FoldersController.FoldersMatching(context.Folders, "musicas").ToQueryString();
        var books = FoldersController.BooksMatching(context.Books, "sancao").ToQueryString();
        var texts = FoldersController.TextsMatching(context.Texts, "etre").ToQueryString();

        Assert.Contains(@"strpos(unaccent(lower(f.""Name"")), unaccent(lower(@query))) > 0", folders);
        Assert.Contains(@"strpos(unaccent(lower(b.""Title"")), unaccent(lower(@query))) > 0", books);
        Assert.Contains(@"strpos(unaccent(lower(b.""Author"")), unaccent(lower(@query))) > 0", books);
        Assert.Contains(@"strpos(unaccent(lower(t.""Title"")), unaccent(lower(@query))) > 0", texts);
    }

    [Fact]
    public void Migration_CreatesTheUnaccentExtension()
    {
        using var context = CreateNpgsqlContext();

        var sql = string.Concat(context.GetService<IMigrationsSqlGenerator>()
            .Generate(new EnableUnaccent().UpOperations)
            .Select(c => c.CommandText));

        Assert.Contains("CREATE EXTENSION IF NOT EXISTS unaccent", sql);
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
