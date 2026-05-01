using System;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

public class SummarizationControllerTests
{
    private static SummarizationController BuildController(ISummarizationService service)
    {
        var factoryMock = new Mock<ISummarizationServiceFactory>();
        factoryMock
            .Setup(f => f.GetServiceForUserAsync(It.IsAny<Guid>()))
            .ReturnsAsync(service);

        var controller = new SummarizationController(
            factoryMock.Object,
            NullLogger<SummarizationController>.Instance);

        var userId = Guid.NewGuid().ToString();
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId)
        }, "Test");
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(identity)
            }
        };

        return controller;
    }

    [Fact]
    public async Task Summarize_EmptyText_ReturnsBadRequest()
    {
        var service = new Mock<ISummarizationService>();
        var controller = BuildController(service.Object);

        var result = await controller.Summarize(new SummarizationRequest
        {
            Text = " ",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN"
        });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task Summarize_NormalResult_ReturnsOk()
    {
        var service = new Mock<ISummarizationService>();
        service
            .Setup(s => s.SummarizeAsync("Texto largo.", "ES", "EN", 200))
            .ReturnsAsync("A short summary.");
        var controller = BuildController(service.Object);

        var result = await controller.Summarize(new SummarizationRequest
        {
            Text = "Texto largo.",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN",
            MaxSummaryWords = 200
        });

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var payload = Assert.IsType<SummarizationResponse>(ok.Value);
        Assert.Equal("A short summary.", payload.SummaryText);
        Assert.Equal("ES", payload.SourceLanguageCode);
        Assert.Equal("EN", payload.TargetLanguageCode);
    }

    [Fact]
    public async Task Summarize_UpstreamTooManyRequests_Returns429()
    {
        var service = new Mock<ISummarizationService>();
        service
            .Setup(s => s.SummarizeAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
            .ReturnsAsync("Summarization error: TooManyRequests");
        var controller = BuildController(service.Object);

        var result = await controller.Summarize(new SummarizationRequest
        {
            Text = "Texto largo.",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN"
        });

        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, statusResult.StatusCode);
    }

    [Fact]
    public async Task Summarize_OtherUpstreamError_Returns502()
    {
        var service = new Mock<ISummarizationService>();
        service
            .Setup(s => s.SummarizeAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
            .ReturnsAsync("Summarization error: ServiceUnavailable");
        var controller = BuildController(service.Object);

        var result = await controller.Summarize(new SummarizationRequest
        {
            Text = "Texto largo.",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN"
        });

        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status502BadGateway, statusResult.StatusCode);
    }
}
