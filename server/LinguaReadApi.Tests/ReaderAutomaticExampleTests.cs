using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.Srs;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class ReaderAutomaticExampleTests
{
    private static (AppDbContext db, WordsController controller, Guid userId) Setup(string autoCreate = "always")
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var userId = Guid.NewGuid();
        db.Users.Add(new User { Id = userId, UserName = "reader", Email = "reader@example.com" });
        db.Languages.Add(new Language { LanguageId = 1, Code = "es", Name = "Spanish" });
        db.Texts.Add(new Text { TextId = 7, UserId = userId, LanguageId = 1, Title = "First source", Content = "El gato duerme." });
        db.Texts.Add(new Text { TextId = 8, UserId = userId, LanguageId = 1, Title = "Next source", Content = "Otro gato salta." });
        db.Words.Add(new Word { WordId = 41, UserId = userId, LanguageId = 1, Term = "gato", Status = 0 });
        db.UserSettings.Add(new UserSettings { UserId = userId, SrsAutoCreateCards = autoCreate });
        db.SaveChanges();
        var controller = new WordsController(db, NullLogger<WordsController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "test"))
            } }
        };
        return (db, controller, userId);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public async Task ExistingWord_FirstLearningSaveCapturesSentenceAndOwnedSource(int status)
    {
        var (db, controller, userId) = Setup();
        using (db)
        {
            var result = await controller.UpdateWord(41, new UpdateWordDto
            { Status = status, Translation = "cat", TextId = 7, Sentence = "El gato duerme." });
            Assert.IsType<NoContentResult>(result);
            var example = await db.SrsPhrases.SingleAsync();
            Assert.Equal((41, userId, 7, "First source", "El gato duerme."),
                (example.WordId, example.UserId, example.TextId!.Value, example.TextTitle, example.Sentence));
            Assert.Single(db.SrsCardReviews);
        }
    }

    [Fact]
    public async Task RepeatedAndLaterSavesKeepFirstExampleAndExistingSchedule()
    {
        var (db, controller, _) = Setup();
        using (db)
        {
            await controller.UpdateWord(41, new UpdateWordDto { Status = 1, TextId = 7, Sentence = "El gato duerme." });
            var card = await db.SrsCardReviews.SingleAsync();
            var due = DateTime.UtcNow.AddDays(17);
            card.NextReviewAt = due;
            card.Repetitions = 9;
            await db.SaveChangesAsync();
            await controller.UpdateWord(41, new UpdateWordDto { Status = 2, TextId = 7, Sentence = "El gato duerme." });
            await controller.UpdateWord(41, new UpdateWordDto { Status = 3, TextId = 8, Sentence = "Otro gato salta." });
            await controller.CreateWord(new CreateWordDto
            { TextId = 8, Term = "Gato", Status = 4, Sentence = "Otro gato salta.", ReplaceExisting = true });
            Assert.Equal("El gato duerme.", (await db.SrsPhrases.SingleAsync()).Sentence);
            Assert.Equal(7, (await db.SrsPhrases.SingleAsync()).TextId);
            var after = await db.SrsCardReviews.SingleAsync();
            Assert.Equal(card.SrsCardReviewId, after.SrsCardReviewId);
            Assert.Equal(due, after.NextReviewAt);
            Assert.Equal(9, after.Repetitions);
        }
    }

    [Theory]
    [InlineData("always", true)]
    [InlineData("with_sentence", true)]
    [InlineData("never", false)]
    public async Task AutomaticExampleRespectsCardPreference(string preference, bool createsCard)
    {
        var (db, controller, _) = Setup(preference);
        using (db)
        {
            await controller.UpdateWord(41, new UpdateWordDto { Status = 2, TextId = 7, Sentence = "El gato duerme." });
            Assert.Single(db.SrsPhrases);
            Assert.Equal(createsCard ? 1 : 0, await db.SrsCardReviews.CountAsync());
        }
    }

    [Theory]
    [InlineData(5)]
    [InlineData(6)]
    public async Task KnownAndIgnoredSavesCreateNeitherCardsNorExamples(int status)
    {
        var (db, controller, _) = Setup();
        using (db)
        {
            await controller.UpdateWord(41, new UpdateWordDto { Status = status, TextId = 7, Sentence = "El gato duerme." });
            await controller.CreateWord(new CreateWordDto { TextId = 7, Term = "duerme", Status = status, Sentence = "El gato duerme." });
            Assert.Empty(db.SrsPhrases);
            Assert.Empty(db.SrsCardReviews);
        }
    }

    [Fact]
    public async Task NewWordLearningSaveCapturesExampleWithoutMineAction()
    {
        var (db, controller, _) = Setup("with_sentence");
        using (db)
        {
            await controller.CreateWord(new CreateWordDto { TextId = 7, Term = "duerme", Status = 1, Sentence = "El gato duerme." });
            Assert.Equal("El gato duerme.", (await db.SrsPhrases.SingleAsync()).Sentence);
            Assert.Single(db.SrsCardReviews);
        }
    }

    [Theory]
    [InlineData("not in this sentence")]
    [InlineData("Un gatote duerme.")]
    [InlineData("   ")]
    public async Task MissingOrUnrelatedExampleDoesNotPreventWordSaveOrCreateSentenceOnlyCard(string sentence)
    {
        var (db, controller, _) = Setup("with_sentence");
        using (db)
        {
            Assert.IsType<NoContentResult>(await controller.UpdateWord(41,
                new UpdateWordDto { Status = 2, TextId = 7, Sentence = sentence }));
            Assert.Equal(2, (await db.Words.SingleAsync()).Status);
            Assert.Empty(db.SrsPhrases);
            Assert.Empty(db.SrsCardReviews);
        }
    }

    [Fact]
    public async Task ExampleCannotReferenceSomeoneElsesSourceOrAnotherLanguage()
    {
        var (db, controller, _) = Setup();
        using (db)
        {
            db.Texts.Add(new Text { TextId = 9, UserId = Guid.NewGuid(), LanguageId = 1, Title = "Private", Content = "El gato duerme." });
            db.Languages.Add(new Language { LanguageId = 2, Code = "fr", Name = "French" });
            db.Texts.Add(new Text { TextId = 10, UserId = (await db.Words.SingleAsync()).UserId, LanguageId = 2, Title = "French", Content = "El gato duerme." });
            await db.SaveChangesAsync();
            Assert.IsType<NotFoundObjectResult>(await controller.UpdateWord(41,
                new UpdateWordDto { Status = 2, TextId = 9, Sentence = "El gato duerme." }));
            Assert.IsType<BadRequestObjectResult>(await controller.UpdateWord(41,
                new UpdateWordDto { Status = 2, TextId = 10, Sentence = "El gato duerme." }));
            Assert.IsType<BadRequestObjectResult>(await controller.UpdateWord(41,
                new UpdateWordDto { Status = 2, Sentence = "El gato duerme." }));
            Assert.Equal(0, (await db.Words.SingleAsync()).Status);
            Assert.Empty(db.SrsPhrases);
        }
    }

    [Theory]
    [InlineData("fr", "l'eau", "Il boit l’eau.")]
    [InlineData("pt", "reparava", "Ele repa\u00ADrava no dono.")]
    [InlineData("tr", "ıslak", "ISLAK kedi.")]
    [InlineData("ar", "بيت", "هَذَا بَيْتٌ جَدِيدٌ.")]
    [InlineData("zh", "猫", "这只猫睡着了。")]
    [InlineData("es", "no es", "Esto no es fácil.")]
    public void ExamplesMatchReaderNormalization(string code, string term, string sentence)
    {
        Assert.True(SrsMinedSentences.ContainsTerm(sentence, term, new Language { Code = code }));
    }
}
