using System.Security.Claims;
using System.Text;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using Microsoft.VisualBasic.FileIO;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>Pins the CSV export format (it is the user's terms backup).</summary>
public class WordsExportCsvTests
{
    [Fact]
    public async Task Export_WritesHeaderAndRows_OrderedByLanguageThenTerm_WithEscaping()
    {
        await using var context = CreateContext();
        var userId = Seed(context);

        var file = await Export(context, userId);

        Assert.Equal("text/csv", file.ContentType);
        Assert.Matches(@"^linguaread_terms_\d{14}\.csv$", file.FileDownloadName);
        Assert.Equal(
            Lines(
                "Term,Translation,Status,Language",
                "chien,dog,1,French",
                "comma,\"a, b\",2,French",
                "quote,\"say \"\"hi\"\"\",3,French",
                "amigo,\"line1\nline2\",5,Spanish",
                "gato,,6,Spanish",
                "zorro,\"cr\rhere\",4,Spanish"),
            Encoding.UTF8.GetString(file.FileContents));
    }

    [Fact]
    public async Task Export_FiltersByLanguageAndStatus_AndIgnoresOtherUsersAndBadStatusTokens()
    {
        await using var context = CreateContext();
        var userId = Seed(context);

        var spanishOnly = await Export(context, userId, languageId: 2);
        Assert.Equal(
            Lines("Term,Translation,Status,Language", "amigo,\"line1\nline2\",5,Spanish", "gato,,6,Spanish", "zorro,\"cr\rhere\",4,Spanish"),
            Encoding.UTF8.GetString(spanishOnly.FileContents));

        var statuses = await Export(context, userId, status: " 1, 6 ,x,");
        Assert.Equal(
            Lines("Term,Translation,Status,Language", "chien,dog,1,French", "gato,,6,Spanish"),
            Encoding.UTF8.GetString(statuses.FileContents));

        var none = await Export(context, Guid.NewGuid());
        Assert.Equal(Lines("Term,Translation,Status,Language"), Encoding.UTF8.GetString(none.FileContents));
    }

    private static string Lines(params string[] lines) =>
        string.Concat(lines.Select(l => l + Environment.NewLine));

    private static async Task<FileContentResult> Export(AppDbContext context, Guid userId, int? languageId = null, string? status = null, string format = "simple")
    {
        var controller = new WordsController(context, NullLogger<WordsController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "TestAuth"))
                }
            }
        };
        return Assert.IsType<FileContentResult>(await controller.ExportWordsCsv(languageId, status, format));
    }

    [Fact]
    public async Task ContextExport_RelationalQuery_KeepsMultipleContextsAndOrphans_AndScopesEveryJoin()
    {
        using var connection = new SqliteConnection("Data Source=:memory:;Foreign Keys=False");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Seed(context);
        var otherId = context.Users.Single(u => u.Id != userId).Id;
        context.Books.AddRange(new Book { BookId = 41, UserId = userId, LanguageId = 2, Title = "Luna, \"azul\"" },
            new Book { BookId = 42, UserId = otherId, LanguageId = 2, Title = "PRIVATE BOOK" });
        context.Texts.AddRange(new Text { TextId = 31, UserId = userId, LanguageId = 2, BookId = 41, Title = "Chapter", Content = "fixture", SourceUrl = "https://example.org/story" },
            new Text { TextId = 32, UserId = otherId, LanguageId = 2, BookId = 42, Title = "PRIVATE TEXT", Content = "private" });
        context.SrsPhrases.AddRange(
            new SrsPhrase { SrsPhraseId = 101, UserId = userId, WordId = 1, TextId = 31, Sentence = "¿Zorro, o gato?\nDice: \"sí\".\rFin.", TextTitle = "Saved title" },
            new SrsPhrase { SrsPhraseId = 102, UserId = userId, WordId = 1, Sentence = "Other context", TextTitle = "Deleted source" },
            new SrsPhrase { SrsPhraseId = 103, UserId = otherId, WordId = 1, Sentence = "PRIVATE CONTEXT" },
            new SrsPhrase { SrsPhraseId = 104, UserId = userId, WordId = 7, Sentence = "PRIVATE WORD" },
            new SrsPhrase { SrsPhraseId = 105, UserId = userId, WordId = 1, TextId = 32, Sentence = "Own sentence with invalid source" });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();
        var csv = Encoding.UTF8.GetString((await Export(context, userId, 2, "4,6", "context")).FileContents);
        var rows = ParseCsv(csv);
        Assert.Equal(5, rows.Count); // header, context-free gato, three owned zorro contexts
        Assert.All(rows, row => Assert.Equal(14, row.Length));
        Assert.Equal("gato", rows[1][0]);
        Assert.Equal("", rows[1][6]);
        Assert.Equal("", rows[1][1]);
        Assert.Equal("¿Zorro, o gato?\nDice: \"sí\".\rFin.", rows[2][7]);
        Assert.Equal("31", rows[2][8]);
        Assert.Equal("Saved title", rows[2][9]);
        Assert.Equal("41", rows[2][10]);
        Assert.Equal("Luna, \"azul\"", rows[2][11]);
        Assert.Equal("https://example.org/story", rows[2][12]);
        Assert.Equal("Deleted source", rows[3][9]);
        Assert.Equal("", rows[3][8]);
        Assert.Equal("", rows[4][8]); // foreign live metadata cannot leak
        Assert.DoesNotContain("PRIVATE", csv);
        Assert.DoesNotContain("French", csv);
        var empty = ParseCsv(Encoding.UTF8.GetString((await Export(context, Guid.NewGuid(), format: "context")).FileContents));
        Assert.Single(empty);
    }

    [Theory]
    [InlineData("context", null)]
    [InlineData("context", "")]
    [InlineData("context", "   ")]
    [InlineData("anki", null)]
    [InlineData("anki", "")]
    [InlineData("anki", "   ")]
    public async Task ContextExports_FallBackToOwnedLiveTitle_WhenSnapshotIsBlank(string format, string? savedTitle)
    {
        using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Seed(context);
        context.Texts.Add(new Text { TextId = 31, UserId = userId, LanguageId = 2, Title = "Available source title", Content = "Original fixture." });
        context.SrsPhrases.Add(new SrsPhrase { UserId = userId, WordId = 1, TextId = 31, Sentence = "Original fixture.", TextTitle = savedTitle });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var output = Encoding.UTF8.GetString((await Export(context, userId, 2, "4", format)).FileContents);
        if (format == "context")
            Assert.Equal("Available source title", ParseCsv(output)[1][9]);
        else
            Assert.Contains("Available source title", System.Net.WebUtility.HtmlDecode(output));
    }

    [Theory]
    [InlineData("=1+1")]
    [InlineData(" +SUM(1,2)")]
    [InlineData("-1+2")]
    [InlineData("@SUM(1)")]
    [InlineData("\tformula")]
    [InlineData("\rformula")]
    [InlineData("\nformula")]
    [InlineData("\u00a0＝1+1")]
    public async Task ContextExport_NeutralizesSpreadsheetFormulas_InEveryTextField(string dangerous)
    {
        await using var context = CreateContext();
        var userId = Seed(context);
        var word = context.Words.Single(w => w.WordId == 1);
        word.Term = dangerous;
        context.WordTranslations.Single(t => t.WordId == 1).Translation = dangerous;
        context.Languages.Single(l => l.LanguageId == 2).Name = dangerous;
        context.Books.Add(new Book { BookId = 20, UserId = userId, LanguageId = 2, Title = dangerous });
        context.Texts.Add(new Text { TextId = 10, UserId = userId, LanguageId = 2, BookId = 20, Title = dangerous, SourceUrl = dangerous });
        context.SrsPhrases.Add(new SrsPhrase { UserId = userId, WordId = 1, TextId = 10, Sentence = dangerous, TextTitle = dangerous });
        await context.SaveChangesAsync();
        var rows = ParseCsv(Encoding.UTF8.GetString((await Export(context, userId, 2, "4", "context")).FileContents));
        Assert.Equal(2, rows.Count);
        foreach (var index in new[] { 0, 1, 3, 7, 9, 11, 12 })
            Assert.Equal("'" + dangerous, rows[1][index]);
    }

    [Fact]
    public async Task AnkiExport_GroupsAllContexts_KeepsContextFreeTerms_AndEncodesHtmlTabsAndNewlines()
    {
        await using var context = CreateContext();
        var userId = Seed(context);
        context.SrsPhrases.AddRange(
            new SrsPhrase { UserId = userId, WordId = 1, Sentence = "First <script> & \"sí\"\nline\ttab", TextTitle = "Old title" },
            new SrsPhrase { UserId = userId, WordId = 1, Sentence = "Second context" });
        await context.SaveChangesAsync();
        var file = await Export(context, userId, 2, "4,6", "anki");
        Assert.Equal("text/plain", file.ContentType);
        Assert.EndsWith(".txt", file.FileDownloadName);
        var output = Encoding.UTF8.GetString(file.FileContents);
        var lines = output.Split('\n').Where(l => l.Length > 0 && !l.StartsWith('#')).ToArray();
        Assert.Equal(2, lines.Length);
        Assert.All(lines, line => Assert.Equal(6, line.Split('\t').Length));
        Assert.Contains($"lr:{userId:N}:1\t", output);
        Assert.Contains("&lt;script&gt; &amp; &quot;", output);
        Assert.Contains("<br>line&#9;tab", output);
        Assert.Contains("sí", System.Net.WebUtility.HtmlDecode(output));
        Assert.Contains("Second context", output);
        Assert.Contains("Old title", output);
        Assert.DoesNotContain("<script>", output);
        Assert.Contains("<hr>", lines.Single(l => l.Contains($"lr:{userId:N}:1\t")));
        Assert.DoesNotContain("chien", output);
        Assert.EndsWith("\t", lines.Single(l => l.Contains($"lr:{userId:N}:2\t")));
    }

    private static List<string[]> ParseCsv(string csv)
    {
        using var parser = new TextFieldParser(new StringReader(csv)) { HasFieldsEnclosedInQuotes = true, TrimWhiteSpace = false };
        parser.SetDelimiters(",");
        var rows = new List<string[]>();
        while (!parser.EndOfData) rows.Add(parser.ReadFields()!);
        return rows;
    }

    private static Guid Seed(AppDbContext context)
    {
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        context.Users.AddRange(
            new User { Id = userId, UserName = "tester", Email = "tester@example.com" },
            new User { Id = otherUserId, UserName = "other", Email = "other@example.com" });
        context.Languages.AddRange(
            new Language { LanguageId = 1, Name = "French", Code = "FR" },
            new Language { LanguageId = 2, Name = "Spanish", Code = "ES" });

        void AddWord(int id, Guid owner, int languageId, string term, int status, string? translation)
        {
            context.Words.Add(new Word { WordId = id, UserId = owner, LanguageId = languageId, Term = term, Status = status });
            if (translation != null)
            {
                context.WordTranslations.Add(new WordTranslation { WordId = id, Translation = translation });
            }
        }

        AddWord(1, userId, 2, "zorro", 4, "cr\rhere");
        AddWord(2, userId, 2, "gato", 6, null);
        AddWord(3, userId, 2, "amigo", 5, "line1\nline2");
        AddWord(4, userId, 1, "quote", 3, "say \"hi\"");
        AddWord(5, userId, 1, "comma", 2, "a, b");
        AddWord(6, userId, 1, "chien", 1, "dog");
        AddWord(7, otherUserId, 1, "secret", 1, "not mine");
        context.SaveChanges();
        context.ChangeTracker.Clear();
        return userId;
    }

    private static AppDbContext CreateContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
}
