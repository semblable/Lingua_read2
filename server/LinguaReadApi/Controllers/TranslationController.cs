using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Threading.Tasks;
using LinguaReadApi.Services;
using System.Text.Json.Serialization;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class TranslationController : ControllerBase
    {
        private readonly IWordTranslationServiceFactory _translationServiceFactory;
        private readonly ILanguageService _languageService; // Inject LanguageService
        private readonly ILogger<TranslationController> _logger;

        public TranslationController(
            IWordTranslationServiceFactory translationServiceFactory,
            ILanguageService languageService,
            ILogger<TranslationController> logger)
        {
            _translationServiceFactory = translationServiceFactory;
            _languageService = languageService; // Assign injected service
            _logger = logger;
        }

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                throw new UnauthorizedAccessException("User ID not found in token");
            }
            return userId;
        }

        // The Wiktionary provider surfaces a persistent upstream 429 as this exception; map it
        // to HTTP 429 so the reader shows its existing "rate limit reached" message.
        private ObjectResult RateLimitResult() =>
            StatusCode(StatusCodes.Status429TooManyRequests,
                new { message = "Wiktionary rate limit reached. Try again in a few seconds." });

        /// <summary>
        /// Translates text from one language to another
        /// </summary>
        /// <param name="request">The translation request containing text and language codes</param>
        /// <returns>The translated text</returns>
        [HttpPost]
        public async Task<ActionResult<TranslationResponse>> TranslateText([FromBody] TranslationRequest request)
        {
            if (string.IsNullOrEmpty(request.Text))
            {
                return BadRequest("Text to translate cannot be empty");
            }

            if (string.IsNullOrEmpty(request.SourceLanguageCode))
            {
                return BadRequest("Source language code cannot be empty");
            }

            if (string.IsNullOrEmpty(request.TargetLanguageCode))
            {
                return BadRequest("Target language code cannot be empty");
            }

            try
            {
                var translationService = await _translationServiceFactory.GetServiceForUserAsync(GetUserId());
                var translatedText = await translationService.TranslateTextAsync(
                    request.Text,
                    request.SourceLanguageCode,
                    request.TargetLanguageCode);

                return Ok(new TranslationResponse
                {
                    OriginalText = request.Text,
                    TranslatedText = translatedText,
                    SourceLanguageCode = request.SourceLanguageCode,
                    TargetLanguageCode = request.TargetLanguageCode
                });
            }
            catch (WiktionaryRateLimitException)
            {
                return RateLimitResult();
            }
            catch (Exception ex)
            {
                return StatusCode(500, $"Translation failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Gets the list of supported languages
        /// </summary>
        /// <returns>List of language codes and names</returns>
        [HttpGet("languages")]
        public async Task<ActionResult<IEnumerable<LanguageInfo>>> GetSupportedLanguages()
        {
            // Fetch languages marked as active for translation from the service
            var activeLanguages = await _languageService.GetLanguagesForTranslationAsync();

            // Map the Language entities to LanguageInfo DTOs
            var languageInfos = activeLanguages.Select(lang => new LanguageInfo
            {
                // Ensure case consistency if needed (e.g., DeepL might expect uppercase)
                Code = lang.Code.ToUpperInvariant(),
                Name = lang.Name
            }).ToList();

            return Ok(languageInfos);
        }

        /// <summary>
        /// Translates a batch of words using DeepL.
        /// </summary>
        /// <param name="request">The batch translation request containing words and language codes.</param>
        /// <returns>A dictionary mapping original words to their translations.</returns>
        [HttpPost("batch")] // Added route segment "batch"
        public async Task<ActionResult<Dictionary<string, string>>> TranslateBatch([FromBody] BatchTranslationRequest request)

        {
            if (request.Words == null || request.Words.Count == 0)
            {
                return BadRequest("Word list cannot be empty.");
            }
            if (string.IsNullOrEmpty(request.TargetLanguageCode))
            {
                return BadRequest("Target language code cannot be empty.");
            }

            var translationService = await _translationServiceFactory.GetServiceForUserAsync(GetUserId());
            try
            {
                var translations = await translationService.TranslateBatchAsync(
                    request.Words,
                    request.TargetLanguageCode,
                    request.SourceLanguageCode);
                return Ok(translations);
            }
            catch (WiktionaryRateLimitException)
            {
                return RateLimitResult();
            }
        }

        /// <summary>
        /// Returns structured Wiktionary definitions (part of speech + senses) for the optional
        /// rich display. Only meaningful when the user's word translation provider is Wiktionary;
        /// the frontend calls this only in that case.
        /// </summary>
        [HttpGet("define")]
        public async Task<ActionResult<WordDefinitionResponse>> Define([FromQuery] string term, [FromQuery] string? sourceLanguageCode)
        {
            if (string.IsNullOrWhiteSpace(term))
            {
                return BadRequest("Term cannot be empty.");
            }

            try
            {
                var wiktionaryService = await _translationServiceFactory.GetWiktionaryServiceForUserAsync(GetUserId());
                var entries = await wiktionaryService.GetDefinitionsAsync(term, sourceLanguageCode);

                return Ok(new WordDefinitionResponse
                {
                    Term = term,
                    SourceLanguageCode = sourceLanguageCode ?? string.Empty,
                    Entries = entries.Select(e => new WordDefinitionEntryDto
                    {
                        PartOfSpeech = e.PartOfSpeech,
                        Senses = e.Senses.Select(s => s.Definition).ToList()
                    }).ToList()
                });
            }
            catch (WiktionaryRateLimitException)
            {
                return RateLimitResult();
            }
        }
    } // End of Controller class

    // Add the new Request DTO below the existing ones
    public class BatchTranslationRequest
    {
        [JsonPropertyName("words")]
        public List<string> Words { get; set; } = new List<string>();

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("sourceLanguageCode")] // Optional
        public string? SourceLanguageCode { get; set; }
    }

    public class TranslationRequest
    {
        [JsonPropertyName("text")]
        public string Text { get; set; } = string.Empty;

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty;
    }

    public class TranslationResponse
    {
        [JsonPropertyName("originalText")]
        public string OriginalText { get; set; } = string.Empty;

        [JsonPropertyName("translatedText")]
        public string TranslatedText { get; set; } = string.Empty;

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty;
    }

    public class LanguageInfo
    {
        [JsonPropertyName("code")]
        public string Code { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;
    }

    public class WordDefinitionResponse
    {
        [JsonPropertyName("term")]
        public string Term { get; set; } = string.Empty;

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("entries")]
        public List<WordDefinitionEntryDto> Entries { get; set; } = new();
    }

    public class WordDefinitionEntryDto
    {
        [JsonPropertyName("partOfSpeech")]
        public string PartOfSpeech { get; set; } = string.Empty;

        [JsonPropertyName("senses")]
        public List<string> Senses { get; set; } = new();
    }
}