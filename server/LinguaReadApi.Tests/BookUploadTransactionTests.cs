using System.Security.Claims;
using System.Data.Common;
using System.Text;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Tokenization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class BookUploadTransactionTests
{
    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task CommitFailure_VerifiesOutcomeBeforeRetryingOrDeletingAssets(bool retry, bool committed)
    {
        var root = Path.Combine(Path.GetTempPath(), $"lingua-commit-{Guid.NewGuid():N}");
        try
        {
            await using var connection = new SqliteConnection("Data Source=:memory:");
            await connection.OpenAsync();
            var failure = new CommitFailure(committed);
            var builder = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).AddInterceptors(failure);
            if (retry) builder.ReplaceService<IExecutionStrategyFactory, CommitRetryFactory>();
            await using var context = new AppDbContext(builder.Options);
            await context.Database.EnsureCreatedAsync();
            var user = Guid.NewGuid();
            context.Users.Add(new User { Id = user, UserName = "commit-test" });
            context.Languages.Add(new Language { LanguageId = 1, Name = "English", Code = "en" });
            await context.SaveChangesAsync();
            string? asset = null;
            context.SavingChanges += (_, _) =>
            {
                if (!context.ChangeTracker.Entries<Text>().Any(e => e.State == EntityState.Added)) return;
                var book = context.ChangeTracker.Entries<Book>().Single().Entity;
                // Simulate an extracted image present before chapter insertion/commit.
                asset = Path.Combine(root, "epub_assets", user.ToString(), book.BookId.ToString(), "cover.png");
                Directory.CreateDirectory(Path.GetDirectoryName(asset)!);
                File.WriteAllText(asset, "image");
            };
            var channel = new WordLinkingChannel();
            var controller = new BooksController(context, NullLogger<BooksController>.Instance, new ChapterDetectionService(), wordLinkingChannel: channel) {
                WebRoot = root,
                ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user.ToString())], "test")) } }
            };
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes("First paragraph here.\n\nAnother paragraph here."));
            failure.Armed = true;
            var result = await controller.UploadBook(new UploadBookDto {
                File = new FormFile(stream, 0, stream.Length, "File", "book.txt"), LanguageId = 1,
                SplitMethod = "paragraph", MaxSegmentSize = 10
            });
            context.ChangeTracker.Clear();
            Assert.Null(context.Database.CurrentTransaction);
            if (committed || retry)
            {
                Assert.IsType<CreatedAtActionResult>(result.Result);
                Assert.Single(await context.Books.ToListAsync());
                Assert.Equal(2, await context.Texts.CountAsync());
                Assert.Equal(2, channel.Reader.Count);
                Assert.True(File.Exists(asset));
                if (committed) Assert.Equal(1, failure.Attempts);
            }
            else
            {
                Assert.Equal(500, Assert.IsType<ObjectResult>(result.Result).StatusCode);
                Assert.Empty(await context.Books.ToListAsync());
                Assert.False(File.Exists(asset));
                Assert.Equal(0, channel.Reader.Count);
            }
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, recursive: true); }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Upload_CommitsCompleteAggregate_OrRollsBackWithoutCompensation(bool fail)
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var outage = new ChapterOutage();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).AddInterceptors(outage).Options;
        await using var context = new AppDbContext(options);
        await context.Database.EnsureCreatedAsync();
        var user = Guid.NewGuid();
        context.Users.Add(new User { Id = user, UserName = "upload-test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "English", Code = "en" });
        await context.SaveChangesAsync();
        outage.Armed = fail;
        var channel = new WordLinkingChannel();
        var controller = new BooksController(context, NullLogger<BooksController>.Instance, new ChapterDetectionService(), wordLinkingChannel: channel)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext {
                User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, user.ToString())], "test")) } }
        };
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("First paragraph here.\n\nAnother paragraph here."));
        var result = await controller.UploadBook(new UploadBookDto {
            File = new FormFile(stream, 0, stream.Length, "File", "book.txt"), LanguageId = 1,
            Tags = ["imported"], SplitMethod = "paragraph", MaxSegmentSize = 10
        });
        outage.Armed = false;
        await using var verify = new AppDbContext(options);
        if (fail)
        {
            Assert.Equal(500, Assert.IsType<ObjectResult>(result.Result).StatusCode);
            Assert.Empty(await verify.Books.ToListAsync());
            Assert.Empty(await verify.Texts.ToListAsync());
            Assert.Empty(await verify.Tags.ToListAsync());
            Assert.Empty(await verify.BookTags.ToListAsync());
            Assert.Equal(0, channel.Reader.Count);
        }
        else
        {
            Assert.IsType<CreatedAtActionResult>(result.Result);
            Assert.Single(await verify.Books.ToListAsync());
            Assert.Single(await verify.BookTags.ToListAsync());
            var texts = await verify.Texts.ToListAsync();
            Assert.Equal(2, texts.Count);
            Assert.All(texts, text => Assert.Equal("processing", text.WordLinkingStatus));
            Assert.Equal(texts.Count, channel.Reader.Count);
        }
    }

    private sealed class ChapterOutage : SaveChangesInterceptor
    {
        public bool Armed;
        private bool failed;
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Armed && (failed || eventData.Context!.ChangeTracker.Entries<Text>().Any(e => e.State == EntityState.Added)))
            {
                failed = true;
                throw new DbUpdateException("Database unavailable, including compensating writes.");
            }
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }

    private sealed class CommitFailure(bool afterCommit) : DbTransactionInterceptor
    {
        public bool Armed;
        public int Attempts;
        public override ValueTask<InterceptionResult> TransactionCommittingAsync(DbTransaction transaction,
            TransactionEventData eventData, InterceptionResult result, CancellationToken cancellationToken = default)
        {
            if (Armed)
            {
                Attempts++;
                if (!afterCommit) { Armed = false; throw new TimeoutException("Commit did not reach the server."); }
            }
            return new(result);
        }

        public override Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (Armed && afterCommit) { Armed = false; throw new TimeoutException("Commit acknowledgement lost."); }
            return Task.CompletedTask;
        }
    }

    public sealed class CommitRetryFactory(ExecutionStrategyDependencies dependencies) : IExecutionStrategyFactory
    {
        public IExecutionStrategy Create() => new CommitRetryStrategy(dependencies);
    }

    private sealed class CommitRetryStrategy(ExecutionStrategyDependencies dependencies) : ExecutionStrategy(dependencies, 2, TimeSpan.Zero)
    {
        protected override bool ShouldRetryOn(Exception exception) => exception is TimeoutException;
    }
}
