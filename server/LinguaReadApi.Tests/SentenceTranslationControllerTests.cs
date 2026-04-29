using System;
using System.Collections.Generic;
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

public class SentenceTranslationControllerTests
{
    private static SentenceTranslationController BuildController(ISentenceTranslationService service)
    {
        var factoryMock = new Mock<ITranslationServiceFactory>();
        factoryMock
            .Setup(f => f.GetServiceForUserAsync(It.IsAny<Guid>()))
            .ReturnsAsync(service);

        var controller = new SentenceTranslationController(
            factoryMock.Object,
            NullLogger<SentenceTranslationController>.Instance);

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
    public async Task TranslateSentence_UpstreamTooManyRequests_Returns429()
    {
        var service = new Mock<ISentenceTranslationService>();
        service
            .Setup(s => s.TranslateSentenceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync("Translation error: TooManyRequests");
        var controller = BuildController(service.Object);

        var result = await controller.TranslateSentence(new SentenceTranslationRequest
        {
            Text = "Hello world.",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN"
        });

        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, statusResult.StatusCode);
    }

    [Fact]
    public async Task TranslateSentence_OtherUpstreamError_Returns502()
    {
        var service = new Mock<ISentenceTranslationService>();
        service
            .Setup(s => s.TranslateSentenceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync("Translation error: ServiceUnavailable");
        var controller = BuildController(service.Object);

        var result = await controller.TranslateSentence(new SentenceTranslationRequest
        {
            Text = "Hello world.",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN"
        });

        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status502BadGateway, statusResult.StatusCode);
    }

    [Fact]
    public async Task TranslateSentence_NormalResult_ReturnsOk()
    {
        var service = new Mock<ISentenceTranslationService>();
        service
            .Setup(s => s.TranslateSentenceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync("Hola mundo.");
        var controller = BuildController(service.Object);

        var result = await controller.TranslateSentence(new SentenceTranslationRequest
        {
            Text = "Hello world.",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN"
        });

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var payload = Assert.IsType<SentenceTranslationResponse>(ok.Value);
        Assert.Equal("Hola mundo.", payload.TranslatedText);
    }

    [Fact]
    public async Task TranslateSelection_UpstreamTooManyRequests_Returns429()
    {
        var service = new Mock<ISentenceTranslationService>();
        service
            .Setup(s => s.TranslateSelectionWithContextAsync(
                It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync("Translation error: TooManyRequests");
        var controller = BuildController(service.Object);

        var result = await controller.TranslateSelection(new SelectionTranslationRequest
        {
            SelectedText = "world",
            SentenceContext = "Hello world.",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN"
        });

        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, statusResult.StatusCode);
    }

    [Fact]
    public async Task ExplainSentence_UpstreamTooManyRequests_Returns429()
    {
        var service = new Mock<ISentenceTranslationService>();
        service
            .Setup(s => s.ExplainSentenceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()))
            .ReturnsAsync("Explanation error: TooManyRequests");
        var controller = BuildController(service.Object);

        var result = await controller.ExplainSentence(new SentenceTranslationRequest
        {
            Text = "Hello world.",
            SourceLanguageCode = "ES",
            TargetLanguageCode = "EN"
        });

        var statusResult = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status429TooManyRequests, statusResult.StatusCode);
    }
}
