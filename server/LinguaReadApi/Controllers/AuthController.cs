using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System;
// using System.ComponentModel.DataAnnotations; // No longer needed for models
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.Extensions.Logging; // Add logging

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AuthController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IConfiguration _configuration;
        private readonly ILogger<AuthController> _logger; // Add logger
        private readonly IWebHostEnvironment _env;
        private static readonly Guid DefaultUserId = new Guid("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5"); // Define default user ID

        public AuthController(
            AppDbContext context,
            IConfiguration configuration,
            ILogger<AuthController> logger,
            IWebHostEnvironment env) // Inject environment
        {
            _context = context;
            _configuration = configuration;
            _logger = logger; // Assign logger
            _env = env;
        }

        // REMOVED [HttpPost("register")] endpoint

        [HttpPost("login")]
        // No [FromBody] needed as we don't expect a request body
        public async Task<IActionResult> Login()
        {
            // Defense-in-depth: in production, do not mint JWTs for anonymous callers.
            // Preferred: Require a shared secret (header: X-Login-Secret) to access auto-login.
            // If no secret is configured, require that the request came through the reverse proxy
            // (Nginx Basic Auth) by checking `X-Forwarded-User` (set from `$remote_user`).
            if (!_env.IsDevelopment())
            {
                var configuredSecret =
                    _configuration["Auth:LoginSecret"] ??
                    Environment.GetEnvironmentVariable("LINGUAREAD_LOGIN_SECRET");

                if (!string.IsNullOrWhiteSpace(configuredSecret))
                {
                    var providedSecret = Request.Headers["X-Login-Secret"].FirstOrDefault();
                    if (!FixedTimeEquals(providedSecret, configuredSecret))
                    {
                        _logger.LogWarning("[AuthController] Login blocked: invalid or missing X-Login-Secret.");
                        return Unauthorized(new { message = "Invalid login secret." });
                    }
                }
                else
                {
                    var forwardedUser = Request.Headers["X-Forwarded-User"].FirstOrDefault();
                    if (string.IsNullOrWhiteSpace(forwardedUser))
                    {
                        _logger.LogWarning("[AuthController] Login blocked: missing X-Forwarded-User (expected behind reverse proxy Basic Auth).");
                        return Unauthorized(new { message = "Login is not available without proxy authentication." });
                    }
                }
            }

            _logger.LogInformation("[AuthController] Attempting auto-login for default user ID: {UserId}", DefaultUserId);

            // Find the predefined default user by ID
            _logger.LogInformation("[AuthController] Attempting to find user with ID {UserId} in database...", DefaultUserId);
            var user = await _context.Users.FindAsync(DefaultUserId);

            if (user == null)
            {
                // This should ideally not happen if DbInitializer ran correctly
                _logger.LogError("[AuthController] Default user with ID {UserId} was NOT FOUND in database. Ensure DbInitializer ran successfully and saved changes.", DefaultUserId);
                return StatusCode(500, new { message = "Default user configuration error. Cannot log in." });
            }
            else
            {
                 _logger.LogInformation("[AuthController] Default user with ID {UserId} FOUND successfully.", DefaultUserId);
            }

            // No password verification needed

            // Generate JWT token for the default user
            var token = GenerateJwtToken(user);
            _logger.LogInformation("Successfully generated token for default user {UserId}", DefaultUserId);

            // Return token
            return Ok(new { token });
        }

        private static bool FixedTimeEquals(string? provided, string expected)
        {
            if (string.IsNullOrEmpty(provided) || string.IsNullOrEmpty(expected))
            {
                return false;
            }

            var providedBytes = Encoding.UTF8.GetBytes(provided);
            var expectedBytes = Encoding.UTF8.GetBytes(expected);

            if (providedBytes.Length != expectedBytes.Length)
            {
                return false;
            }

            return CryptographicOperations.FixedTimeEquals(providedBytes, expectedBytes);
        }

        private string GenerateJwtToken(User user)
        {
            _logger.LogDebug("Generating token for user: {UserEmail} (ID: {UserId})", user.Email, user.Id);
            var issuer = _configuration["Jwt:Issuer"];
            var audience = _configuration["Jwt:Audience"];
            var expiryHours = _configuration["Jwt:ExpiryInHours"];
            var jwtKey = _configuration["Jwt:Key"];

            if (string.IsNullOrEmpty(jwtKey))
            {
                 _logger.LogError("JWT Key is not configured in app settings.");
                 throw new InvalidOperationException("JWT Key not configured.");
            }
             if (string.IsNullOrEmpty(issuer)) _logger.LogWarning("JWT Issuer is not configured.");
             if (string.IsNullOrEmpty(audience)) _logger.LogWarning("JWT Audience is not configured.");
             if (string.IsNullOrEmpty(expiryHours) || !double.TryParse(expiryHours, out var hours))
             {
                 _logger.LogWarning("JWT ExpiryInHours is not configured or invalid. Defaulting to 1 hour.");
                 hours = 1;
             }


            var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
            var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()), // Use ClaimTypes.NameIdentifier and user.Id
                new Claim(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty), // Use null-coalescing for safety
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new Claim(JwtRegisteredClaimNames.Iat, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
            };

            _logger.LogDebug("Claims added to token for user {UserId}: {Claims}", user.Id, string.Join(", ", claims.Select(c => $"{c.Type}={c.Value}")));


            var token = new JwtSecurityToken(
                issuer: issuer,
                audience: audience,
                claims: claims,
                expires: DateTime.UtcNow.AddHours(hours), // Use parsed or default expiry
                signingCredentials: credentials
            );

            var tokenString = new JwtSecurityTokenHandler().WriteToken(token);
            _logger.LogDebug("Generated token length for user {UserId}: {Length}", user.Id, tokenString.Length);
            return tokenString;
        }
    }

    // REMOVED RegisterModel class
    // REMOVED LoginModel class
}