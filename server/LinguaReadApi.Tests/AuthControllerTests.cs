using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

public class AuthControllerTests
{
    private static readonly Guid DefaultUserId = new("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5");
    private const string TestPassword = "SecurePass123";
    private const string TestJwtKey = "this-is-a-test-jwt-key-that-is-at-least-32-bytes-long-for-hmac-sha256!!";

    // --- Login Tests ---

    [Fact]
    public async Task Login_EmptyPassword_ReturnsBadRequest()
    {
        await using var context = CreateContext();
        var controller = CreateController(context);

        var result = await controller.Login(new LoginRequest { Password = "" });

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("Password is required", GetMessage(bad.Value));
    }

    [Fact]
    public async Task Login_DefaultUserNotFound_Returns500()
    {
        await using var context = CreateContext();
        var controller = CreateController(context);

        var result = await controller.Login(new LoginRequest { Password = TestPassword });

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(500, obj.StatusCode);
    }

    [Fact]
    public async Task Login_PasswordNotSet_ReturnsBadRequest()
    {
        await using var context = CreateContext();
        SeedDefaultUser(context, passwordHash: null);
        var controller = CreateController(context);

        var result = await controller.Login(new LoginRequest { Password = TestPassword });

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("Password not set", GetMessage(bad.Value));
    }

    [Fact]
    public async Task Login_WrongPassword_ReturnsUnauthorized()
    {
        await using var context = CreateContext();
        var hasher = new PasswordHasher<User>();
        var user = SeedDefaultUser(context);
        user.PasswordHash = hasher.HashPassword(user, TestPassword);
        await context.SaveChangesAsync();

        var controller = CreateController(context);
        var result = await controller.Login(new LoginRequest { Password = "WrongPassword" });

        Assert.IsType<UnauthorizedObjectResult>(result);
    }

    [Fact]
    public async Task Login_CorrectPassword_ReturnsOkAndSetsCookie()
    {
        await using var context = CreateContext();
        var hasher = new PasswordHasher<User>();
        var user = SeedDefaultUser(context);
        user.PasswordHash = hasher.HashPassword(user, TestPassword);
        await context.SaveChangesAsync();

        var httpContext = new DefaultHttpContext();
        var controller = CreateController(context, httpContext: httpContext);

        var result = await controller.Login(new LoginRequest { Password = TestPassword });

        Assert.IsType<OkObjectResult>(result);

        var setCookie = httpContext.Response.Headers["Set-Cookie"].ToString();
        Assert.Contains(".LinguaRead.Auth", setCookie);

        // Verify LastLogin was updated
        var updatedUser = await context.Users.FindAsync(DefaultUserId);
        Assert.NotNull(updatedUser!.LastLogin);
    }

    [Fact]
    public async Task Login_CorrectPassword_CookieIsHttpOnly()
    {
        await using var context = CreateContext();
        var hasher = new PasswordHasher<User>();
        var user = SeedDefaultUser(context);
        user.PasswordHash = hasher.HashPassword(user, TestPassword);
        await context.SaveChangesAsync();

        var httpContext = new DefaultHttpContext();
        var controller = CreateController(context, httpContext: httpContext);

        await controller.Login(new LoginRequest { Password = TestPassword });

        var setCookie = httpContext.Response.Headers["Set-Cookie"].ToString().ToLower();
        Assert.Contains("httponly", setCookie);
    }

    [Fact]
    public async Task Login_RehashNeeded_UpdatesHash()
    {
        await using var context = CreateContext();
        var user = SeedDefaultUser(context);
        var originalHash = "old-hash-value";
        user.PasswordHash = originalHash;
        await context.SaveChangesAsync();

        // Mock hasher to return SuccessRehashNeeded
        var mockHasher = new Mock<IPasswordHasher<User>>();
        mockHasher.Setup(h => h.VerifyHashedPassword(It.IsAny<User>(), originalHash, TestPassword))
            .Returns(PasswordVerificationResult.SuccessRehashNeeded);
        mockHasher.Setup(h => h.HashPassword(It.IsAny<User>(), TestPassword))
            .Returns("new-rehashed-value");

        var controller = CreateController(context, passwordHasher: mockHasher.Object);

        var result = await controller.Login(new LoginRequest { Password = TestPassword });

        Assert.IsType<OkObjectResult>(result);
        var updatedUser = await context.Users.FindAsync(DefaultUserId);
        Assert.Equal("new-rehashed-value", updatedUser!.PasswordHash);
    }

    // --- Logout Tests ---

    [Fact]
    public void Logout_ReturnsOkAndDeletesCookie()
    {
        using var context = CreateContext();
        var httpContext = new DefaultHttpContext();
        var controller = CreateController(context, httpContext: httpContext);

        var result = controller.Logout();

        Assert.IsType<OkObjectResult>(result);
        var setCookie = httpContext.Response.Headers["Set-Cookie"].ToString();
        Assert.Contains(".LinguaRead.Auth", setCookie);
    }

    // --- Status Tests ---

    [Fact]
    public async Task Status_UserWithNoPassword_ReturnsNeedsSetup()
    {
        await using var context = CreateContext();
        SeedDefaultUser(context, passwordHash: null);
        var controller = CreateController(context);

        var result = await controller.Status();

        var ok = Assert.IsType<OkObjectResult>(result);
        var needsSetup = GetProperty<bool>(ok.Value!, "needsSetup");
        Assert.True(needsSetup);
    }

    [Fact]
    public async Task Status_Unauthenticated_ReturnsAuthenticatedFalse()
    {
        await using var context = CreateContext();
        var hasher = new PasswordHasher<User>();
        var user = SeedDefaultUser(context);
        user.PasswordHash = hasher.HashPassword(user, TestPassword);
        await context.SaveChangesAsync();

        var controller = CreateController(context);

        var result = await controller.Status();

        var ok = Assert.IsType<OkObjectResult>(result);
        var authenticated = GetProperty<bool>(ok.Value!, "authenticated");
        Assert.False(authenticated);
        var needsSetup = GetProperty<bool>(ok.Value!, "needsSetup");
        Assert.False(needsSetup);
    }

    [Fact]
    public async Task Status_Authenticated_ReturnsUserInfo()
    {
        await using var context = CreateContext();
        var hasher = new PasswordHasher<User>();
        var user = SeedDefaultUser(context);
        user.PasswordHash = hasher.HashPassword(user, TestPassword);
        await context.SaveChangesAsync();

        var authenticatedPrincipal = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, DefaultUserId.ToString())
        ], "TestAuth"));

        var controller = CreateController(context, principal: authenticatedPrincipal);

        var result = await controller.Status();

        var ok = Assert.IsType<OkObjectResult>(result);
        var authenticated = GetProperty<bool>(ok.Value!, "authenticated");
        Assert.True(authenticated);
    }

    // --- Setup Tests ---

    [Fact]
    public async Task Setup_EmptyPassword_ReturnsBadRequest()
    {
        await using var context = CreateContext();
        var controller = CreateController(context);

        var result = await controller.Setup(new SetupRequest { Password = "" });

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("Password is required", GetMessage(bad.Value));
    }

    [Fact]
    public async Task Setup_TooShortPassword_ReturnsBadRequest()
    {
        await using var context = CreateContext();
        var controller = CreateController(context);

        var result = await controller.Setup(new SetupRequest { Password = "12345" });

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("at least 6 characters", GetMessage(bad.Value));
    }

    [Fact]
    public async Task Setup_DefaultUserNotFound_Returns500()
    {
        await using var context = CreateContext();
        var controller = CreateController(context);

        var result = await controller.Setup(new SetupRequest { Password = TestPassword });

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(500, obj.StatusCode);
    }

    [Fact]
    public async Task Setup_PasswordAlreadySet_ReturnsBadRequest()
    {
        await using var context = CreateContext();
        var hasher = new PasswordHasher<User>();
        var user = SeedDefaultUser(context);
        user.PasswordHash = hasher.HashPassword(user, "existing-password");
        await context.SaveChangesAsync();

        var controller = CreateController(context);
        var result = await controller.Setup(new SetupRequest { Password = TestPassword });

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("already set", GetMessage(bad.Value));
    }

    [Fact]
    public async Task Setup_ValidPassword_SetsHashAndAutoLogins()
    {
        await using var context = CreateContext();
        SeedDefaultUser(context, passwordHash: null);

        var httpContext = new DefaultHttpContext();
        var controller = CreateController(context, httpContext: httpContext);

        var result = await controller.Setup(new SetupRequest { Password = TestPassword });

        Assert.IsType<OkObjectResult>(result);

        // Verify password hash was set
        var user = await context.Users.FindAsync(DefaultUserId);
        Assert.False(string.IsNullOrEmpty(user!.PasswordHash));

        // Verify LastLogin was set
        Assert.NotNull(user.LastLogin);

        // Verify auth cookie was set (auto-login)
        var setCookie = httpContext.Response.Headers["Set-Cookie"].ToString();
        Assert.Contains(".LinguaRead.Auth", setCookie);
    }

    [Fact]
    public async Task Setup_ValidPassword_CookieIsHttpOnly()
    {
        await using var context = CreateContext();
        SeedDefaultUser(context, passwordHash: null);

        var httpContext = new DefaultHttpContext();
        var controller = CreateController(context, httpContext: httpContext);

        await controller.Setup(new SetupRequest { Password = TestPassword });

        var setCookie = httpContext.Response.Headers["Set-Cookie"].ToString().ToLower();
        Assert.Contains("httponly", setCookie);
    }

    // --- Helpers ---

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static User SeedDefaultUser(AppDbContext context, string? passwordHash = "")
    {
        var user = new User
        {
            Id = DefaultUserId,
            UserName = "default",
            Email = "user@linguaread.app",
            PasswordHash = passwordHash
        };
        context.Users.Add(user);
        context.SaveChanges();
        return user;
    }

    private static AuthController CreateController(
        AppDbContext context,
        DefaultHttpContext? httpContext = null,
        ClaimsPrincipal? principal = null,
        IPasswordHasher<User>? passwordHasher = null)
    {
        httpContext ??= new DefaultHttpContext();
        if (principal != null)
        {
            httpContext.User = principal;
        }

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Key"] = TestJwtKey,
                ["Jwt:Issuer"] = "LinguaReadTest",
                ["Jwt:Audience"] = "LinguaReadTestAudience",
                ["Jwt:ExpiryInHours"] = "1"
            })
            .Build();

        var mockEnv = new Mock<Microsoft.AspNetCore.Hosting.IWebHostEnvironment>();
        mockEnv.Setup(e => e.EnvironmentName).Returns(Environments.Development);

        return new AuthController(
            context,
            config,
            NullLogger<AuthController>.Instance,
            mockEnv.Object,
            passwordHasher ?? new PasswordHasher<User>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = httpContext
            }
        };
    }

    private static string GetMessage(object? value)
    {
        if (value == null) return string.Empty;
        var prop = value.GetType().GetProperty("message");
        return prop?.GetValue(value)?.ToString() ?? string.Empty;
    }

    private static T GetProperty<T>(object value, string name)
    {
        var prop = value.GetType().GetProperty(name)
            ?? throw new InvalidOperationException($"Property '{name}' not found on {value.GetType().Name}");
        return (T)prop.GetValue(value)!;
    }
}
