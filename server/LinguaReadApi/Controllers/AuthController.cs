using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;

namespace LinguaReadApi.Controllers
{
    public class LoginRequest
    {
        public string Password { get; set; } = string.Empty;
    }

    public class SetupRequest
    {
        public string Password { get; set; } = string.Empty;
    }

    [Route("api/[controller]")]
    [ApiController]
    public class AuthController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IConfiguration _configuration;
        private readonly ILogger<AuthController> _logger;
        private readonly IWebHostEnvironment _env;
        private readonly IPasswordHasher<User> _passwordHasher;
        private static readonly Guid DefaultUserId = new Guid("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5");

        public AuthController(
            AppDbContext context,
            IConfiguration configuration,
            ILogger<AuthController> logger,
            IWebHostEnvironment env,
            IPasswordHasher<User> passwordHasher)
        {
            _context = context;
            _configuration = configuration;
            _logger = logger;
            _env = env;
            _passwordHasher = passwordHasher;
        }

        [AllowAnonymous]
        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Password))
            {
                return BadRequest(new { message = "Password is required." });
            }

            var user = await _context.Users.FindAsync(DefaultUserId);
            if (user == null)
            {
                _logger.LogError("[AuthController] Default user with ID {UserId} not found.", DefaultUserId);
                return StatusCode(500, new { message = "Default user configuration error." });
            }

            if (string.IsNullOrEmpty(user.PasswordHash))
            {
                return BadRequest(new { message = "Password not set. Please use the setup endpoint first." });
            }

            var result = _passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
            if (result == PasswordVerificationResult.Failed)
            {
                _logger.LogWarning("[AuthController] Failed login attempt.");
                return Unauthorized(new { message = "Invalid password." });
            }

            // Rehash if needed (e.g. algorithm upgrade)
            if (result == PasswordVerificationResult.SuccessRehashNeeded)
            {
                user.PasswordHash = _passwordHasher.HashPassword(user, request.Password);
                await _context.SaveChangesAsync();
            }

            // Update last login
            user.LastLogin = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            var token = GenerateJwtToken(user);
            SetAuthCookie(token);

            _logger.LogInformation("[AuthController] User {UserId} logged in successfully.", user.Id);
            return Ok(new { message = "Login successful." });
        }

        [AllowAnonymous]
        [HttpPost("logout")]
        public IActionResult Logout()
        {
            Response.Cookies.Delete(".LinguaRead.Auth", new CookieOptions
            {
                Path = "/",
                HttpOnly = true,
                Secure = !_env.IsDevelopment(),
                SameSite = SameSiteMode.Lax
            });
            return Ok(new { message = "Logged out." });
        }

        [AllowAnonymous]
        [HttpGet("status")]
        public async Task<IActionResult> Status()
        {
            var user = await _context.Users.FindAsync(DefaultUserId);
            bool needsSetup = user == null || string.IsNullOrEmpty(user.PasswordHash);

            // Check if the request has a valid auth cookie by inspecting the current identity
            bool authenticated = User.Identity?.IsAuthenticated == true;

            return Ok(new
            {
                authenticated,
                needsSetup,
                user = authenticated && user != null ? new { id = user.Id, email = user.Email } : null
            });
        }

        [AllowAnonymous]
        [HttpPost("setup")]
        public async Task<IActionResult> Setup([FromBody] SetupRequest request)
        {
            if (string.IsNullOrWhiteSpace(request?.Password))
            {
                return BadRequest(new { message = "Password is required." });
            }

            if (request.Password.Length < 6)
            {
                return BadRequest(new { message = "Password must be at least 6 characters." });
            }

            var user = await _context.Users.FindAsync(DefaultUserId);
            if (user == null)
            {
                _logger.LogError("[AuthController] Default user with ID {UserId} not found.", DefaultUserId);
                return StatusCode(500, new { message = "Default user configuration error." });
            }

            if (!string.IsNullOrEmpty(user.PasswordHash))
            {
                return BadRequest(new { message = "Password is already set. Use login instead." });
            }

            user.PasswordHash = _passwordHasher.HashPassword(user, request.Password);
            user.LastLogin = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            // Auto-login after setup
            var token = GenerateJwtToken(user);
            SetAuthCookie(token);

            _logger.LogInformation("[AuthController] Password set and user {UserId} logged in via setup.", user.Id);
            return Ok(new { message = "Password set successfully." });
        }

        private void SetAuthCookie(string token)
        {
            var expiryHours = _configuration["Jwt:ExpiryInHours"];
            if (!double.TryParse(expiryHours, out var hours))
            {
                hours = 2160; // 90 days default
            }

            Response.Cookies.Append(".LinguaRead.Auth", token, new CookieOptions
            {
                HttpOnly = true,
                Secure = !_env.IsDevelopment(),
                SameSite = SameSiteMode.Lax,
                Path = "/",
                MaxAge = TimeSpan.FromHours(hours)
            });
        }

        private string GenerateJwtToken(User user)
        {
            var issuer = _configuration["Jwt:Issuer"];
            var audience = _configuration["Jwt:Audience"];
            var expiryHours = _configuration["Jwt:ExpiryInHours"];
            var jwtKey = _configuration["Jwt:Key"];

            if (string.IsNullOrEmpty(jwtKey))
            {
                throw new InvalidOperationException("JWT Key not configured.");
            }

            if (!double.TryParse(expiryHours, out var hours))
            {
                hours = 2160; // 90 days default
            }

            var securityKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
            var credentials = new SigningCredentials(securityKey, SecurityAlgorithms.HmacSha256);

            var claims = new[]
            {
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
                new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
                new Claim(JwtRegisteredClaimNames.Iat, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
            };

            var token = new JwtSecurityToken(
                issuer: issuer,
                audience: audience,
                claims: claims,
                expires: DateTime.UtcNow.AddHours(hours),
                signingCredentials: credentials
            );

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }
}
