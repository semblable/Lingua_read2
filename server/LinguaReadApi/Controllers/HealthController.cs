using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.Threading.Tasks;
using LinguaReadApi.Data;

namespace LinguaReadApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [AllowAnonymous] // Explicitly allow anonymous access to all health endpoints
    // [EnableCors("AllowClientApp")] // Rely on global CORS policy applied in Program.cs
    public class HealthController : ControllerBase
    {
        private readonly ILogger<HealthController> _logger;

        /// <summary>Same default user as AuthController / DbInitializer.</summary>
        private static readonly Guid DefaultUserId = new Guid("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5");

        public HealthController(ILogger<HealthController> logger)
        {
            _logger = logger;
        }

        /// <summary>
        /// Readiness probe: verifies database connectivity and that the seeded default user exists.
        /// Use for deploy smoke tests and orchestration; returns 503 until the API can serve authenticated traffic.
        /// </summary>
        [HttpGet("ready")]
        public async Task<IActionResult> GetReady([FromServices] AppDbContext db)
        {
            try
            {
                var canConnect = await db.Database.CanConnectAsync();
                if (!canConnect)
                {
                    return StatusCode(503, new { status = "not_ready", reason = "database_unreachable" });
                }

                var defaultUserExists = await db.Users.AnyAsync(u => u.Id == DefaultUserId);
                if (!defaultUserExists)
                {
                    _logger.LogWarning("Readiness check failed: default user {UserId} is missing", DefaultUserId);
                    return StatusCode(503, new { status = "not_ready", reason = "default_user_missing", defaultUserId = DefaultUserId });
                }

                return Ok(new { status = "ready", database = true, defaultUser = true });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Readiness check failed");
                return StatusCode(503, new { status = "not_ready", reason = "readiness_error", error = ex.Message });
            }
        }

        /// <summary>
        /// Basic health check endpoint that returns server status
        /// </summary>
        [HttpGet]
        public IActionResult Get()
        {
            _logger.LogInformation("Health check requested at: {time}", DateTimeOffset.UtcNow); // Restore logging
            
            // Return minimal response to isolate issues
            return Ok(new
            {
                Status = "healthy",
                Timestamp = DateTimeOffset.UtcNow
                // Version = "1.0.0", // Temporarily removed
                // Environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development" // Temporarily removed
            });
        }

    }
}