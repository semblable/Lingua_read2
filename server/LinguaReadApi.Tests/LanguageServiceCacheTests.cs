using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// Pins the caching contract introduced for language config: reads are served from a shared
/// IMemoryCache entry (the hot translation path must not re-query per call), and every write
/// through the service evicts that entry so admin edits are visible immediately. A stale-read
/// regression here would surface as translations targeting the wrong language after an edit.
/// </summary>
public class LanguageServiceCacheTests
{
    [Fact]
    public async Task GetAllLanguages_IsServedFromCache_NotFromTheDatabase()
    {
        var dbName = Guid.NewGuid().ToString();
        var cache = CreateCache();
        await using var context = CreateContext(dbName);
        SeedLanguage(context, 1, "Spanish", "ES");
        var service = new LanguageService(context, cache);

        var first = await service.GetAllLanguagesAsync();
        Assert.Single(first);

        // Write directly to the database, bypassing the service (no eviction).
        SeedLanguage(context, 2, "French", "FR");

        var second = await service.GetAllLanguagesAsync();
        Assert.Single(second); // still the cached list — the DB was not re-queried
    }

    [Fact]
    public async Task CreateLanguage_EvictsTheCache()
    {
        var dbName = Guid.NewGuid().ToString();
        var cache = CreateCache();
        await using var context = CreateContext(dbName);
        SeedLanguage(context, 1, "Spanish", "ES");
        var service = new LanguageService(context, cache);

        Assert.Single(await service.GetAllLanguagesAsync()); // warm the cache

        await service.CreateLanguageAsync(new Language { Name = "German", Code = "DE" });

        var after = await service.GetAllLanguagesAsync();
        Assert.Equal(2, after.Count());
    }

    [Fact]
    public async Task UpdateLanguage_EvictsTheCache()
    {
        var dbName = Guid.NewGuid().ToString();
        var cache = CreateCache();
        await using var context = CreateContext(dbName);
        SeedLanguage(context, 1, "Spanish", "ES");
        var service = new LanguageService(context, cache);

        Assert.Single(await service.GetAllLanguagesAsync()); // warm the cache

        var updated = await service.UpdateLanguageAsync(1, new Language
        {
            LanguageId = 1,
            Name = "Castilian",
            Code = "ES"
        });
        Assert.True(updated);

        var after = await service.GetAllLanguagesAsync();
        Assert.Equal("Castilian", Assert.Single(after).Name);
    }

    [Fact]
    public async Task DeleteLanguage_EvictsTheCache()
    {
        var dbName = Guid.NewGuid().ToString();
        var cache = CreateCache();
        await using var context = CreateContext(dbName);
        SeedLanguage(context, 1, "Spanish", "ES");
        SeedLanguage(context, 2, "French", "FR");
        var service = new LanguageService(context, cache);

        Assert.Equal(2, (await service.GetAllLanguagesAsync()).Count()); // warm the cache

        var result = await service.DeleteLanguageAsync(2);
        Assert.Equal(DeleteLanguageStatus.Deleted, result.Status);

        Assert.Single(await service.GetAllLanguagesAsync());
    }

    [Fact]
    public async Task ByIdAndForTranslation_AreServedFromTheSameCacheEntry()
    {
        var dbName = Guid.NewGuid().ToString();
        var cache = CreateCache();
        await using var context = CreateContext(dbName);
        SeedLanguage(context, 1, "Spanish", "ES", activeForTranslation: true);
        var service = new LanguageService(context, cache);

        Assert.Single(await service.GetAllLanguagesAsync()); // warm the cache

        // Bypass the service: neither derived read should see this row while cached.
        SeedLanguage(context, 2, "French", "FR", activeForTranslation: true);

        Assert.Null(await service.GetLanguageByIdAsync(2));
        Assert.Single(await service.GetLanguagesForTranslationAsync());
    }

    [Fact]
    public async Task CacheIsShared_AcrossServiceInstances_LikeScopedServicesOverASingletonCache()
    {
        // Production shape: LanguageService is scoped (fresh per request) while IMemoryCache is
        // a singleton. A write through one request's service must be visible to the next.
        var dbName = Guid.NewGuid().ToString();
        var cache = CreateCache();

        await using (var warmContext = CreateContext(dbName))
        {
            SeedLanguage(warmContext, 1, "Spanish", "ES");
            var warmService = new LanguageService(warmContext, cache);
            Assert.Single(await warmService.GetAllLanguagesAsync()); // warm the shared cache

            await warmService.CreateLanguageAsync(new Language { Name = "German", Code = "DE" });
        }

        await using var laterContext = CreateContext(dbName);
        var laterService = new LanguageService(laterContext, cache);
        Assert.Equal(2, (await laterService.GetAllLanguagesAsync()).Count());
    }

    private static MemoryCache CreateCache() => new(new MemoryCacheOptions());

    private static AppDbContext CreateContext(string dbName)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;
        return new AppDbContext(options);
    }

    private static void SeedLanguage(AppDbContext context, int id, string name, string code, bool activeForTranslation = false)
    {
        context.Languages.Add(new Language
        {
            LanguageId = id,
            Name = name,
            Code = code,
            IsActiveForTranslation = activeForTranslation
        });
        context.SaveChanges();
        context.ChangeTracker.Clear();
    }
}
