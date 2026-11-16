using System.Security.Claims;
using System.Text.RegularExpressions;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Data.Migrations;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Srs;
using LinguaReadApi.Services.Tokenization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Pin the lower(Term) index and the production query predicates that can use it.
/// Languages with normalized/fallback headwords intentionally use a different path.
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
    public async Task CreateWord_ProbesNormalizedTermWithScopedLowerTermPredicate()
    {
        var userId = Guid.NewGuid();
        var language = Spanish();
        var capture = new NpgsqlQueryCapture(language, new Text
        {
            TextId = 42, UserId = userId, LanguageId = language.LanguageId,
            Title = "Fixture", Content = "Hola amigo"
        });
        await using var context = capture.CreateContext();
        var controller = CreateController(context, userId);

        var query = await capture.CaptureAsync(() => controller.CreateWord(new CreateWordDto
        {
            TextId = 42, Term = "  HOLA  ", Status = 1
        }));

        AssertIndexedTermLookup(query, userId, language.LanguageId, "hola");
    }

    [Fact]
    public async Task AddTermsBatch_ProbesOnlyNormalizedDistinctTermsWithScopedLowerTermPredicate()
    {
        var userId = Guid.NewGuid();
        var language = Spanish();
        var capture = new NpgsqlQueryCapture(language);
        await using var context = capture.CreateContext();
        var controller = CreateController(context, userId);

        var query = await capture.CaptureAsync(() => controller.AddTermsBatch(new AddTermBatchDto
        {
            LanguageId = language.LanguageId,
            Terms = [new() { Term = " HOLA " }, new() { Term = "amigo" }, new() { Term = "hola" }]
        }));

        AssertIndexedTermLookup(query, userId, language.LanguageId, "hola", "amigo");
    }

    [Fact]
    public async Task WordLinker_ProbesTextTokensWithScopedLowerTermPredicate()
    {
        var userId = Guid.NewGuid();
        var language = Spanish();
        var capture = new NpgsqlQueryCapture(language, new Text
        {
            TextId = 42, UserId = userId, LanguageId = language.LanguageId,
            Title = "Fixture", Content = "HOLA amigo hola"
        });
        await using var context = capture.CreateContext();

        var query = await capture.CaptureAsync(() =>
            WordLinker.LinkAsync(context, 42, "HOLA amigo hola", language.LanguageId, userId));

        AssertIndexedTermLookup(query, userId, language.LanguageId, "hola", "amigo");
    }

    [Fact]
    public async Task SrsUnknownWordCounter_ProbesSentenceTokensWithScopedLowerTermPredicate()
    {
        var userId = Guid.NewGuid();
        var language = Spanish();
        var capture = new NpgsqlQueryCapture();
        await using var context = capture.CreateContext();

        var query = await capture.CaptureAsync(() => SrsUnknownWordCounter.CountAsync(context, userId,
            [new(1, 42, language.LanguageId, "HOLA amigo hola")],
            new Dictionary<int, Language> { [language.LanguageId] = language }));

        AssertIndexedTermLookup(query, userId, language.LanguageId, "hola", "amigo");
    }

    private static void AssertIndexedTermLookup(
        NpgsqlQueryCapture.CapturedQuery query, Guid userId, int languageId, params string[] expectedKeys)
    {
        var whereStart = query.Sql.IndexOf("\nWHERE ", StringComparison.Ordinal);
        Assert.True(whereStart >= 0, query.Sql);
        var where = query.Sql[whereStart..];
        Assert.Equal(userId, ParameterFor(@"w\.""UserId"" = @(?<parameter>\w+)"));
        Assert.Equal(languageId, ParameterFor(@"w\.""LanguageId"" = @(?<parameter>\w+)"));
        var keys = Assert.IsAssignableFrom<IEnumerable<string>>(
            ParameterFor(@"lower\(w\.""Term""\) = ANY \(@(?<parameter>\w+)\)"));
        Assert.Equal(expectedKeys.OrderBy(k => k), keys.OrderBy(k => k));

        object? ParameterFor(string predicate)
        {
            var match = Regex.Match(where, predicate);
            Assert.True(match.Success, $"Missing indexed lookup predicate {predicate}:\n{query.Sql}");
            return query.Parameters[match.Groups["parameter"].Value];
        }
    }

    private static Language Spanish() => new() { LanguageId = 7, Code = "es", Name = "Spanish" };

    private static WordsController CreateController(AppDbContext context, Guid userId) =>
        new(context, NullLogger<WordsController>.Instance)
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
}
