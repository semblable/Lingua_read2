using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// words/batch reads only the rows its terms can match. It used to read and track every word the
/// user has in the language (56k on prod) to save the few dozen auto-translate sends, which took
/// ~20 s on staging. SQLite rather than InMemory, so the lower(Term) lookup runs as SQL.
/// </summary>
public class WordsBatchLookupTests : IDisposable
{
    private static readonly Guid UserId = Guid.NewGuid();
    private readonly SqliteConnection _keepAlive;
    private readonly DbContextOptions<AppDbContext> _options;

    public WordsBatchLookupTests()
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = $"WordsBatch{Guid.NewGuid():N}",
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared,
        }.ToString();
        _keepAlive = new SqliteConnection(connectionString);
        _keepAlive.Open();
        _options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connectionString).Options;

        using var setup = new AppDbContext(_options);
        setup.Database.EnsureCreated();
        setup.Users.Add(new User { Id = UserId, UserName = "tester", Email = "tester@example.com" });
        setup.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        setup.Languages.Add(new Language { LanguageId = 2, Name = "Portuguese", Code = "pt" });
        setup.SaveChanges();
    }

    public void Dispose() => _keepAlive.Dispose();

    [Fact]
    public async Task AddTermsBatch_ReadsOnlyTheBatchWords_AndStillMatchesACapitalizedRow()
    {
        // A term saved with its capital (rekeying keeps case), a word outside the batch, and the
        // same term in another language.
        var gato = await InsertWord("Gato", status: 2);
        await InsertWord("casa", status: 5);
        await InsertWord("gato", status: 3, languageId: 2);

        await using var context = new AppDbContext(_options);
        var result = await Controller(context).AddTermsBatch(new AddTermBatchDto
        {
            LanguageId = 1,
            KeepExistingStatus = true,
            Terms = new List<NewTermDto>
            {
                new() { Term = "gato", Translation = "cat", Status = 1 },
                new() { Term = "Perro", Translation = "dog", Status = 1 },
            },
        });

        var body = Assert.IsType<AddTermsBatchResultDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(new[] { "Gato", "perro" }, context.ChangeTracker.Entries<Word>().Select(e => e.Entity.Term).Order());

        await using var check = new AppDbContext(_options);
        var words = await check.Words.Include(w => w.Translation)
            .Where(w => w.LanguageId == 1).OrderBy(w => w.WordId).ToListAsync();
        Assert.Equal(new[] { "Gato", "casa", "perro" }, words.Select(w => w.Term));
        Assert.Equal(gato, words[0].WordId);
        Assert.Equal(2, words[0].Status);
        Assert.Equal("cat", words[0].Translation?.Translation);
        Assert.Equal(1, words[2].Status);
        Assert.Equal("dog", words[2].Translation?.Translation);
        Assert.Equal(3, (await check.Words.SingleAsync(w => w.LanguageId == 2)).Status);

        // The response carries the batch's rows as stored, so the reader needn't reload the language.
        Assert.Equal(
            new[] { (words[0].WordId, "Gato", 2, "cat", false), (words[2].WordId, "perro", 1, "dog", true) },
            body.Words.Select(w => (w.WordId, w.Term, w.Status, w.Translation, w.IsNew)));
    }

    [Fact]
    public async Task AddTermsBatch_ReturnsAWordOnce_WithTheLastTranslationSent()
    {
        var gato = await InsertWord("gato", status: 0);

        await using var context = new AppDbContext(_options);
        var result = await Controller(context).AddTermsBatch(new AddTermBatchDto
        {
            LanguageId = 1,
            Terms = new List<NewTermDto>
            {
                new() { Term = "gato", Translation = "cat" },
                new() { Term = "Gato", Translation = "tomcat" },
            },
        });

        var body = Assert.IsType<AddTermsBatchResultDto>(Assert.IsType<OkObjectResult>(result).Value);
        var saved = Assert.Single(body.Words);
        Assert.Equal((gato, "gato", 5, "tomcat"), (saved.WordId, saved.Term, saved.Status, saved.Translation));
        await using var check = new AppDbContext(_options);
        Assert.Equal("tomcat", (await check.WordTranslations.SingleAsync()).Translation);
    }

    private async Task<int> InsertWord(string term, int status, int languageId = 1)
    {
        await using var context = new AppDbContext(_options);
        var word = new Word { UserId = UserId, LanguageId = languageId, Term = term, Status = status, CreatedAt = DateTime.UtcNow };
        context.Words.Add(word);
        await context.SaveChangesAsync();
        return word.WordId;
    }

    private static WordsController Controller(AppDbContext context) =>
        new(context, NullLogger<WordsController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, UserId.ToString()) }, "TestAuth"))
                }
            }
        };
}
