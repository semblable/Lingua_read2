// File: server/LinguaReadApi/Controllers/DataManagementController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using System.Security.Claims; // Added for User claims
using Microsoft.Extensions.Configuration;
using System.Linq;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")] // Route will now be /api/datamanagement
    [ApiController]
    [Authorize] // Requires any logged-in user
    public class DataManagementController : ControllerBase // Renamed class
    {
        private readonly IDatabaseAdminService _dbAdminService;
        private readonly ILogger<DataManagementController> _logger; // Updated logger type
        private readonly HashSet<string> _adminUserIds;
        private const string AdminUserIdsConfigKey = "Admin:AllowedUserIds";

        public DataManagementController(
            IDatabaseAdminService dbAdminService,
            IConfiguration configuration,
            ILogger<DataManagementController> logger) // Updated constructor
        {
            _dbAdminService = dbAdminService;
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

        // GET: api/datamanagement/backup
        [HttpGet("backup")]
        public async Task<IActionResult> BackupDatabase()
        {
            if (!IsAdminUser())
            {
                _logger.LogWarning("Database backup blocked for non-admin user {UserId}.", User.FindFirst(ClaimTypes.NameIdentifier)?.Value);
                return Forbid();
            }
            _logger.LogInformation("Database backup requested by user {UserId}", User.FindFirst(ClaimTypes.NameIdentifier)?.Value);

            var backupFilePath = await _dbAdminService.BackupDatabaseAsync();

            if (string.IsNullOrEmpty(backupFilePath))
            {
                _logger.LogError("Database backup failed in service.");
                return StatusCode(500, "Database backup failed.");
            }

            try
            {
                var memoryStream = new MemoryStream();
                using (var fileStream = new FileStream(backupFilePath, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    await fileStream.CopyToAsync(memoryStream);
                }
                memoryStream.Position = 0;

                // Clean up the temporary file after reading it into memory
                System.IO.File.Delete(backupFilePath);
                _logger.LogInformation("Temporary backup file deleted: {BackupFilePath}", backupFilePath);


                return File(memoryStream, "application/octet-stream", Path.GetFileName(backupFilePath));
            }
            catch (Exception ex)
            {
                 _logger.LogError(ex, "Error reading or deleting backup file: {BackupFilePath}", backupFilePath);
                 // Attempt cleanup again just in case
                 if (System.IO.File.Exists(backupFilePath)) System.IO.File.Delete(backupFilePath);
                 return StatusCode(500, "Error processing backup file.");
            }
        }

        // POST: api/datamanagement/restore
        [HttpPost("restore")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(200 * 1024 * 1024)]
        [RequestFormLimits(MultipartBodyLengthLimit = 200 * 1024 * 1024)]
        public async Task<IActionResult> RestoreDatabase(IFormFile backupFile)
        {
             if (!IsAdminUser())
             {
                 _logger.LogWarning("Database restore blocked for non-admin user {UserId}.", User.FindFirst(ClaimTypes.NameIdentifier)?.Value);
                 return Forbid();
             }
             _logger.LogWarning("Database restore requested by user {UserId}. THIS IS A DESTRUCTIVE OPERATION.", User.FindFirst(ClaimTypes.NameIdentifier)?.Value);

            if (backupFile == null || backupFile.Length == 0)
            {
                return BadRequest("No backup file uploaded.");
            }

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
                        // Return JSON error object
                        return StatusCode(500, new { error = "Database restore failed in service." });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Exception occurred during database restore request processing.");
                // Return JSON error object
                return StatusCode(500, new { error = $"Internal server error during restore: {ex.Message}" });
            }
        }
    }
}