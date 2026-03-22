using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
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

        /// <summary>
        /// Test endpoint that returns sample statistics data for debugging
        /// </summary>
        [HttpGet("stats")]
        public IActionResult GetTestStats()
        {
            _logger.LogInformation("Test statistics requested at: {time}", DateTimeOffset.UtcNow);
            
            return Ok(new
            {
                TotalBooks = 12,
                FinishedBooks = 8,
                TotalWords = 25000,
                KnownWords = 18750,
                LanguageStats = new Dictionary<string, object>
                {
                    { "English", new { TotalWords = 15000, KnownWords = 12000 } },
                    { "Spanish", new { TotalWords = 10000, KnownWords = 6750 } }
                }
            });
        }
        
        /// <summary>
        /// Test endpoint that returns sample reading activity data for debugging
        /// </summary>
        [HttpGet("activity")]
        public IActionResult GetTestActivity([FromQuery] string period = "all")
        {
            _logger.LogInformation("Test activity data requested for period: {period} at: {time}",
                period, DateTimeOffset.UtcNow);
            
            // Current date for reference
            var today = DateTime.UtcNow.Date;
            
            // Create sample activity data
            var activityByDate = new Dictionary<string, int>();
            
            // Generate data for the last 30 days with random word counts
            var random = new Random(42); // Fixed seed for consistent results
            for (int i = 0; i < 30; i++)
            {
                var date = today.AddDays(-i).ToString("yyyy-MM-dd");
                activityByDate[date] = random.Next(10, 500);
            }
            
            return Ok(new
            {
                TotalWordsRead = 25000,
                ActivityByDate = activityByDate,
                ActivityByLanguage = new Dictionary<string, int>
                {
                    { "English", 15000 },
                    { "Spanish", 10000 }
                }
            });
        }
        
        /// <summary>
        /// Diagnostic endpoint that returns information about the current request
        /// </summary>
        [HttpGet("diagnostics")]
        public IActionResult GetDiagnostics()
        {
            _logger.LogInformation("Diagnostics endpoint called at {time} from {ip}",
                DateTime.UtcNow, HttpContext.Connection.RemoteIpAddress);
            
            try
            {
                var headers = new Dictionary<string, string>();
                foreach (var header in Request.Headers)
                {
                    // Convert StringValues to a single string, handling potential null/empty cases
                    headers[header.Key] = header.Value.ToString() ?? string.Empty;
                }

                var result = new
                {
                    Timestamp = DateTime.UtcNow,
                    ClientIP = HttpContext.Connection.RemoteIpAddress?.ToString(),
                    Host = Request.Host.ToString(),
                    Path = Request.Path.ToString(),
                    Protocol = Request.Protocol,
                    Headers = headers,
                    QueryString = Request.QueryString.ToString(),
                    ServerVariables = new
                    {
                        ServerName = Environment.MachineName,
                        OSVersion = Environment.OSVersion.ToString(),
                        DotNetVersion = Environment.Version.ToString(),
                        ServerTime = DateTime.Now.ToString()
                    }
                };

                _logger.LogInformation("Successfully returned diagnostics data");
                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error generating diagnostics data");
                return StatusCode(500, new { message = "Error generating diagnostics data", error = ex.Message });
            }
        }
        
        /// <summary>
        /// Debug endpoint that returns test data for the Statistics component
        /// </summary>
        [HttpGet("debug-stats")]
        public IActionResult GetDebugStats()
        {
            _logger.LogInformation("Debug statistics and activity requested at: {time}", DateTimeOffset.UtcNow);
            
            // Create combined stats and activity data for debugging
            return Ok(new
            {
                ApiVersion = "1.0.0",
                Timestamp = DateTimeOffset.UtcNow,
                Environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Development",
                StatsData = new
                {
                    TotalBooks = 12,
                    FinishedBooks = 8,
                    TotalWords = 25000,
                    KnownWords = 18750,
                    LanguageStats = new Dictionary<string, object>
                    {
                        { "English", new { TotalWords = 15000, KnownWords = 12000 } },
                        { "Spanish", new { TotalWords = 10000, KnownWords = 6750 } }
                    },
                    TotalWordsRead = 25000,
                    ActivityByDate = CreateSampleActivityByDate(),
                    ActivityByLanguage = new Dictionary<string, int>
                    {
                        { "English", 15000 },
                        { "Spanish", 10000 }
                    }
                }
            });
        }

        private Dictionary<string, int> CreateSampleActivityByDate()
        {
            var activityByDate = new Dictionary<string, int>();
            var today = DateTime.UtcNow.Date;
            var random = new Random(42); // Fixed seed for consistent results
            
            for (int i = 0; i < 30; i++)
            {
                var date = today.AddDays(-i).ToString("yyyy-MM-dd");
                activityByDate[date] = random.Next(10, 500);
            }
            
            return activityByDate;
        }
    }
} 