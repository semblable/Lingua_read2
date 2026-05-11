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
    public async Task RequestSweep_RunsRecompute_AfterDebounceDelay()
    {
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        SeedBookAndStandaloneText(dbName, userId);

        var (provider, _) = CreateProvider(dbName);
        var service = NewService(provider);

        // Pre-condition: standalone text has no cached stats yet.
        await using (var pre = NewContext(dbName))
        {
            Assert.Null((await pre.Texts.SingleAsync(t => t.TextId == 100)).StatsUpdatedAt);
        }

        service.RequestSweep(TimeSpan.FromMilliseconds(50));

        // Wait long enough for the debounce timer to elapse and
        // the background recompute to finish.
        var deadline = DateTime.UtcNow.AddSeconds(2);
        Text? observed = null;
        while (DateTime.UtcNow < deadline)
        {
            await Task.Delay(50);
            await using var probe = NewContext(dbName);
            observed = await probe.Texts.AsNoTracking().SingleAsync(t => t.TextId == 100);
            if (observed.StatsUpdatedAt != null) break;
        }

        Assert.NotNull(observed?.StatsUpdatedAt);
        Assert.Equal(3, observed!.TotalWords);
        Assert.Equal(1, observed.KnownWords);
    }

    [Fact]
    public async Task RequestSweep_Coalesces_WhenCalledRepeatedlyWithinDelay()
    {
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        SeedBookAndStandaloneText(dbName, userId);

        var (provider, _) = CreateProvider(dbName);
        var service = NewService(provider);

        // Re-arm the debounce 10 times in quick succession. Only the
        // last call's timer should survive; the recompute should fire
        // exactly once, ~150ms after the final RequestSweep call.
        for (int i = 0; i < 10; i++)
        {
            service.RequestSweep(TimeSpan.FromMilliseconds(150));
            await Task.Delay(20);
        }

        // Within the debounce window (150ms after the last call):
        // sweep should NOT have run yet.
        await using (var midProbe = NewContext(dbName))
        {
            var midText = await midProbe.Texts.AsNoTracking().SingleAsync(t => t.TextId == 100);
            Assert.Null(midText.StatsUpdatedAt);
        }

        // After the window elapses, the single coalesced sweep runs.
        await Task.Delay(400);
        await using var afterProbe = NewContext(dbName);
        var afterText = await afterProbe.Texts.AsNoTracking().SingleAsync(t => t.TextId == 100);
        Assert.NotNull(afterText.StatsUpdatedAt);
        Assert.Equal(3, afterText.TotalWords);
    }

    [Theory]
    // Midday → wait until tonight at 03:00 UTC.
    [InlineData(2026, 5, 10, 14, 0,  /* expectedHours */ 13.0)]
    // Just before 03:00 → minutes until today's 03:00 run.
    [InlineData(2026, 5, 10,  2, 30, /*  */               0.5)]
    // Exactly at 03:00 → schedule the NEXT one 24 h out, not zero.
    [InlineData(2026, 5, 10,  3,  0, /*  */              24.0)]
    // Just after 03:00 → wait ~24 h.
    [InlineData(2026, 5, 10,  3,  1, /*  */              23.0 + 59.0/60.0)]
    public void TimeUntilNextRun_TargetsThreeAmUtc(int year, int month, int day, int hour, int minute, double expectedHours)
    {
        var now = new DateTime(year, month, day, hour, minute, 0, DateTimeKind.Utc);
        var delta = StatsRecomputeService.TimeUntilNextRun(now);

        // Always positive, never negative, never zero.
        Assert.True(delta > TimeSpan.Zero);

        // The next firing lands on 03:00 UTC on the next eligible day.
        var fireAt = now + delta;
        Assert.Equal(3, fireAt.Hour);
        Assert.Equal(0, fireAt.Minute);
        Assert.Equal(DateTimeKind.Utc, fireAt.Kind);

        Assert.InRange(delta.TotalHours, expectedHours - 0.05, expectedHours + 0.05);
    }

    [Fact]
    public async Task RecomputeAllAsync_PicksUpNewlyKnownWords_OnSubsequentRun()
    {
        // Simulates "user learns more words between sweeps": the nightly
        // run at 03:00 UTC must see the new Status values and update the
        // cached book/text stats accordingly.
        var dbName = Guid.NewGuid().ToString();
        var userId = Guid.NewGuid();
        SeedBookAndStandaloneText(dbName, userId);

        var (provider, _) = CreateProvider(dbName);
        var service = NewService(provider);

        // First sweep: baseline.
        await service.RecomputeAllAsync(CancellationToken.None);
        int knownBefore;
        await using (var ctx = NewContext(dbName))
        {
            var book = await ctx.Books.SingleAsync(b => b.BookId == 50);
            knownBefore = book.KnownWords;
        }

        // User grades two previously-learning words up to "known" (Status >= 4).
        await using (var ctx = NewContext(dbName))
        {
            // hola(Status=2 → 5): contributes 2 known tokens across the two book texts.
            // amigo(Status=1 → 4): contributes 1 known token in the standalone text.
            var hola = await ctx.Words.SingleAsync(w => w.WordId == 1);
            var amigo = await ctx.Words.SingleAsync(w => w.WordId == 2);
            hola.Status = 5;
            amigo.Status = 4;
            await ctx.SaveChangesAsync();
        }

        // Second sweep: should re-aggregate against the new Status values.
        await service.RecomputeAllAsync(CancellationToken.None);

        await using var assertCtx = NewContext(dbName);
        var bookAfter = await assertCtx.Books.SingleAsync(b => b.BookId == 50);
        var standaloneAfter = await assertCtx.Texts.SingleAsync(t => t.TextId == 100);

        // Book: hola occurs once in each of the two parts → 2 new known tokens.
        Assert.Equal(knownBefore + 2, bookAfter.KnownWords);

        // Standalone text: hola(1) + amigo(1) + mundo(1) all known now.
        Assert.Equal(3, standaloneAfter.KnownWords);
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

    private static StatsRecomputeService NewService(IServiceProvider provider)
        => new StatsRecomputeService(provider, NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());

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

