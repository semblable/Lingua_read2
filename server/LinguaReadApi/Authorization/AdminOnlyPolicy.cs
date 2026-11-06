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
    /// only the seeded owner account qualifies. Other accounts require an explicit allow-list.
    /// </summary>
    public sealed class AdminOnlyRequirement : IAuthorizationRequirement
    {
        public const string PolicyName = "AdminOnly";
    }

    public sealed class AdminOnlyHandler : AuthorizationHandler<AdminOnlyRequirement>
    {
        private const string AdminUserIdsConfigKey = "Admin:AllowedUserIds";
        private const string OwnerUserId = "a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5";

        private readonly HashSet<string> _allowedUserIds;
        private readonly ILogger<AdminOnlyHandler> _logger;

        public AdminOnlyHandler(IConfiguration configuration, ILogger<AdminOnlyHandler> logger)
        {
            _logger = logger;
            _allowedUserIds = (configuration[AdminUserIdsConfigKey] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (_allowedUserIds.Count == 0) _allowedUserIds.Add(OwnerUserId);
        }

        protected override Task HandleRequirementAsync(AuthorizationHandlerContext context, AdminOnlyRequirement requirement)
        {
            if (context.User.Identity?.IsAuthenticated != true)
            {
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
