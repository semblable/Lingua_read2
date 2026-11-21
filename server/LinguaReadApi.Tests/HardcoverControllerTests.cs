using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class HardcoverControllerTests
{
    [Fact]
    public async Task GetStatus_ReturnsServiceStatusForCurrentUser()
    {
        var userId = Guid.NewGuid();
        var service = new RecordingHardcoverService
        {
            StatusResult = new HardcoverConnectionResult(true, true, true, 123, "reader", "ok")
        };
        var controller = CreateController(service, userId);

        var result = await controller.GetStatus(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<HardcoverConnectionResult>(ok.Value);
        Assert.True(body.Connected);
        Assert.Equal(userId, service.LastUserId);
    }

    [Fact]
    public async Task MatchBook_PassesOptionalHardcoverBookId()
    {
        var userId = Guid.NewGuid();
        var service = new RecordingHardcoverService
        {
            MatchResult = new HardcoverMatchResult(
                true,
                new HardcoverBookCandidate(55, 66, "Book", null, null, null, null, null, null, null, null, 1),
                [],
                "matched")
        };
        var controller = CreateController(service, userId);

        var result = await controller.MatchBook(10, new HardcoverMatchRequest { HardcoverBookId = 55 }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<HardcoverMatchResult>(ok.Value);
        Assert.True(body.Applied);
        Assert.Equal(10, service.LastBookId);
        Assert.Equal(55, service.LastHardcoverBookId);
    }

    [Fact]
    public async Task ImportSyncAndSyncAll_ReturnServiceResults()
    {
        var userId = Guid.NewGuid();
        var service = new RecordingHardcoverService
        {
            ImportResult = new HardcoverMetadataImportResult(true, ["author"], [], "imported"),
            ProgressResult = new HardcoverProgressSyncResult(20, true, false, 50, 2, 100, "synced"),
            SyncAllResult = new HardcoverSyncAllResult([], "all synced")
        };
        var controller = CreateController(service, userId);

        var import = await controller.ImportMetadata(20, CancellationToken.None);
        var importOk = Assert.IsType<OkObjectResult>(import.Result);
        Assert.Equal("imported", Assert.IsType<HardcoverMetadataImportResult>(importOk.Value).Message);

        var progress = await controller.SyncProgress(20, CancellationToken.None);
        var progressOk = Assert.IsType<OkObjectResult>(progress.Result);
        Assert.Equal(50, Assert.IsType<HardcoverProgressSyncResult>(progressOk.Value).CompletionPercentage);
        Assert.False(service.LastRequireSyncEnabled);

        var syncAll = await controller.SyncAll(CancellationToken.None);
        var syncAllOk = Assert.IsType<OkObjectResult>(syncAll.Result);
        Assert.Equal("all synced", Assert.IsType<HardcoverSyncAllResult>(syncAllOk.Value).Message);
    }

    [Fact]
    public async Task MatchBook_PassesEditionIdAndQuery_AndUnlinkReturnsNoContent()
    {
        var userId = Guid.NewGuid();
        var service = new RecordingHardcoverService
        {
            MatchResult = new HardcoverMatchResult(false, null, [], "review")
        };
        var controller = CreateController(service, userId);

        await controller.MatchBook(
            12,
            new HardcoverMatchRequest { HardcoverBookId = 55, HardcoverEditionId = 67, Query = "Oathbringer" },
            CancellationToken.None);

        Assert.Equal(55, service.LastHardcoverBookId);
        Assert.Equal(67, service.LastHardcoverEditionId);
        Assert.Equal("Oathbringer", service.LastSearchQuery);

        var unlink = await controller.UnlinkBook(12, CancellationToken.None);
        Assert.IsType<NoContentResult>(unlink);
        Assert.Equal(12, service.LastBookId);
    }

    [Fact]
    public async Task Endpoints_MapServiceExceptionsToCleanHttpStatuses()
    {
        var userId = Guid.NewGuid();

        var notFound = await CreateController(new RecordingHardcoverService { ExceptionToThrow = new HardcoverBookNotFoundException("Book not found.") }, userId)
            .MatchBook(1, null, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(notFound.Result);

        var unlinkNotFound = await CreateController(new RecordingHardcoverService { ExceptionToThrow = new HardcoverBookNotFoundException("Book not found.") }, userId)
            .UnlinkBook(1, CancellationToken.None);
        Assert.IsType<NotFoundObjectResult>(unlinkNotFound);

        var conflict = await CreateController(new RecordingHardcoverService { ExceptionToThrow = new HardcoverConflictException("Another book is linked.") }, userId)
            .MatchBook(1, null, CancellationToken.None);
        Assert.IsType<ConflictObjectResult>(conflict.Result);

        var unconfigured = await CreateController(new RecordingHardcoverService { ExceptionToThrow = new HardcoverConfigurationException("Token missing") }, userId)
            .ImportMetadata(1, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(unconfigured.Result);

        // Upstream 401 from Hardcover must NOT return 401 (which triggers app logout/redirect).
        var upstreamAuth = await CreateController(
                new RecordingHardcoverService
                {
                    ExceptionToThrow = new HardcoverApiException("Token invalid or expired", HttpStatusCode.Unauthorized, "invalid_token")
                },
                userId)
            .SyncProgress(1, CancellationToken.None);
        var authObj = Assert.IsType<ObjectResult>(upstreamAuth.Result);
        Assert.Equal(StatusCodes.Status502BadGateway, authObj.StatusCode);

        var rateLimitedController = CreateController(
            new RecordingHardcoverService
            {
                ExceptionToThrow = new HardcoverApiException("Rate limit", HttpStatusCode.TooManyRequests, "rate_limit", retryAfterSeconds: 7)
            },
            userId);
        var rateLimited = await rateLimitedController.SyncAll(CancellationToken.None);
        var rlObj = Assert.IsType<ObjectResult>(rateLimited.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, rlObj.StatusCode);
        Assert.Equal("7", rateLimitedController.Response.Headers.RetryAfter.ToString());

        var timedOut = await CreateController(
                new RecordingHardcoverService
                {
                    ExceptionToThrow = new HardcoverApiException("Timed out", HttpStatusCode.GatewayTimeout, "timeout")
                },
                userId)
            .SyncAll(CancellationToken.None);
        var timeoutObj = Assert.IsType<ObjectResult>(timedOut.Result);
        Assert.Equal(StatusCodes.Status504GatewayTimeout, timeoutObj.StatusCode);

        // Raw InvalidOperationException and KeyNotFoundException must NOT be swallowed as 400/404.
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateController(new RecordingHardcoverService { ExceptionToThrow = new InvalidOperationException("Unexpected internal state") }, userId)
                .MatchBook(1, null, CancellationToken.None));

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            CreateController(new RecordingHardcoverService { ExceptionToThrow = new KeyNotFoundException("Unexpected missing dictionary key") }, userId)
                .MatchBook(1, null, CancellationToken.None));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-guid")]
    public async Task Endpoints_WhenUserIdClaimMissingOrInvalid_Return401Unauthorized(string? claimValue)
    {
        var service = new RecordingHardcoverService();
        var claims = claimValue == null ? Array.Empty<Claim>() : [new Claim(ClaimTypes.NameIdentifier, claimValue)];
        var controller = new HardcoverController(service, NullLogger<HardcoverController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
                }
            }
        };

        Assert.IsType<UnauthorizedObjectResult>((await controller.GetStatus(CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>((await controller.MatchBook(1, null, CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>(await controller.UnlinkBook(1, CancellationToken.None));
        Assert.IsType<UnauthorizedObjectResult>((await controller.ImportMetadata(1, CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>((await controller.SyncProgress(1, CancellationToken.None)).Result);
        Assert.IsType<UnauthorizedObjectResult>((await controller.SyncAll(CancellationToken.None)).Result);
    }

    [Fact]
    public async Task SyncAll_WithRealHardcoverService_Propagates429AndRetryAfterHeader()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        await using var context = new AppDbContext(options);

        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@test.com" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            HardcoverApiToken = "test-token",
            HardcoverSyncEnabled = true
        });
        context.Languages.Add(new Language { LanguageId = 1, Name = "English", Code = "EN" });
        context.Books.Add(new Book
        {
            BookId = 1,
            UserId = userId,
            LanguageId = 1,
            Title = "Dune"
        });
        await context.SaveChangesAsync();

        using var handler = new StubRateLimitHttpMessageHandler(retryAfterSeconds: 25);
        var factory = new SingleHandlerHttpClientFactory(handler);
        var service = new HardcoverService(
            context,
            factory,
            new StubWebHostEnvironment(),
            NullLogger<HardcoverService>.Instance)
        {
            DelayAsync = (_, _) => Task.CompletedTask
        };

        var controller = CreateController(service, userId);
        var result = await controller.SyncAll(CancellationToken.None);

        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, statusResult.StatusCode);
        Assert.Equal("25", controller.Response.Headers.RetryAfter.ToString());
    }

    private static HardcoverController CreateController(IHardcoverService service, Guid userId)
    {
        return new HardcoverController(service, NullLogger<HardcoverController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                    ], "TestAuth"))
                }
            }
        };
    }

    private sealed class RecordingHardcoverService : IHardcoverService
    {
        public Guid LastUserId { get; private set; }
        public int LastBookId { get; private set; }
        public bool? LastRequireSyncEnabled { get; private set; }
        public decimal? LastRating { get; private set; }
        public int? LastHardcoverBookId { get; private set; }
        public int? LastHardcoverEditionId { get; private set; }
        public string? LastSearchQuery { get; private set; }
        public Exception? ExceptionToThrow { get; init; }

        public HardcoverConnectionResult StatusResult { get; init; } = new(false, false, false, null, null, "not configured");
        public HardcoverMatchResult MatchResult { get; init; } = new(false, null, [], "no match");
        public HardcoverMetadataImportResult ImportResult { get; init; } = new(false, [], [], "not imported");
        public HardcoverProgressSyncResult ProgressResult { get; init; } = new(0, false, true, 0, null, null, "skipped");
        public HardcoverSyncAllResult SyncAllResult { get; init; } = new([], "none");

        public Task<HardcoverConnectionResult> GetStatusAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            return Task.FromResult(StatusResult);
        }

        public Task<HardcoverMatchResult> MatchBookAsync(
            Guid userId,
            int bookId,
            int? hardcoverBookId = null,
            int? hardcoverEditionId = null,
            string? searchQuery = null,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastBookId = bookId;
            LastHardcoverBookId = hardcoverBookId;
            LastHardcoverEditionId = hardcoverEditionId;
            LastSearchQuery = searchQuery;
            if (ExceptionToThrow != null) throw ExceptionToThrow;
            return Task.FromResult(MatchResult);
        }

        public Task UnlinkBookAsync(Guid userId, int bookId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastBookId = bookId;
            if (ExceptionToThrow != null) throw ExceptionToThrow;
            return Task.CompletedTask;
        }

        public Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastBookId = bookId;
            if (ExceptionToThrow != null) throw ExceptionToThrow;
            return Task.FromResult(ImportResult);
        }

        public Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, decimal? rating = null, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastBookId = bookId;
            LastRequireSyncEnabled = requireSyncEnabled;
            LastRating = rating;
            if (ExceptionToThrow != null) throw ExceptionToThrow;
            return Task.FromResult(ProgressResult);
        }

        public Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            if (ExceptionToThrow != null) throw ExceptionToThrow;
            return Task.FromResult(SyncAllResult);
        }
    }

    private sealed class StubRateLimitHttpMessageHandler(int retryAfterSeconds) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests)
            {
                Content = new StringContent("{\"errors\":[{\"message\":\"Too many requests\"}]}")
            };
            response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(retryAfterSeconds));
            return Task.FromResult(response);
        }
    }

    private sealed class SingleHandlerHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false)
        {
            BaseAddress = new Uri("https://api.hardcover.app/")
        };
    }

    private sealed class StubWebHostEnvironment : IWebHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Testing";
        public string ApplicationName { get; set; } = "LinguaReadApi";
        public string WebRootPath { get; set; } = Path.GetTempPath();
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = Path.GetTempPath();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
