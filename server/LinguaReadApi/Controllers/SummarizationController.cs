using System;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class SummarizationController : ControllerBase
    {
        private readonly ISummarizationServiceFactory _summarizationServiceFactory;
        private readonly ILogger<SummarizationController> _logger;

        public SummarizationController(
            ISummarizationServiceFactory summarizationServiceFactory,
            ILogger<SummarizationController> logger)
        {
            _summarizationServiceFactory = summarizationServiceFactory;
            _logger = logger;
        }

        [HttpPost]
        public async Task<ActionResult<SummarizationResponse>> Summarize([FromBody] SummarizationRequest request)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            if (string.IsNullOrWhiteSpace(request.Text))
            {
                return BadRequest(new { message = "Text to summarize cannot be empty" });
            }

            try
            {
                var userId = GetUserId();
                var summarizationService = await _summarizationServiceFactory.GetServiceForUserAsync(userId);
                var maxSummaryWords = Math.Clamp(request.MaxSummaryWords ?? 200, 50, 1000);

                _logger.LogInformation("Received summarization request, text length: {Length}, source: {Source}, target: {Target}, maxWords: {MaxWords}",
                    request.Text.Length, request.SourceLanguageCode, request.TargetLanguageCode, maxSummaryWords);

                var summaryText = await summarizationService.SummarizeAsync(
                    request.Text,
                    request.SourceLanguageCode,
                    request.TargetLanguageCode,
                    maxSummaryWords);

                if (string.IsNullOrWhiteSpace(summaryText))
                {
                    _logger.LogWarning("Summarization service returned empty result");
                    return StatusCode(500, new { message = "Summarization service returned empty result" });
                }

                var upstreamError = TryMapUpstreamError(summaryText);
                if (upstreamError != null) return upstreamError;

                return Ok(new SummarizationResponse
                {
                    OriginalText = request.Text,
                    SummaryText = summaryText.Trim(),
                    SourceLanguageCode = request.SourceLanguageCode,
                    TargetLanguageCode = request.TargetLanguageCode
                });
            }
            catch (UnauthorizedAccessException)
            {
                return Unauthorized();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during summarization");
                return StatusCode(500, new { message = $"Summarization failed: {ex.Message}" });
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

        private ActionResult? TryMapUpstreamError(string? result)
        {
            const string errorPrefix = "Summarization error:";
            if (string.IsNullOrWhiteSpace(result)) return null;
            if (!result.StartsWith(errorPrefix, StringComparison.Ordinal)) return null;

            if (result.Contains("TooManyRequests", StringComparison.Ordinal))
            {
                return StatusCode(StatusCodes.Status429TooManyRequests, new { message = "Provider rate limit reached. Try again in a few seconds." });
            }

            return StatusCode(StatusCodes.Status502BadGateway, new { message = result });
        }
    }

    public class SummarizationRequest
    {
        [Required]
        [JsonPropertyName("text")]
        public string Text { get; set; } = string.Empty;

        [Required]
        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty;

        [Required]
        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("maxSummaryWords")]
        public int? MaxSummaryWords { get; set; }
    }

    public class SummarizationResponse
    {
        [JsonPropertyName("originalText")]
        public string OriginalText { get; set; } = string.Empty;

        [JsonPropertyName("summaryText")]
        public string SummaryText { get; set; } = string.Empty;

        [JsonPropertyName("sourceLanguageCode")]
        public string SourceLanguageCode { get; set; } = string.Empty;

        [JsonPropertyName("targetLanguageCode")]
        public string TargetLanguageCode { get; set; } = string.Empty;
    }
}
