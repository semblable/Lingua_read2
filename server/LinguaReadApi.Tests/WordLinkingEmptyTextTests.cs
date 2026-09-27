using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Tokenization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// An empty text (an SRS micro-story whose AI reply parsed into nothing) was never stamped with
/// the tokenizer version, so WordLinkingMigrationService picked it up again on every batch and
/// re-linked it forever: on staging 2 such texts ran 2.1 million times in 3.5 hours, and
/// StatsRecomputeService, which waits for the pass, never ran.
/// </summary>
public class WordLinkingEmptyTextTests
{
    private static readonly Guid UserId = Guid.NewGuid();

    [Theory]
    [InlineData("")]
    [InlineData("   \n\n ")]
    public async Task LinkAsync_StampsAnEmptyTextAsCurrent(string content)
    {
        await using var connection = await OpenAsync();
        var options = Options(connection);
        await SeedAsync(options, new Text { TextId = 1, UserId = UserId, LanguageId = 1, Title = "Empty", Content = content });

        await using (var context = new AppDbContext(options))
        {
            await WordLinker.LinkAsync(context, 1, content, 1, UserId);
        }

        await using var check = new AppDbContext(options);
        Assert.Equal(WordLinker.CurrentTokenizerVersion, (await check.Texts.SingleAsync()).WordLinkingTokenizerVersion);
        Assert.Empty(await check.TextWords.ToListAsync());
    }

    [Fact]
    public async Task MigrationPass_EndsWithEmptyTexts_AndStampsEveryText()
    {
        await using var connection = await OpenAsync();
        var options = Options(connection);
        await SeedAsync(options,
            new Text { TextId = 1, UserId = UserId, LanguageId = 1, Title = "SRS Micro-Contexts", Content = "", Tag = "srs-story" },
            new Text { TextId = 2, UserId = UserId, LanguageId = 1, Title = "Notícia", Content = "O jovem seguia para a casa da tia." },
            new Text { TextId = 3, UserId = UserId, LanguageId = 1, Title = "SRS Micro-Contexts", Content = "", Tag = "srs-story" });

        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(builder => builder.UseSqlite(connection));
        await using var provider = services.BuildServiceProvider();
        var service = new WordLinkingMigrationService(
            provider, NullLogger<WordLinkingMigrationService>.Instance, new MigrationSignal());

        // Before the fix this never returned; the timeout turns a regression into a failure.
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await service.RunMigration(timeout.Token);

        Assert.False(timeout.IsCancellationRequested, "The relink pass didn't end.");
        await using var check = new AppDbContext(options);
        Assert.All(await check.Texts.ToListAsync(),
            text => Assert.Equal(WordLinker.CurrentTokenizerVersion, text.WordLinkingTokenizerVersion));
        Assert.NotEmpty(await check.TextWords.Where(tw => tw.TextId == 2).ToListAsync());
    }

    private static async Task<SqliteConnection> OpenAsync()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        return connection;
    }

    private static DbContextOptions<AppDbContext> Options(SqliteConnection connection) =>
        new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;

    private static async Task SeedAsync(DbContextOptions<AppDbContext> options, params Text[] texts)
    {
        await using var context = new AppDbContext(options);
        await context.Database.EnsureCreatedAsync();
        context.Users.Add(new User { Id = UserId, UserName = "reader", Email = "reader@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Portuguese", Code = "pt", WordCharacters = Language.LatinWordCharacters });
        context.Texts.AddRange(texts);
        await context.SaveChangesAsync();
    }
}
