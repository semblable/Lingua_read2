using System.Globalization;
using System.Net;
using System.Security.Claims;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace LinguaReadApi.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class HardcoverController : ControllerBase
{
    private const string DuplicateHardcoverBookMessage = "Another book in your library is already linked to this Hardcover book.";

    private readonly IHardcoverService _hardcoverService;
    private readonly ILogger<HardcoverController> _logger;

    public HardcoverController(IHardcoverService hardcoverService, ILogger<HardcoverController> logger)
    {
        _hardcoverService = hardcoverService;
        _logger = logger;
    }

    [HttpGet("status")]
    [ProducesResponseType(typeof(HardcoverConnectionResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<ActionResult<HardcoverConnectionResult>> GetStatus(CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized(new { message = "User ID not found in token." });
        }

        return Ok(await _hardcoverService.GetStatusAsync(userId, cancellationToken));
    }

    [HttpPost("match/{bookId:int}")]
    [ProducesResponseType(typeof(HardcoverMatchResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status504GatewayTimeout)]
    public async Task<ActionResult<HardcoverMatchResult>> MatchBook(
        int bookId,
        [FromBody] HardcoverMatchRequest? request,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized(new { message = "User ID not found in token." });
        }

        return await ExecuteAsync<HardcoverMatchResult>(async () =>
            Ok(await _hardcoverService.MatchBookAsync(
                userId,
                bookId,
                request?.HardcoverBookId,
                request?.HardcoverEditionId,
                request?.Query,
                cancellationToken)));
    }

    [HttpDelete("link/{bookId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UnlinkBook(int bookId, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized(new { message = "User ID not found in token." });
        }

        return await ExecuteActionAsync(async () =>
        {
            await _hardcoverService.UnlinkBookAsync(userId, bookId, cancellationToken);
            return NoContent();
        });
    }

    [HttpPost("import-metadata/{bookId:int}")]
    [ProducesResponseType(typeof(HardcoverMetadataImportResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status504GatewayTimeout)]
    public async Task<ActionResult<HardcoverMetadataImportResult>> ImportMetadata(int bookId, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized(new { message = "User ID not found in token." });
        }

        return await ExecuteAsync<HardcoverMetadataImportResult>(async () =>
            Ok(await _hardcoverService.ImportMetadataAsync(userId, bookId, cancellationToken)));
    }

    [HttpPost("sync-progress/{bookId:int}")]
    [ProducesResponseType(typeof(HardcoverProgressSyncResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status504GatewayTimeout)]
    public async Task<ActionResult<HardcoverProgressSyncResult>> SyncProgress(int bookId, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized(new { message = "User ID not found in token." });
        }

        return await ExecuteAsync<HardcoverProgressSyncResult>(async () =>
            Ok(await _hardcoverService.SyncProgressAsync(userId, bookId, requireSyncEnabled: false, rating: null, cancellationToken)));
    }

    [HttpPost("sync-all")]
    [ProducesResponseType(typeof(HardcoverSyncAllResult), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status429TooManyRequests)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status504GatewayTimeout)]
    public async Task<ActionResult<HardcoverSyncAllResult>> SyncAll(CancellationToken cancellationToken)
    {
        if (!TryGetUserId(out var userId))
        {
            return Unauthorized(new { message = "User ID not found in token." });
        }

        return await ExecuteAsync<HardcoverSyncAllResult>(async () =>
            Ok(await _hardcoverService.SyncAllAsync(userId, cancellationToken)));
    }

    private async Task<ActionResult<T>> ExecuteAsync<T>(Func<Task<ActionResult<T>>> action)
    {
        try
        {
            return await action();
        }
        catch (Exception ex) when (MapException(ex) is { } errorResult)
        {
            return errorResult;
        }
    }

    private async Task<IActionResult> ExecuteActionAsync(Func<Task<IActionResult>> action)
    {
        try
        {
            return await action();
        }
        catch (Exception ex) when (MapException(ex) is { } errorResult)
        {
            return errorResult;
        }
    }

    private ActionResult? MapException(Exception ex)
    {
        switch (ex)
        {
            case HardcoverBookNotFoundException:
                return NotFound(new { message = ex.Message });
            case HardcoverConflictException:
                return Conflict(new { message = ex.Message });
            case DbUpdateException dbEx when IsHardcoverDuplicateConstraintViolation(dbEx):
                _logger.LogWarning(dbEx, "Hardcover duplicate book link conflict.");
                return Conflict(new { message = DuplicateHardcoverBookMessage });
            case HardcoverConfigurationException:
                return BadRequest(new { message = ex.Message });
            case HardcoverApiException apiEx when apiEx.StatusCode == HttpStatusCode.TooManyRequests:
                if (apiEx.RetryAfterSeconds.HasValue)
                {
                    Response.Headers.RetryAfter = apiEx.RetryAfterSeconds.Value.ToString(CultureInfo.InvariantCulture);
                }
                _logger.LogWarning(apiEx, "Hardcover API rate limit hit.");
                return StatusCode(StatusCodes.Status429TooManyRequests, new { message = apiEx.Message });
            case HardcoverApiException apiEx when apiEx.StatusCode is HttpStatusCode.GatewayTimeout or HttpStatusCode.RequestTimeout:
                _logger.LogWarning(apiEx, "Hardcover API request timed out.");
                return StatusCode(StatusCodes.Status504GatewayTimeout, new { message = apiEx.Message });
            case HardcoverApiException apiEx:
                _logger.LogWarning(apiEx, "Hardcover API request failed.");
                return StatusCode(StatusCodes.Status502BadGateway, new { message = apiEx.Message });
            default:
                return null;
        }
    }

    private static bool IsHardcoverDuplicateConstraintViolation(DbUpdateException ex)
    {
        for (Exception? current = ex.InnerException; current != null; current = current.InnerException)
        {
            if (current is PostgresException pgEx &&
                string.Equals(pgEx.SqlState, PostgresErrorCodes.UniqueViolation, StringComparison.Ordinal))
            {
                if (string.IsNullOrEmpty(pgEx.ConstraintName))
                {
                    return true;
                }

                return pgEx.ConstraintName.Contains("HardcoverBookId", StringComparison.OrdinalIgnoreCase) ||
                       pgEx.MessageText.Contains("HardcoverBookId", StringComparison.OrdinalIgnoreCase);
            }
        }

        return false;
    }

    private bool TryGetUserId(out Guid userId)
    {
        var userIdClaim = User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrWhiteSpace(userIdClaim) || !Guid.TryParse(userIdClaim, out userId))
        {
            userId = Guid.Empty;
            _logger.LogWarning("Hardcover endpoint called without a valid user id claim.");
            return false;
        }

        return true;
    }
}

public sealed class HardcoverMatchRequest
{
    public int? HardcoverBookId { get; set; }
    public int? HardcoverEditionId { get; set; }
    public string? Query { get; set; }
}
