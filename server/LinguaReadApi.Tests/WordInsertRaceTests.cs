using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// The word linker and the reader both insert Word rows, each after checking the row
/// isn't there. After a book import the linker runs for minutes in the background, so the
/// other writer can insert the same term between the check and the save. That hits the
/// unique IX_Words_UserId_LanguageId_Term, which InMemory doesn't enforce, hence SQLite.
/// On prod, auto-translate's words/batch lost this race and returned 500 ("Failed to save terms").
/// </summary>
public class WordInsertRaceTests : IDisposable
{
    private static readonly Guid UserId = Guid.NewGuid();
    private const int TextId = 10;

    private readonly List<SqliteConnection> _keepAlive = new();

    public void Dispose()
    {
        foreach (var connection in _keepAlive) connection.Dispose();
    }

    [Fact]
    public async Task AddTermsBatch_WhenTheLinkerInsertsTheSameWordFirst_SavesOntoItsRow()
    {
        var options = await CreateSqliteOptions();
        await using var context = new AppDbContext(
            WithInsertBeforeFirstSave(options, () => InsertWord(options, "gato", status: 0)));

        var result = await CreateController(context).AddTermsBatch(new AddTermBatchDto
        {
            LanguageId = 1,
            Terms = new List<NewTermDto>
            {
                new() { Term = "Gato", Translation = "cat" },
                new() { Term = "perro", Translation = "dog" },
            },
        });

        Assert.IsType<OkObjectResult>(result);
        await using var check = new AppDbContext(options);
        var words = await check.Words.Include(w => w.Translation).OrderBy(w => w.Term).ToListAsync();
        Assert.Equal(new[] { "gato", "perro" }, words.Select(w => w.Term));
        Assert.All(words, w => Assert.Equal(5, w.Status));
        Assert.Equal(new[] { "cat", "dog" }, words.Select(w => w.Translation?.Translation));
    }

    [Fact]
    public async Task CreateWord_WhenTheLinkerInsertsTheSameWordFirst_UpdatesItsRow()
    {
        var options = await CreateSqliteOptions();
        await using var context = new AppDbContext(
            WithInsertBeforeFirstSave(options, () => InsertWord(options, "gato", status: 0)));

        var result = await CreateController(context).CreateWord(new CreateWordDto
        {
            TextId = TextId,
            Term = "Gato",
            Status = 2,
            Translation = "cat",
        });

        var response = Assert.IsType<WordResponseDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.False(response.IsNew);
        await using var check = new AppDbContext(options);
        var word = await check.Words.Include(w => w.Translation).SingleAsync();
        Assert.Equal(response.WordId, word.WordId);
        Assert.Equal(2, word.Status);
        Assert.Equal("cat", word.Translation?.Translation);
    }

    [Fact]
    public async Task LinkAsync_WhenTheReaderInsertsTheSameWordFirst_LinksToItsRow()
    {
        var options = await CreateSqliteOptions();
        await using var context = new AppDbContext(
            WithInsertBeforeFirstSave(options, () => InsertWord(options, "gato", status: 3)));

        await WordLinker.LinkAsync(context, TextId, "gato perro gato", languageId: 1, UserId);

        await using var check = new AppDbContext(options);
        var words = await check.Words.OrderBy(w => w.Term).ToListAsync();
        Assert.Equal(new[] { "gato", "perro" }, words.Select(w => w.Term));
        Assert.Equal(3, words[0].Status); // the reader's row, not replaced
        var links = await check.TextWords.Where(tw => tw.TextId == TextId).ToListAsync();
        Assert.Equal(words.Select(w => w.WordId).Order(), links.Select(tw => tw.WordId).Order());
        Assert.Equal(2, links.Single(tw => tw.WordId == words[0].WordId).OccurrenceCount);
        Assert.Equal(WordLinker.CurrentTokenizerVersion, (await check.Texts.SingleAsync()).WordLinkingTokenizerVersion);
    }

    // --- Helpers ---

    private async Task<DbContextOptions<AppDbContext>> CreateSqliteOptions()
    {
        var connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = $"WordRace{Guid.NewGuid():N}",
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared,
        }.ToString();
        var keepAlive = new SqliteConnection(connectionString);
        await keepAlive.OpenAsync();
        _keepAlive.Add(keepAlive);

        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connectionString).Options;
        await using var setup = new AppDbContext(options);
        await setup.Database.EnsureCreatedAsync();
        setup.Users.Add(new User { Id = UserId, UserName = "tester", Email = "tester@example.com" });
        setup.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "es" });
        setup.Texts.Add(new Text { TextId = TextId, UserId = UserId, LanguageId = 1, Title = "T", Content = "gato perro gato" });
        await setup.SaveChangesAsync();
        return options;
    }

    // The other writer, on its own connection, like the linker's scope or a second request.
    private static async Task InsertWord(DbContextOptions<AppDbContext> options, string term, int status)
    {
        await using var other = new AppDbContext(options);
        other.Words.Add(new Word { UserId = UserId, LanguageId = 1, Term = term, Status = status, CreatedAt = DateTime.UtcNow });
        await other.SaveChangesAsync();
    }

    // Runs `competitor` right before the context's first save: the window between this
    // writer's check for the word and its insert.
    private static DbContextOptions<AppDbContext> WithInsertBeforeFirstSave(
        DbContextOptions<AppDbContext> options, Func<Task> competitor) =>
        new DbContextOptionsBuilder<AppDbContext>(options)
            .AddInterceptors(new BeforeFirstSaveInterceptor(competitor))
            .Options;

    private sealed class BeforeFirstSaveInterceptor(Func<Task> action) : SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!_fired)
            {
                _fired = true;
                await action();
            }
            return result;
        }
    }

    private static WordsController CreateController(AppDbContext context) =>
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
