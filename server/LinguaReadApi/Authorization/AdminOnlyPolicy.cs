using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Authorization
{
    /// <summary>
    /// Gate for destructive admin endpoints (DB backup/restore, Discord report triggers).
    /// The allow-list comes from Admin:AllowedUserIds (comma-separated user ids). When unset,
    /// every authenticated user qualifies: the app is single-user by design (one password,
    /// one seeded account), so the owner is the admin. If multi-user auth ever lands, the
    /// allow-list must be configured — this default would otherwise make every user an admin.
    /// </summary>
    public sealed class AdminOnlyRequirement : IAuthorizationRequirement
    {
        public const string PolicyName = "AdminOnly";
    }

    public sealed class AdminOnlyHandler : AuthorizationHandler<AdminOnlyRequirement>
    {
        private const string AdminUserIdsConfigKey = "Admin:AllowedUserIds";

        private readonly HashSet<string> _allowedUserIds;
        private readonly ILogger<AdminOnlyHandler> _logger;

        public AdminOnlyHandler(IConfiguration configuration, ILogger<AdminOnlyHandler> logger)
        {
            _logger = logger;
            _allowedUserIds = (configuration[AdminUserIdsConfigKey] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, AdminOnlyRequirement requirement)
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
                return Task.CompletedTask;
            }

            if (_allowedUserIds.Count == 0)
            {
                context.Succeed(requirement); // No restriction configured (single-user default).
                return Task.CompletedTask;
            }

            var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (userId != null && _allowedUserIds.Contains(userId))
            {
                context.Succeed(requirement);
            }
            else
            {
                _logger.LogWarning("Admin endpoint access blocked for non-admin user {UserId}.", userId);
            }

            return Task.CompletedTask;
        }
    }
}
