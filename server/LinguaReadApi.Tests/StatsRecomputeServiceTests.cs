using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class StatsRecomputeServiceTests
{
    [Fact]
    public async Task RecomputeAllAsync_PopulatesTextStats_FromUniqueTextWordStatuses()
    {
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        SeedBookAndStandaloneText(dbName, userId);

        var (provider, _) = CreateProvider(dbName);
        var service = new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        await service.RecomputeAllAsync(CancellationToken.None);

        await using var assertCtx = NewContext(dbName);
        var standalone = await assertCtx.Texts.SingleAsync(t => t.TextId == 100);
        // 3 unique words: hola(2), amigo(1), mundo(5). Status >= 4 => mundo.
        Assert.Equal(3, standalone.TotalWords);
        Assert.Equal(1, standalone.KnownWords);
        Assert.NotNull(standalone.StatsUpdatedAt);

        var bookText1 = await assertCtx.Texts.SingleAsync(t => t.TextId == 200);
        // bookText1: hola(2), playa(4) → 2 total, 1 known
        Assert.Equal(2, bookText1.TotalWords);
        Assert.Equal(1, bookText1.KnownWords);

        var bookText2 = await assertCtx.Texts.SingleAsync(t => t.TextId == 201);
        // bookText2: hola(2) shared with bookText1 + sol(5) → 2 total, 1 known
        Assert.Equal(2, bookText2.TotalWords);
        Assert.Equal(1, bookText2.KnownWords);
    }

    [Fact]
    public async Task RecomputeAllAsync_PopulatesBookStats_AsRunningTokenSums()
    {
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        SeedBookAndStandaloneText(dbName, userId);

        var (provider, _) = CreateProvider(dbName);
        var service = new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        await service.RecomputeAllAsync(CancellationToken.None);

        await using var assertCtx = NewContext(dbName);
        var book = await assertCtx.Books.SingleAsync(b => b.BookId == 50);

        // Book contains bookText1 (hola×1[Status=2], playa×1[4]) +
        // bookText2 (hola×1[2], sol×1[5]). Running totals SUM occurrences,
        // so "hola" contributes 2 (not 1). Total=4, known(>=4)=2, learning(2-3)=2.
        Assert.Equal(4, book.TotalWords);
        Assert.Equal(2, book.KnownWords);
        Assert.Equal(2, book.LearningWords);
        Assert.NotNull(book.StatsUpdatedAt);
    }

    [Fact]
    public async Task RecomputeAllAsync_WeightsByOccurrenceCount_NotByDistinctWords()
    {
        // Repro of the user-reported "5% per chapter, 17% across the book"
        // confusion: with unique-word counting, rare unknowns inflate the
        // book ratio. With running-word counting (sum of OccurrenceCount),
        // chapters and the book agree to within length-weighted rounding.
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        await using (var seed = NewContext(dbName))
        {
            seed.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
            seed.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
            seed.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "que", Status = 5 });
            seed.Words.Add(new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "rare1", Status = 1 });
            seed.Words.Add(new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "rare2", Status = 1 });

            seed.Books.Add(new Book { BookId = 1, UserId = userId, LanguageId = 1, Title = "B" });
            seed.Texts.Add(new Text { TextId = 10, UserId = userId, LanguageId = 1, BookId = 1, Title = "P1", Content = "" });
            seed.Texts.Add(new Text { TextId = 11, UserId = userId, LanguageId = 1, BookId = 1, Title = "P2", Content = "" });

            // P1 has "que" 95 times + "rare1" 5 times. P2 has "que" 95 times + "rare2" 5 times.
            seed.TextWords.AddRange(
                new TextWord { TextWordId = 100, TextId = 10, WordId = 1, OccurrenceCount = 95 },
                new TextWord { TextWordId = 101, TextId = 10, WordId = 2, OccurrenceCount = 5 },
                new TextWord { TextWordId = 110, TextId = 11, WordId = 1, OccurrenceCount = 95 },
                new TextWord { TextWordId = 111, TextId = 11, WordId = 3, OccurrenceCount = 5 });
            await seed.SaveChangesAsync();
        }

        var (provider, _) = CreateProvider(dbName);
        var service = new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        await service.RecomputeAllAsync(CancellationToken.None);

        await using var ctx = NewContext(dbName);
        var p1 = await ctx.Texts.SingleAsync(t => t.TextId == 10);
        var p2 = await ctx.Texts.SingleAsync(t => t.TextId == 11);
        var book = await ctx.Books.SingleAsync();

        Assert.Equal(100, p1.TotalWords);
        Assert.Equal(95, p1.KnownWords);
        Assert.Equal(100, p2.TotalWords);
        Assert.Equal(95, p2.KnownWords);

        // Running-word book totals = sum of running tokens across texts.
        // Old (unique-word) behavior would give Total=3, Known=1 → 66.7% unknown,
        // wildly diverging from the per-text 5%. New behavior gives 200/190 = 5%.
        Assert.Equal(200, book.TotalWords);
        Assert.Equal(190, book.KnownWords);
    }

    [Fact]
    public async Task RecomputeAllAsync_IsIdempotent_WhenCountsUnchanged()
    {
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        SeedBookAndStandaloneText(dbName, userId);

        var (provider, _) = CreateProvider(dbName);
        var service = new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        await service.RecomputeAllAsync(CancellationToken.None);

        await using (var firstCtx = NewContext(dbName))
        {
            var t = await firstCtx.Texts.SingleAsync(x => x.TextId == 100);
            var firstStamp = t.StatsUpdatedAt;
            Assert.NotNull(firstStamp);
        }

        DateTime? stampBefore;
        await using (var beforeCtx = NewContext(dbName))
        {
            stampBefore = (await beforeCtx.Texts.SingleAsync(x => x.TextId == 100)).StatsUpdatedAt;
        }

        // Wait briefly so a second pass would produce a different timestamp if it wrote.
        await Task.Delay(20);
        await service.RecomputeAllAsync(CancellationToken.None);

        await using var afterCtx = NewContext(dbName);
        var stampAfter = (await afterCtx.Texts.SingleAsync(x => x.TextId == 100)).StatsUpdatedAt;
        Assert.Equal(stampBefore, stampAfter);
    }

    [Fact]
    public async Task RecomputeAllAsync_LeavesStatsAtZero_ForRowsWithoutTextWords()
    {
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        await using (var seed = NewContext(dbName))
        {
            seed.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
            seed.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
            seed.Texts.Add(new Text
            {
                TextId = 999,
                UserId = userId,
                LanguageId = 1,
                Title = "Empty",
                Content = "ignored"
            });
            await seed.SaveChangesAsync();
        }

        var (provider, _) = CreateProvider(dbName);
        var service = new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
        await service.RecomputeAllAsync(CancellationToken.None);

        await using var ctx = NewContext(dbName);
        var t = await ctx.Texts.SingleAsync();
        Assert.Equal(0, t.TotalWords);
        Assert.Equal(0, t.KnownWords);
        // Even untouched rows get a stamp on the first sweep so the
        // background service knows to leave them alone next time.
        Assert.NotNull(t.StatsUpdatedAt);
    }

    // --- Orchestration tests (ExecuteAsync / MigrationSignal) ---

    [Fact]
    public async Task ExecuteAsync_StartupSweep_BlocksUntilMigrationSignalFires()
    {
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        SeedBookAndStandaloneText(dbName, userId);

        var signal = new MigrationSignal(); // not yet fired
        var (provider, _) = CreateProvider(dbName);
        var service = new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, signal);

        await service.StartAsync(CancellationToken.None);

        // Signal hasn't fired — sweep must not have run yet.
        await using (var ctx = NewContext(dbName))
        {
            var t = await ctx.Texts.SingleAsync(x => x.TextId == 100);
            Assert.Null(t.StatsUpdatedAt);
        }

        // Unblock the service and wait for the in-memory sweep to finish.
        signal.SetComplete();
        await Task.Delay(200);

        await using (var ctx = NewContext(dbName))
        {
            var t = await ctx.Texts.SingleAsync(x => x.TextId == 100);
            Assert.NotNull(t.StatsUpdatedAt);
        }

        await service.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task ExecuteAsync_CancelBeforeMigrationSignal_ReturnsWithoutHanging()
    {
        var signal = new MigrationSignal(); // never fired
        var (provider, _) = CreateProvider(Guid.NewGuid().ToString());
        var service = new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, signal);

        await service.StartAsync(CancellationToken.None);

        // StopAsync must return promptly even though the signal never fires.
        await service.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(5));
    }

    // --- Helpers ---

    private static (IServiceProvider provider, ServiceProvider services) CreateProvider(string dbName)
    {
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(o => o.UseInMemoryDatabase(dbName));
        var sp = services.BuildServiceProvider();
        return (sp, sp);
    }

    private static AppDbContext NewContext(string dbName)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;
        return new AppDbContext(options);
    }

    /// <summary>
    /// Seeds a single user/language with:
    /// - One standalone text (id=100) referencing words: hola(Status=2), amigo(Status=1), mundo(Status=5)
    /// - One book (id=50) containing two texts:
    ///     bookText1 (id=200) → words: hola(2), playa(4)
    ///     bookText2 (id=201) → words: hola(2) [shared], sol(5)
    /// </summary>
    private static void SeedBookAndStandaloneText(string dbName, Guid userId)
    {
        using var ctx = NewContext(dbName);
        ctx.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        ctx.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });

        var hola = new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "hola", Status = 2 };
        var amigo = new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "amigo", Status = 1 };
        var mundo = new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "mundo", Status = 5 };
        var playa = new Word { WordId = 4, UserId = userId, LanguageId = 1, Term = "playa", Status = 4 };
        var sol = new Word { WordId = 5, UserId = userId, LanguageId = 1, Term = "sol", Status = 5 };
        ctx.Words.AddRange(hola, amigo, mundo, playa, sol);

        ctx.Books.Add(new Book
        {
            BookId = 50,
            UserId = userId,
            LanguageId = 1,
            Title = "Libro",
        });

        ctx.Texts.Add(new Text
        {
            TextId = 100,
            UserId = userId,
            LanguageId = 1,
            Title = "Standalone",
            Content = "hola amigo mundo"
        });
        ctx.Texts.Add(new Text
        {
            TextId = 200,
            UserId = userId,
            LanguageId = 1,
            BookId = 50,
            Title = "Part 1",
            Content = "hola playa"
        });
        ctx.Texts.Add(new Text
        {
            TextId = 201,
            UserId = userId,
            LanguageId = 1,
            BookId = 50,
            Title = "Part 2",
            Content = "hola sol"
        });

        ctx.TextWords.AddRange(
            new TextWord { TextWordId = 1000, TextId = 100, WordId = 1 },
            new TextWord { TextWordId = 1001, TextId = 100, WordId = 2 },
            new TextWord { TextWordId = 1002, TextId = 100, WordId = 3 },
            new TextWord { TextWordId = 2000, TextId = 200, WordId = 1 },
            new TextWord { TextWordId = 2001, TextId = 200, WordId = 4 },
            new TextWord { TextWordId = 2010, TextId = 201, WordId = 1 },
            new TextWord { TextWordId = 2011, TextId = 201, WordId = 5 }
        );

        ctx.SaveChanges();
    }
}

