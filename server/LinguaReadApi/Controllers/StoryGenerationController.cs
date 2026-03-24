using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Security.Claims;
using System.Threading.Tasks;
using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Logging;
using LinguaReadApi.Services;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class StoryGenerationController : ControllerBase
    {
        private readonly IStoryGenerationServiceFactory _storyGenerationServiceFactory;
        private readonly ILogger<StoryGenerationController> _logger;

        public StoryGenerationController(
            IStoryGenerationServiceFactory storyGenerationServiceFactory,
            ILogger<StoryGenerationController> logger)
        {
            _storyGenerationServiceFactory = storyGenerationServiceFactory;
            _logger = logger;
        }

        /// <summary>
        /// Generates a story based on provided parameters using user's configured AI provider
        /// </summary>
        /// <param name="request">The story generation request containing prompt, language, and other parameters</param>
        /// <returns>The generated story</returns>
        [HttpPost]
        public async Task<ActionResult<StoryGenerationResponse>> GenerateStory([FromBody] StoryGenerationRequest request)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            _logger.LogInformation($"Story generation request received: {request.Prompt}, Language: {request.Language}");

            var userId = GetUserId();
            var storyGenerationService = await _storyGenerationServiceFactory.GetServiceForUserAsync(userId);

            // Build the full prompt — services are thin API clients
            string fullPrompt = $"Write a {request.Level} level story in {request.Language} about: {request.Prompt}\n\n" +
                                $"Requirements:\n" +
                                $"- Write approximately {request.MaxLength} words\n" +
                                $"- Use vocabulary and grammar appropriate for {request.Level} level learners\n" +
                                $"- Include diverse sentence structures\n" +
                                $"- Use everyday vocabulary with occasional new words for learning\n" +
                                $"- Return ONLY the story with no additional text or explanations";

            var generatedStory = await storyGenerationService.GenerateStoryAsync(fullPrompt, maxOutputTokens: 20000);

            return Ok(new StoryGenerationResponse { GeneratedStory = generatedStory });
        }

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim))
            {
                throw new UnauthorizedAccessException("User ID not found in token");
            }
            return Guid.Parse(userIdClaim);
        }
    }

    public class StoryGenerationRequest
    {
        [Required]
        public string Prompt { get; set; } = string.Empty;

        [Required]
        public string Language { get; set; } = string.Empty;

        [Required]
        public string Level { get; set; } = "intermediate";

        public int MaxLength { get; set; } = 500;
    }

    public class StoryGenerationResponse
    {
        public string GeneratedStory { get; set; } = string.Empty;
    }
} 