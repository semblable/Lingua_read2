using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Services.Ai;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Controllers
{
    /// <summary>
    /// The AI providers a user can pick in Settings, plus checks against the user's saved settings
    /// for one of them. The settings themselves are saved through PUT api/usersettings.
    /// </summary>
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class AiProvidersController : ControllerBase
    {
        private static readonly TimeSpan TestTimeout = TimeSpan.FromSeconds(30);

        private readonly AppDbContext _context;
        private readonly OpenAiCompatibleChatClient _chatClient;
        private readonly ILogger<AiProvidersController> _logger;

        public AiProvidersController(AppDbContext context, OpenAiCompatibleChatClient chatClient, ILogger<AiProvidersController> logger)
        {
            _context = context;
            _chatClient = chatClient;
            _logger = logger;
        }

        // GET: api/aiproviders
        [HttpGet]
        public ActionResult<List<AiProviderInfoDto>> GetProviders()
        {
            return AiProviderCatalog.Providers.Select(p => new AiProviderInfoDto
            {
                Id = p.Id,
                DisplayName = p.DisplayName,
                BaseUrl = p.BaseUrl,
                DefaultModel = p.DefaultModel,
                KeyPlaceholder = p.KeyPlaceholder,
                KeysUrl = p.KeysUrl,
                ModelsUrl = p.ModelsUrl,
                RequiresBaseUrl = p.RequiresBaseUrl,
                ApiKeyOptional = p.ApiKeyOptional,
                SupportsReasoning = p.ReasoningStyle != AiReasoningStyle.None
            }).ToList();
        }

        // POST: api/aiproviders/deepseek/test
        // Sends a tiny chat completion with the provider's saved key and default model.
        [HttpPost("{provider}/test")]
        public async Task<ActionResult<AiProviderTestResultDto>> TestConnection(string provider)
        {
            var (connection, problem, failure) = await ConnectAsync(provider, requireModel: true);
            if (failure != null) return failure;
            if (connection == null) return new AiProviderTestResultDto { Success = false, Message = problem! };

            var model = connection.ModelFor(AiTask.Translation);
            var request = new ChatCompletionRequest
            {
                Model = model,
                Messages = new[] { new ChatMessage { Role = "user", Content = "Reply with only the word 'OK'" } },
                // Room for a reasoning model's thinking before the one-word answer.
                MaxTokens = 256
            };
            AiReasoningOptions.ApplyForTranslation(request, connection.Definition.ReasoningStyle, connection.Settings);

            _logger.LogInformation("Testing {Provider} with model {Model}", connection.Definition.DisplayName, model);
            try
            {
                var result = await _chatClient.CompleteAsync(connection, request, "connection test", TestTimeout, HttpContext.RequestAborted);
                if (!result.Success)
                {
                    return new AiProviderTestResultDto
                    {
                        Success = false,
                        Message = $"{connection.Definition.DisplayName} error: {result.Error}"
                    };
                }

                return new AiProviderTestResultDto
                {
                    Success = true,
                    Message = $"Connection successful! Model '{model}' responded.",
                    Details = result.Content
                };
            }
            catch (Exception ex) when (ex is System.Net.Http.HttpRequestException or InvalidOperationException)
            {
                _logger.LogWarning(ex, "{Provider} connection test failed", connection.Definition.DisplayName);
                return new AiProviderTestResultDto { Success = false, Message = $"Error: {ex.Message}" };
            }
        }

        // GET: api/aiproviders/deepseek/models
        // The model ids the provider offers, fetched with the user's saved key.
        [HttpGet("{provider}/models")]
        public async Task<ActionResult<AiProviderModelsDto>> GetModels(string provider)
        {
            // Listing the models is how the user picks the first one, so no model is needed yet.
            var (connection, problem, failure) = await ConnectAsync(provider, requireModel: false);
            if (failure != null) return failure;
            if (connection == null) return new AiProviderModelsDto { Error = problem };

            var (models, error) = await _chatClient.ListModelsAsync(connection, HttpContext.RequestAborted);
            return new AiProviderModelsDto { Models = models.ToList(), Error = error };
        }

        // The user's saved settings for a catalog provider. Failure is set for a bad request
        // (unknown provider, no user); Problem says what the saved settings are missing.
        private async Task<(AiProviderConnection? Connection, string? Problem, ActionResult? Failure)> ConnectAsync(string provider, bool requireModel)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!Guid.TryParse(userIdClaim, out var userId))
            {
                return (null, null, Unauthorized(new { message = "User ID not found in token" }));
            }

            var definition = AiProviderCatalog.Find(provider);
            if (definition == null)
            {
                return (null, null, NotFound(new { message = $"Unknown AI provider '{provider}'." }));
            }

            var settings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId)
                           ?? new Models.UserSettings { UserId = userId };
            var config = await AiProviderResolver.FindConfigAsync(_context, userId, definition.Id);
            var connection = AiProviderConnection.TryCreate(definition, config, settings, out var problem, requireModel);
            return (connection, problem, null);
        }
    }

    public class AiProviderInfoDto
    {
        public string Id { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        // Null for the custom provider, whose URL the user enters.
        public string? BaseUrl { get; set; }
        public string? DefaultModel { get; set; }
        public string KeyPlaceholder { get; set; } = string.Empty;
        public string? KeysUrl { get; set; }
        public string? ModelsUrl { get; set; }
        public bool RequiresBaseUrl { get; set; }
        public bool ApiKeyOptional { get; set; }
        // Whether the reasoning settings apply to this provider.
        public bool SupportsReasoning { get; set; }
    }

    public class AiProviderTestResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public string? Details { get; set; }
    }

    public class AiProviderModelsDto
    {
        public List<string> Models { get; set; } = new();
        // Why the list couldn't be fetched; the models field is empty then.
        public string? Error { get; set; }
    }
}
