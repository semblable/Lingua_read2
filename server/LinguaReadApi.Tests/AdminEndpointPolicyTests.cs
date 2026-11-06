using System.Reflection;
using LinguaReadApi.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Xunit;

namespace LinguaReadApi.Tests;

/// <summary>
/// TextsController shipped two "admin/*" actions that carried only the class-level [Authorize],
/// so any signed-in user could trigger a full-table stats recompute. This guards the whole surface
/// rather than those two actions, so a newly added admin route can't repeat it.
/// </summary>
public class AdminEndpointPolicyTests
{
    [Fact]
    public void LanguageMutations_RequireAdmin_WhileReadsRemainAvailableToAuthenticatedUsers()
    {
        var actions = typeof(LinguaReadApi.Controllers.LanguagesController).GetMethods()
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());
        var mutations = actions.Where(m => m.GetCustomAttributes<HttpMethodAttribute>()
            .Any(a => a.HttpMethods.Any(v => v is "POST" or "PUT" or "DELETE"))
            && m.Name != "ResetLanguageContent").ToList();
        Assert.Equal(3, mutations.Count);
        Assert.All(mutations, action => Assert.True(HasAdminPolicy(action.GetCustomAttributes<AuthorizeAttribute>())));
        Assert.All(actions.Where(m => m.IsDefined(typeof(HttpGetAttribute))),
            action => Assert.False(HasAdminPolicy(action.GetCustomAttributes<AuthorizeAttribute>())));
        Assert.False(HasAdminPolicy(typeof(LinguaReadApi.Controllers.LanguagesController)
            .GetMethod("ResetLanguageContent")!.GetCustomAttributes<AuthorizeAttribute>()));
    }
    [Fact]
    public void EveryAdminRoutedAction_RequiresTheAdminOnlyPolicy()
    {
        var controllerTypes = typeof(LinguaReadApi.Controllers.TextsController).Assembly
            .GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t) && !t.IsAbstract);

        var unguarded = new List<string>();
        var inspected = new List<string>();

        foreach (var controller in controllerTypes)
        {
            var controllerHasPolicy = HasAdminPolicy(controller.GetCustomAttributes<AuthorizeAttribute>());

            foreach (var action in controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                var templates = action.GetCustomAttributes<HttpMethodAttribute>()
                    .Select(a => a.Template)
                    .Where(t => !string.IsNullOrEmpty(t));

                if (!templates.Any(t => t!.StartsWith("admin/", StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                inspected.Add($"{controller.Name}.{action.Name}");

                if (controllerHasPolicy || HasAdminPolicy(action.GetCustomAttributes<AuthorizeAttribute>()))
                {
                    continue;
                }

                unguarded.Add($"{controller.Name}.{action.Name}");
            }
        }

        // Guards against the guard silently passing because the scan matched nothing.
        Assert.NotEmpty(inspected);

        Assert.True(
            unguarded.Count == 0,
            $"These admin-routed actions are missing [Authorize(Policy = AdminOnlyRequirement.PolicyName)]: {string.Join(", ", unguarded)}");
    }

    private static bool HasAdminPolicy(IEnumerable<AuthorizeAttribute> attributes)
        => attributes.Any(a => a.Policy == AdminOnlyRequirement.PolicyName);
}
