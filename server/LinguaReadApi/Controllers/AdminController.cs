using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using LinguaReadApi.Services; // Assuming your service is here
using Microsoft.AspNetCore.Http; // Required for IFormFile
using Microsoft.Extensions.Configuration;
using System.Linq;
using System.Security.Claims;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize] // Basic authorization, refine later for admin role
    public class AdminController : ControllerBase
    {
        private readonly IDatabaseAdminService _dbAdminService;
        private readonly DiscordReportService _discordReportService;
        private readonly IOptions<DiscordReportOptions> _discordReportOptions;
        private readonly ILogger<AdminController> _logger;
        private readonly HashSet<string> _adminUserIds;
        private const string AdminUserIdsConfigKey = "Admin:AllowedUserIds";

        public AdminController(
            IDatabaseAdminService dbAdminService,
            DiscordReportService discordReportService,
            IOptions<DiscordReportOptions> discordReportOptions,
            IConfiguration configuration,
            ILogger<AdminController> logger)
        {
            _dbAdminService = dbAdminService;
            _discordReportService = discordReportService;
            _discordReportOptions = discordReportOptions;
            _logger = logger;
            _adminUserIds = ParseAdminUserIds(configuration[AdminUserIdsConfigKey]);
        }
        
        private static HashSet<string> ParseAdminUserIds(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            }
            
            return raw
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        
        private bool IsAdminUser()
        {
            if (_adminUserIds.Count == 0)
            {
                return true; // No restriction configured
            }
            
            var userId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            return userId != null && _adminUserIds.Contains(userId);
        }

        // GET: api/admin/backup
        [HttpGet("backup")]
        // [Authorize(Roles = "Admin")] // TODO: Add role-based authorization later
        public async Task<IActionResult> BackupDatabase()
        {
            if (!IsAdminUser())
            {
                _logger.LogWarning("Database backup blocked for non-admin user {UserId}.", User.FindFirst(ClaimTypes.NameIdentifier)?.Value);
                return Forbid();
            }
            _logger.LogInformation("Database backup requested by user {UserId}", User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value);

            var backupFilePath = await _dbAdminService.BackupDatabaseAsync();

            if (string.IsNullOrEmpty(backupFilePath))
            {
                _logger.LogError("Database backup failed in service.");
                return StatusCode(500, "Database backup failed.");
            }

            try
            {
                var fileName = Path.GetFileName(backupFilePath);
                // DeleteOnClose removes the temp file once the response stream finishes; avoids buffering the whole backup in RAM.
                var fileStream = new FileStream(
                    backupFilePath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read,
                    bufferSize: 64 * 1024,
                    options: FileOptions.Asynchronous | FileOptions.DeleteOnClose);

                return new FileStreamResult(fileStream, "application/octet-stream")
                {
                    FileDownloadName = fileName
                };
            }
            catch (Exception ex)
            {
                 _logger.LogError(ex, "Error opening backup file for streaming: {BackupFilePath}", backupFilePath);
                 if (System.IO.File.Exists(backupFilePath)) System.IO.File.Delete(backupFilePath);
                 return StatusCode(500, "Error processing backup file.");
            }
        }

        // POST: api/admin/restore
        [HttpPost("restore")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(200 * 1024 * 1024)] // Example: 200MB limit for restore file, adjust as needed
        [RequestFormLimits(MultipartBodyLengthLimit = 200 * 1024 * 1024)]
        // [Authorize(Roles = "Admin")] // TODO: Add role-based authorization later
        public async Task<IActionResult> RestoreDatabase(IFormFile backupFile)
        {
             if (!IsAdminUser())
             {
                 _logger.LogWarning("Database restore blocked for non-admin user {UserId}.", User.FindFirst(ClaimTypes.NameIdentifier)?.Value);
                 return Forbid();
             }
             _logger.LogWarning("Database restore requested by user {UserId}. THIS IS A DESTRUCTIVE OPERATION.", User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value);

            if (backupFile == null || backupFile.Length == 0)
            {
                return BadRequest("No backup file uploaded.");
            }

            // Optional: Add more validation for file type/name if desired
            // if (!backupFile.FileName.EndsWith(".backup", StringComparison.OrdinalIgnoreCase))
            // {
            //     return BadRequest("Invalid backup file type. Expected '.backup'.");
            // }

            try
            {
                using (var stream = backupFile.OpenReadStream())
                {
                    var success = await _dbAdminService.RestoreDatabaseAsync(stream);
                    if (success)
                    {
                        _logger.LogInformation("Database restore successful.");
                        return Ok(new { message = "Database restored successfully." });
                    }
                    else
                    {
                        _logger.LogError("Database restore failed in service.");
                        return StatusCode(500, "Database restore failed.");
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Exception occurred during database restore request processing.");
                return StatusCode(500, "Restore failed. Check server logs.");
            }
        }

        // POST: api/admin/discord/weekly-report
        [HttpPost("discord/weekly-report")]
        public async Task<IActionResult> SendWeeklyDiscordReport(
            [FromQuery] bool dryRun = false,
            [FromQuery] bool force = false)
        {
            if (!IsAdminUser())
            {
                _logger.LogWarning("Weekly report trigger blocked for non-admin user {UserId}.", User.FindFirst(ClaimTypes.NameIdentifier)?.Value);
                return Forbid();
            }
            var baseOptions = _discordReportOptions.Value;
            var options = new DiscordReportOptions
            {
                WeeklyReportDayOfWeek = baseOptions.WeeklyReportDayOfWeek,
                WeeklyReportHourUtc = baseOptions.WeeklyReportHourUtc,
                DryRun = dryRun || baseOptions.DryRun,
                PollIntervalMinutes = baseOptions.PollIntervalMinutes
            };

            var result = await _discordReportService.SendDueWeeklyReportsAsync(
                options,
                DateTime.UtcNow,
                force,
                HttpContext.RequestAborted);
            return Ok(new
            {
                result.TargetCount,
                result.PreparedCount,
                result.SentCount,
                result.FailedCount,
                result.SkippedCount
            });
        }
    }
}