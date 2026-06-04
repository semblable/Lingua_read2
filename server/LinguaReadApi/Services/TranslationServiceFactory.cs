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

        public Task<string> TranslateSelectionWithContextAsync(string selectedText, string sentenceContext, string sourceLanguage, string targetLanguage)
        {
            return _service.TranslateSelectionWithContextAsync(selectedText, sentenceContext, sourceLanguage, targetLanguage, _userId);
        }
    }

    /// <summary>
    /// Factory interface for getting the appropriate word-level translation service based on
    /// user settings (DeepL vs Wiktionary). Returns the shared <see cref="ITranslationService"/>
    /// contract so callers stay provider-agnostic.
    /// </summary>
    public interface IWordTranslationServiceFactory
    {
        Task<ITranslationService> GetServiceForUserAsync(Guid userId);
    }

    /// <summary>
    /// Selects between DeepL and Wiktionary for word lookups based on the user's
    /// <c>WordTranslationProvider</c> setting. Defaults to DeepL.
    /// </summary>
    public class WordTranslationServiceFactory : IWordTranslationServiceFactory
    {
        private readonly DeepLTranslationService _deepLService;
        private readonly WiktionaryTranslationService _wiktionaryService;
        private readonly AppDbContext _context;

        public WordTranslationServiceFactory(
            DeepLTranslationService deepLService,
            WiktionaryTranslationService wiktionaryService,
            AppDbContext context)
        {
            _deepLService = deepLService;
            _wiktionaryService = wiktionaryService;
            _context = context;
        }

        public async Task<ITranslationService> GetServiceForUserAsync(Guid userId)
        {
            var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);

            if (userSettings != null &&
                string.Equals(userSettings.WordTranslationProvider, "wiktionary", StringComparison.OrdinalIgnoreCase))
            {
                return _wiktionaryService;
            }

            return _deepLService;
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

        public Task<string> GenerateStoryAsync(string prompt, int maxOutputTokens = 20000)
        {
            return _service.GenerateStoryAsync(prompt, maxOutputTokens, _userId);
        }
    }

    /// <summary>
    /// Factory interface for getting the appropriate summarization service based on user settings
    /// </summary>
    public interface ISummarizationServiceFactory
    {
        Task<ISummarizationService> GetServiceForUserAsync(Guid userId);
    }

    /// <summary>
    /// Factory that selects between Gemini and OpenRouter summarization services based on user preferences
    /// </summary>
    public class SummarizationServiceFactory : ISummarizationServiceFactory
    {
        private readonly GeminiSummarizationService _geminiService;
        private readonly OpenRouterSummarizationService _openRouterService;
        private readonly AppDbContext _context;

        public SummarizationServiceFactory(
            GeminiSummarizationService geminiService,
            OpenRouterSummarizationService openRouterService,
            AppDbContext context)
        {
            _geminiService = geminiService;
            _openRouterService = openRouterService;
            _context = context;
        }

        public async Task<ISummarizationService> GetServiceForUserAsync(Guid userId)
        {
            var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);

            if (userSettings != null &&
                userSettings.UseOpenRouter &&
                !string.IsNullOrWhiteSpace(userSettings.OpenRouterApiKey))
            {
                return new OpenRouterSummarizationServiceAdapter(_openRouterService, userId);
            }

            return _geminiService;
        }
    }

    /// <summary>
    /// Adapter to make OpenRouterSummarizationService implement ISummarizationService
    /// </summary>
    public class OpenRouterSummarizationServiceAdapter : ISummarizationService
    {
        private readonly OpenRouterSummarizationService _service;
        private readonly Guid _userId;

        public OpenRouterSummarizationServiceAdapter(OpenRouterSummarizationService service, Guid userId)
        {
            _service = service;
            _userId = userId;
        }

        public Task<string> SummarizeAsync(string text, string sourceLanguage, string targetLanguage, int maxSummaryWords = 200)
        {
            return _service.SummarizeAsync(text, sourceLanguage, targetLanguage, maxSummaryWords, _userId);
        }
    }
}
