using System.Security.Claims;
using System.Text.Encodings.Web;
using LinguaReadApi.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace LinguaReadApi.Authorization;

/// <summary>Retains normal authorization and ownership checks without creating a portable session.</summary>
public sealed class LocalOwnerAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
    AppDbContext context, IConfiguration configuration)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!LocalMode.IsEnabled(configuration)) return AuthenticateResult.NoResult();
        var owner = await context.Users.FindAsync(LocalMode.OwnerId);
        if (owner == null) return AuthenticateResult.Fail("Local owner has not been initialized.");
        var claims = new[] {
            new Claim(ClaimTypes.NameIdentifier, owner.Id.ToString()),
            new Claim(ClaimTypes.Email, owner.Email ?? string.Empty)
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, LocalMode.Scheme));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, LocalMode.Scheme));
    }
}
