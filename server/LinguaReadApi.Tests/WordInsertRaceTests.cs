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

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task QueuedWordEdit_WhenAnotherDeviceSavedLater_KeepsItsStatusTranslationAndCard(bool queuedCreate)
    {
        var options = await CreateSqliteOptions();
        var offlineTime = DateTimeOffset.UtcNow.AddHours(-1);
        await using var newer = new AppDbContext(options);
        var created = await CreateController(newer).CreateWord(new CreateWordDto
        {
            Term = "gato", TextId = TextId, Status = 2, Translation = "cat",
            ClientUpdatedAt = offlineTime.AddMinutes(-1)
        });
        var word = Assert.IsType<WordResponseDto>(Assert.IsType<CreatedAtActionResult>(created.Result).Value);
        Assert.IsType<NoContentResult>(await CreateController(newer).UpdateWord(word.WordId,
            new UpdateWordDto { Status = 6, Translation = "newer definition" }));

        await using var replay = new AppDbContext(options);
        var replayController = CreateController(replay);
        var result = queuedCreate
            ? (await replayController.CreateWord(new CreateWordDto
            {
                Term = "gato", TextId = TextId, Status = 4, Translation = "older definition",
                Sentence = "gato perro gato", ReplaceExisting = true, ClientUpdatedAt = offlineTime
            })).Result
            : await replayController.UpdateWord(word.WordId, new UpdateWordDto
            {
                Status = 4, Translation = "older definition", TextId = TextId,
                Sentence = "gato perro gato", ClientUpdatedAt = offlineTime
            });

        var conflict = Assert.IsType<WordEditConflictDto>(Assert.IsType<ConflictObjectResult>(result).Value);
        Assert.Equal(word.WordId, conflict.Word.WordId);
        Assert.Equal(6, conflict.Word.Status);
        Assert.Equal("newer definition", conflict.Word.Translation);
        await using var check = new AppDbContext(options);
        var saved = await check.Words.Include(w => w.Translation).SingleAsync();
        Assert.Equal(6, saved.Status);
        Assert.Equal("newer definition", saved.Translation.Translation);
        Assert.True((await check.SrsCardReviews.SingleAsync()).IsSuspended);
        Assert.Empty(await check.SrsPhrases.ToListAsync());
    }

    [Fact]
    public async Task QueuedEdit_WhenAnotherDeviceCommitsAfterItsRead_RollsBackAllStaleChanges()
    {
        var options = await CreateSqliteOptions();
        await InsertWord(options, "gato", status: 0);
        var oldTime = DateTimeOffset.UtcNow.AddMinutes(-2);
        await using var reader = new AppDbContext(WithInsertBeforeFirstSave(options, async () =>
        {
            await using var other = new AppDbContext(options);
            var wordId = await other.Words.Select(w => w.WordId).SingleAsync();
            Assert.IsType<NoContentResult>(await CreateController(other).UpdateWord(wordId,
                new UpdateWordDto { Status = 6, Translation = "other device" }));
        }));

        var result = await CreateController(reader).CreateWord(new CreateWordDto
        {
            Term = "gato", TextId = TextId, Status = 3, Translation = "old queued edit",
            Sentence = "gato perro gato", ReplaceExisting = true, ClientUpdatedAt = oldTime
        });

        var conflict = Assert.IsType<WordEditConflictDto>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
        Assert.Equal(6, conflict.Word.Status);
        Assert.Equal("other device", conflict.Word.Translation);
        await using var check = new AppDbContext(options);
        Assert.Empty(await check.TextWords.ToListAsync());
        Assert.Empty(await check.SrsPhrases.ToListAsync());
        Assert.Empty(await check.SrsCardReviews.ToListAsync());
        Assert.Equal("other device", (await check.WordTranslations.SingleAsync()).Translation);
    }

    [Fact]
    public async Task QueuedWordCreate_CanSaveALinkerPlaceholderAndRetryWithoutDuplicatingEffects()
    {
        var options = await CreateSqliteOptions();
        var offlineTime = DateTimeOffset.UtcNow.AddMinutes(-5);
        await InsertWord(options, "gato", status: 0);

        for (var attempt = 0; attempt < 2; attempt++)
        {
            await using var replay = new AppDbContext(options);
            var result = await CreateController(replay).CreateWord(new CreateWordDto
            {
                Term = "gato", TextId = TextId, Status = 3, Translation = "cat",
                Sentence = "gato perro gato", ReplaceExisting = true, ClientUpdatedAt = offlineTime
            });
            Assert.IsType<OkObjectResult>(result.Result);
        }

        await using var check = new AppDbContext(options);
        Assert.Equal(3, (await check.Words.SingleAsync()).Status);
        Assert.Single(await check.TextWords.ToListAsync());
        Assert.Single(await check.SrsPhrases.ToListAsync());
        Assert.Single(await check.SrsCardReviews.ToListAsync());
    }

    [Fact]
    public async Task CoalescedEdit_DoesNotRefreshAgeOfOlderTranslation()
    {
        var options = await CreateSqliteOptions();
        await InsertWord(options, "gato", status: 0);
        var earlierEdit = DateTimeOffset.UtcNow.AddMinutes(-3);
        await using var reader = new AppDbContext(options);
        var wordId = await reader.Words.Select(w => w.WordId).SingleAsync();
        var controller = CreateController(reader);
        Assert.IsType<NoContentResult>(await controller.UpdateWord(wordId,
            new UpdateWordDto { Status = 3, Translation = "intervening definition", ClientUpdatedAt = earlierEdit.AddMinutes(1) }));

        var result = await controller.UpdateWord(wordId, new UpdateWordDto
        {
            Status = 4, Translation = "older definition", ClientUpdatedAt = earlierEdit.AddMinutes(2),
            TranslationUpdatedAt = earlierEdit
        });

        var conflict = Assert.IsType<WordEditConflictDto>(Assert.IsType<ConflictObjectResult>(result).Value);
        Assert.Equal("intervening definition", conflict.Word.Translation);
        Assert.IsType<NoContentResult>(await controller.UpdateWord(wordId,
            new UpdateWordDto { Status = 4, ClientUpdatedAt = earlierEdit.AddMinutes(2) }));
        Assert.Equal("intervening definition", (await reader.WordTranslations.SingleAsync()).Translation);
    }

    [Fact]
    public async Task LaterDefinitionInCoalescedRequestDoesNotRefreshAnOlderExplicitGrade()
    {
        var options = await CreateSqliteOptions();
        await InsertWord(options, "gato", status: 0);
        await using var db = new AppDbContext(options);
        var id = await db.Words.Select(w => w.WordId).SingleAsync();
        var time = DateTimeOffset.UtcNow.AddMinutes(-5);
        var words = CreateController(db);
        Assert.IsType<NoContentResult>(await words.UpdateWord(id, new UpdateWordDto { Status = 5, ClientUpdatedAt = time }));
        var mixed = new UpdateWordDto { Status = 2, Translation = "queued", StatusUpdatedAt = time.AddMinutes(-1),
            ClientUpdatedAt = time.AddMinutes(1) };
        Assert.IsType<ConflictObjectResult>(await words.UpdateWord(id, mixed));
        var word = await db.Words.AsNoTracking().Include(w => w.Translation).SingleAsync();
        Assert.Equal(5, word.Status);
        Assert.Null(word.Translation);
        mixed.StatusUpdatedAt = time.AddSeconds(10);
        Assert.IsType<NoContentResult>(await words.UpdateWord(id, mixed));
        word = await db.Words.AsNoTracking().Include(w => w.Translation).SingleAsync();
        Assert.Equal(2, word.Status);
        Assert.True(word.LastEditedAt > word.LastManualStatusAt);
        Assert.Equal(word.LastManualStatusAt, word.LastStatusEditedAt);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CoalescedEdit_IgnoresAnOlderFieldThatAlreadyMatches(bool olderDefinition)
    {
        var options = await CreateSqliteOptions();
        await InsertWord(options, "gato", status: 0);
        await using var db = new AppDbContext(options);
        var id = await db.Words.Select(w => w.WordId).SingleAsync();
        var now = DateTimeOffset.UtcNow.AddMinutes(-5);
        var serverAt = now.AddMinutes(1);
        var offlineAt = now.AddMinutes(2);
        var controller = CreateController(db);
        Assert.IsType<NoContentResult>(await controller.UpdateWord(id, new() { Status = 2, Translation = "cat", ClientUpdatedAt = serverAt }));

        var replay = new UpdateWordDto
        {
            Status = olderDefinition ? 4 : 2,
            Translation = olderDefinition ? "cat" : "domestic cat",
            ClientUpdatedAt = offlineAt,
            StatusUpdatedAt = olderDefinition ? null : now,
            TranslationUpdatedAt = olderDefinition ? now : null
        };
        Assert.IsType<NoContentResult>(await controller.UpdateWord(id, replay));
        var word = await db.Words.AsNoTracking().Include(w => w.Translation).SingleAsync();
        Assert.Equal(replay.Status, word.Status);
        Assert.Equal(replay.Translation, word.Translation.Translation);
        Assert.Equal(TrimToMicroseconds(olderDefinition ? serverAt : offlineAt), word.LastTranslationEditedAt);
        Assert.Equal(TrimToMicroseconds(olderDefinition ? offlineAt : serverAt), word.LastManualStatusAt);

        static DateTime TrimToMicroseconds(DateTimeOffset time) => time.UtcDateTime.AddTicks(-(time.Ticks % 10));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ExplicitReapplyFromSlowClock_RequiresTheVersionActuallyReviewed(bool create)
    {
        var options = await CreateSqliteOptions();
        await InsertWord(options, "gato", status: 0);
        await using var seed = new AppDbContext(options);
        var wordId = await seed.Words.Select(w => w.WordId).SingleAsync();
        var slowClock = DateTimeOffset.UtcNow.AddHours(-1);
        Assert.IsType<NoContentResult>(await CreateController(seed).UpdateWord(wordId,
            new UpdateWordDto { Status = 5, Translation = "saved" }));

        async Task<IActionResult> ApplyDraft(AppDbContext db, string? revision)
        {
            var controller = CreateController(db);
            if (create)
            {
                var result = await controller.CreateWord(new CreateWordDto
                {
                    Term = "gato", TextId = TextId, ReplaceExisting = true, Status = 2, Sentence = "El gato.",
                    Translation = "my draft", ClientUpdatedAt = slowClock,
                    TranslationUpdatedAt = slowClock.AddMinutes(-1), ExpectedRevision = revision
                });
                return result.Result!;
            }
            return await controller.UpdateWord(wordId, new UpdateWordDto
            {
                TextId = TextId, Status = 2, Sentence = "El gato.", Translation = "my draft",
                ClientUpdatedAt = slowClock, TranslationUpdatedAt = slowClock.AddMinutes(-1), ExpectedRevision = revision
            });
        }

        var first = Assert.IsType<WordEditConflictDto>(Assert.IsType<ConflictObjectResult>(await ApplyDraft(seed, null)).Value);
        Assert.Equal("saved", first.Word.Translation);
        await using var racing = new AppDbContext(WithInsertBeforeFirstSave(options, async () =>
        {
            await using var other = new AppDbContext(options);
            Assert.IsType<NoContentResult>(await CreateController(other).UpdateWord(wordId,
                new UpdateWordDto { Status = 6, Translation = "changed during reapply" }));
        }));
        var second = Assert.IsType<WordEditConflictDto>(Assert.IsType<ConflictObjectResult>(await ApplyDraft(racing, first.Revision)).Value);
        Assert.NotEqual(first.Revision, second.Revision);
        Assert.Equal("changed during reapply", second.Word.Translation);
        Assert.Empty(await racing.SrsPhrases.ToListAsync());

        await using var retry = new AppDbContext(options);
        var applied = await ApplyDraft(retry, second.Revision);
        if (create) Assert.IsType<OkObjectResult>(applied);
        else Assert.IsType<NoContentResult>(applied);
        var word = await retry.Words.Include(w => w.Translation).SingleAsync();
        Assert.Equal("my draft", word.Translation.Translation);
        Assert.Equal(2, word.Status);
        Assert.Equal(word.LastEditedAt, word.LastManualStatusAt);
        Assert.True(word.LastEditedAt > slowClock.UtcDateTime.AddMinutes(30));
        Assert.Single(await retry.SrsPhrases.ToListAsync());
        if (create) Assert.Single(await retry.TextWords.ToListAsync());
    }

    [Fact]
    public async Task TranslationOnlyBatch_PreservesTheLastExplicitStatusTime()
    {
        var options = await CreateSqliteOptions();
        await using var db = new AppDbContext(options);
        var controller = CreateController(db);
        var slowClock = DateTimeOffset.UtcNow.AddHours(-1);
        await controller.CreateWord(new CreateWordDto { Term = "gato", TextId = TextId, Status = 2, ClientUpdatedAt = slowClock });
        var word = await db.Words.SingleAsync();
        var manual = word.LastManualStatusAt;
        Assert.NotNull(manual);
        Assert.IsType<OkObjectResult>(await controller.AddTermsBatch(new AddTermBatchDto
        {
            LanguageId = 1, KeepExistingStatus = true, Terms = [new() { Term = "gato", Translation = "cat" }]
        }));
        Assert.Equal(manual, word.LastManualStatusAt);
        Assert.True(word.LastEditedAt > manual);
        Assert.IsType<OkObjectResult>(await controller.AddTermsBatch(new AddTermBatchDto
        {
            LanguageId = 1, Terms = [new() { Term = "gato", Status = 3 }]
        }));
        Assert.True(word.LastManualStatusAt > manual);
        Assert.Equal(word.LastEditedAt, word.LastManualStatusAt);
    }

    [Fact]
    public async Task LinkAsync_ConcurrentReaderSave_PreservesReaderEditAndLinkedCounts()
    {
        var options = await CreateSqliteOptions();
        var linkerAtSave = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseLinker = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var readerAtSave = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var context = new AppDbContext(
            WithInsertBeforeFirstSave(options, async () => { linkerAtSave.SetResult(); await releaseLinker.Task; }));
        await using var reader = new AppDbContext(WithInsertBeforeFirstSave(options, () => {
            readerAtSave.SetResult(); return Task.CompletedTask;
        }));
        var linking = Task.Run(() => WordLinker.LinkAsync(context, TextId, "gato perro gato", languageId: 1, UserId));
        await linkerAtSave.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var saving = Task.Run(() => CreateController(reader).CreateWord(new CreateWordDto {
            TextId = TextId, Term = "gato", Status = 3, Translation = "cat"
        }));
        try { await readerAtSave.Task.WaitAsync(TimeSpan.FromSeconds(10)); }
        finally { releaseLinker.TrySetResult(); }
        await linking.WaitAsync(TimeSpan.FromSeconds(10));
        var saved = await saving.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.IsType<OkObjectResult>(saved.Result);

        await using var check = new AppDbContext(options);
        var words = await check.Words.Include(w => w.Translation).OrderBy(w => w.Term).ToListAsync();
        Assert.Equal(new[] { "gato", "perro" }, words.Select(w => w.Term));
        Assert.Equal(3, words[0].Status); // the reader's row, not replaced
        Assert.Equal("cat", words[0].Translation?.Translation);
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
