using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Services
{
    public interface IDatabaseAdminService
    {
        Task<string?> BackupDatabaseAsync(); // Returns path to backup file or null on error
        Task<bool> RestoreDatabaseAsync(Stream backupStream); // Returns true on success, false on error
    }

    public class DatabaseAdminService : IDatabaseAdminService
    {
        private readonly IConfiguration _configuration;
        private readonly ILogger<DatabaseAdminService> _logger;
        private readonly string _pgHost;
        private readonly string _pgPort;
        private readonly string _pgDatabase;
        private readonly string _pgUser;
        private readonly string _pgPassword;
        private readonly string _pgDumpPath;
        private readonly string _pgRestorePath;
        private readonly string _backupDirectory;

        public DatabaseAdminService(IConfiguration configuration, ILogger<DatabaseAdminService> logger)
        {
            _configuration = configuration;
            _logger = logger;

            // Read connection details from configuration (loaded from .env)
            _pgHost = _configuration["PGHOST"] ?? "localhost";
            _pgPort = _configuration["PGPORT"] ?? "5432";
            _pgDatabase = _configuration["PGDATABASE"] ?? throw new InvalidOperationException("PGDATABASE not configured.");
            _pgUser = _configuration["PGUSER"] ?? throw new InvalidOperationException("PGUSER not configured.");
            _pgPassword = _configuration["PGPASSWORD"] ?? throw new InvalidOperationException("PGPASSWORD not configured.");

            // Read tool paths (optional, defaults to assuming they are in PATH, but use full path as fallback for container)
            _pgDumpPath = _configuration["PGDUMP_PATH"] ?? "/usr/bin/pg_dump"; // Use full path as default
            _pgRestorePath = _configuration["PGRESTORE_PATH"] ?? "/usr/bin/pg_restore"; // Use full path as default

            // Define a directory for temporary backup files
            // Define a directory for temporary backup files within the app's working directory
            _backupDirectory = Path.Combine(Directory.GetCurrentDirectory(), "temp_backups"); // Use relative path
            Directory.CreateDirectory(_backupDirectory); // Ensure it exists
        }

        public async Task<string?> BackupDatabaseAsync()
        {
            var timestamp = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
            var backupFileName = $"linguaread_backup_{timestamp}.backup";
            var backupFilePath = Path.Combine(_backupDirectory, backupFileName);

            var arguments = new List<string>
            {
                "-h", _pgHost,
                "-p", _pgPort,
                "-U", _pgUser,
                "-d", _pgDatabase,
                "-F", "c",
                "-f", backupFilePath
            }; // Custom format backup

            _logger.LogInformation("Starting database backup to {BackupFilePath}...", backupFilePath);

            try
            {
                var exitCode = await ExecuteProcessAsync(_pgDumpPath, arguments, _pgPassword);

                if (exitCode == 0 && File.Exists(backupFilePath))
                {
                    _logger.LogInformation("Database backup completed successfully: {BackupFilePath}", backupFilePath);
                    return backupFilePath;
                }
                else
                {
                    _logger.LogError("Database backup failed. pg_dump exit code: {ExitCode}", exitCode);
                    if (File.Exists(backupFilePath)) File.Delete(backupFilePath); // Clean up failed backup file
                    return null;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Exception occurred during database backup.");
                if (File.Exists(backupFilePath)) File.Delete(backupFilePath); // Clean up failed backup file
                return null;
            }
        }

        public async Task<bool> RestoreDatabaseAsync(Stream backupStream)
        {
            // --- WARNING: This is a destructive operation! ---
            // Consider adding more checks, confirmations, or specific user role validation here or in the controller.

            var tempBackupFilePath = Path.Combine(_backupDirectory, $"restore_{Guid.NewGuid()}.backup");

            try
            {
                // Save the uploaded stream to a temporary file
                using (var fileStream = new FileStream(tempBackupFilePath, FileMode.Create, FileAccess.Write))
                {
                    await backupStream.CopyToAsync(fileStream);
                }
                _logger.LogInformation("Temporary backup file saved for restore: {TempBackupFilePath}", tempBackupFilePath);

                // Construct pg_restore command
                // --clean: Drop database objects before recreating them
                // --if-exists: Use DROP IF EXISTS to avoid errors if objects don't exist
                // --no-owner: Don't try to set ownership (useful if restoring user is different)
                // --no-privileges: Don't try to set privileges
                // -1: Single transaction
                var arguments = new List<string>
                {
                    "-h", _pgHost,
                    "-p", _pgPort,
                    "-U", _pgUser,
                    "-d", _pgDatabase,
                    "--clean",
                    "--if-exists",
                    "--no-owner",
                    "--no-privileges",
                    "-1",
                    tempBackupFilePath
                };

                _logger.LogWarning("Starting database restore from {TempBackupFilePath}. THIS WILL OVERWRITE EXISTING DATA.", tempBackupFilePath);

                var exitCode = await ExecuteProcessAsync(_pgRestorePath, arguments, _pgPassword);

                if (exitCode == 0)
                {
                    _logger.LogInformation("Database restore completed successfully.");
                    return true;
                }
                else
                {
                    _logger.LogError("Database restore failed. pg_restore exit code: {ExitCode}", exitCode);
                    return false;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Exception occurred during database restore.");
                return false;
            }
            finally
            {
                // Clean up the temporary backup file
                if (File.Exists(tempBackupFilePath))
                {
                    try { File.Delete(tempBackupFilePath); } catch (Exception cleanupEx) { _logger.LogWarning(cleanupEx, "Failed to delete temporary restore file: {TempBackupFilePath}", tempBackupFilePath); }
                }
            }
        }

        private async Task<int> ExecuteProcessAsync(string command, IEnumerable<string> arguments, string? password = null)
        {
            var processStartInfo = new ProcessStartInfo
            {
                FileName = command,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            processStartInfo.Environment["PGPASSWORD"] = password ?? string.Empty;
            foreach (var argument in arguments)
            {
                processStartInfo.ArgumentList.Add(argument);
            }

            using var process = new Process { StartInfo = processStartInfo };

            var outputBuilder = new System.Text.StringBuilder();
            var errorBuilder = new System.Text.StringBuilder();

            process.OutputDataReceived += (sender, args) => { if (args.Data != null) outputBuilder.AppendLine(args.Data); };
            process.ErrorDataReceived += (sender, args) => { if (args.Data != null) errorBuilder.AppendLine(args.Data); };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.WaitForExitAsync(); // Use async version

            var output = outputBuilder.ToString();
            var error = errorBuilder.ToString();

            if (!string.IsNullOrWhiteSpace(output)) _logger.LogDebug("Process output:\n{Output}", output);
            if (!string.IsNullOrWhiteSpace(error)) _logger.LogError("Process error:\n{Error}", error); // Log errors as errors

            return process.ExitCode;
        }
    }
}