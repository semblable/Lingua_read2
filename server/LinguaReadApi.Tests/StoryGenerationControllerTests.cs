using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LinguaReadApi.Tests;

public class StoryGenerationControllerTests
{
    [Theory]
    [InlineData("deepseek")]
    [InlineData("google")]
    public async Task GenerateStory_UsesTheSavedCustomPrompt(string provider)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        context.UserSettings.Add(new UserSettings
        {
            UserId = userId,
            AiProvider = provider,
            CustomStoryPrompt = "CUSTOM {level} {language} {prompt} {maxLength}",
            CreatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var fakeService = new FakeStoryGenerationService();
        var controller = CreateController(context, userId, new FakeStoryFactory(fakeService));

        await controller.GenerateStory(new StoryGenerationRequest
        {
            Prompt = "a robot dog",
            Language = "Spanish",
            Level = "beginner",
            MaxLength = 300
        });

        Assert.Equal("CUSTOM beginner Spanish a robot dog 300", fakeService.LastPrompt);
    }

    [Fact]
    public async Task GenerateStory_MissingProviderSetup_ReturnsBadRequest()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var factory = new Mock<IStoryGenerationServiceFactory>();
        factory.Setup(f => f.GetServiceForUserAsync(userId))
            .ThrowsAsync(new TranslationProviderNotConfiguredException("Google Gemini", "Add a key in Settings."));
        var controller = CreateController(context, userId, factory.Object);

        var result = await controller.GenerateStory(new StoryGenerationRequest
        {
            Prompt = "a robot dog",
            Language = "Spanish"
        });

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("Add a key in Settings.", System.Text.Json.JsonSerializer.Serialize(badRequest.Value));
    }

    [Fact]
    public async Task GenerateStory_UsesDefaultPrompt_WhenNoUserSettingsRowExists()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        context.Users.Add(new User { Id = userId, UserName = "u", Email = "u@test.com" });
        await context.SaveChangesAsync();

        var fakeService = new FakeStoryGenerationService();
        var controller = CreateController(context, userId, new FakeStoryFactory(fakeService));

        await controller.GenerateStory(new StoryGenerationRequest
        {
            Prompt = "a tiny island",
            Language = "Italian",
            Level = "intermediate",
            MaxLength = 500
        });

        Assert.NotNull(fakeService.LastPrompt);
        Assert.Contains("Write a intermediate level story in Italian", fakeService.LastPrompt);
    }

    private static StoryGenerationController CreateController(
        AppDbContext context,
        Guid userId,
        IStoryGenerationServiceFactory factory)
    {
        return new StoryGenerationController(
            factory,
            context,
            NullLogger<StoryGenerationController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                    [
                        new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                    ], "TestAuth"))
                }
            }
        };
    }

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private sealed class FakeStoryFactory : IStoryGenerationServiceFactory
    {
        private readonly IStoryGenerationService _service;
        public FakeStoryFactory(IStoryGenerationService service) => _service = service;

        public Task<IStoryGenerationService> GetServiceForUserAsync(Guid userId) =>
            Task.FromResult(_service);
    }

    private sealed class FakeStoryGenerationService : IStoryGenerationService
    {
        public string? LastPrompt { get; private set; }

        public Task<string> GenerateStoryAsync(string prompt, int maxOutputTokens = 20000)
        {
            LastPrompt = prompt;
            return Task.FromResult("generated");
        }
    }
}
