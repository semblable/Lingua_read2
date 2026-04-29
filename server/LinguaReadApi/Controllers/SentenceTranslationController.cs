using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using System;
using System.Security.Claims;
using Microsoft.Extensions.Logging;
using LinguaReadApi.Services;
using LinguaReadApi.Utilities;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class SentenceTranslationController : ControllerBase
    {
        private readonly ITranslationServiceFactory _translationServiceFactory;
        private readonly ILogger<SentenceTranslationController> _logger;

        public SentenceTranslationController(
            ITranslationServiceFactory translationServiceFactory,
            ILogger<SentenceTranslationController> logger)
        {
            _translationServiceFactory = translationServiceFactory;
            _logger = logger;
        }

        /// <summary>
        /// Translates a sentence or paragraph from one language to another using user's configured AI provider
        /// </summary>
        /// <param name="request">The translation request containing text and language codes</param>
        /// <returns>The translated text</returns>
        [HttpPost]
        public async Task<ActionResult<SentenceTranslationResponse>> TranslateSentence([FromBody] SentenceTranslationRequest request)
        {
            try
            {
                _logger.LogInformation($"Received sentence translation request: {request.Text?.Substring(0, Math.Min(50, request.Text?.Length ?? 0))}...");
                
                if (string.IsNullOrWhiteSpace(request.Text))
                {
                    _logger.LogWarning("Empty text provided for translation");
                    return BadRequest(new { message = "Text to translate cannot be empty" });
                }

                var userId = GetUserId();
                var translationService = await _translationServiceFactory.GetServiceForUserAsync(userId);

                _logger.LogInformation($"Translating from {request.SourceLanguageCode} to {request.TargetLanguageCode}");
                
                var translatedText = await translationService.TranslateSentenceAsync(
                    request.Text,
                    request.SourceLanguageCode,
                    request.TargetLanguageCode);

                if (string.IsNullOrEmpty(translatedText))
                {
                    _logger.LogWarning("Translation service returned empty result");
                    return StatusCode(500, new { message = "Translation service returned empty result" });
                }

                var upstreamError = TryMapUpstreamError(translatedText, "Translation error:");
                if (upstreamError != null) return upstreamError;

                // Keep a defensive fallback in case a provider still returns paired tags.
                translatedText = PairedTranslationTagExtractor.ExtractTranslatedTextOnly(translatedText);

                _logger.LogInformation($"Translation successful, result length: {translatedText.Length}");

                return Ok(new SentenceTranslationResponse
                {
                    OriginalText = request.Text,
                    TranslatedText = translatedText,
                    SourceLanguageCode = request.SourceLanguageCode,
                    TargetLanguageCode = request.TargetLanguageCode
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during sentence translation");
                return StatusCode(500, new { message = $"Translation failed: {ex.Message}" });
            }
        }

        /// <summary>
        /// Translates an entire text for a quick preview
        /// </summary>
        [HttpPost("full-text")]
        public async Task<ActionResult<SentenceTranslationResponse>> TranslateFullText([FromBody] SentenceTranslationRequest request)
        {
            try
            {
                _logger.LogInformation($"Received full text translation request, text length: {request.Text?.Length ?? 0}");
                
                if (string.IsNullOrWhiteSpace(request.Text))
                {
                    _logger.LogWarning("Empty text provided for full text translation");
                    return BadRequest(new { message = "Text to translate cannot be empty" });
                }

                var userId = GetUserId();
                var translationService = await _translationServiceFactory.GetServiceForUserAsync(userId);

                _logger.LogInformation($"Translating full text from {request.SourceLanguageCode} to {request.TargetLanguageCode}");
                
                var translatedText = await translationService.TranslateFullTextAsync(
                    request.Text,
                    request.SourceLanguageCode,
                    request.TargetLanguageCode);

                if (string.IsNullOrEmpty(translatedText))
                {
                    _logger.LogWarning("Translation service returned empty result for full text");
                    return StatusCode(500, new { message = "Translation service returned empty result" });
                }

                var upstreamError = TryMapUpstreamError(translatedText, "Translation error:");
                if (upstreamError != null) return upstreamError;

                _logger.LogInformation($"Full text translation successful, result length: {translatedText.Length}");
                
                return Ok(new SentenceTranslationResponse
                {
                    OriginalText = request.Text,
                    TranslatedText = translatedText,
                    SourceLanguageCode = request.SourceLanguageCode,
                    TargetLanguageCode = request.TargetLanguageCode
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during full text translation");
                return StatusCode(500, new { message = $"Translation failed: {ex.Message}" });
            }
        }

        [HttpPost("explain")]
        public async Task<ActionResult<SentenceExplanationResponse>> ExplainSentence([FromBody] SentenceTranslationRequest request)
        {
            try
            {
                _logger.LogInformation($"Received sentence explanation request: {request.Text?.Substring(0, Math.Min(50, request.Text?.Length ?? 0))}...");

                if (string.IsNullOrWhiteSpace(request.Text))
                {
                    _logger.LogWarning("Empty text provided for sentence explanation");
                    return BadRequest(new { message = "Text to explain cannot be empty" });
                }

                var userId = GetUserId();
                var translationService = await _translationServiceFactory.GetServiceForUserAsync(userId);

                var explanationText = await translationService.ExplainSentenceAsync(
                    request.Text,
                    request.SourceLanguageCode,
                    request.TargetLanguageCode);

                if (string.IsNullOrEmpty(explanationText))
                {
                    _logger.LogWarning("Explanation service returned empty result");
                    return StatusCode(500, new { message = "Explanation service returned empty result" });
                }

                var upstreamError = TryMapUpstreamError(explanationText, "Explanation error:");
                if (upstreamError != null) return upstreamError;

                return Ok(new SentenceExplanationResponse
                {
                    OriginalText = request.Text,
                    ExplanationText = explanationText,
                    SourceLanguageCode = request.SourceLanguageCode,
                    TargetLanguageCode = request.TargetLanguageCode
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during sentence explanation");
                return StatusCode(500, new { message = $"Sentence explanation failed: {ex.Message}" });
            }
        }

        /// <summary>
        /// Translates only the selected text while using full sentence context for disambiguation.
        /// </summary>
        [HttpPost("selection")]
        public async Task<ActionResult<SelectionTranslationResponse>> TranslateSelection([FromBody] SelectionTranslationRequest request)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(request.SelectedText))
                {
                    return BadRequest(new { message = "Selected text cannot be empty" });
                }

                if (string.IsNullOrWhiteSpace(request.SentenceContext))
                {
                    return BadRequest(new { message = "Sentence context cannot be empty" });
                }

                var userId = GetUserId();
                var translationService = await _translationServiceFactory.GetServiceForUserAsync(userId);

                var translatedSelection = await translationService.TranslateSelectionWithContextAsync(
                    request.SelectedText,
                    request.SentenceContext,
                    request.SourceLanguageCode,
                    request.TargetLanguageCode);

                if (string.IsNullOrWhiteSpace(translatedSelection))
                {
                    _logger.LogWarning("Selection translation service returned empty result");
                    return StatusCode(500, new { message = "Translation service returned empty result" });
                }

                var upstreamError = TryMapUpstreamError(translatedSelection, "Translation error:");
                if (upstreamError != null) return upstreamError;

                return Ok(new SelectionTranslationResponse
                {
                    SelectedText = request.SelectedText,
                    SentenceContext = request.SentenceContext,
                    TranslatedText = translatedSelection.Trim(),
                    SourceLanguageCode = request.SourceLanguageCode,
                    TargetLanguageCode = request.TargetLanguageCode
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during selection translation");
                return StatusCode(500, new { message = $"Selection translation failed: {ex.Message}" });
            }
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

        // Provider services return error strings prefixed with "Translation error:" or
        // "Explanation error:" rather than throwing. Surface upstream rate-limit hits as
        // HTTP 429 so the client can show a clear message; other upstream errors as 502.
        private ActionResult? TryMapUpstreamError(string? result, string defaultErrorPrefix)
        {
            if (string.IsNullOrWhiteSpace(result)) return null;
            if (!result.StartsWith(defaultErrorPrefix, StringComparison.Ordinal)) return null;

            if (result.Contains("TooManyRequests", StringComparison.Ordinal))
            {
                return StatusCode(StatusCodes.Status429TooManyRequests, new { message = "Provider rate limit reached. Try again in a few seconds." });
            }
            return StatusCode(StatusCodes.Status502BadGateway, new { message = result });
        }
    }

    public class SentenceTranslationRequest
    {
        [JsonPropertyName("text")]
        public string Text { get; set; } = string.Empty; // Initialize

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty; // Initialize

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty; // Initialize
    }

    public class SentenceTranslationResponse
    {
        [JsonPropertyName("originalText")]
        public string OriginalText { get; set; } = string.Empty; // Initialize

        [JsonPropertyName("translatedText")]
        public string TranslatedText { get; set; } = string.Empty; // Initialize

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty; // Initialize

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty; // Initialize
    }

    public class SentenceExplanationResponse
    {
        [JsonPropertyName("originalText")]
        public string OriginalText { get; set; } = string.Empty;

        [JsonPropertyName("explanationText")]
        public string ExplanationText { get; set; } = string.Empty;

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty;
    }

    public class SelectionTranslationRequest
    {
        [JsonPropertyName("selectedText")]
        public string SelectedText { get; set; } = string.Empty;

        [JsonPropertyName("sentenceContext")]
        public string SentenceContext { get; set; } = string.Empty;

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty;
    }

    public class SelectionTranslationResponse
    {
        [JsonPropertyName("selectedText")]
        public string SelectedText { get; set; } = string.Empty;

        [JsonPropertyName("sentenceContext")]
        public string SentenceContext { get; set; } = string.Empty;

        [JsonPropertyName("translatedText")]
        public string TranslatedText { get; set; } = string.Empty;

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty;
    }
} 