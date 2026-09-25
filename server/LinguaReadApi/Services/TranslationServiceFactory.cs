using System;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using LinguaReadApi.Data;
using LinguaReadApi.Services.Ai;

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
    /// Factory that selects between the built-in Gemini service and the user's AI provider
    /// (UserSettings.AiProvider) for sentence translation
    /// </summary>
    public class TranslationServiceFactory : ITranslationServiceFactory
    {
        private readonly GeminiTranslationService _geminiService;
        private readonly OpenAiCompatibleTranslationService _providerService;
        private readonly AppDbContext _context;

        public TranslationServiceFactory(
            GeminiTranslationService geminiService,
            OpenAiCompatibleTranslationService providerService,
            AppDbContext context)
        {
            _geminiService = geminiService;
            _providerService = providerService;
            _context = context;
        }

        public async Task<ISentenceTranslationService> GetServiceForUserAsync(Guid userId)
        {
            var connection = await AiProviderResolver.ResolveActiveAsync(_context, userId);
            return connection != null
                ? new ProviderTranslationServiceAdapter(_providerService, connection)
                : _geminiService;
        }
    }

    /// <summary>
    /// Adapter to make OpenAiCompatibleTranslationService implement ISentenceTranslationService
    /// </summary>
    public class ProviderTranslationServiceAdapter : ISentenceTranslationService
    {
        private readonly OpenAiCompatibleTranslationService _service;
        private readonly AiProviderConnection _connection;

        public ProviderTranslationServiceAdapter(OpenAiCompatibleTranslationService service, AiProviderConnection connection)
        {
            _service = service;
            _connection = connection;
        }

        public Task<string> TranslateSentenceAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return _service.TranslateSentenceAsync(text, sourceLanguage, targetLanguage, _connection);
        }

        public Task<string> TranslateFullTextAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return _service.TranslateFullTextAsync(text, sourceLanguage, targetLanguage, _connection);
        }

        public Task<string> ExplainSentenceAsync(string text, string sourceLanguage, string targetLanguage)
        {
            return _service.ExplainSentenceAsync(text, sourceLanguage, targetLanguage, _connection);
        }

        public Task<string> TranslateSelectionWithContextAsync(string selectedText, string sentenceContext, string sourceLanguage, string targetLanguage)
        {
            return _service.TranslateSelectionWithContextAsync(selectedText, sentenceContext, sourceLanguage, targetLanguage, _connection);
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

        /// <summary>
        /// Returns the Wiktionary service configured with the user's access token, for endpoints
        /// that need Wiktionary-specific behaviour (e.g. structured definitions) regardless of the
        /// user's selected provider.
        /// </summary>
        Task<WiktionaryTranslationService> GetWiktionaryServiceForUserAsync(Guid userId);
    }

    /// <summary>
    /// Selects between DeepL, Wiktionary, Azure Translator, and Google Translate for word lookups
    /// based on the user's <c>WordTranslationProvider</c> setting. Defaults to DeepL.
    /// </summary>
    public class WordTranslationServiceFactory : IWordTranslationServiceFactory
    {
        private readonly DeepLTranslationService _deepLService;
        private readonly WiktionaryTranslationService _wiktionaryService;
        private readonly AzureTranslationService _azureService;
        private readonly GoogleTranslationService _googleService;
        private readonly AppDbContext _context;

        public WordTranslationServiceFactory(
            DeepLTranslationService deepLService,
            WiktionaryTranslationService wiktionaryService,
            AzureTranslationService azureService,
            GoogleTranslationService googleService,
            AppDbContext context)
        {
            _deepLService = deepLService;
            _wiktionaryService = wiktionaryService;
            _azureService = azureService;
            _googleService = googleService;
            _context = context;
        }

        public async Task<ITranslationService> GetServiceForUserAsync(Guid userId)
        {
            var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);

            var provider = userSettings?.WordTranslationProvider?.Trim().ToLowerInvariant();
            switch (provider)
            {
                case "wiktionary":
                    _wiktionaryService.UseAccessToken(userSettings!.WiktionaryAccessToken);
                    return _wiktionaryService;
                case "azure":
                    _azureService.UseCredentials(userSettings!.AzureTranslatorKey, userSettings.AzureTranslatorRegion);
                    return _azureService;
                case "google":
                    _googleService.UseApiKey(userSettings!.GoogleTranslateApiKey);
                    return _googleService;
                default:
                    return _deepLService;
            }
        }

        public async Task<WiktionaryTranslationService> GetWiktionaryServiceForUserAsync(Guid userId)
        {
            var userSettings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
            _wiktionaryService.UseAccessToken(userSettings?.WiktionaryAccessToken);
            return _wiktionaryService;
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
    /// Factory that selects between the built-in Gemini service and the user's AI provider for story generation
    /// </summary>
    public class StoryGenerationServiceFactory : IStoryGenerationServiceFactory
    {
        private readonly GeminiStoryGenerationService _geminiService;
        private readonly OpenAiCompatibleStoryGenerationService _providerService;
        private readonly AppDbContext _context;

        public StoryGenerationServiceFactory(
            GeminiStoryGenerationService geminiService,
            OpenAiCompatibleStoryGenerationService providerService,
            AppDbContext context)
        {
            _geminiService = geminiService;
            _providerService = providerService;
            _context = context;
        }

        public async Task<IStoryGenerationService> GetServiceForUserAsync(Guid userId)
        {
            var connection = await AiProviderResolver.ResolveActiveAsync(_context, userId);
            return connection != null
                ? new ProviderStoryServiceAdapter(_providerService, connection)
                : _geminiService;
        }
    }

    /// <summary>
    /// Adapter to make OpenAiCompatibleStoryGenerationService implement IStoryGenerationService
    /// </summary>
    public class ProviderStoryServiceAdapter : IStoryGenerationService
    {
        private readonly OpenAiCompatibleStoryGenerationService _service;
        private readonly AiProviderConnection _connection;

        public ProviderStoryServiceAdapter(OpenAiCompatibleStoryGenerationService service, AiProviderConnection connection)
        {
            _service = service;
            _connection = connection;
        }

        public Task<string> GenerateStoryAsync(string prompt, int maxOutputTokens = 20000)
        {
            return _service.GenerateStoryAsync(prompt, maxOutputTokens, _connection);
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
    /// Factory that selects between the built-in Gemini service and the user's AI provider for summarization
    /// </summary>
    public class SummarizationServiceFactory : ISummarizationServiceFactory
    {
        private readonly GeminiSummarizationService _geminiService;
        private readonly OpenAiCompatibleSummarizationService _providerService;
        private readonly AppDbContext _context;

        public SummarizationServiceFactory(
            GeminiSummarizationService geminiService,
            OpenAiCompatibleSummarizationService providerService,
            AppDbContext context)
        {
            _geminiService = geminiService;
            _providerService = providerService;
            _context = context;
        }

        public async Task<ISummarizationService> GetServiceForUserAsync(Guid userId)
        {
            var connection = await AiProviderResolver.ResolveActiveAsync(_context, userId);
            return connection != null
                ? new ProviderSummarizationServiceAdapter(_providerService, connection)
                : _geminiService;
        }
    }

    /// <summary>
    /// Adapter to make OpenAiCompatibleSummarizationService implement ISummarizationService
    /// </summary>
    public class ProviderSummarizationServiceAdapter : ISummarizationService
    {
        private readonly OpenAiCompatibleSummarizationService _service;
        private readonly AiProviderConnection _connection;

        public ProviderSummarizationServiceAdapter(OpenAiCompatibleSummarizationService service, AiProviderConnection connection)
        {
            _service = service;
            _connection = connection;
        }

        public Task<string> SummarizeAsync(string text, string sourceLanguage, string targetLanguage, int maxSummaryWords = 200)
        {
            return _service.SummarizeAsync(text, sourceLanguage, targetLanguage, maxSummaryWords, _connection);
        }
    }
}
