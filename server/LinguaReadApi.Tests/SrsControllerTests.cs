using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

public class SrsControllerTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(DateTime.Now.Ticks.ToString()) // Unique DB per test
            .Options;
        return new AppDbContext(options);
    }

    private static SrsController CreateController(AppDbContext context, Guid userId, IStoryGenerationServiceFactory? factory = null)
    {
        var controller = new SrsController(context, factory ?? Mock.Of<IStoryGenerationServiceFactory>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                    }, "TestAuth"))
                }
            }
        };
        return controller;
    }

    private static void SeedData(AppDbContext context, Guid userId, int languageId)
    {
        var lang = new Language { LanguageId = languageId, Name = "Spanish", Code = "ES" };
        context.Languages.Add(lang);

        var word1 = new Word { WordId = 1, UserId = userId, LanguageId = languageId, Term = "gato", Status = 1 };
        var word2 = new Word { WordId = 2, UserId = userId, LanguageId = languageId, Term = "perro", Status = 2 };
        context.Words.AddRange(word1, word2);

        var card1 = new SrsCardReview { WordId = 1, UserId = userId, NextReviewAt = DateTime.UtcNow.AddHours(-1), CreatedAt = DateTime.UtcNow };
        var card2 = new SrsCardReview { WordId = 2, UserId = userId, NextReviewAt = DateTime.UtcNow.AddHours(-1), CreatedAt = DateTime.UtcNow };
        context.SrsCardReviews.AddRange(card1, card2);

        context.SaveChanges();
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_ReturnsEmpty_WhenNoDueWords()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        var controller = CreateController(context, userId);

        var request = new SrsStoryGenerateRequest { LanguageId = 1, MaxWords = 10 };
        var result = await controller.GenerateStoryFromDueWords(request);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<SrsStoryGenerateResponse>(okResult.Value);
        Assert.Empty(response.MicroContexts);
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_CallsAiServiceAndParsesJsonOutput()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        int languageId = 1;
        SeedData(context, userId, languageId);

        var mockService = new Mock<IStoryGenerationService>();
        mockService.Setup(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()))
                   .ReturnsAsync(@"[
  {""term"": ""gato"", ""context"": ""El gato duerme en el sofá. Está muy tranquilo.""},
  {""term"": ""perro"", ""context"": ""Mi perro corre por el parque.""}
]");

        var mockFactory = new Mock<IStoryGenerationServiceFactory>();
        mockFactory.Setup(f => f.GetServiceForUserAsync(userId)).ReturnsAsync(mockService.Object);

        var controller = CreateController(context, userId, mockFactory.Object);

        var request = new SrsStoryGenerateRequest { LanguageId = languageId, MaxWords = 5 };
        var result = await controller.GenerateStoryFromDueWords(request);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<SrsStoryGenerateResponse>(okResult.Value);

        Assert.Equal(2, response.MicroContexts.Count);
        Assert.Contains(response.MicroContexts, m => m.Term == "gato" && m.Context.StartsWith("El gato"));
        Assert.Contains(response.MicroContexts, m => m.Term == "perro" && m.Context.Contains("parque"));
        Assert.NotEqual(0, response.TextId);
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_FiltersUnmatchedTerms()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        int languageId = 1;
        SeedData(context, userId, languageId);

        // AI returns one matching term and one stray term not in the deck
        var mockService = new Mock<IStoryGenerationService>();
        mockService.Setup(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()))
                   .ReturnsAsync(@"[
  {""term"": ""gato"", ""context"": ""El gato corre.""},
  {""term"": ""elefante"", ""context"": ""El elefante es grande.""}
]");

        var mockFactory = new Mock<IStoryGenerationServiceFactory>();
        mockFactory.Setup(f => f.GetServiceForUserAsync(userId)).ReturnsAsync(mockService.Object);

        var controller = CreateController(context, userId, mockFactory.Object);

        var request = new SrsStoryGenerateRequest { LanguageId = languageId };
        var result = await controller.GenerateStoryFromDueWords(request);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<SrsStoryGenerateResponse>(okResult.Value);

        Assert.Single(response.MicroContexts);
        Assert.Equal("gato", response.MicroContexts[0].Term);
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_PropagatesUsedFormAndFallsBackToTerm()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        int languageId = 1;
        SeedData(context, userId, languageId);

        // First entry supplies usedForm; second omits it (controller should fall back to term).
        var mockService = new Mock<IStoryGenerationService>();
        mockService.Setup(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()))
                   .ReturnsAsync(@"[
  {""term"": ""gato"", ""usedForm"": ""gatos"", ""context"": ""Los gatos duermen mucho.""},
  {""term"": ""perro"", ""context"": ""El perro corre.""}
]");

        var mockFactory = new Mock<IStoryGenerationServiceFactory>();
        mockFactory.Setup(f => f.GetServiceForUserAsync(userId)).ReturnsAsync(mockService.Object);

        var controller = CreateController(context, userId, mockFactory.Object);

        var request = new SrsStoryGenerateRequest { LanguageId = languageId };
        var result = await controller.GenerateStoryFromDueWords(request);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<SrsStoryGenerateResponse>(okResult.Value);

        Assert.Equal(2, response.MicroContexts.Count);
        var gatoEntry = response.MicroContexts.Single(m => m.Term == "gato");
        var perroEntry = response.MicroContexts.Single(m => m.Term == "perro");
        Assert.Equal("gatos", gatoEntry.UsedForm);
        Assert.Equal("perro", perroEntry.UsedForm);
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_MalformedJson_ReturnsEmptyMicroContexts()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        int languageId = 1;
        SeedData(context, userId, languageId);

        var mockService = new Mock<IStoryGenerationService>();
        mockService.Setup(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()))
                   .ReturnsAsync("Sorry, I can't help with that.");

        var mockFactory = new Mock<IStoryGenerationServiceFactory>();
        mockFactory.Setup(f => f.GetServiceForUserAsync(userId)).ReturnsAsync(mockService.Object);

        var controller = CreateController(context, userId, mockFactory.Object);

        var request = new SrsStoryGenerateRequest { LanguageId = languageId };
        var result = await controller.GenerateStoryFromDueWords(request);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<SrsStoryGenerateResponse>(okResult.Value);

        Assert.Empty(response.MicroContexts);
    }

    [Fact]
    public async Task MineSentence_ForIgnoredWord_DoesNotCreateSrsCard()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
        // An ignored word (Status 6) with no SRS card.
        context.Words.Add(new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "gato", Status = 6 });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        var result = await controller.MineSentence(new SrsMineDto
        {
            WordId = 1,
            Sentence = "El gato duerme."
        });

        Assert.IsType<OkObjectResult>(result);
        // The mined phrase is still saved, but an ignored word must never enter the review queue.
        Assert.Single(context.SrsPhrases.Where(p => p.WordId == 1));
        Assert.Empty(context.SrsCardReviews.Where(c => c.WordId == 1));
    }
}
