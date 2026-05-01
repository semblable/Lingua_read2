using System.Security.Claims;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LinguaReadApi.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class HardcoverController : ControllerBase
{
    private readonly IHardcoverService _hardcoverService;
    private readonly ILogger<HardcoverController> _logger;

    public HardcoverController(IHardcoverService hardcoverService, ILogger<HardcoverController> logger)
    {
        _hardcoverService = hardcoverService;
        _logger = logger;
    }

    [HttpGet("status")]
    public async Task<ActionResult<HardcoverConnectionResult>> GetStatus(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        return Ok(await _hardcoverService.GetStatusAsync(userId, cancellationToken));
    }

    [HttpPost("match/{bookId:int}")]
    public async Task<ActionResult<HardcoverMatchResult>> MatchBook(
        int bookId,
        [FromBody] HardcoverMatchRequest? request,
        CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var result = await _hardcoverService.MatchBookAsync(userId, bookId, request?.HardcoverBookId, cancellationToken);
        return Ok(result);
    }

    [HttpPost("import-metadata/{bookId:int}")]
    public async Task<ActionResult<HardcoverMetadataImportResult>> ImportMetadata(int bookId, CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var result = await _hardcoverService.ImportMetadataAsync(userId, bookId, cancellationToken);
        return Ok(result);
    }

    [HttpPost("sync-progress/{bookId:int}")]
    public async Task<ActionResult<HardcoverProgressSyncResult>> SyncProgress(int bookId, CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var result = await _hardcoverService.SyncProgressAsync(userId, bookId, requireSyncEnabled: false, cancellationToken);
        return Ok(result);
    }

    [HttpPost("sync-all")]
    public async Task<ActionResult<HardcoverSyncAllResult>> SyncAll(CancellationToken cancellationToken)
    {
        var userId = GetUserId();
        var result = await _hardcoverService.SyncAllAsync(userId, cancellationToken);
        return Ok(result);
    }

    private Guid GetUserId()
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrWhiteSpace(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            _logger.LogWarning("Hardcover endpoint called without a valid user id claim.");
            throw new UnauthorizedAccessException("User ID not found in token");
        }

        return userId;
    }
}

public sealed class HardcoverMatchRequest
{
    public int? HardcoverBookId { get; set; }
}
