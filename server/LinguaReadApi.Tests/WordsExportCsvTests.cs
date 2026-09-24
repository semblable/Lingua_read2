using System.Security.Claims;
using System.Text;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
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

    private static async Task<FileContentResult> Export(AppDbContext context, Guid userId, int? languageId = null, string? status = null)
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
        return Assert.IsType<FileContentResult>(await controller.ExportWordsCsv(languageId, status));
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
