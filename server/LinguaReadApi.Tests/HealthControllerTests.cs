using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

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

    [Fact]
    public async Task GetReady_WithoutDefaultUser_Returns503WithoutInternalDetails()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        await using var db = new AppDbContext(options);
        var controller = new HealthController(NullLogger<HealthController>.Instance);

        var result = await controller.GetReady(db);

        // Anonymous endpoint: the reason code is enough for probes; ids stay out of the body.
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, objectResult.StatusCode);
        var body = objectResult.Value!.GetType();
        Assert.Equal("default_user_missing", body.GetProperty("reason")!.GetValue(objectResult.Value));
        Assert.Null(body.GetProperty("defaultUserId"));
        Assert.Null(body.GetProperty("error"));
    }
}
