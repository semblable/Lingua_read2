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

/// <summary>
/// Controller-level error mapping for <see cref="TranslationController"/>: a provider with no
/// configured credentials surfaces as 400 (not a silent empty body or a 500), and a token missing
/// its user-id claim surfaces as 401 (not 500). The happy path still returns the translation.
/// </summary>
public class TranslationControllerTests
{
    [Fact]
    public async Task TranslateText_WhenProviderNotConfigured_ReturnsBadRequest()
    {
        var service = new Mock<ITranslationService>();
        service.Setup(s => s.TranslateTextAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string>()))
            .ThrowsAsync(new TranslationProviderNotConfiguredException("Azure Translator"));

        var controller = CreateController(service.Object, Guid.NewGuid());

        var result = await controller.TranslateText(new TranslationRequest
        {
            Text = "hello",
            SourceLanguageCode = "EN",
            TargetLanguageCode = "FR"
        });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task TranslateBatch_WhenProviderNotConfigured_ReturnsBadRequest()
    {
        var service = new Mock<ITranslationService>();
        service.Setup(s => s.TranslateBatchAsync(It.IsAny<List<string>>(), It.IsAny<string>(), It.IsAny<string?>()))
            .ThrowsAsync(new TranslationProviderNotConfiguredException("Google Translate"));

        var controller = CreateController(service.Object, Guid.NewGuid());

        var result = await controller.TranslateBatch(new BatchTranslationRequest
        {
            Words = new List<string> { "hello" },
            TargetLanguageCode = "FR"
        });

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task TranslateText_WhenTokenMissingUserId_ReturnsUnauthorized()
    {
        var service = new Mock<ITranslationService>();
        var controller = CreateController(service.Object, userId: null); // authenticated, but no NameIdentifier claim

        var result = await controller.TranslateText(new TranslationRequest
        {
            Text = "hello",
            SourceLanguageCode = "EN",
            TargetLanguageCode = "FR"
        });

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    [Fact]
    public async Task TranslateBatch_WhenTokenMissingUserId_ReturnsUnauthorized()
    {
        var service = new Mock<ITranslationService>();
        var controller = CreateController(service.Object, userId: null);

        var result = await controller.TranslateBatch(new BatchTranslationRequest
        {
            Words = new List<string> { "hello" },
            TargetLanguageCode = "FR"
        });

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
    }

    [Fact]
    public async Task TranslateText_Success_ReturnsTranslation()
    {
        var service = new Mock<ITranslationService>();
        service.Setup(s => s.TranslateTextAsync("hello", "EN", "FR")).ReturnsAsync("bonjour");

        var controller = CreateController(service.Object, Guid.NewGuid());

        var result = await controller.TranslateText(new TranslationRequest
        {
            Text = "hello",
            SourceLanguageCode = "EN",
            TargetLanguageCode = "FR"
        });

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<TranslationResponse>(ok.Value);
        Assert.Equal("bonjour", response.TranslatedText);
    }

    private static TranslationController CreateController(ITranslationService service, Guid? userId)
    {
        var factory = new Mock<IWordTranslationServiceFactory>();
        factory.Setup(f => f.GetServiceForUserAsync(It.IsAny<Guid>())).ReturnsAsync(service);

        var claims = userId.HasValue
            ? new[] { new Claim(ClaimTypes.NameIdentifier, userId.Value.ToString()) }
            : Array.Empty<Claim>();

        return new TranslationController(
            factory.Object,
            Mock.Of<ILanguageService>(),
            NullLogger<TranslationController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestAuth"))
                }
            }
        };
    }
}
