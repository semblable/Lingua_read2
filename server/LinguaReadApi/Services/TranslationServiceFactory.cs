using System;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using LinguaReadApi.Data;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Factory interface for getting the appropriate translation service based on user settings
    /// </summary>
    public interface ITranslationServiceFactory
    {
        Task<ISentenceTranslationService> GetServiceForUserAsync(Guid userId);
    }

    /// <summary>
    /// Factory that selects between Gemini and OpenRouter translation services based on user preferences
    /// </summary>
    public class TranslationServiceFactory : ITranslationServiceFactory
    {
        private readonly GeminiTranslationService _geminiService;
        private readonly OpenRouterTranslationService _openRouterService;
        private readonly AppDbContext _context;

        public TranslationServiceFactory(
            GeminiTranslationService geminiService,
            OpenRouterTranslationService openRouterService,
            AppDbContext context)
        {
            _geminiService = geminiService;
            _openRouterService = openRouterService;
            _context = context;
        }

        public async Task<ISentenceTranslationService> GetServiceForUserAsync(Guid userId)
        {
            var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);

            if (userSettings != null && 
                userSettings.UseOpenRouter && 
                !string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
            {
                return new OpenRouterServiceAdapter(_openRouterService, userId);
            }

            return _geminiService;
        }
    }

    /// <summary>
    /// Adapter to make OpenRouterTranslationService implement ISentenceTranslationService
    /// </summary>
    public class OpenRouterServiceAdapter : ISentenceTranslationService
    {
        private readonly OpenRouterTranslationService _service;
        private readonly Guid _userId;

        public OpenRouterServiceAdapter(OpenRouterTranslationService service, Guid userId)
        {
            _service = service;
            _userId = userId;
        }

        public Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return _service.TranslateSentenceAsync(text, sourceLanguage, targetLanguage, _userId);
        }

        public Task<string> TranslateFullTextAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return _service.TranslateFullTextAsync(text, sourceLanguage, targetLanguage, _userId);
        }

        public Task<string> ExplainSentenceAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return _service.ExplainSentenceAsync(text, sourceLanguage, targetLanguage, _userId);
        }
    }

    /// <summary>
    /// Factory interface for getting the appropriate story generation service based on user settings
    /// </summary>
    public interface IStoryGenerationServiceFactory
    {
        Task<IStoryGenerationService> GetServiceForUserAsync(Guid userId);
    }

    /// <summary>
    /// Factory that selects between Gemini and OpenRouter story generation services based on user preferences
    /// </summary>
    public class StoryGenerationServiceFactory : IStoryGenerationServiceFactory
    {
        private readonly GeminiStoryGenerationService _geminiService;
        private readonly OpenRouterStoryGenerationService _openRouterService;
        private readonly AppDbContext _context;

        public StoryGenerationServiceFactory(
            GeminiStoryGenerationService geminiService,
            OpenRouterStoryGenerationService openRouterService,
            AppDbContext context)
        {
            _geminiService = geminiService;
            _openRouterService = openRouterService;
            _context = context;
        }

        public async Task<IStoryGenerationService> GetServiceForUserAsync(Guid userId)
        {
            var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);

            if (userSettings != null && 
                userSettings.UseOpenRouter && 
                !string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
            {
                return new OpenRouterStoryServiceAdapter(_openRouterService, userId);
            }

            return _geminiService;
        }
    }

    /// <summary>
    /// Adapter to make OpenRouterStoryGenerationService implement IStoryGenerationService
    /// </summary>
    public class OpenRouterStoryServiceAdapter : IStoryGenerationService
    {
        private readonly OpenRouterStoryGenerationService _service;
        private readonly Guid _userId;

        public OpenRouterStoryServiceAdapter(OpenRouterStoryGenerationService service, Guid userId)
        {
            _service = service;
            _userId = userId;
        }

        public Task<string> GenerateStoryAsync(string prompt, string language, string level, int maxLength)
        {
            return _service.GenerateStoryAsync(prompt, language, level, maxLength, _userId);
        }
    }
}
