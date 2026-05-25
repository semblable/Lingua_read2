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

    // --- Cloze-card support (Feature 1) ---

    private static void SeedCardWithPhrase(
        AppDbContext context, Guid userId, int wordId, string term, string sentence,
        string cardType = "translation")
    {
        if (!context.Languages.Any(l => l.LanguageId == 1))
            context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });

        context.Words.Add(new Word { WordId = wordId, UserId = userId, LanguageId = 1, Term = term, Status = 1 });
        context.SrsCardReviews.Add(new SrsCardReview
        {
            WordId = wordId, UserId = userId,
            NextReviewAt = DateTime.UtcNow.AddHours(-1),
            CreatedAt = DateTime.UtcNow.AddDays(-1)
        });
        context.SrsPhrases.Add(new SrsPhrase
        {
            WordId = wordId, UserId = userId, Sentence = sentence,
            TextTitle = "Test source", CreatedAt = DateTime.UtcNow
        });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId, SrsCardType = cardType,
            SrsMaxNewCards = 20, SrsMaxReviews = 200, SrsReviewOrder = "mix",
            SrsLearningStepMinutes = "1,10"
        });
        context.SaveChanges();
    }

    [Fact]
    public void BuildClozeSentence_MasksFirstOccurrence_PreservingSurroundingText()
    {
        var masked = SrsController.BuildClozeSentence("The cat sat on the mat.", "cat");
        Assert.Equal("The ___ sat on the mat.", masked);
    }

    [Fact]
    public void BuildClozeSentence_MaskingIsCaseInsensitive()
    {
        var masked = SrsController.BuildClozeSentence("Cat sat.", "cat");
        Assert.Equal("___ sat.", masked);
    }

    [Fact]
    public void BuildClozeSentence_MasksOnlyFirstOccurrence()
    {
        // Second "cat" stays visible — gives the learner one cue from context.
        var masked = SrsController.BuildClozeSentence("A cat is a cat.", "cat");
        Assert.Equal("A ___ is a cat.", masked);
    }

    [Fact]
    public void BuildClozeSentence_ReturnsNull_WhenTermAbsent()
    {
        var masked = SrsController.BuildClozeSentence("The dog ran.", "cat");
        Assert.Null(masked);
    }

    [Fact]
    public void BuildClozeSentence_ReturnsNull_OnEmptyInputs()
    {
        Assert.Null(SrsController.BuildClozeSentence(null, "cat"));
        Assert.Null(SrsController.BuildClozeSentence("", "cat"));
        Assert.Null(SrsController.BuildClozeSentence("Some sentence.", null));
        Assert.Null(SrsController.BuildClozeSentence("Some sentence.", ""));
    }

    [Fact]
    public void NormalizeCardType_AcceptsTranslationClozeAndMixed()
    {
        Assert.Equal("translation", SrsController.NormalizeCardType("translation"));
        Assert.Equal("cloze", SrsController.NormalizeCardType("cloze"));
        Assert.Equal("mixed", SrsController.NormalizeCardType("mixed"));
        Assert.Equal("cloze", SrsController.NormalizeCardType("  CLOZE  "));
    }

    [Fact]
    public void NormalizeCardType_FallsBackToTranslation_ForUnknownOrEmpty()
    {
        Assert.Equal("translation", SrsController.NormalizeCardType(null));
        Assert.Equal("translation", SrsController.NormalizeCardType(""));
        Assert.Equal("translation", SrsController.NormalizeCardType("nonsense"));
    }

    [Fact]
    public async Task GetDueCards_WithClozeSetting_ReturnsClozeSentence()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedCardWithPhrase(context, userId, 100, "cat", "The cat sat on the mat.", cardType: "cloze");

        var controller = CreateController(context, userId);
        var result = await controller.GetDueCards();

        var cards = result.Value ?? Assert.IsType<List<SrsDueCardDto>>(((OkObjectResult)result.Result!).Value);
        var card = Assert.Single(cards);
        Assert.Equal("The ___ sat on the mat.", card.ClozeSentence);
        Assert.Equal("cat", card.Term);
    }

    [Fact]
    public async Task GetDueCards_WithMixedSetting_ReturnsClozeSentenceForAllCards()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedCardWithPhrase(context, userId, 200, "perro", "Mi perro corre.", cardType: "mixed");

        var controller = CreateController(context, userId);
        var result = await controller.GetDueCards();

        var cards = result.Value ?? Assert.IsType<List<SrsDueCardDto>>(((OkObjectResult)result.Result!).Value);
        var card = Assert.Single(cards);
        // Client decides per-card whether to render translation or cloze, so the server
        // always populates ClozeSentence in mixed mode.
        Assert.Equal("Mi ___ corre.", card.ClozeSentence);
    }

    [Fact]
    public async Task GetDueCards_WithTranslationSetting_ClozeSentenceIsNull()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedCardWithPhrase(context, userId, 300, "gato", "El gato duerme.", cardType: "translation");

        var controller = CreateController(context, userId);
        var result = await controller.GetDueCards();

        var cards = result.Value ?? Assert.IsType<List<SrsDueCardDto>>(((OkObjectResult)result.Result!).Value);
        var card = Assert.Single(cards);
        Assert.Null(card.ClozeSentence);
        // Existing fields still populated — default behavior preserved.
        Assert.Equal("gato", card.Term);
    }

    [Fact]
    public async Task GetDueCards_WithClozeSetting_FallsBackWhenTermAbsentFromPhrase()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedCardWithPhrase(context, userId, 400, "gato", "El perro corre.", cardType: "cloze");

        var controller = CreateController(context, userId);
        var result = await controller.GetDueCards();

        var cards = result.Value ?? Assert.IsType<List<SrsDueCardDto>>(((OkObjectResult)result.Result!).Value);
        var card = Assert.Single(cards);
        // No matching surface form in the phrase → cloze unavailable; client should
        // fall back to translation rendering for this card.
        Assert.Null(card.ClozeSentence);
        Assert.Equal("gato", card.Term);
    }
}
