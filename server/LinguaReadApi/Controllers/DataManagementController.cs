// File: server/LinguaReadApi/Controllers/DataManagementController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using LinguaReadApi.Authorization;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using System.Security.Claims; // Added for User claims
using Microsoft.Extensions.Configuration;
using System.Linq;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")] // Route will now be /api/datamanagement
    [ApiController]
    [Authorize(Policy = AdminOnlyRequirement.PolicyName)] // Shared admin gate; see AdminOnlyPolicy.cs
    public class DataManagementController : ControllerBase // Renamed class
    {
        private readonly IDatabaseAdminService _dbAdminService;
        private readonly ILogger<DataManagementController> _logger; // Updated logger type

        public DataManagementController(
            IDatabaseAdminService dbAdminService,
            ILogger<DataManagementController> logger) // Updated constructor
        {
            _dbAdminService = dbAdminService;
            _logger = logger;
        }

        // GET: api/datamanagement/backup
        [HttpGet("backup")]
        public async Task<IActionResult> BackupDatabase()
        {
            _logger.LogInformation("Database backup requested by user {UserId}", User.FindFirst(ClaimTypes.NameIdentifier)?.Value);

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

        // POST: api/datamanagement/restore
        [HttpPost("restore")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(200 * 1024 * 1024)]
        [RequestFormLimits(MultipartBodyLengthLimit = 200 * 1024 * 1024)]
        public async Task<IActionResult> RestoreDatabase(IFormFile backupFile)
        {
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