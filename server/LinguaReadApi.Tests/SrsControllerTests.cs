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

    private static SrsController CreateController(AppDbContext context, Guid userId, IStoryGenerationServiceFactory factory = null)
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
        Assert.Empty(response.TargetWords);
        Assert.Equal("", response.Story);
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_CallsAiServiceAndParsesOutput()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        int languageId = 1;
        SeedData(context, userId, languageId);

        var mockService = new Mock<IStoryGenerationService>();
        mockService.Setup(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()))
                   .ReturnsAsync("El gato y el perro. USED_WORDS: gato, perro");

        var mockFactory = new Mock<IStoryGenerationServiceFactory>();
        mockFactory.Setup(f => f.GetServiceForUserAsync(userId)).ReturnsAsync(mockService.Object);

        var controller = CreateController(context, userId, mockFactory.Object);

        var request = new SrsStoryGenerateRequest 
        { 
            LanguageId = languageId, 
            MaxWords = 5,
            MaxLength = 100
        };
        
        var result = await controller.GenerateStoryFromDueWords(request);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<SrsStoryGenerateResponse>(okResult.Value);
        
        Assert.Equal("El gato y el perro.", response.Story);
        Assert.Equal(2, response.TargetWords.Count);
        Assert.Contains("gato", response.UsedWords);
        Assert.Contains("perro", response.UsedWords);
    }

    [Fact]
    public async Task GenerateStoryFromDueWords_UsesFallbackParsing_WhenDelimiterMissing()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        int languageId = 1;
        SeedData(context, userId, languageId);

        var mockService = new Mock<IStoryGenerationService>();
        mockService.Setup(s => s.GenerateStoryAsync(It.IsAny<string>(), It.IsAny<int>()))
                   .ReturnsAsync("El gato corre por el parque.");

        var mockFactory = new Mock<IStoryGenerationServiceFactory>();
        mockFactory.Setup(f => f.GetServiceForUserAsync(userId)).ReturnsAsync(mockService.Object);

        var controller = CreateController(context, userId, mockFactory.Object);

        var request = new SrsStoryGenerateRequest { LanguageId = languageId };
        var result = await controller.GenerateStoryFromDueWords(request);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<SrsStoryGenerateResponse>(okResult.Value);

        Assert.Equal("El gato corre por el parque.", response.Story);
        Assert.Equal(1, response.UsedWords.Count); // Fallback scans story text - only "gato" appears
        Assert.Contains("gato", response.UsedWords);
    }
}
