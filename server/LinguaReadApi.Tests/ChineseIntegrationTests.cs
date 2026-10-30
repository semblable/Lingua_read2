using LinguaReadApi.Data;
using LinguaReadApi.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Tokenization;
using Xunit;

namespace LinguaReadApi.Tests;

[Collection("Postgres study database")]
public class ChineseIntegrationTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("z-a")]
    public void OptInTokens_PreserveMixedSourceAndCustomFallback(string? characters)
    {
        var text = "🙂我今天在图书馆学习中文。ABC2026";
        var result = Tokenizer.Tokenize(text, new Language { ParserType = ChineseSegmenter.Profile, WordCharacters = characters! });
        Assert.Equal(text, string.Concat(result.Tokens.Select(token => token.Text)));
        Assert.Equal(new[] { "我", "今天", "在", "图书馆", "学习", "中文", "ABC" }, result.Tokens.Where(t => t.IsWord).Select(t => t.Text));
        Assert.Equal(new Tokenizer.Token("🙂", 0, 2, false), result.Tokens[0]);
        var legacy = Tokenizer.Tokenize("图书馆学习中文", new Language { ParserType = "jieba" });
        Assert.Single(legacy.Tokens);
    }
    [Fact]
    public async Task UnknownProfile_RefusesRelinkWithoutDeletingSavedLinks()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await context.Database.EnsureCreatedAsync();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "synthetic" });
        context.Languages.Add(new Language { LanguageId = 1, Code = "zh", Name = "Chinese" });
        context.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Content = "中文", Title = "Future", SegmentationProfile = "future-v2" });
        context.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "中文", Status = 5 });
        context.TextWords.Add(new TextWord { TextId = 1, WordId = 1, OccurrenceCount = 2 });
        await context.SaveChangesAsync();
        await Assert.ThrowsAsync<NotSupportedException>(() => WordLinker.RelinkAsync(context, 1, "中文", 1, userId));
        Assert.Equal(2, (await context.TextWords.SingleAsync()).OccurrenceCount);
        Assert.Equal(5, (await context.Words.SingleAsync()).Status);
        Assert.Equal("future-v2", (await context.Texts.SingleAsync()).SegmentationProfile);
    }

    [PostgresStudyFact]
    public async Task ConcurrentQueuedLinkAndEdit_OnlyCurrentSourceRemainsLinked()
    {
        var settings = new NpgsqlConnectionStringBuilder(Environment.GetEnvironmentVariable("LINGUA_STUDY_TEST_POSTGRES")!);
        Assert.Equal("studycheck", settings.Database);
        var schema = "chinese_links_" + Guid.NewGuid().ToString("N");
        await using var admin = new NpgsqlConnection(settings.ToString());
        await admin.OpenAsync();
        await new NpgsqlCommand($"CREATE SCHEMA {schema}", admin).ExecuteNonQueryAsync();
        try
        {
            settings.SearchPath = schema;
            AppDbContext NewContext() => new(new DbContextOptionsBuilder<AppDbContext>()
                .UseNpgsql(settings.ToString(), pg => pg.EnableRetryOnFailure(6)).Options);
            var userId = Guid.NewGuid();
            await using (var seed = NewContext())
            {
                await seed.GetService<IRelationalDatabaseCreator>().CreateTablesAsync();
                seed.Users.Add(new User { Id = userId, UserName = "synthetic" });
                seed.Languages.Add(new Language { LanguageId = 1, Code = "zh", Name = "Chinese" });
                seed.Texts.Add(new Text { TextId = 1, UserId = userId, LanguageId = 1, Content = "我爱读书。", Title = "Synthetic", SegmentationProfile = "jieba-v1" });
                await seed.SaveChangesAsync();
            }
            foreach (var content in new[] { "今天今天。", "中文中文。", "今天今天。" })
            {
                await using var queued = NewContext();
                await using var edited = NewContext();
                await Task.WhenAll(
                    WordLinker.LinkAsync(queued, 1, "我爱读书。", 1, userId),
                    LessonStudyActivity.AtomicAsync(edited, userId, async () => {
                        var text = await edited.Texts.SingleAsync();
                        text.Content = content;
                        await edited.SaveChangesAsync();
                        await WordLinker.RelinkAsync(edited, 1, content, 1, userId);
                        return true;
                    }));
                await using var verify = NewContext();
                var links = await verify.TextWords.Include(link => link.Word).ToListAsync();
                var link = Assert.Single(links);
                Assert.Equal(content[..2], link.Word.Term);
                Assert.Equal(2, link.OccurrenceCount);
                Assert.Empty(await verify.UserActivities.ToListAsync());
            }
        }
        finally { await new NpgsqlCommand($"DROP SCHEMA {schema} CASCADE", admin).ExecuteNonQueryAsync(); }
    }

}
