using LinguaReadApi.Controllers;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;

namespace LinguaReadApi.Tests;

public class HealthControllerTests
{
    [Fact]
    public void Get_ReturnsHealthyStatus()
    {
        var controller = new HealthController(NullLogger<HealthController>.Instance);

        var result = controller.Get();

        var okResult = Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(okResult.Value);

        var statusProperty = okResult.Value!.GetType().GetProperty("Status");
        Assert.NotNull(statusProperty);
        var status = statusProperty!.GetValue(okResult.Value)?.ToString();

        Assert.Equal("healthy", status);
    }
}
