using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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
            JsonResponse("""{ "data": { "me": [{ "id": 42, "username": "reader" }] } }""")
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
    public async Task SyncProgressAsync_WhenExternalWritesDisabled_SkipsWithoutContactingHardcover()
    {
        // Staging runs on a copy of production's data (with sync enabled and Hardcover ids set);
        // finishing a book there must not touch the real Hardcover account.
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            Description = "",
            HardcoverBookId = 328491,
            IsFinished = true
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        var handler = new QueueMessageHandler([]); // any request would throw
        var service = CreateService(context, handler, externalWritesDisabled: true);

        var single = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true, rating: 4.5m);
        var all = await service.SyncAllAsync(userId);

        Assert.True(single.Skipped);
        Assert.Equal(ExternalWritesOptions.DisabledMessage, single.Message);
        Assert.Empty(all.Results);
        Assert.Equal(ExternalWritesOptions.DisabledMessage, all.Message);
        Assert.Equal(0, handler.RequestCount);
        Assert.Null((await context.Books.SingleAsync()).HardcoverLastSyncedAt);
    }

    [Fact]
    public async Task MatchBookAsync_StillWorks_WhenExternalWritesDisabled()
    {
        // Matching only reads from Hardcover and updates the local book, so staging keeps it.
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book { UserId = userId, LanguageId = await SeedLanguageAsync(context), Title = "Oathbringer", Description = "" };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            JsonResponse("""{ "data": { "books": [{ "id": 328491, "title": "Oathbringer", "slug": "oathbringer", "pages": 1248, "contributions": [], "editions": [] }] } }""")
        ]);
        var service = CreateService(context, handler, externalWritesDisabled: true);

        var result = await service.MatchBookAsync(userId, book.BookId);

        Assert.True(result.Applied);
        Assert.Equal(328491, (await context.Books.SingleAsync()).HardcoverBookId);
        Assert.All(handler.RequestBodies, body => Assert.DoesNotContain("mutation", body));
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
                  "slug": "oathbringer",
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
        Assert.Equal("oathbringer", saved.HardcoverSlug);
        Assert.Equal("A book", saved.Description);
    }

    [Fact]
    public async Task MatchBookAsync_ReplacesUploadPlaceholderDescription()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            Description = "Uploaded from Oathbringer.epub"
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
                  "slug": "oathbringer",
                  "description": "Remote description",
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
        Assert.Equal("Remote description", saved.Description);
        Assert.Equal("oathbringer", saved.HardcoverSlug);
    }

    [Fact]
    public async Task MatchBookAsync_DoesNotOverwriteExistingDescription()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            Description = "Local description"
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
                  "slug": "oathbringer",
                  "description": "Remote description",
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
        Assert.Equal("Local description", saved.Description);
        Assert.Equal("oathbringer", saved.HardcoverSlug);
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

        var handler = new QueueMessageHandler([OathbringerBookResponse(), ImageResponse("fake-image")]);
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
    public async Task ImportMetadataAsync_DownloadedCoverFileMissing_DownloadsItAgain()
    {
        // Covers downloaded before hardcover-covers had its own volume were lost on redeploy
        // while the book still points at them.
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var stalePath = $"hardcover-covers/{userId:N}/lost.jpg";
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            HardcoverBookId = 328491,
            HardcoverEditionId = 1,
            CoverImagePath = stalePath
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([OathbringerBookResponse(), ImageResponse("fake-image")]);
        var environment = new TestWebHostEnvironment();
        var service = CreateService(context, handler, environment);

        var result = await service.ImportMetadataAsync(userId, book.BookId);

        Assert.True(result.Success);
        Assert.Contains("coverImage", result.UpdatedFields);
        var saved = await context.Books.SingleAsync();
        Assert.NotEqual(stalePath, saved.CoverImagePath);
        Assert.True(File.Exists(Path.Combine(environment.WebRootPath, saved.CoverImagePath!.Replace('/', Path.DirectorySeparatorChar))));
    }

    [Fact]
    public async Task ImportMetadataAsync_MissingCoverFromElsewhere_IsLeftAlone()
    {
        // Only covers this service downloaded are replaced; an EPUB cover path stays as it is.
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var epubCover = $"epub_assets/{userId}/1/cover.jpg";
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            HardcoverBookId = 328491,
            HardcoverEditionId = 1,
            CoverImagePath = epubCover
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([OathbringerBookResponse()]);
        var service = CreateService(context, handler);

        var result = await service.ImportMetadataAsync(userId, book.BookId);

        Assert.True(result.Success);
        Assert.DoesNotContain("coverImage", result.UpdatedFields);
        Assert.Equal(1, handler.RequestCount); // the book lookup only, no cover download
        Assert.Equal(epubCover, (await context.Books.SingleAsync()).CoverImagePath);
    }

    private static HttpResponseMessage OathbringerBookResponse() => JsonResponse("""
        {
          "data": {
            "books": [{
              "id": 328491,
              "title": "Oathbringer",
              "slug": "oathbringer",
              "description": "Imported description",
              "pages": 1248,
              "release_date": "2017-11-14",
              "image": { "url": "https://example.test/cover.jpg" },
              "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
              "editions": [{ "id": 1, "title": "Oathbringer", "isbn_13": "9780765326379", "pages": 1248, "release_date": "2017-11-14", "publisher": { "name": "Tor" }, "image": { "url": "https://example.test/edition.jpg" } }]
            }]
          }
        }
        """);

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
    public async Task SyncProgressAsync_WithRating_IncludesRatingInUpdateUserBookPayload()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Rated Book",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            PageCount = 200,
            IsFinished = true
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [{ "id": 999 }] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "update_user_book_read": { "id": 999, "error": null, "user_book_read": { "id": 999 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true, rating: 4.5m);

        Assert.True(result.Success);
        // The update_user_book request body must contain the rating field.
        var updateBody = handler.RequestBodies.FirstOrDefault(body => body.Contains("update_user_book") && !body.Contains("update_user_book_read"));
        Assert.NotNull(updateBody);
        Assert.Contains("\"rating\":4.5", updateBody);
    }

    [Fact]
    public async Task SyncProgressAsync_WithoutRating_OmitsRatingFromUpdateUserBookPayload()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Unrated Book",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [{ "id": 999 }] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "update_user_book_read": { "id": 999, "error": null, "user_book_read": { "id": 999 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        var updateBody = handler.RequestBodies.FirstOrDefault(body => body.Contains("update_user_book") && !body.Contains("update_user_book_read"));
        Assert.NotNull(updateBody);
        Assert.DoesNotContain("\"rating\"", updateBody);
    }

    [Fact]
    public async Task SyncProgressAsync_ExistingHardcoverUserBook_UpdatesExistingReadProgress()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Existing Progress Book",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [{ "id": 999 }] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "update_user_book_read": { "id": 999, "error": null, "user_book_read": { "id": 999 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(777, saved.HardcoverUserBookId);
        Assert.Equal(999, saved.HardcoverUserBookReadId);
        Assert.Contains(handler.RequestBodies, body => body.Contains("update_user_book_read"));
        Assert.DoesNotContain(handler.RequestBodies, body => body.Contains("insert_user_book_read"));
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

    [Theory]
    [InlineData(123, 100)]
    [InlineData(999, null)]
    public async Task SyncProgressAsync_UpdatingInProgressRead_UsesPagesOnlyForTheMatchingEdition(int remoteEdition, int? expectedPages)
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "In Progress",
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
            JsonResponse($$""" { "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "edition_id": {{remoteEdition}}, "user_book_reads": [{ "id": 888, "edition_id": {{remoteEdition}} }] }] }] } } """),
            JsonResponse($$""" { "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 2, "edition_id": {{remoteEdition}} } } } } """),
            JsonResponse("""{ "data": { "update_user_book_read": { "id": 888, "error": null, "user_book_read": { "id": 888 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId);

        Assert.True(result.Success);
        var updateBookBody = handler.RequestBodies[1];
        Assert.DoesNotContain("\"last_read_date\"", updateBookBody);
        Assert.DoesNotContain("\"edition_id\"", updateBookBody);
        Assert.Equal(expectedPages, result.ProgressPages);
        if (expectedPages.HasValue)
        {
            var updateReadBody = handler.RequestBodies[2];
            Assert.DoesNotContain("\"started_at\"", updateReadBody);
            Assert.DoesNotContain("\"finished_at\"", updateReadBody);
            Assert.DoesNotContain("\"edition_id\"", updateReadBody);
            Assert.Contains("\"progress_pages\":100", updateReadBody);
        }
        else
        {
            Assert.Equal(2, handler.RequestCount);
        }
    }

    [Fact]
    public async Task SyncProgressAsync_FinishingBook_IncludesLastReadDateAndFinishedAt_WithoutStartedAt()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Finished Book",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            PageCount = 200,
            IsFinished = true
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [{ "id": 888 }] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "update_user_book_read": { "id": 888, "error": null, "user_book_read": { "id": 888 } } } }""")
        ]);
        var service = CreateService(context, handler);
        service.UtcNow = () => new DateTimeOffset(2026, 11, 20, 12, 0, 0, TimeSpan.Zero);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.Contains("\"last_read_date\":\"2026-11-20\"", handler.RequestBodies[1]);
        var updateReadBody = handler.RequestBodies[2];
        Assert.DoesNotContain("\"started_at\"", updateReadBody);
        Assert.Contains("\"finished_at\":\"2026-11-20\"", updateReadBody);
    }

    [Fact]
    public async Task SyncProgressAsync_WhenInsertUserBookCreatesRead_UpdatesExistingReadWithoutDuplicateInsert()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Server Auto Read",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            PageCount = 300
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 2", Content = "two", PartNumber = 2, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": { "user_books": [] } } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 2, "edition_id": 123, "user_book_reads": [{ "id": 555, "edition_id": 123, "finished_at": null, "progress_pages": 0 }] } } } }"""),
            JsonResponse("""{ "data": { "update_user_book_read": { "id": 555, "error": null, "user_book_read": { "id": 555 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.Contains(handler.RequestBodies, b => b.Contains("update_user_book_read"));
        Assert.DoesNotContain(handler.RequestBodies, b => b.Contains("insert_user_book_read"));
        Assert.Equal(555, (await context.Books.SingleAsync()).HardcoverUserBookReadId);
    }

    [Fact]
    public async Task SyncProgressAsync_RemoteAlreadyRead_NeverDemotesToCurrentlyReading()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Already Read On HC",
            HardcoverBookId = 99,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 2", Content = "two", PartNumber = 2, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 3, "user_book_reads": [] }] }] } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Skipped);
        Assert.Equal(1, handler.RequestCount);
        Assert.Contains("_is_null: true", handler.RequestBodies[0]);
        Assert.Equal(777, (await context.Books.SingleAsync()).HardcoverUserBookId);
    }

    [Fact]
    public async Task SyncProgressAsync_RemoteAlreadyReadAndLocalFinished_SkipsMutationWithoutRating_AndOmitsLastReadDateWhenRatingAdded()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Already Finished",
            HardcoverBookId = 99,
            PageCount = 200,
            IsFinished = true
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 3, "user_book_reads": [], "completed_reads": [{ "id": 555 }] }] }] } }"""),
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 3, "user_book_reads": [], "completed_reads": [{ "id": 555 }] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var withoutRating = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);
        Assert.True(withoutRating.Success);
        Assert.Equal(1, handler.RequestCount); // FindUserBook only; no update_user_book or insert_user_book_read

        var withRating = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true, rating: 4.5m);
        Assert.True(withRating.Success);
        Assert.Equal(3, handler.RequestCount); // FindUserBook + update_user_book (no duplicate read insert)
        var updateBody = handler.RequestBodies[2];
        Assert.Contains("\"rating\":4.5", updateBody);
        Assert.DoesNotContain("\"last_read_date\"", updateBody);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SyncProgressAsync_BulkRetryRecordsMissingFinishWithoutDuplicatingTheRead(bool hasHistory)
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Finished Book",
            Description = "Description",
            Author = "Author",
            Isbn13 = "9780765326379",
            Publisher = "Publisher",
            ReleaseDate = DateTime.UtcNow,
            CoverImagePath = "epub_assets/cover.jpg",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            PageCount = 200,
            IsFinished = true,
            LastReadAt = new DateTime(2026, 11, 20, 20, 0, 0, DateTimeKind.Utc)
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var completedReads = hasHistory ? """[{ "id": 444 }]""" : "[]";
        var firstLookup = hasHistory
            ? JsonResponse($$""" { "data": { "me": [{ "user_books": [{ "id": 777, "edition_id": 123, "status_id": 2, "user_book_reads": [], "completed_reads": {{completedReads}} }] }] } } """)
            : JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }""");
        var firstShelfWrite = hasHistory
            ? JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "edition_id": 123 } } } }""")
            : JsonResponse("""{ "data": { "insert_user_book": { "id": 777, "error": null } } }""");
        var handler = new QueueMessageHandler([
            firstLookup,
            firstShelfWrite,
            JsonResponse("""{ "data": { "insert_user_book_read": { "error": "Temporary error" } } }"""),
            JsonResponse($$""" { "data": { "me": [{ "user_books": [{ "id": 777, "book_id": 99, "edition_id": 123, "status_id": 3, "user_book_reads": [], "completed_reads": {{completedReads}} }] }] } } """),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "edition_id": 123 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 555 } } }"""),
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "edition_id": 123, "status_id": 3, "user_book_reads": [], "completed_reads": [{ "id": 555 }] }] }] } }""")
        ]);
        var service = CreateService(context, handler);
        service.UtcNow = () => new DateTimeOffset(2026, 11, 21, 12, 0, 0, TimeSpan.Zero);

        await Assert.ThrowsAsync<HardcoverApiException>(() => service.SyncProgressAsync(userId, book.BookId));
        context.ChangeTracker.Clear();
        Assert.Equal(hasHistory ? 444 : 0, (await context.Books.AsNoTracking().SingleAsync()).HardcoverPendingFinishAfterReadId);

        var retried = Assert.Single((await service.SyncAllAsync(userId)).Results);
        Assert.True(retried.Success);
        Assert.Contains("completed_reads: user_book_reads", handler.RequestBodies[3]);
        Assert.Contains("insert_user_book_read", handler.RequestBodies[5]);
        Assert.Contains("\"finished_at\":\"2026-11-20\"", handler.RequestBodies[5]);
        Assert.Contains("\"progress_pages\":200", handler.RequestBodies[5]);
        var finished = await context.Books.SingleAsync();
        Assert.Equal(555, finished.HardcoverUserBookReadId);
        Assert.Null(finished.HardcoverPendingFinishAfterReadId);

        Assert.True((await service.SyncProgressAsync(userId, book.BookId)).Success);
        Assert.Equal(7, handler.RequestCount);
    }

    [Fact]
    public async Task MatchBookAsync_RematchingToDifferentBook_ClearsStaleUserBookAndReadIds()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            HardcoverBookId = 10,
            HardcoverEditionId = 20,
            HardcoverUserBookId = 777,
            HardcoverUserBookReadId = 888,
            HardcoverLastSyncedAt = DateTime.UtcNow
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([OathbringerBookResponse()]);
        var service = CreateService(context, handler);

        var result = await service.MatchBookAsync(userId, book.BookId, hardcoverBookId: 328491);

        Assert.True(result.Applied);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(328491, saved.HardcoverBookId);
        Assert.Equal(1, saved.HardcoverEditionId);
        Assert.Null(saved.HardcoverUserBookId);
        Assert.Null(saved.HardcoverUserBookReadId);
        Assert.Null(saved.HardcoverLastSyncedAt);
    }

    [Fact]
    public async Task SyncProgressAsync_StaleLocalUserBookIdDeletedRemotely_RecoversByInsertingNewUserBook()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Recovered Book",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            HardcoverUserBookId = 777,
            HardcoverUserBookReadId = 888,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 900, "error": null, "user_book": { "id": 900, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 901, "error": null, "user_book_read": { "id": 901 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(900, saved.HardcoverUserBookId);
        Assert.Equal(901, saved.HardcoverUserBookReadId);
    }

    [Fact]
    public async Task SyncProgressAsync_WhenUpdateUserBookReturnsNotFound_RecoversByInsertingNewUserBook()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Recover On 404",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            HardcoverUserBookId = 777,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [] }] }] } }"""),
            ErrorResponse(HttpStatusCode.NotFound, """{ "error": "not_found" }"""),
            JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 910, "error": null, "user_book": { "id": 910, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 911, "error": null, "user_book_read": { "id": 911 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(910, saved.HardcoverUserBookId);
        Assert.Equal(911, saved.HardcoverUserBookReadId);
    }

    [Fact]
    public async Task SyncProgressAsync_WeightsCompletionByPartWordCount()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Weighted Book",
            HardcoverBookId = 99,
            PageCount = 400
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Preface", Content = "a", PartNumber = 1, TotalWords = 100, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Chapter 1", Content = "b", PartNumber = 2, TotalWords = 300, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": { "user_books": [] } } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 2 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 888, "error": null, "user_book_read": { "id": 888 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.Equal(25.0, result.CompletionPercentage);
        Assert.Equal(100, result.ProgressPages);
    }

    [Fact]
    public async Task MatchBookAsync_ConflictingAuthor_DoesNotAutoMatch()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "The Shadow",
            Author = "Jane Doe"
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "search": { "ids": [501] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 501,
                  "title": "The Shadow",
                  "contributions": [{ "author": { "name": "John Smith" } }],
                  "editions": []
                }]
              }
            }
            """)
        ]);
        var service = CreateService(context, handler);

        var result = await service.MatchBookAsync(userId, book.BookId);

        Assert.False(result.Applied);
        Assert.Single(result.Candidates);
        Assert.True(result.Candidates[0].Score < 0.92);
        Assert.Null((await context.Books.SingleAsync()).HardcoverBookId);
    }

    [Fact]
    public async Task MatchBookAsync_SelectsLanguageMatchedNonAudioEdition()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var spanishId = await SeedLanguageAsync(context, "Spanish", "ES");
        var book = new Book
        {
            UserId = userId,
            LanguageId = spanishId,
            Title = "El Quijote",
            Author = "Miguel de Cervantes"
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "search": { "ids": [600] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 600,
                  "title": "El Quijote",
                  "slug": "el-quijote",
                  "pages": 900,
                  "contributions": [{ "author": { "name": "Miguel de Cervantes" } }],
                  "editions": [
                    { "id": 1, "title": "Don Quixote", "pages": 1000, "reading_format_id": 1, "edition_format": "Hardcover", "language": { "code2": "en", "language": "English" } },
                    { "id": 2, "title": "El Quijote Audio", "pages": null, "reading_format_id": 2, "edition_format": "Audiobook", "language": { "code2": "es", "language": "Spanish" } },
                    { "id": 3, "title": "El Quijote Digital", "pages": 840, "reading_format_id": 4, "edition_format": "Ebook", "isbn_13": "9788400000001", "language": { "code2": "es", "language": "Spanish" } }
                  ]
                }]
              }
            }
            """)
        ]);
        var service = CreateService(context, handler);

        var result = await service.MatchBookAsync(userId, book.BookId);

        Assert.True(result.Applied);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(3, saved.HardcoverEditionId);
        Assert.Equal(840, saved.PageCount);
        Assert.NotNull(result.AppliedCandidate?.Editions);
        Assert.Equal(3, result.AppliedCandidate!.Editions!.Count);
    }

    [Fact]
    public async Task MatchBookAsync_ManualQuery_SupportsUrlAndIsbn_AndUnlinkClearsFields()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Unrelated Local Title"
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            OathbringerBookResponse(),
            JsonResponse("""{ "data": { "editions": [{ "id": 1, "book_id": 328491 }] } }"""),
            OathbringerBookResponse(),
            OathbringerBookResponse()
        ]);
        var service = CreateService(context, handler);

        // 1. Manual search by URL does not auto-apply; returns candidate for user selection.
        var byUrl = await service.MatchBookAsync(userId, book.BookId, searchQuery: "https://hardcover.app/id/book/328491");
        Assert.False(byUrl.Applied);
        Assert.Single(byUrl.Candidates);
        Assert.Contains("328491", handler.RequestBodies[0]);

        // 2. Manual search by ISBN-13 queries editions.
        var byIsbn = await service.MatchBookAsync(userId, book.BookId, searchQuery: "978-0765326379");
        Assert.False(byIsbn.Applied);
        Assert.Single(byIsbn.Candidates);
        Assert.Contains("9780765326379", handler.RequestBodies[1]);

        // 3. Explicit selection applies, and UnlinkBookAsync clears all Hardcover columns.
        var applied = await service.MatchBookAsync(userId, book.BookId, hardcoverBookId: 328491, hardcoverEditionId: 1);
        Assert.True(applied.Applied);
        await service.UnlinkBookAsync(userId, book.BookId);

        var cleared = await context.Books.SingleAsync();
        Assert.Null(cleared.HardcoverBookId);
        Assert.Null(cleared.HardcoverEditionId);
        Assert.Null(cleared.HardcoverSlug);
        Assert.Null(cleared.HardcoverUserBookId);
        Assert.Null(cleared.HardcoverUserBookReadId);
        Assert.Null(cleared.HardcoverMatchedAt);
        Assert.Null(cleared.HardcoverLastSyncedAt);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MatchBookAsync_ChangingToAnEditionOfUnknownLengthDropsTheOldPageCount(bool unlinkFirst)
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Different Editions",
            HardcoverBookId = 99,
            HardcoverEditionId = 123,
            PageCount = 600
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "books": [{ "id": 99, "title": "Different Editions", "pages": 250, "editions": [{ "id": 456 }] }] } }""")
        ]);
        var service = CreateService(context, handler);

        if (unlinkFirst) await service.UnlinkBookAsync(userId, book.BookId);
        var result = await service.MatchBookAsync(userId, book.BookId, hardcoverBookId: 99, hardcoverEditionId: unlinkFirst ? null : 456);

        Assert.True(result.Applied);
        var saved = await context.Books.AsNoTracking().SingleAsync();
        Assert.Equal(456, saved.HardcoverEditionId);
        Assert.Null(saved.PageCount);
    }

    [Fact]
    public async Task UnlinkBookAsync_RequiresAnExplicitMatchBeforeSyncingAgain()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            Author = "Brandon Sanderson",
            HardcoverBookId = 328491,
            HardcoverPendingRating = 3.5m,
            HardcoverPendingRatingId = Guid.NewGuid(),
            HardcoverPendingRatingBookId = 328491,
            HardcoverPendingFinishAfterReadId = 12
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            OathbringerBookResponse(),
            OathbringerBookResponse()
        ]);
        var service = CreateService(context, handler);

        await service.UnlinkBookAsync(userId, book.BookId);
        context.ChangeTracker.Clear();

        Assert.True((await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true)).Skipped);
        Assert.True(Assert.Single((await service.SyncAllAsync(userId)).Results).Skipped);
        Assert.Equal(0, handler.RequestCount);

        var candidates = await service.MatchBookAsync(userId, book.BookId);
        Assert.False(candidates.Applied);
        Assert.Equal(328491, Assert.Single(candidates.Candidates).BookId);

        var relinked = await service.MatchBookAsync(userId, book.BookId, hardcoverBookId: 328491);
        Assert.True(relinked.Applied);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(328491, saved.HardcoverBookId);
        Assert.False(saved.HardcoverAutoMatchDisabled);
        Assert.Null(saved.HardcoverPendingRating);
        Assert.Null(saved.HardcoverPendingFinishAfterReadId);
    }

    [Fact]
    public async Task GetStatusAsync_Parses401And403ScopeErrors()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var handler = new QueueMessageHandler([
            ErrorResponse(HttpStatusCode.Unauthorized, """{ "error": "invalid_token", "error_description": "Token expired" }"""),
            ErrorResponse(HttpStatusCode.Forbidden, """{ "error": "insufficient_scope", "scope": "read:library" }""")
        ]);
        var service = CreateService(context, handler);

        var unauthorized = await service.GetStatusAsync(userId);
        var insufficient = await service.GetStatusAsync(userId);

        Assert.False(unauthorized.Connected);
        Assert.Contains("invalid or expired", unauthorized.Message, StringComparison.OrdinalIgnoreCase);

        Assert.False(insufficient.Connected);
        Assert.Contains("read:library", insufficient.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ExecuteGraphQl_RetriesOn429And503_AndDailyLimitFailsFast()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");

        var retryAfter429 = ErrorResponse(HttpStatusCode.TooManyRequests, """{ "error": "Too Many Requests" }""");
        retryAfter429.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(3));
        var unavailable503 = ErrorResponse(HttpStatusCode.ServiceUnavailable, """{ "error": "Service temporarily unavailable" }""");
        var okMe = JsonResponse("""{ "data": { "me": [{ "id": 7, "username": "okuser" }] } }""");

        var daily429 = ErrorResponse(HttpStatusCode.TooManyRequests, """{ "error": "Too Many Requests" }""");
        daily429.Headers.Add("RateLimit", "\"Free\";r=0;t=0, \"daily\";r=0;t=3600");

        var handler = new QueueMessageHandler([retryAfter429, unavailable503, okMe, daily429]);
        var service = CreateService(context, handler);
        var delays = new List<TimeSpan>();
        var now = new DateTimeOffset(2026, 11, 21, 10, 0, 0, TimeSpan.Zero);
        service.UtcNow = () => now;
        service.DelayAsync = (d, _) =>
        {
            delays.Add(d);
            now = now.Add(d);
            return Task.CompletedTask;
        };

        var status = await service.GetStatusAsync(userId);
        Assert.True(status.Connected);
        Assert.Equal("okuser", status.Username);
        Assert.Equal([TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(2)], delays);

        // Next call hits daily limit -> fails fast without retrying, and next call fails before HTTP.
        var daily1 = await service.GetStatusAsync(userId);
        var daily2 = await service.GetStatusAsync(userId);
        Assert.False(daily1.Connected);
        Assert.Contains("daily", daily1.Message, StringComparison.OrdinalIgnoreCase);
        Assert.False(daily2.Connected);
        Assert.Contains("daily", daily2.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(4, handler.RequestCount);
    }

    [Fact]
    public async Task SyncAllAsync_BatchesMetadataAndLibrary_AndSkipsUnchangedBooks()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);

        var unchangedBook = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Already Synced",
            Description = "Has description",
            Author = "Author A",
            Isbn13 = "9780000000001",
            Publisher = "Pub A",
            ReleaseDate = new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            PageCount = 200,
            CoverImagePath = "epub_assets/cover1.jpg",
            HardcoverBookId = 101,
            HardcoverEditionId = 201
        };
        var updatedBook = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Needs Update",
            Description = "",
            HardcoverBookId = 328491
        };
        context.Books.AddRange(unchangedBook, updatedBook);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = unchangedBook.BookId, Title = "P1", Content = "a", PartNumber = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = unchangedBook.BookId, Title = "P2", Content = "b", PartNumber = 2, IsFinished = false },
            new Text { UserId = userId, LanguageId = languageId, BookId = updatedBook.BookId, Title = "P1", Content = "c", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            // Only updatedBook lacks metadata -> single batched BooksByIds query for [328491]
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Needs Update",
                  "slug": "needs-update",
                  "description": "Fetched desc",
                  "pages": 100,
                  "release_date": "2017-11-14",
                  "image": { "url": null },
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [{ "id": 1, "title": "Needs Update", "isbn_13": "9780765326379", "pages": 100, "release_date": "2017-11-14", "publisher": { "name": "Tor" }, "image": { "url": null } }]
                }]
              }
            }
            """),
            // Single MyLibrary fetch returning both books
            JsonResponse("""
            {
              "data": {
                "me": [{
                  "user_books": [
                    { "id": 701, "book_id": 101, "status_id": 2, "edition_id": 201, "user_book_reads": [{ "id": 801, "progress_pages": 100, "finished_at": null }] },
                    { "id": 702, "book_id": 328491, "status_id": 2, "edition_id": 1, "user_book_reads": [{ "id": 802, "progress_pages": 50, "finished_at": null }] }
                  ]
                }]
              }
            }
            """),
            // Only updatedBook triggers mutations (unchangedBook is skipped with 0 writes)
            JsonResponse("""{ "data": { "update_user_book": { "id": 702, "error": null, "user_book": { "id": 702, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "update_user_book_read": { "id": 802, "error": null, "user_book_read": { "id": 802 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncAllAsync(userId);

        Assert.Equal(2, result.Results.Count);
        Assert.All(result.Results, r => Assert.True(r.Success));
        Assert.Equal(4, handler.RequestCount);
    }

    [Fact]
    public async Task ImportMetadataAsync_RejectsOversizedCover_AndReplacesOldExtension()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Oathbringer",
            Description = "Desc",
            Author = "Author",
            Isbn13 = "9780765326379",
            Publisher = "Tor",
            ReleaseDate = DateTime.UtcNow,
            PageCount = 100,
            HardcoverBookId = 328491,
            HardcoverEditionId = 1,
            CoverImagePath = $"hardcover-covers/{userId:N}/missing.jpg"
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var environment = new TestWebHostEnvironment();
        var coverDir = Path.Combine(environment.WebRootPath, "hardcover-covers", userId.ToString("N"));
        Directory.CreateDirectory(coverDir);
        var staleOtherExt = Path.Combine(coverDir, $"{book.BookId}.jpg");
        await File.WriteAllTextAsync(staleOtherExt, "old");

        var oversizedResponse = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(new byte[10])
        };
        oversizedResponse.Content.Headers.ContentLength = 6 * 1024 * 1024;

        var pngResponse = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1, 2, 3, 4])
        };
        pngResponse.Content.Headers.ContentType = new MediaTypeHeaderValue("image/png");

        var pngBookResponse = JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "slug": "oathbringer",
                  "description": "Imported description",
                  "pages": 1248,
                  "release_date": "2017-11-14",
                  "image": { "url": "https://example.test/cover" },
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [{ "id": 1, "title": "Oathbringer", "isbn_13": "9780765326379", "pages": 1248, "release_date": "2017-11-14", "publisher": { "name": "Tor" }, "image": { "url": "https://example.test/edition" } }]
                }]
              }
            }
            """);

        var handler = new QueueMessageHandler([
            OathbringerBookResponse(),
            oversizedResponse,
            pngBookResponse,
            pngResponse
        ]);
        var service = CreateService(context, handler, environment);

        var first = await service.ImportMetadataAsync(userId, book.BookId);
        Assert.DoesNotContain("coverImage", first.UpdatedFields);

        var second = await service.ImportMetadataAsync(userId, book.BookId);
        Assert.Contains("coverImage", second.UpdatedFields);
        Assert.False(File.Exists(staleOtherExt));
        Assert.True(File.Exists(Path.Combine(coverDir, $"{book.BookId}.png")));
    }

    [Fact]
    public void HardcoverRateLimiter_ParsesHeadersAndTracksBuckets()
    {
        var limiter = new HardcoverRateLimiter();
        var userId = Guid.NewGuid();
        var now = new DateTimeOffset(2026, 11, 21, 12, 0, 0, TimeSpan.Zero);

        var response = ErrorResponse(HttpStatusCode.OK, "{}");
        response.Headers.Add("RateLimit", "\"Free\";r=1;t=4, \"daily\";r=4000;t=1000");
        limiter.RecordResponse(userId, response.Headers, HttpStatusCode.OK, now);

        var delay = limiter.GetRequiredDelay(userId, now, out var dailyExhausted, out _);
        Assert.False(dailyExhausted);
        Assert.Equal(TimeSpan.FromSeconds(4), delay);

        var dailyZero = ErrorResponse(HttpStatusCode.TooManyRequests, "{}");
        dailyZero.Headers.Add("RateLimit", "\"daily\";r=0;t=500");
        limiter.RecordResponse(userId, dailyZero.Headers, HttpStatusCode.TooManyRequests, now);

        limiter.GetRequiredDelay(userId, now, out dailyExhausted, out var resetSeconds);
        Assert.True(dailyExhausted);
        Assert.Equal(500, resetSeconds);
    }

    [Fact]
    public async Task HardcoverSyncBackgroundService_ProcessesEnqueuedRequests()
    {
        var channel = new HardcoverSyncChannel();
        var invoked = new TaskCompletionSource<(Guid UserId, int BookId, bool RequireSyncEnabled, decimal? Rating)>(TaskCreationOptions.RunContinuationsAsynchronously);
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(Guid.NewGuid().ToString()));
        services.AddScoped<IHardcoverService>(_ => new CallbackHardcoverService(invoked));
        using var provider = services.BuildServiceProvider();

        using var worker = new HardcoverSyncBackgroundService(
            channel,
            provider,
            NullLogger<HardcoverSyncBackgroundService>.Instance);

        var userId = Guid.NewGuid();
        channel.TryEnqueue(new HardcoverSyncRequest(userId, 42));

        await worker.StartAsync(CancellationToken.None);
        var call = await invoked.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await worker.StopAsync(CancellationToken.None);

        Assert.Equal(userId, call.UserId);
        Assert.Equal(42, call.BookId);
        Assert.True(call.RequireSyncEnabled);
        Assert.Null(call.Rating);
    }

    [Fact]
    public async Task HardcoverSyncBackgroundService_ResumesPersistedRatingAfterARejectedWrite()
    {
        var databaseName = Guid.NewGuid().ToString();
        var channel = new HardcoverSyncChannel();
        var delivered = new TaskCompletionSource<HardcoverProgressSyncResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        const string remoteBook = """{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 3, "user_book_reads": [], "completed_reads": [{ "id": 555 }] }] }] } }""";
        var handler = new QueueMessageHandler([
            JsonResponse(remoteBook),
            JsonResponse("""{ "data": { "update_user_book": { "error": "Temporarily unavailable" } } }"""),
            JsonResponse(remoteBook),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null } } }""")
        ]);
        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(databaseName));
        services.AddScoped<IHardcoverService>(scope => new DelegateHardcoverService(async (userId, bookId, requireSync, _, ct) =>
        {
            var service = CreateService(scope.GetRequiredService<AppDbContext>(), handler);
            var result = await service.SyncProgressAsync(userId, bookId, requireSync, cancellationToken: ct);
            delivered.TrySetResult(result);
            return result;
        }));
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Finished Book",
            HardcoverBookId = 99,
            IsFinished = true,
            HardcoverPendingRating = 4.5m,
            HardcoverPendingRatingId = Guid.NewGuid()
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        var service = CreateService(context, handler);

        await Assert.ThrowsAsync<HardcoverApiException>(() => service.SyncProgressAsync(userId, book.BookId));
        Assert.Equal(4.5m, (await context.Books.AsNoTracking().SingleAsync()).HardcoverPendingRating);
        Assert.Equal(0, channel.Reader.Count);

        using var worker = new HardcoverSyncBackgroundService(channel, provider, NullLogger<HardcoverSyncBackgroundService>.Instance);
        await worker.StartAsync(CancellationToken.None);
        var result = await delivered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await worker.StopAsync(CancellationToken.None);

        Assert.True(result.Success);
        Assert.Contains("\"rating\":4.5", handler.RequestBodies[1]);
        Assert.Contains("\"rating\":4.5", handler.RequestBodies[3]);
        var saved = await context.Books.AsNoTracking().SingleAsync();
        Assert.Null(saved.HardcoverPendingRating);
        Assert.Null(saved.HardcoverPendingRatingId);
    }

    [Fact]
    public async Task SyncProgressAsync_AcknowledgingRatingPreservesANewerRating()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options;
        await using var context = new AppDbContext(options);
        await context.Database.EnsureCreatedAsync();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Finished Book",
            HardcoverBookId = 99,
            IsFinished = true,
            HardcoverPendingRating = 4.5m,
            HardcoverPendingRatingId = Guid.NewGuid()
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        var newerRatingId = Guid.NewGuid();

        var handler = new FuncMessageHandler(async (request, ct) =>
        {
            var body = await request.Content!.ReadAsStringAsync(ct);
            if (body.Contains("query UserBook", StringComparison.Ordinal))
            {
                return JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 3, "user_book_reads": [], "completed_reads": [{ "id": 555 }] }] }] } }""");
            }

            Assert.Contains("\"rating\":4.5", body);
            await using var concurrentContext = new AppDbContext(options);
            await concurrentContext.Books.Where(b => b.BookId == book.BookId).ExecuteUpdateAsync(setters => setters
                .SetProperty(b => b.HardcoverPendingRating, 5.0m)
                .SetProperty(b => b.HardcoverPendingRatingId, newerRatingId), ct);
            return JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null } } }""");
        });

        var result = await CreateService(context, handler).SyncProgressAsync(userId, book.BookId);

        Assert.True(result.Success);
        var saved = await context.Books.AsNoTracking().SingleAsync();
        Assert.Equal(5.0m, saved.HardcoverPendingRating);
        Assert.Equal(newerRatingId, saved.HardcoverPendingRatingId);
    }

    [Fact]
    public async Task SyncProgressAsync_AlreadyFinishedOnHardcoverWithStaleReadId_SkipsReadUpsertAndClearsStaleReadId()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Historically Finished",
            HardcoverBookId = 99,
            HardcoverUserBookId = 777,
            HardcoverUserBookReadId = 555, // stale completed historical read id
            PageCount = 200,
            IsFinished = true
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 3, "user_book_reads": [], "completed_reads": [{ "id": 555 }] }] }] } }"""),
            // Even if update_user_book somehow returned a finished read, UpdateUserBookAsync must ignore it and SyncProgressCoreAsync must skip UpsertUserBookReadAsync.
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3, "user_book_reads": [{ "id": 555, "finished_at": "2024-01-10", "progress_pages": 200 }] } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true, rating: 4.5m);

        Assert.True(result.Success);
        Assert.Equal(2, handler.RequestCount);
        Assert.Contains("finished_at: { _is_null: true }", handler.RequestBodies[1]);
        Assert.DoesNotContain(handler.RequestBodies, b => b.Contains("update_user_book_read") || b.Contains("insert_user_book_read"));
        var saved = await context.Books.SingleAsync();
        Assert.Null(saved.HardcoverUserBookReadId);
    }

    [Fact]
    public async Task SyncProgressAsync_RemoteInProgressWithoutActiveRead_ClearsStaleLocalReadIdAndInsertsNewRead()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Rereading Book",
            HardcoverBookId = 99,
            HardcoverUserBookId = 777,
            HardcoverUserBookReadId = 555, // stale historical completed read id
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 1", Content = "one", PartNumber = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Part 2", Content = "two", PartNumber = 2, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 2, "user_book_reads": [] } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 999, "error": null, "user_book_read": { "id": 999 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.DoesNotContain(handler.RequestBodies, b => b.Contains("update_user_book_read"));
        Assert.Contains(handler.RequestBodies, b => b.Contains("insert_user_book_read"));
        Assert.Equal(999, (await context.Books.SingleAsync()).HardcoverUserBookReadId);
    }

    [Fact]
    public async Task GetOwnedBook_MissingBook_ThrowsHardcoverBookNotFoundException()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var service = CreateService(context, new QueueMessageHandler([]));

        var ex = await Assert.ThrowsAsync<HardcoverBookNotFoundException>(() => service.UnlinkBookAsync(userId, 99999));
        Assert.IsAssignableFrom<KeyNotFoundException>(ex);
    }

    [Fact]
    public async Task MatchBookAsync_ExplicitDuplicateHardcoverBookId_ThrowsHardcoverConflictException_AndAllowsSameBookRematch()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var languageId = await SeedLanguageAsync(context);
        var existingBook = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Oathbringer",
            HardcoverBookId = 328491,
            HardcoverEditionId = 1
        };
        var secondBook = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Oathbringer Copy"
        };
        context.Books.AddRange(existingBook, secondBook);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([OathbringerBookResponse()]);
        var service = CreateService(context, handler);

        var ex = await Assert.ThrowsAsync<HardcoverConflictException>(() =>
            service.MatchBookAsync(userId, secondBook.BookId, hardcoverBookId: 328491));
        Assert.IsAssignableFrom<InvalidOperationException>(ex);
        Assert.Equal("Another book in your library is already linked to this Hardcover book.", ex.Message);
        Assert.Equal(0, handler.RequestCount);
        Assert.Null((await context.Books.SingleAsync(b => b.BookId == secondBook.BookId)).HardcoverBookId);

        // Re-matching the SAME book to the same HardcoverBookId is allowed (e.g. changing edition).
        var selfMatch = await service.MatchBookAsync(userId, existingBook.BookId, hardcoverBookId: 328491, hardcoverEditionId: 1);
        Assert.True(selfMatch.Applied);
    }

    [Fact]
    public async Task AutoMatch_DuplicateHardcoverBookId_SkipsCleanlyAcrossMatchImportSyncAndSyncAll()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book1 = new Book { UserId = userId, LanguageId = languageId, Title = "Oathbringer", HardcoverBookId = 328491 };
        var book2 = new Book { UserId = userId, LanguageId = languageId, Title = "Oathbringer" };
        context.Books.AddRange(book1, book2);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            // MatchBookAsync auto-match
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            OathbringerBookResponse(),
            // ImportMetadataAsync auto-match
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            OathbringerBookResponse(),
            // SyncProgressAsync auto-match
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            OathbringerBookResponse()
        ]);
        var service = CreateService(context, handler);

        var match = await service.MatchBookAsync(userId, book2.BookId);
        Assert.False(match.Applied);
        Assert.Contains("already linked", match.Message, StringComparison.OrdinalIgnoreCase);

        var import = await service.ImportMetadataAsync(userId, book2.BookId);
        Assert.False(import.Success);
        Assert.Contains("already linked", import.Message, StringComparison.OrdinalIgnoreCase);

        var sync = await service.SyncProgressAsync(userId, book2.BookId, requireSyncEnabled: true);
        Assert.True(sync.Skipped);
        Assert.Contains("already linked", sync.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(handler.RequestBodies, b => b.Contains("mutation"));
        Assert.Null((await context.Books.SingleAsync(b => b.BookId == book2.BookId)).HardcoverBookId);
    }

    [Fact]
    public async Task SyncAllAsync_TwoUnmatchedBooksMatchingSameHardcoverBook_ClaimsFirstAndSkipsSecond()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var bookA = new Book { UserId = userId, LanguageId = languageId, Title = "Oathbringer" };
        var bookB = new Book { UserId = userId, LanguageId = languageId, Title = "Oathbringer" };
        context.Books.AddRange(bookA, bookB);
        await context.SaveChangesAsync();

        var bookNoCover = JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "slug": "oathbringer",
                  "description": "Desc",
                  "pages": 100,
                  "release_date": "2017-11-14",
                  "image": { "url": null },
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [{ "id": 1, "title": "Oathbringer", "isbn_13": "9780765326379", "pages": 100, "publisher": { "name": "Tor" }, "image": { "url": null } }]
                }]
              }
            }
            """);
        var bookNoCover2 = JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "slug": "oathbringer",
                  "description": "Desc",
                  "pages": 100,
                  "release_date": "2017-11-14",
                  "image": { "url": null },
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [{ "id": 1, "title": "Oathbringer", "isbn_13": "9780765326379", "pages": 100, "publisher": { "name": "Tor" }, "image": { "url": null } }]
                }]
              }
            }
            """);

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            bookNoCover,
            JsonResponse("""{ "data": { "search": { "ids": [328491] } } }"""),
            bookNoCover2,
            JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 701, "error": null, "user_book": { "id": 701, "status_id": 1 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncAllAsync(userId);

        Assert.Equal(2, result.Results.Count);
        Assert.Equal(1, result.Results.Count(r => r.Success));
        Assert.Equal(1, result.Results.Count(r => r.Skipped && r.Message.Contains("already linked", StringComparison.OrdinalIgnoreCase)));
        var books = await context.Books.ToListAsync();
        Assert.Equal(1, books.Count(b => b.HardcoverBookId == 328491));
        Assert.Equal(1, books.Count(b => b.HardcoverBookId == null));
    }

    [Fact]
    public async Task SyncProgressAsync_RequireSyncEnabledWithoutSettingsOrToken_SkipsQuietlyWithoutThrowing()
    {
        await using var context = CreateContext();
        var userWithoutSettings = Guid.NewGuid();
        context.Users.Add(new User { Id = userWithoutSettings, UserName = "noset", Email = "noset@test.com" });
        await context.SaveChangesAsync();

        var userWithoutToken = await SeedUserWithSettingsAsync(context, hardcoverToken: "", syncEnabled: true);
        var handler = new QueueMessageHandler([]);
        var service = CreateService(context, handler);

        var noSettingsResult = await service.SyncProgressAsync(userWithoutSettings, bookId: 1, requireSyncEnabled: true);
        Assert.True(noSettingsResult.Skipped);
        Assert.False(noSettingsResult.Success);

        var noTokenResult = await service.SyncProgressAsync(userWithoutToken, bookId: 1, requireSyncEnabled: true);
        Assert.True(noTokenResult.Skipped);
        Assert.False(noTokenResult.Success);
        Assert.Equal(0, handler.RequestCount);

        await Assert.ThrowsAsync<HardcoverConfigurationException>(() =>
            service.SyncProgressAsync(userWithoutToken, bookId: 1, requireSyncEnabled: false));
    }

    [Fact]
    public async Task SyncProgressAsync_RequireSyncEnabledWithoutRating_SkipsWriteWhenAlreadyInSync()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Already In Sync",
            HardcoverBookId = 99,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "P1", Content = "one", PartNumber = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "P2", Content = "two", PartNumber = 2, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [{ "id": 888, "progress_pages": 100, "finished_at": null }] }] }] } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.Equal(1, handler.RequestCount); // FindUserBook only; skipped redundant writes
    }

    [Theory]
    [InlineData("secret token")]
    [InlineData("secret\r\nX-Injected: 1")]
    [InlineData("secret\r\n")]
    [InlineData("secret\0value")]
    [InlineData("secr\u00e9t")]
    public async Task TokenWithInvalidCharacters_ThrowsConfigurationExceptionWithoutEchoingSecret(string badToken)
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: badToken, syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book { UserId = userId, LanguageId = languageId, Title = "Test", HardcoverBookId = 99 };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([]);
        var service = CreateService(context, handler);

        var ex = await Assert.ThrowsAsync<HardcoverConfigurationException>(() =>
            service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: false));
        Assert.Equal("Hardcover API token contains invalid characters.", ex.Message);
        Assert.DoesNotContain("secret", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, handler.RequestCount);

        var status = await service.GetStatusAsync(userId);
        Assert.False(status.Connected);
        Assert.Equal("Hardcover API token contains invalid characters.", status.Message);
    }

    [Fact]
    public async Task SyncAllAsync_FatalApiErrorMidBatch_SavesPartialUpdatesWithoutLastSyncAt_AndRethrows()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book1 = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "A First",
            Description = "Desc",
            Author = "Author",
            Isbn13 = "9780000000001",
            Publisher = "Pub",
            ReleaseDate = DateTime.UtcNow,
            PageCount = 100,
            CoverImagePath = "epub_assets/c1.jpg",
            HardcoverBookId = 101
        };
        var book2 = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "B Second",
            Description = "Desc",
            Author = "Author",
            Isbn13 = "9780000000002",
            Publisher = "Pub",
            ReleaseDate = DateTime.UtcNow,
            PageCount = 100,
            CoverImagePath = "epub_assets/c2.jpg",
            HardcoverBookId = 102
        };
        context.Books.AddRange(book1, book2);
        await context.SaveChangesAsync();

        var rateLimited = ErrorResponse(HttpStatusCode.TooManyRequests, """{ "error": "rate_limit" }""");
        rateLimited.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(45));

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 701, "error": null, "user_book": { "id": 701, "status_id": 1 } } } }"""),
            rateLimited
        ]);
        var service = CreateService(context, handler);

        var ex = await Assert.ThrowsAsync<HardcoverApiException>(() => service.SyncAllAsync(userId));
        Assert.Equal(HttpStatusCode.TooManyRequests, ex.StatusCode);
        Assert.Equal(45, ex.RetryAfterSeconds);

        context.ChangeTracker.Clear();
        var savedBook1 = await context.Books.SingleAsync(b => b.BookId == book1.BookId);
        Assert.Equal(701, savedBook1.HardcoverUserBookId);
        var savedSettings = await context.UserSettings.SingleAsync();
        Assert.Null(savedSettings.HardcoverLastSyncAt);
    }

    [Fact]
    public async Task SyncAllAsync_Step1MetadataChunkFailure_StillSyncsBookProgressInStep4()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Needs Meta",
            Description = "",
            HardcoverBookId = 101,
            PageCount = 100
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "P1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            // Step 1 metadata query fails with 500
            ErrorResponse(HttpStatusCode.InternalServerError, """{ "error": "server_error" }"""),
            // Step 3 filtered library query succeeds
            JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }"""),
            // Step 4 still inserts user_book and user_book_read!
            JsonResponse("""{ "data": { "insert_user_book": { "id": 701, "error": null, "user_book": { "id": 701, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 801, "error": null, "user_book_read": { "id": 801 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncAllAsync(userId);

        Assert.Single(result.Results);
        Assert.True(result.Results[0].Success);
        Assert.Equal(701, (await context.Books.SingleAsync()).HardcoverUserBookId);
    }

    [Fact]
    public async Task SyncAllAsync_Step3NonFatalFailure_PersistsPhase2MatchesBeforeAborting()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book { UserId = userId, LanguageId = languageId, Title = "Oathbringer", Description = "" };
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
                  "slug": "oathbringer",
                  "description": "Desc",
                  "pages": 100,
                  "image": { "url": null },
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [{ "id": 1, "title": "Oathbringer", "pages": 100, "image": { "url": null } }]
                }]
              }
            }
            """),
            ErrorResponse(HttpStatusCode.InternalServerError, """{ "error": "temporary_failure" }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncAllAsync(userId);

        Assert.Single(result.Results);
        Assert.False(result.Results[0].Success);
        context.ChangeTracker.Clear();
        var saved = await context.Books.SingleAsync();
        Assert.Equal(328491, saved.HardcoverBookId);
        Assert.Equal("Desc", saved.Description);
    }

    [Fact]
    public async Task SyncAllAsync_FetchMyLibrary_FiltersByBookIdsInChunksOf100()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);

        for (var i = 1; i <= 105; i++)
        {
            context.Books.Add(new Book
            {
                UserId = userId,
                LanguageId = languageId,
                Title = $"Book {i:D3}",
                Description = "Desc",
                Author = "Author",
                Isbn13 = $"978000000{i:D4}",
                Publisher = "Pub",
                ReleaseDate = DateTime.UtcNow,
                PageCount = 100,
                CoverImagePath = "epub_assets/c.jpg",
                HardcoverBookId = 1000 + i
            });
        }
        await context.SaveChangesAsync();

        var chunk1UserBooks = string.Join(",", Enumerable.Range(1, 100).Select(i =>
            $$"""{ "id": {{2000 + i}}, "book_id": {{1000 + i}}, "status_id": 1, "user_book_reads": [] }"""));
        var chunk2UserBooks = string.Join(",", Enumerable.Range(101, 5).Select(i =>
            $$"""{ "id": {{2000 + i}}, "book_id": {{1000 + i}}, "status_id": 1, "user_book_reads": [] }"""));

        var handler = new QueueMessageHandler([
            JsonResponse($$"""{ "data": { "me": [{ "user_books": [{{chunk1UserBooks}}] }] } }"""),
            JsonResponse($$"""{ "data": { "me": [{ "user_books": [{{chunk2UserBooks}}] }] } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncAllAsync(userId);

        Assert.Equal(105, result.Results.Count);
        Assert.All(result.Results, r => Assert.True(r.Success));
        Assert.Equal(2, handler.RequestCount);
        Assert.All(handler.RequestBodies, body => Assert.Contains("book_id: { _in: $bookIds }", body));
    }

    [Fact]
    public async Task Cancellation_IsNotSwallowedInGetStatusSyncAllOrDownloadCover()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Cancel Test",
            HardcoverBookId = 328491,
            HardcoverEditionId = 1
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var cancelingHandler = new FuncMessageHandler((_, ct) =>
        {
            ct.ThrowIfCancellationRequested();
            return Task.FromResult(JsonResponse("{}"));
        });
        var service = CreateService(context, cancelingHandler);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.GetStatusAsync(userId, cts.Token));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.SyncAllAsync(userId, cts.Token));

        // Caller cancellation during DownloadCoverAsync must also propagate rather than returning null.
        using var coverCts = new CancellationTokenSource();
        var callCount = 0;
        var coverCancelHandler = new FuncMessageHandler((_, ct) =>
        {
            callCount++;
            if (callCount == 1)
            {
                return Task.FromResult(OathbringerBookResponse());
            }

            coverCts.Cancel();
            ct.ThrowIfCancellationRequested();
            return Task.FromResult(ImageResponse("img"));
        });
        var coverService = CreateService(context, coverCancelHandler);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => coverService.ImportMetadataAsync(userId, book.BookId, coverCts.Token));
    }

    [Fact]
    public async Task SyncProgressAsync_GraphQlValidationError_IsNotTreatedAsStaleRecord()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Validation Error Book",
            HardcoverBookId = 99,
            HardcoverUserBookId = 777,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "P1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [] }] }] } }"""),
            JsonResponse("""{ "errors": [{ "message": "Rating must be in 0.5 increments" }] }""")
        ]);
        var service = CreateService(context, handler);

        var ex = await Assert.ThrowsAsync<HardcoverApiException>(() =>
            service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true, rating: 4.3m));

        Assert.Contains("0.5 increments", ex.Message);
        Assert.Equal(2, handler.RequestCount); // Did NOT refetch or call insert_user_book
        Assert.Equal(777, (await context.Books.SingleAsync()).HardcoverUserBookId);
    }

    [Fact]
    public async Task SyncProgressAsync_StaleUserBookRecovery_ReappliesNonDemotionGuard()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Stale Recovery Non-Demote",
            HardcoverBookId = 99,
            HardcoverUserBookId = 777,
            PageCount = 200
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "P1", Content = "one", PartNumber = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "P2", Content = "two", PartNumber = 2, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [] }] }] } }"""),
            ErrorResponse(HttpStatusCode.NotFound, """{ "error": "not_found" }"""),
            // Refetched book is already marked Read (status 3) on Hardcover!
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 888, "status_id": 3, "user_book_reads": [] }] }] } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Skipped);
        Assert.Equal(3, handler.RequestCount); // No second update_user_book or insert_user_book_read
        Assert.Equal(888, (await context.Books.SingleAsync()).HardcoverUserBookId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SyncProgressAsync_StaleReadRecovery_ConfirmsTheAttemptedReadOrInsertsIt(bool completedAttempt)
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Stale Read Recovery",
            HardcoverBookId = 99,
            HardcoverUserBookId = 777,
            HardcoverUserBookReadId = 888,
            PageCount = 200,
            IsFinished = true
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.Add(new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "P1", Content = "one", PartNumber = 1, IsFinished = true });
        await context.SaveChangesAsync();

        var pendingRead = completedAttempt ? """[{ "id": 888 }]""" : "[]";
        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 2, "user_book_reads": [{ "id": 888, "finished_at": null }], "completed_reads": [{ "id": 999 }] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3 } } } }"""),
            JsonResponse("""{ "data": { "update_user_book_read": { "id": null, "error": "User book read not found" } } }"""),
            JsonResponse($$""" { "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 3, "user_book_reads": [], "completed_reads": [{ "id": 999 }], "completed_pending_read": {{pendingRead}} }] }] } } """),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 1000 } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.Contains("\"pendingReadId\":888", handler.RequestBodies[3]);
        Assert.Equal(completedAttempt ? 4 : 5, handler.RequestCount);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(completedAttempt ? (int?)null : 1000, saved.HardcoverUserBookReadId);
        Assert.Null(saved.HardcoverPendingFinishAfterReadId);
    }

    [Fact]
    public async Task ExecuteMutation_DoesNotRetry503Or408_ButRetriesShort429()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book { UserId = userId, LanguageId = languageId, Title = "Mutation Retry", HardcoverBookId = 99 };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        // 503 on insert_user_book -> must NOT retry
        var handler503 = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }"""),
            ErrorResponse(HttpStatusCode.ServiceUnavailable, """{ "error": "unavailable" }""")
        ]);
        var service503 = CreateService(context, handler503);
        var ex503 = await Assert.ThrowsAsync<HardcoverApiException>(() => service503.SyncProgressAsync(userId, book.BookId));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, ex503.StatusCode);
        Assert.Equal(2, handler503.RequestCount);

        // 408 on insert_user_book -> must NOT retry
        var handler408 = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }"""),
            ErrorResponse(HttpStatusCode.RequestTimeout, """{ "error": "timeout" }""")
        ]);
        var service408 = CreateService(context, handler408);
        var ex408 = await Assert.ThrowsAsync<HardcoverApiException>(() => service408.SyncProgressAsync(userId, book.BookId));
        Assert.Equal(HttpStatusCode.RequestTimeout, ex408.StatusCode);
        Assert.Equal(2, handler408.RequestCount);

        // Short 429 on insert_user_book -> DOES retry (rejected before execution)
        var retry429 = ErrorResponse(HttpStatusCode.TooManyRequests, """{ "error": "rate_limit" }""");
        retry429.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(2));
        var handler429 = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": [{ "user_books": [] }] } }"""),
            retry429,
            JsonResponse("""{ "data": { "insert_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 1 } } } }""")
        ]);
        var service429 = CreateService(context, handler429);
        var now = new DateTimeOffset(2026, 11, 21, 10, 0, 0, TimeSpan.Zero);
        service429.UtcNow = () => now;
        service429.DelayAsync = (d, _) => { now = now.Add(d); return Task.CompletedTask; };

        var ok = await service429.SyncProgressAsync(userId, book.BookId);
        Assert.True(ok.Success);
        Assert.Equal(3, handler429.RequestCount);
    }

    [Fact]
    public async Task SyncProgressAsync_99Point995PercentUnfinished_ClampsCompletionAndPagesAndKeepsCurrentlyReading()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Almost Done",
            HardcoverBookId = 99,
            PageCount = 200,
            IsFinished = false
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Main", Content = "a", PartNumber = 1, TotalWords = 99999, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Epilogue", Content = "b", PartNumber = 2, TotalWords = 1, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": { "user_books": [] } } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 2 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 888, "error": null, "user_book_read": { "id": 888 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.Equal(99.99, result.CompletionPercentage);
        Assert.Equal(2, result.StatusId);
        Assert.Equal(199, result.ProgressPages);
        Assert.Contains("\"status_id\":2", handler.RequestBodies[1]);
        Assert.Contains("\"progress_pages\":199", handler.RequestBodies[2]);
        Assert.DoesNotContain("\"finished_at\"", handler.RequestBodies[2]);
    }

    [Fact]
    public async Task SyncProgressAsync_TinyFirstPartFinished_ClampsTo0Point01AndCurrentlyReading()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Just Started",
            HardcoverBookId = 99,
            PageCount = 200,
            IsFinished = false
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Title Page", Content = "a", PartNumber = 1, TotalWords = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = book.BookId, Title = "Body", Content = "b", PartNumber = 2, TotalWords = 99999, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            JsonResponse("""{ "data": { "me": { "user_books": [] } } }"""),
            JsonResponse("""{ "data": { "insert_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 2 } } } }"""),
            JsonResponse("""{ "data": { "insert_user_book_read": { "id": 888, "error": null, "user_book_read": { "id": 888 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var result = await service.SyncProgressAsync(userId, book.BookId, requireSyncEnabled: true);

        Assert.True(result.Success);
        Assert.Equal(0.01, result.CompletionPercentage);
        Assert.Equal(2, result.StatusId);
    }

    [Fact]
    public async Task SyncProgressAsync_RatingNeverDemotesReadOrHigherRemoteStatus()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);

        var inProgressBook = new Book { UserId = userId, LanguageId = languageId, Title = "In Progress Locally", HardcoverBookId = 99, PageCount = 200 };
        var unreadBook = new Book { UserId = userId, LanguageId = languageId, Title = "Unread Locally", HardcoverBookId = 100, PageCount = 200 };
        context.Books.AddRange(inProgressBook, unreadBook);
        await context.SaveChangesAsync();
        context.Texts.AddRange(
            new Text { UserId = userId, LanguageId = languageId, BookId = inProgressBook.BookId, Title = "P1", Content = "a", PartNumber = 1, IsFinished = true },
            new Text { UserId = userId, LanguageId = languageId, BookId = inProgressBook.BookId, Title = "P2", Content = "b", PartNumber = 2, IsFinished = false });
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            // Book 1: remote Read (3), local CurrentlyReading (2), rating 4.5 -> must keep status 3 and skip read upsert
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 777, "status_id": 3, "user_book_reads": [] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 777, "error": null, "user_book": { "id": 777, "status_id": 3 } } } }"""),
            // Book 2: remote CurrentlyReading (2), local WantToRead (1), rating 4.0 -> must keep status 2
            JsonResponse("""{ "data": { "me": [{ "user_books": [{ "id": 778, "status_id": 2, "user_book_reads": [{ "id": 888 }] }] }] } }"""),
            JsonResponse("""{ "data": { "update_user_book": { "id": 778, "error": null, "user_book": { "id": 778, "status_id": 2 } } } }""")
        ]);
        var service = CreateService(context, handler);

        var res1 = await service.SyncProgressAsync(userId, inProgressBook.BookId, requireSyncEnabled: true, rating: 4.5m);
        Assert.True(res1.Success);
        Assert.Equal(3, res1.StatusId);
        Assert.Contains("\"status_id\":3", handler.RequestBodies[1]);
        Assert.Contains("\"rating\":4.5", handler.RequestBodies[1]);

        var res2 = await service.SyncProgressAsync(userId, unreadBook.BookId, requireSyncEnabled: true, rating: 4.0m);
        Assert.True(res2.Success);
        Assert.Equal(2, res2.StatusId);
        Assert.Contains("\"status_id\":2", handler.RequestBodies[3]);
        Assert.Contains("\"rating\":4.0", handler.RequestBodies[3]);
        Assert.Equal(4, handler.RequestCount); // Neither book called read upsert
    }

    [Fact]
    public async Task MatchBookAsync_IsbnEditionOutsideTop20_PreservesMatchedEditionAndUsesDescNullsLast()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var languageId = await SeedLanguageAsync(context, "Spanish", "ES");
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "El Quijote",
            Isbn13 = "9788400009999"
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            // BooksByIsbn returns edition 999 with full fields
            JsonResponse("""
            {
              "data": {
                "editions": [{
                  "id": 999,
                  "book_id": 600,
                  "title": "El Quijote Special ISBN",
                  "isbn_13": "9788400009999",
                  "pages": 412,
                  "release_date": "2022-05-01",
                  "reading_format_id": 1,
                  "edition_format": "Paperback",
                  "language": { "code2": "es", "code3": "spa", "language": "Spanish" },
                  "publisher": { "name": "Special Press" },
                  "image": { "url": "https://example.test/isbn-cover.jpg" }
                }]
              }
            }
            """),
            // BooksByIds top-20 editions do NOT contain edition 999
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 600,
                  "title": "El Quijote",
                  "slug": "el-quijote",
                  "pages": 900,
                  "contributions": [{ "contribution": "Author", "author": { "name": "Miguel de Cervantes" } }],
                  "editions": [{ "id": 1, "title": "English Top Edition", "pages": 1000, "reading_format_id": 1, "language": { "code2": "en", "code3": "eng", "language": "English" } }]
                }]
              }
            }
            """)
        ]);
        var service = CreateService(context, handler);

        var result = await service.MatchBookAsync(userId, book.BookId);

        Assert.True(result.Applied);
        Assert.Contains("desc_nulls_last", handler.RequestBodies[1]);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(999, saved.HardcoverEditionId);
        Assert.Equal(412, saved.PageCount);
        Assert.Equal("Special Press", result.AppliedCandidate!.Publisher);
        Assert.Contains(result.AppliedCandidate.Editions!, e => e.EditionId == 999);
    }

    [Fact]
    public async Task MatchBookAsync_MatchesLanguageByCode3_AndFetchesExplicitEditionOutsideTop20()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        // Local language uses 3-letter code "spa" and non-standard name "Castilian"
        var spaId = await SeedLanguageAsync(context, "Castilian", "spa");
        var book = new Book { UserId = userId, LanguageId = spaId, Title = "Oathbringer" };
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
                  "slug": "oathbringer",
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [
                    { "id": 1, "title": "English", "pages": 1200, "reading_format_id": 1, "language": { "code2": "en", "code3": "eng", "language": "English" } },
                    { "id": 2, "title": "Juramentada", "pages": 1400, "reading_format_id": 4, "language": { "code2": "es", "code3": "spa", "language": "Spanish" } }
                  ]
                }]
              }
            }
            """),
            // Explicit selection of edition 888 outside top-20 triggers direct EditionById query
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "slug": "oathbringer",
                  "contributions": [{ "author": { "name": "Brandon Sanderson" } }],
                  "editions": [
                    { "id": 1, "title": "English", "pages": 1200, "reading_format_id": 1, "language": { "code2": "en", "code3": "eng", "language": "English" } }
                  ]
                }]
              }
            }
            """),
            JsonResponse("""
            {
              "data": {
                "editions": [{
                  "id": 888,
                  "book_id": 328491,
                  "title": "Collector Edition",
                  "pages": 555,
                  "reading_format_id": 1,
                  "publisher": { "name": "Collector Press" }
                }]
              }
            }
            """)
        ]);
        var service = CreateService(context, handler);

        var autoMatch = await service.MatchBookAsync(userId, book.BookId);
        Assert.True(autoMatch.Applied);
        Assert.Equal(2, (await context.Books.SingleAsync()).HardcoverEditionId);

        var explicitMatch = await service.MatchBookAsync(userId, book.BookId, hardcoverBookId: 328491, hardcoverEditionId: 888);
        Assert.True(explicitMatch.Applied);
        var saved = await context.Books.SingleAsync();
        Assert.Equal(888, saved.HardcoverEditionId);
        Assert.Equal(555, saved.PageCount);
        Assert.Contains(explicitMatch.AppliedCandidate!.Editions!, e => e.EditionId == 888);
    }

    [Fact]
    public async Task ApplyMatch_ClearsStaleSlugOnBookChange_AndPreservesChosenEditionOnMetadataImport()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book
        {
            UserId = userId,
            LanguageId = await SeedLanguageAsync(context),
            Title = "Oathbringer",
            HardcoverBookId = 10,
            HardcoverEditionId = 20,
            HardcoverSlug = "stale-old-slug"
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            // Rematch to book 328491 whose slug is null
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "slug": null,
                  "pages": 1000,
                  "contributions": [],
                  "editions": [{ "id": 77, "title": "Ed 77", "pages": 1000 }]
                }]
              }
            }
            """),
            // Later metadata import returns top-20 without edition 77, and direct EditionById returns empty -> must preserve book.HardcoverEditionId = 77
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Oathbringer",
                  "slug": null,
                  "description": "Filled",
                  "pages": 1000,
                  "contributions": [],
                  "editions": [{ "id": 1, "title": "Ed 1", "pages": 1000 }]
                }]
              }
            }
            """),
            JsonResponse("""{ "data": { "editions": [] } }""")
        ]);
        var service = CreateService(context, handler);

        var rematch = await service.MatchBookAsync(userId, book.BookId, hardcoverBookId: 328491, hardcoverEditionId: 77);
        Assert.True(rematch.Applied);
        var afterRematch = await context.Books.SingleAsync();
        Assert.Null(afterRematch.HardcoverSlug);
        Assert.Equal(77, afterRematch.HardcoverEditionId);

        var import = await service.ImportMetadataAsync(userId, book.BookId);
        Assert.True(import.Success);
        var afterImport = await context.Books.SingleAsync();
        Assert.Equal(77, afterImport.HardcoverEditionId);
        Assert.Equal("Filled", afterImport.Description);
    }

    [Fact]
    public async Task ExecuteGraphQl_WrapsTransportTimeoutJsonAndNullDataErrors_AndUsesRelativeUriWithBaseAddress()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var languageId = await SeedLanguageAsync(context);
        var book = new Book { UserId = userId, LanguageId = languageId, Title = "Error Tests", HardcoverBookId = 99 };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        // HttpRequestException -> 502 network_error
        var netService = CreateService(context, new FuncMessageHandler((_, _) => throw new HttpRequestException("DNS failed")));
        var netEx = await Assert.ThrowsAsync<HardcoverApiException>(() => netService.SyncProgressAsync(userId, book.BookId));
        Assert.Equal(HttpStatusCode.BadGateway, netEx.StatusCode);
        Assert.Equal("network_error", netEx.ErrorCode);

        // Timeout TaskCanceledException (caller token not canceled) -> 504 timeout
        var timeoutService = CreateService(context, new FuncMessageHandler((_, _) => throw new TaskCanceledException("HttpClient timeout")));
        var timeoutEx = await Assert.ThrowsAsync<HardcoverApiException>(() => timeoutService.SyncProgressAsync(userId, book.BookId));
        Assert.Equal(HttpStatusCode.GatewayTimeout, timeoutEx.StatusCode);
        Assert.Equal("timeout", timeoutEx.ErrorCode);

        // Invalid JSON -> 502 invalid_response
        var badJsonService = CreateService(context, new QueueMessageHandler([JsonResponse("<html>502 Bad Gateway</html>")]));
        var badJsonEx = await Assert.ThrowsAsync<HardcoverApiException>(() => badJsonService.SyncProgressAsync(userId, book.BookId));
        Assert.Equal(HttpStatusCode.BadGateway, badJsonEx.StatusCode);
        Assert.Equal("invalid_response", badJsonEx.ErrorCode);

        // data: null -> 502 invalid_response
        var nullDataService = CreateService(context, new QueueMessageHandler([JsonResponse("""{ "data": null }""")]));
        var nullDataEx = await Assert.ThrowsAsync<HardcoverApiException>(() => nullDataService.SyncProgressAsync(userId, book.BookId));
        Assert.Equal(HttpStatusCode.BadGateway, nullDataEx.StatusCode);
        Assert.Equal("invalid_response", nullDataEx.ErrorCode);

        // BaseAddress configured -> sends relative "v1/graphql", and SearchBookIdsAsync accepts string + numeric IDs
        Uri? observedUri = null;
        var baseAddressHandler = new FuncMessageHandler((req, _) =>
        {
            observedUri = req.RequestUri;
            if (req.Content != null && req.Content.ReadAsStringAsync().Result.Contains("SearchBooks"))
            {
                return Task.FromResult(JsonResponse("""{ "data": { "search": { "ids": [100, "200", "bad", 100] } } }"""));
            }

            return Task.FromResult(JsonResponse("""
            {
              "data": {
                "books": [
                  { "id": 100, "title": "Error Tests", "contributions": [], "editions": [] },
                  { "id": 200, "title": "Other Book", "contributions": [], "editions": [] }
                ]
              }
            }
            """));
        });
        var relService = CreateService(context, baseAddressHandler, baseAddress: new Uri("https://api.hardcover.app/"));
        var matchResult = await relService.MatchBookAsync(userId, book.BookId, searchQuery: "Error Tests");
        Assert.Equal(new Uri("https://api.hardcover.app/v1/graphql"), observedUri);
        Assert.Equal([100, 200], matchResult.Candidates.Select(c => c.BookId).ToArray());
    }

    [Fact]
    public async Task HardcoverRateLimiter_HandlesTokenFingerprintZeroDailyResetHighWaitOutOfOrder200AndQuotedHeaders()
    {
        var limiter = new HardcoverRateLimiter();
        var userId = Guid.NewGuid();
        var t0 = new DateTimeOffset(2026, 11, 21, 12, 0, 0, TimeSpan.Zero);

        // Quote-aware parsing with comma and semicolon inside policy name
        var parsed = HardcoverRateLimiter.ParseRateLimitHeader(["\"Tier, Pro; v2\";r=0;t=25, \"daily\";r=100;t=3600"]);
        Assert.Equal(2, parsed.Count);
        Assert.Equal("Tier, Pro; v2", parsed[0].Name);
        Assert.Equal(0, parsed[0].Remaining);
        Assert.Equal(25, parsed[0].ResetSeconds);

        // daily;r=0;t=0 waits 2s (NOT 3600s); daily;r=0 with no t waits 3600s
        var dailyZeroT = ErrorResponse(HttpStatusCode.TooManyRequests, "{}");
        dailyZeroT.Headers.Add("RateLimit", "\"daily\";r=0;t=0");
        limiter.RecordResponse(userId, dailyZeroT.Headers, HttpStatusCode.TooManyRequests, t0, requestStartedUtc: t0, tokenFingerprint: "fp-a");
        limiter.GetRequiredDelay(userId, t0, out var dailyExhausted, out var resetSeconds, tokenFingerprint: "fp-a");
        Assert.True(dailyExhausted);
        Assert.Equal(2, resetSeconds);

        // Token fingerprint change resets throttle state
        limiter.GetRequiredDelay(userId, t0, out dailyExhausted, out resetSeconds, tokenFingerprint: "fp-b");
        Assert.False(dailyExhausted);
        Assert.Null(resetSeconds);

        // Non-daily 429 with r=0;t=45 is NOT clamped down to 10s; Retry-After: 600 caps at 300s
        var r45 = ErrorResponse(HttpStatusCode.TooManyRequests, "{}");
        r45.Headers.Add("RateLimit", "\"Free\";r=0;t=45");
        limiter.RecordResponse(userId, r45.Headers, HttpStatusCode.TooManyRequests, t0.AddSeconds(10), requestStartedUtc: t0.AddSeconds(9), tokenFingerprint: "fp-b");
        var delay45 = limiter.GetRequiredDelay(userId, t0.AddSeconds(10), out _, out _, tokenFingerprint: "fp-b");
        Assert.Equal(TimeSpan.FromSeconds(45), delay45);

        // Out-of-order 200 OK started BEFORE throttle (t0+5 < t0+10) must NOT wipe NextAllowedUtc
        var staleOk = JsonResponse("{}");
        staleOk.Headers.Add("RateLimit", "\"Free\";r=50;t=60");
        limiter.RecordResponse(userId, staleOk.Headers, HttpStatusCode.OK, t0.AddSeconds(11), requestStartedUtc: t0.AddSeconds(5), tokenFingerprint: "fp-b");
        Assert.Equal(TimeSpan.FromSeconds(44), limiter.GetRequiredDelay(userId, t0.AddSeconds(11), out _, out _, tokenFingerprint: "fp-b"));

        // Retry-After: 600 on non-daily 429 caps at 300s
        var r600 = ErrorResponse(HttpStatusCode.TooManyRequests, "{}");
        r600.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(600));
        limiter.RecordResponse(userId, r600.Headers, HttpStatusCode.TooManyRequests, t0.AddSeconds(12), requestStartedUtc: t0.AddSeconds(11), tokenFingerprint: "fp-b");
        Assert.Equal(TimeSpan.FromSeconds(300), limiter.GetRequiredDelay(userId, t0.AddSeconds(12), out _, out _, tokenFingerprint: "fp-b"));

        // Clear removes throttle state completely
        limiter.Clear(userId);
        Assert.Equal(TimeSpan.Zero, limiter.GetRequiredDelay(userId, t0.AddSeconds(12), out _, out _, tokenFingerprint: "fp-b"));

        // ParseApiError falls back to non-daily RateLimit t when Retry-After is absent
        await using var context = CreateContext();
        var hcUserId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token", syncEnabled: true);
        var book = new Book { UserId = hcUserId, LanguageId = await SeedLanguageAsync(context), Title = "RL", HardcoverBookId = 99 };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var rlWithoutRetryAfter = ErrorResponse(HttpStatusCode.TooManyRequests, "{}");
        rlWithoutRetryAfter.Headers.Add("RateLimit", "\"Free\";r=0;t=25");
        var service = CreateService(context, new QueueMessageHandler([rlWithoutRetryAfter]));
        var apiEx = await Assert.ThrowsAsync<HardcoverApiException>(() => service.SyncProgressAsync(hcUserId, book.BookId));
        Assert.Equal(HttpStatusCode.TooManyRequests, apiEx.StatusCode);
        Assert.Equal(25, apiEx.RetryAfterSeconds);
    }

    [Fact]
    public async Task MatchBookAsync_ManualQuery1984RunsTextSearch_AndSupportsHashIdAndUppercaseSlug()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var book = new Book { UserId = userId, LanguageId = await SeedLanguageAsync(context), Title = "1984", Author = "George Orwell" };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            // "1984" runs SearchBooks AND merges exact ID 1984 in BooksByIds without dropping text results
            JsonResponse("""{ "data": { "search": { "ids": [500] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [
                  { "id": 500, "title": "1984", "contributions": [{ "author": { "name": "George Orwell" } }], "editions": [] },
                  { "id": 1984, "title": "Unrelated Book With Id 1984", "contributions": [], "editions": [] }
                ]
              }
            }
            """),
            // "#328491" goes straight to BooksByIds (no SearchBooks)
            OathbringerBookResponse(),
            // Uppercase slug URL is lowercased
            OathbringerBookResponse()
        ]);
        var service = CreateService(context, handler);

        var numericSearch = await service.MatchBookAsync(userId, book.BookId, searchQuery: "1984");
        Assert.False(numericSearch.Applied);
        Assert.Equal(2, numericSearch.Candidates.Count);
        Assert.Equal(500, numericSearch.Candidates[0].BookId);
        Assert.Contains("SearchBooks", handler.RequestBodies[0]);
        Assert.Contains("1984", handler.RequestBodies[1]);

        var hashLookup = await service.MatchBookAsync(userId, book.BookId, searchQuery: "#328491");
        Assert.Single(hashLookup.Candidates);
        Assert.Contains("BooksByIds", handler.RequestBodies[2]);
        Assert.Contains("328491", handler.RequestBodies[2]);

        var slugLookup = await service.MatchBookAsync(userId, book.BookId, searchQuery: "https://hardcover.app/books/OathBringer-Deluxe");
        Assert.Single(slugLookup.Candidates);
        Assert.Contains("\"slug\":\"oathbringer-deluxe\"", handler.RequestBodies[3]);
    }

    [Fact]
    public async Task MatchBookAsync_AuthorMatching_PrefersPrimaryAuthorsFiltersParticlesAndInitialsAndGuardsAmbiguity()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var languageId = await SeedLanguageAsync(context);

        // 1. Prefers primary author over Translator listed first, and matches second co-author
        var book1 = new Book { UserId = userId, LanguageId = languageId, Title = "Good Omens", Author = "Neil Gaiman" };
        // 2. Shared particle "de"/"la" or 1-char initial "J." or first name only must NOT match
        var book2 = new Book { UserId = userId, LanguageId = languageId, Title = "La Sombra", Author = "J. de la Cruz" };
        // 3. Ambiguous top-2 candidates even when Author is populated must NOT auto-match
        var book3 = new Book { UserId = userId, LanguageId = languageId, Title = "Duplicate Title", Author = "Same Author" };
        // 4. Reversed "Last, First" matches via >= 2 meaningful tokens and wins over authorless runner-up by >= 0.02 gap
        var book4 = new Book { UserId = userId, LanguageId = languageId, Title = "Oathbringer", Author = "Sanderson, Brandon" };
        context.Books.AddRange(book1, book2, book3, book4);
        await context.SaveChangesAsync();

        var handler = new QueueMessageHandler([
            // Book 1
            JsonResponse("""{ "data": { "search": { "ids": [701] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 701,
                  "title": "Good Omens",
                  "contributions": [
                    { "contribution": "Translator", "author": { "name": "Some Translator" } },
                    { "contribution": "Author", "author": { "name": "Terry Pratchett" } },
                    { "contribution": null, "author": { "name": "Neil Gaiman" } }
                  ],
                  "editions": []
                }]
              }
            }
            """),
            // Book 2: shares "J.", "de", "la" ONLY -> conflict!
            JsonResponse("""{ "data": { "search": { "ids": [702] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 702,
                  "title": "La Sombra",
                  "contributions": [{ "contribution": "Author", "author": { "name": "J. de la Vega" } }],
                  "editions": []
                }]
              }
            }
            """),
            // Book 3: two equally high-scoring books -> ambiguity guard blocks auto-match
            JsonResponse("""{ "data": { "search": { "ids": [703, 704] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [
                  { "id": 703, "title": "Duplicate Title", "contributions": [{ "contribution": "Author", "author": { "name": "Same Author" } }], "editions": [] },
                  { "id": 704, "title": "Duplicate Title", "contributions": [{ "contribution": "Author", "author": { "name": "Same Author" } }], "editions": [] }
                ]
              }
            }
            """),
            // Book 4: candidate 705 scores 0.99 (exact title + matching author), candidate 706 scores 0.97 (no author) -> gap 0.02 allows auto-match
            JsonResponse("""{ "data": { "search": { "ids": [705, 706] } } }"""),
            JsonResponse("""
            {
              "data": {
                "books": [
                  { "id": 705, "title": "Oathbringer", "contributions": [{ "contribution": "Author", "author": { "name": "Brandon Sanderson" } }], "editions": [] },
                  { "id": 706, "title": "Oathbringer", "contributions": [], "editions": [] }
                ]
              }
            }
            """)
        ]);
        var service = CreateService(context, handler);

        var res1 = await service.MatchBookAsync(userId, book1.BookId);
        Assert.True(res1.Applied);
        Assert.DoesNotContain("Translator", res1.AppliedCandidate!.Author!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Terry Pratchett", res1.AppliedCandidate.Author!);
        Assert.Contains("Neil Gaiman", res1.AppliedCandidate.Author!);

        var res2 = await service.MatchBookAsync(userId, book2.BookId);
        Assert.False(res2.Applied);
        Assert.True(res2.Candidates[0].Score <= 0.75);

        var res3 = await service.MatchBookAsync(userId, book3.BookId);
        Assert.False(res3.Applied);
        Assert.Contains("Multiple Hardcover books", res3.Message);

        var res4 = await service.MatchBookAsync(userId, book4.BookId);
        Assert.True(res4.Applied);
        Assert.Equal(705, res4.AppliedCandidate!.BookId);
    }

    [Fact]
    public async Task ImportMetadataAsync_CoverDownload_RejectsInvalidSchemeHtmlSvgChunkedOverflowAndTimeout()
    {
        await using var context = CreateContext();
        var userId = await SeedUserWithSettingsAsync(context, hardcoverToken: "token");
        var languageId = await SeedLanguageAsync(context);
        var book = new Book
        {
            UserId = userId,
            LanguageId = languageId,
            Title = "Cover Security",
            Description = "Desc",
            Author = "Author",
            Isbn13 = "9780000000001",
            Publisher = "Pub",
            ReleaseDate = DateTime.UtcNow,
            PageCount = 100,
            HardcoverBookId = 328491,
            HardcoverEditionId = 1
        };
        context.Books.Add(book);
        await context.SaveChangesAsync();

        var environment = new TestWebHostEnvironment();

        // 1. file:// scheme rejected with 0 cover requests
        var fileSchemeBook = JsonResponse("""
            {
              "data": {
                "books": [{
                  "id": 328491,
                  "title": "Cover Security",
                  "image": { "url": "file:///etc/passwd" },
                  "contributions": [],
                  "editions": [{ "id": 1, "title": "Cover Security", "image": { "url": "file:///etc/passwd" } }]
                }]
              }
            }
            """);
        var fileHandler = new QueueMessageHandler([fileSchemeBook]);
        var fileRes = await CreateService(context, fileHandler, environment).ImportMetadataAsync(userId, book.BookId);
        Assert.DoesNotContain("coverImage", fileRes.UpdatedFields);
        Assert.Equal(1, fileHandler.RequestCount);

        // 2. text/html and image/svg+xml rejected
        var htmlResp = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html>not an image</html>", System.Text.Encoding.UTF8, "text/html")
        };
        var svgResp = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<svg></svg>", System.Text.Encoding.UTF8, "image/svg+xml")
        };
        // 3. Chunked stream without Content-Length exceeding 5 MB rejected
        var oversizedStream = new MemoryStream(new byte[(5 * 1024 * 1024) + 1024]);
        var chunkedResp = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(oversizedStream)
        };
        chunkedResp.Content.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");

        var handler = new QueueMessageHandler([
            OathbringerBookResponse(), htmlResp,
            OathbringerBookResponse(), svgResp,
            OathbringerBookResponse(), chunkedResp
        ]);
        var service = CreateService(context, handler, environment);

        Assert.DoesNotContain("coverImage", (await service.ImportMetadataAsync(userId, book.BookId)).UpdatedFields);
        Assert.DoesNotContain("coverImage", (await service.ImportMetadataAsync(userId, book.BookId)).UpdatedFields);
        Assert.DoesNotContain("coverImage", (await service.ImportMetadataAsync(userId, book.BookId)).UpdatedFields);
        Assert.Null((await context.Books.SingleAsync()).CoverImagePath);

        // 4. Timeout during cover download is non-fatal (returns cleanly without throwing)
        var slowCall = 0;
        var slowCoverService = CreateService(context, new FuncMessageHandler(async (_, ct) =>
        {
            slowCall++;
            if (slowCall == 1)
            {
                return OathbringerBookResponse();
            }

            await Task.Delay(TimeSpan.FromSeconds(5), ct);
            return ImageResponse("late");
        }), environment);
        slowCoverService.CoverDownloadTimeout = TimeSpan.FromMilliseconds(50);

        var timeoutImport = await slowCoverService.ImportMetadataAsync(userId, book.BookId);
        Assert.True(timeoutImport.Success);
        Assert.DoesNotContain("coverImage", timeoutImport.UpdatedFields);

        var coverDir = Path.Combine(environment.WebRootPath, "hardcover-covers", userId.ToString("N"));
        if (Directory.Exists(coverDir))
        {
            Assert.Empty(Directory.GetFiles(coverDir, "*.tmp"));
        }
    }

    [Fact]
    public void ParseDate_PreservesUtcDateAcrossOffsets()
    {
        var dateOnly = HardcoverService.ParseDate("2017-11-14");
        Assert.NotNull(dateOnly);
        Assert.Equal(new DateTime(2017, 11, 14, 0, 0, 0, DateTimeKind.Utc), dateOnly.Value);
        Assert.Equal(DateTimeKind.Utc, dateOnly.Value.Kind);

        var withNegativeOffset = HardcoverService.ParseDate("2017-11-14T23:30:00-02:00");
        Assert.NotNull(withNegativeOffset);
        Assert.Equal(new DateTime(2017, 11, 15, 0, 0, 0, DateTimeKind.Utc), withNegativeOffset.Value);
        Assert.Equal(DateTimeKind.Utc, withNegativeOffset.Value.Kind);
    }

    [Fact]
    public async Task HardcoverOperationLock_SerializesSameUser_AndAllowsConcurrentDifferentUsers()
    {
        var opLock = new HardcoverOperationLock();
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();

        var firstA = await opLock.AcquireAsync(userA);
        var secondATask = opLock.AcquireAsync(userA);
        Assert.False(secondATask.IsCompleted);

        // User B must acquire immediately while User A holds its lock
        using (await opLock.AcquireAsync(userB).WaitAsync(TimeSpan.FromSeconds(2)))
        {
            Assert.False(secondATask.IsCompleted);
        }

        firstA.Dispose();
        using var secondA = await secondATask.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.NotNull(secondA);
    }

    [Fact]
    public async Task HardcoverSyncChannel_CoalescesByUserAndBook_EnforcesCapacity_AndSupportsDI()
    {
        // Verify default DI resolution works with optional capacity parameter
        var diServices = new ServiceCollection();
        diServices.AddSingleton<HardcoverSyncChannel>();
        using var diProvider = diServices.BuildServiceProvider();
        Assert.NotNull(diProvider.GetRequiredService<HardcoverSyncChannel>());

        var channel = new HardcoverSyncChannel(capacity: 2);
        var userId = Guid.NewGuid();

        Assert.True(channel.TryEnqueue(new HardcoverSyncRequest(userId, 1)));
        Assert.True(channel.TryEnqueue(new HardcoverSyncRequest(userId, 1)));
        Assert.Equal(1, channel.Reader.Count);

        Assert.True(channel.TryEnqueue(new HardcoverSyncRequest(userId, 2)));
        Assert.False(channel.TryEnqueue(new HardcoverSyncRequest(userId, 3)));
        Assert.True(channel.TryEnqueue(new HardcoverSyncRequest(userId, 2)));

        Assert.True(channel.TryDequeue(out var first));
        Assert.Equal(1, first!.BookId);

        Assert.True(channel.TryEnqueue(new HardcoverSyncRequest(userId, 3)));

        channel.Complete();
        Assert.False(channel.TryEnqueue(new HardcoverSyncRequest(userId, 4)));

        var remaining = new List<HardcoverSyncRequest>();
        await foreach (var item in channel.Reader.ReadAllAsync())
        {
            remaining.Add(item);
        }

        Assert.Equal(2, remaining.Count);
        Assert.Equal([2, 3], remaining.Select(request => request.BookId));
    }

    [Fact]
    public async Task HardcoverSyncBackgroundService_RunsUsersConcurrently_AndTimesOutSlowItemsWithoutStalling()
    {
        var channel = new HardcoverSyncChannel();
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        var userC = Guid.NewGuid();

        var userAStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var userACanceled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var userBCompleted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var userCCompleted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var services = new ServiceCollection();
        services.AddDbContext<AppDbContext>(options => options.UseInMemoryDatabase(Guid.NewGuid().ToString()));
        services.AddScoped<IHardcoverService>(_ => new DelegateHardcoverService(async (uid, bookId, _, _, ct) =>
        {
            if (uid == userA)
            {
                userAStarted.TrySetResult();
                try
                {
                    await Task.Delay(Timeout.InfiniteTimeSpan, ct);
                }
                catch (OperationCanceledException)
                {
                    userACanceled.TrySetResult();
                    throw;
                }
            }
            else if (uid == userB)
            {
                userBCompleted.TrySetResult();
            }
            else if (uid == userC)
            {
                userCCompleted.TrySetResult();
            }

            return new HardcoverProgressSyncResult(bookId, true, false, 100, 3, 100, "ok");
        }));
        using var provider = services.BuildServiceProvider();

        using var worker = new HardcoverSyncBackgroundService(
            channel,
            provider,
            NullLogger<HardcoverSyncBackgroundService>.Instance,
            workerCount: 2,
            itemTimeout: TimeSpan.FromMilliseconds(250));

        await worker.StartAsync(CancellationToken.None);

        channel.TryEnqueue(new HardcoverSyncRequest(userA, 1));
        await userAStarted.Task.WaitAsync(TimeSpan.FromSeconds(5));

        // User B must complete while User A is still blocked (no head-of-line blocking)
        channel.TryEnqueue(new HardcoverSyncRequest(userB, 2));
        await userBCompleted.Task.WaitAsync(TimeSpan.FromSeconds(5));

        // User A's per-item timeout cancels it cleanly, and workers continue processing User C
        await userACanceled.Task.WaitAsync(TimeSpan.FromSeconds(5));
        channel.TryEnqueue(new HardcoverSyncRequest(userC, 3));
        await userCCompleted.Task.WaitAsync(TimeSpan.FromSeconds(5));

        await worker.StopAsync(CancellationToken.None);
    }

    private static HardcoverService CreateService(
        AppDbContext context,
        HttpMessageHandler handler,
        IWebHostEnvironment? environment = null,
        bool externalWritesDisabled = false,
        HardcoverRateLimiter? rateLimiter = null,
        HardcoverOperationLock? operationLock = null,
        Uri? baseAddress = null)
    {
        return new HardcoverService(
            context,
            new SingleClientFactory(handler, baseAddress),
            environment ?? new TestWebHostEnvironment(),
            NullLogger<HardcoverService>.Instance,
            Microsoft.Extensions.Options.Options.Create(new ExternalWritesOptions { Disabled = externalWritesDisabled }),
            rateLimiter,
            operationLock);
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

    private static async Task<int> SeedLanguageAsync(AppDbContext context, string? name = null, string? code = null)
    {
        var language = new Language
        {
            Name = name ?? $"English-{Guid.NewGuid():N}",
            Code = code ?? Guid.NewGuid().ToString("N")[..8]
        };
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

    private static HttpResponseMessage ImageResponse(string content, string mediaType = "image/jpeg")
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(System.Text.Encoding.UTF8.GetBytes(content))
        };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
        return response;
    }

    private static HttpResponseMessage ErrorResponse(HttpStatusCode statusCode, string json)
    {
        return new HttpResponseMessage(statusCode)
        {
            Content = new StringContent(json)
        };
    }

    private sealed class DelegateHardcoverService : IHardcoverService
    {
        private readonly Func<Guid, int, bool, decimal?, CancellationToken, Task<HardcoverProgressSyncResult>> _onSync;

        public DelegateHardcoverService(Func<Guid, int, bool, decimal?, CancellationToken, Task<HardcoverProgressSyncResult>> onSync) =>
            _onSync = onSync;

        public Task<HardcoverConnectionResult> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<HardcoverMatchResult> MatchBookAsync(Guid userId, int bookId, int? hardcoverBookId = null, int? hardcoverEditionId = null, string? searchQuery = null, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task UnlinkBookAsync(Guid userId, int bookId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, decimal? rating = null, CancellationToken cancellationToken = default) =>
            _onSync(userId, bookId, requireSyncEnabled, rating, cancellationToken);

        public Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();
    }

    private sealed class CallbackHardcoverService : IHardcoverService
    {
        private readonly TaskCompletionSource<(Guid, int, bool, decimal?)> _tcs;

        public CallbackHardcoverService(TaskCompletionSource<(Guid, int, bool, decimal?)> tcs) => _tcs = tcs;

        public Task<HardcoverConnectionResult> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<HardcoverMatchResult> MatchBookAsync(Guid userId, int bookId, int? hardcoverBookId = null, int? hardcoverEditionId = null, string? searchQuery = null, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task UnlinkBookAsync(Guid userId, int bookId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();

        public Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, decimal? rating = null, CancellationToken cancellationToken = default)
        {
            _tcs.TrySetResult((userId, bookId, requireSyncEnabled, rating));
            return Task.FromResult(new HardcoverProgressSyncResult(bookId, true, false, 100, 3, 100, "ok"));
        }

        public Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();
    }

    private sealed class SingleClientFactory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        private readonly Uri? _baseAddress;

        public SingleClientFactory(HttpMessageHandler handler, Uri? baseAddress = null)
        {
            _handler = handler;
            _baseAddress = baseAddress;
        }

        public HttpClient CreateClient(string name)
        {
            var client = new HttpClient(_handler, disposeHandler: false);
            if (_baseAddress != null)
            {
                client.BaseAddress = _baseAddress;
            }
            return client;
        }
    }

    private sealed class FuncMessageHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _handler;

        public FuncMessageHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> handler) =>
            _handler = handler;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            _handler(request, cancellationToken);
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
        public List<string> RequestBodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            LastAuthorizationScheme = request.Headers.Authorization?.Scheme;
            LastAuthorizationParameter = request.Headers.Authorization?.Parameter;
            if (request.Content != null)
            {
                RequestBodies.Add(await request.Content.ReadAsStringAsync(cancellationToken));
            }

            if (_responses.Count == 0)
            {
                throw new InvalidOperationException("No queued HTTP response for Hardcover test.");
            }

            return _responses.Dequeue();
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
