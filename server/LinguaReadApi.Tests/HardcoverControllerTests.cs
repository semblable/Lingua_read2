using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
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

        var syncAll = await controller.SyncAll(CancellationToken.None);
        var syncAllOk = Assert.IsType<OkObjectResult>(syncAll.Result);
        Assert.Equal("all synced", Assert.IsType<HardcoverSyncAllResult>(syncAllOk.Value).Message);
    }

    private static HardcoverController CreateController(RecordingHardcoverService service, Guid userId)
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
        public int? LastHardcoverBookId { get; private set; }

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

        public Task<HardcoverMatchResult> MatchBookAsync(Guid userId, int bookId, int? hardcoverBookId = null, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastBookId = bookId;
            LastHardcoverBookId = hardcoverBookId;
            return Task.FromResult(MatchResult);
        }

        public Task<HardcoverMetadataImportResult> ImportMetadataAsync(Guid userId, int bookId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastBookId = bookId;
            return Task.FromResult(ImportResult);
        }

        public Task<HardcoverProgressSyncResult> SyncProgressAsync(Guid userId, int bookId, bool requireSyncEnabled = false, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastBookId = bookId;
            return Task.FromResult(ProgressResult);
        }

        public Task<HardcoverSyncAllResult> SyncAllAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            return Task.FromResult(SyncAllResult);
        }
    }
}
