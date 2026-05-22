using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class UsersControllerTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()) // Unique DB per test
            .Options;
        return new AppDbContext(options);
    }

    private static UsersController CreateController(AppDbContext context, Guid userId)
    {
        return new UsersController(context, NullLogger<UsersController>.Instance)
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
    }

    [Fact]
    public async Task GetUserStatistics_ExcludesIgnoredWords_FromTotalAndLearningCounts()
    {
        using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "tester", Email = "tester@example.com" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });

        // 1 new, 1 learning, 2 known, 2 ignored. Ignored words (Status 6) must count
        // toward neither TotalWords nor the derived LearningWords.
        context.Words.AddRange(
            new Word { WordId = 1, UserId = userId, LanguageId = 1, Term = "nuevo", Status = 1 },
            new Word { WordId = 2, UserId = userId, LanguageId = 1, Term = "aprendiendo", Status = 2 },
            new Word { WordId = 3, UserId = userId, LanguageId = 1, Term = "avanzado", Status = 4 },
            new Word { WordId = 4, UserId = userId, LanguageId = 1, Term = "conocido", Status = 5 },
            new Word { WordId = 5, UserId = userId, LanguageId = 1, Term = "ignorado1", Status = 6 },
            new Word { WordId = 6, UserId = userId, LanguageId = 1, Term = "ignorado2", Status = 6 });
        context.SaveChanges();

        var controller = CreateController(context, userId);
        var result = await controller.GetUserStatistics();

        var dto = result.Value;
        Assert.NotNull(dto);
        // 6 words seeded, 2 ignored -> 4 counted; known = statuses 4-5; learning = the rest.
        Assert.Equal(4, dto!.TotalWords);
        Assert.Equal(2, dto.KnownWords);
        Assert.Equal(2, dto.LearningWords);

        var lang = Assert.Single(dto.LanguageStatistics);
        Assert.Equal(4, lang.WordCount);
        Assert.Equal(2, lang.KnownWords);
        Assert.Equal(2, lang.LearningWords);
    }
}
