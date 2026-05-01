using System.Net;
using System.Security.Claims;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class HardcoverServiceTests
{
    [Fact]
    public async Task GetStatusAsync_WithoutToken_ReturnsUnconfiguredWithoutCallingApi()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "");
        var handler = new QueueMessageHandler([]);
        var service = CreateService(context, handler);

        var result = await service.GetStatusAsync(userId);

        Assert.False(result.Configured);
        Assert.False(result.Connected);
        Assert.Equal("Hardcover API token is not configured.", result.Message);
        Assert.Equal(0, handler.RequestCount);
    }

    [Fact]
    public async Task GetStatusAsync_WithToken_ParsesMeResponse()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "hardcover-token");
        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": { "id": 42, "username": "reader" } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.GetStatusAsync(userId);

        Assert.True(result.Configured);
        Assert.True(result.Connected);
        Assert.Equal(42, result.HardcoverUserId);
        Assert.Equal("reader", result.Username);
        Assert.Equal("Bearer", handler.LastAuthorizationScheme);
        Assert.Equal("hardcover-token", handler.LastAuthorizationParameter);
    }

    [Fact]
    public async Task MatchBookAsync_LowConfidence_ReturnsCandidatesWithoutApplyingMatch()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "The Local Book",
            Description = ""
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "search": { "ids": [111] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 111,
                  "title": "Completely Different",
                  "description": "A book",
                  "pages": 300,
                  "release_date": "2020-01-01",
                  "image": { "url": "https://example.test/cover.jpg" },
                  "contributions": [{ "author": { "name": "Someone" } }],
                  "editions": [{ "id": 2, "title": "Completely Different", "isbn_13": "9780000000000", "pages": 300, "release_date": "2020-01-01", "publisher": { "name": "Pub" }, "image": { "url": "https://example.test/edition.jpg" } }]
                }]
              }
            }
            """)
        ]);
        var service = CreateService(context, handler);

        var result = await service.MatchBookAsync(userId, book.BookId);

        Assert.False(result.Applied);
        Assert.Single(result.Candidates);
        var saved = await context.Books.SingleAsync();
        Assert.Null(saved.HardcoverBookId);
        Assert.Null(saved.HardcoverEditionId);
    }

    [Fact]
    public async Task MatchBookAsync_ExactTitle_AppliesHardcoverIds()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            Description = ""
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "description": "A book",
                  "pages": 1248,
                  "release_date": "2017-11-14",
                  "image": { "url": "https://example.test/cover.jpg" },
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [{ "id": 1, "title": "Oathbringer", "isbn_13": "9780765326379", "pages": 1248, "release_date": "2017-11-14", "publisher": { "name": "Tor" }, "image": { "url": "https://example.test/edition.jpg" } }]
                }]
              }
            }
            """)
        ]);
        var service = CreateService(context, handler);

        var result = await service.MatchBookAsync(userId, book.BookId);

        Assert.True(result.Applied);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(328491, saved.HardcoverBookId);
        Assert.Equal(1, saved.HardcoverEditionId);
        Assert.Equal(1248, saved.PageCount);
    }

    [Fact]
    public async Task ImportMetadataAsync_MatchedBook_FillsMissingFieldsAndDownloadsCover()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            Description = "",
            HardcoverBookId = 328491,
            HardcoverEditionId = 1
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "description": "Imported description",
                  "pages": 1248,
                  "release_date": "2017-11-14",
                  "image": { "url": "https://example.test/cover.jpg" },
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [{ "id": 1, "title": "Oathbringer", "isbn_13": "9780765326379", "pages": 1248, "release_date": "2017-11-14", "publisher": { "name": "Tor" }, "image": { "url": "https://example.test/edition.jpg" } }]
                }]
              }
            }
            """),
            JsonResponse("fake-image")
        ]);
        var environment = new TestWebHostEnvironment();
        var service = CreateService(context, handler, environment);

        var result = await service.ImportMetadataAsync(userId, book.BookId);

        Assert.True(result.Success);
        Assert.Contains("description", result.UpdatedFields);
        Assert.Contains("author", result.UpdatedFields);
        Assert.Contains("coverImage", result.UpdatedFields);

        var saved = await context.Books.SingleAsync();
        Assert.Equal("Imported description", saved.Description);
        Assert.Equal("Brandon Sanderson", saved.Author);
        Assert.Equal("9780765326379", saved.Isbn13);
        Assert.Equal("Tor", saved.Publisher);
        Assert.Equal(1248, saved.PageCount);
        Assert.NotNull(saved.CoverImagePath);
        Assert.True(File.Exists(Path.Combine(environment.WebRootPath, saved.CoverImagePath!.Replace('/', Path.DirectorySeparatorChar))));
    }

    [Fact]
    public async Task SyncProgressAsync_WhenSyncDisabledAndRequired_SkipsWithoutCallingApi()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: false);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Progress Book",
            HardcoverBookId = 99
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Skipped);
        Assert.False(result.Success);
        Assert.Equal("Hardcover sync is disabled.", result.Message);
        Assert.Equal(0, handler.RequestCount);
    }

    [Fact]
    public async Task SyncProgressAsync_LinkedBook_CreatesUserBookAndReadProgress()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Progress Book",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 2", Content = "two", PartNumber = 2, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": { "user_books": [] } } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 2 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 888, "error": null, "user_book_read": { "id": 888 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.Equal(50, result.CompletionPercentage);
        Assert.Equal(2, result.StatusId);
        Assert.Equal(100, result.ProgressPages);

        var saved = await context.Books.SingleAsync();
        Assert.Equal(777, saved.HardcoverUserBookId);
        Assert.Equal(888, saved.HardcoverUserBookReadId);
        Assert.NotNull(saved.HardcoverLastSyncedAt);
    }

    [Fact]
    public async Task SyncAllAsync_ImportsMetadataAndSyncsEachBook()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Oathbringer",
            Description = ""
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "description": "Imported description",
                  "pages": 100,
                  "release_date": "2017-11-14",
                  "image": { "url": null },
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [{ "id": 1, "title": "Oathbringer", "isbn_13": "9780765326379", "pages": 100, "release_date": "2017-11-14", "publisher": { "name": "Tor" }, "image": { "url": null } }]
                }]
              }
            }
            """),
            JsonResponse("""{ "data": { "me": { "user_books": [] } } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 888, "error": null, "user_book_read": { "id": 888 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncAllAsync(userId);

        Assert.Single(result.Results);
        Assert.True(result.Results[0].Success);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(328491, saved.HardcoverBookId);
        Assert.Equal("Imported description", saved.Description);
        Assert.Equal(777, saved.HardcoverUserBookId);
        var settings = await context.UserSettings.SingleAsync();
        Assert.NotNull(settings.HardcoverLastSyncAt);
    }

    private static HardcoverService CreateService(AppDbContext context, HttpMessageHandler handler, IWebHostEnvironment? environment = null)
    {
        return new HardcoverService(
            context,
            new SingleClientFactory(handler),
            environment ?? new TestWebHostEnvironment(),
            NullLogger<HardcoverService>.Instance);
    }

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static async Task<Guid> SeedUserWithSettingsAsync(AppDbContext context, string hardcoverToken, bool syncEnabled = false)
    {
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            HardcoverApiToken = hardcoverToken,
            HardcoverSyncEnabled = syncEnabled,
            CreatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        return userId;
    }

    private static async Task<int> SeedLanguageAsync(AppDbContext context)
    {
        var language = new Language { Name = $"English-{Guid.NewGuid():N}", Code = Guid.NewGuid().ToString("N")[..8] };
        context.Languages.Add(language);
        await context.SaveChangesAsync();
        return language.LanguageId;
    }

    private static HttpResponseMessage JsonResponse(string json)
    {
        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(json)
        };
    }

    private sealed class SingleClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;

        public SingleClientFactory(HttpMessageHandler handler)
        {
            _handler = handler;
        }

        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }

    private sealed class QueueMessageHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses;

        public QueueMessageHandler(IEnumerable<HttpResponseMessage> responses)
        {
            _responses = new Queue<HttpResponseMessage>(responses);
        }

        public string? LastAuthorizationScheme { get; private set; }
        public string? LastAuthorizationParameter { get; private set; }
        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            LastAuthorizationScheme = request.Headers.Authorization?.Scheme;
            LastAuthorizationParameter = request.Headers.Authorization?.Parameter;

            if (_responses.Count == 0)
            {
                throw new InvalidOperationException("No queued HTTP response for Hardcover test.");
            }

            return Task.FromResult(_responses.Dequeue());
        }
    }

    private sealed class TestWebHostEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = Path.Combine(Path.GetTempPath(), "linguaread-hardcover-tests", Guid.NewGuid().ToString("N"));
        public string EnvironmentName { get; set; } = "Testing";
        public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
