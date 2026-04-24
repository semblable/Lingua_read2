using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore; // <-- Add this for DbUpdateException
using System;
using System.Collections.Generic;
using System.Security.Claims;
using System.Threading.Tasks;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize] // Require authentication for language management
    public class LanguagesController : ControllerBase
    {
        private readonly ILanguageService _languageService;
        private readonly ILogger<LanguagesController> _logger;

        public LanguagesController(ILanguageService languageService, ILogger<LanguagesController> logger)
        {
            _languageService = languageService;
            _logger = logger;
        }

        // GET: api/languages
        /// <summary>
        /// Gets a list of all configured languages with their details.
        /// </summary>
        [HttpGet]
        public async Task<ActionResult<IEnumerable<Language>>> GetAllLanguages()
        {
            try
            {
                var languages = await _languageService.GetAllLanguagesAsync();
                return Ok(languages);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in GetAllLanguages");
                return StatusCode(500, "An error occurred while retrieving languages.");
            }
        }

        // GET: api/languages/{id}
        /// <summary>
        /// Gets a specific language by its ID.
        /// </summary>
        [HttpGet("{id}")]
        public async Task<ActionResult<Language>> GetLanguageById(int id)
        {
            try
            {
                var language = await _languageService.GetLanguageByIdAsync(id);
                if (language == null)
                {
                    return NotFound($"Language with ID {id} not found.");
                }
                return Ok(language);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting language by ID {LanguageId}", id);
                return StatusCode(500, "An error occurred while retrieving the language.");
            }
        }

        // POST: api/languages
        /// <summary>
        /// Creates a new language configuration.
        /// </summary>
        [HttpPost]
        public async Task<ActionResult<Language>> CreateLanguage([FromBody] Language language) // Use a DTO later if needed
        {
            if (language == null)
            {
                return BadRequest("Language data is required.");
            }

            // Basic validation (could be expanded or moved to service/DTOs)
            if (string.IsNullOrWhiteSpace(language.Name) || string.IsNullOrWhiteSpace(language.Code))
            {
                return BadRequest("Language Name and Code are required.");
            }

            try
            {
                // Ensure LanguageId is 0 for creation
                language.LanguageId = 0;
                var createdLanguage = await _languageService.CreateLanguageAsync(language);
                // Return 201 Created with the location of the new resource and the created object
                return CreatedAtAction(nameof(GetLanguageById), new { id = createdLanguage.LanguageId }, createdLanguage);
            }
            catch (DbUpdateException ex) // Catch potential unique constraint violations
            {
                 _logger.LogError(ex, "Error creating language");
                 // Check if it's a unique constraint violation (specific error code/message depends on DB)
                 if (ex.InnerException?.Message.Contains("duplicate key value violates unique constraint") ?? false)
                 {
                     return Conflict("A language with the same Name or Code already exists.");
                 }
                 return StatusCode(500, "An error occurred while creating the language.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating language");
                return StatusCode(500, "An error occurred while creating the language.");
            }
        }


        // PUT: api/languages/{id}
        /// <summary>
        /// Updates an existing language configuration.
        /// </summary>
        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateLanguage(int id, [FromBody] Language language) // Use a DTO later
        {
            if (id != language?.LanguageId)
            {
                return BadRequest("Language ID mismatch in request body vs URL.");
            }
            if (language == null)
            {
                return BadRequest("Language data is required.");
            }

            // Basic validation (could be expanded)
            if (string.IsNullOrWhiteSpace(language.Name) || string.IsNullOrWhiteSpace(language.Code))
            {
                return BadRequest("Language Name and Code are required.");
            }

            try
            {
                var success = await _languageService.UpdateLanguageAsync(id, language);
                if (!success)
                {
                    // The service returns false if the language wasn't found
                    return NotFound($"Language with ID {id} not found.");
                }
                // Return 204 No Content on successful update
                return NoContent();
            }
            catch (DbUpdateException ex) // Catch potential unique constraint violations on update
            {
                 _logger.LogError(ex, "Error updating language {LanguageId}", id);
                 if (ex.InnerException?.Message.Contains("duplicate key value violates unique constraint") ?? false)
                 {
                     return Conflict("A language with the same Name or Code already exists.");
                 }
                 return StatusCode(500, "An error occurred while updating the language.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating language {LanguageId}", id);
                return StatusCode(500, "An error occurred while updating the language.");
            }
        }

        // DELETE: api/languages/{id}
        /// <summary>
        /// Deletes a language configuration.
        /// </summary>
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteLanguage(int id)
        {
            try
            {
                var result = await _languageService.DeleteLanguageAsync(id);
                if (result.Status == DeleteLanguageStatus.NotFound)
                {
                    return NotFound($"Language with ID {id} not found.");
                }
                if (result.Status == DeleteLanguageStatus.BlockedByDependencies)
                {
                    return Conflict(new
                    {
                        Message = $"Cannot delete language {id} because it has historical or user data. Use reset content for per-user cleanup.",
                        Dependencies = result.Dependencies
                    });
                }

                // Return 204 No Content on successful deletion
                return NoContent();
            }
            catch (DbUpdateException ex) // Catch potential constraint violations on delete
            {
                 _logger.LogError(ex, "Error deleting language {LanguageId}", id);
                 // Check if it's a foreign key constraint violation
                 if (ex.InnerException is Npgsql.PostgresException pgEx && pgEx.SqlState == "23503") // 23503 = foreign_key_violation
                 {
                     return Conflict($"Cannot delete language {id} because it is still referenced by other entities (e.g., Books, Texts, Words).");
                 }
                 return StatusCode(500, "An error occurred while deleting the language due to database constraints.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting language {LanguageId}", id);
                return StatusCode(500, "An error occurred while deleting the language.");
            }
        }

        // POST: api/languages/{id}/reset-content
        /// <summary>
        /// Deletes all of the current user's content for the given language (texts, books, words,
        /// activity, statistics) while preserving the language configuration itself.
        /// </summary>
        [HttpPost("{id}/reset-content")]
        public async Task<IActionResult> ResetLanguageContent(int id)
        {
            Guid userId;
            try
            {
                userId = GetUserId();
            }
            catch (UnauthorizedAccessException)
            {
                return Unauthorized();
            }

            try
            {
                var success = await _languageService.ResetLanguageContentAsync(id, userId);
                if (!success)
                {
                    return NotFound($"Language with ID {id} not found.");
                }
                _logger.LogInformation("Reset content for language {LanguageId} and user {UserId}", id, userId);
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error resetting content for language {LanguageId}", id);
                return StatusCode(500, "An error occurred while resetting the language content.");
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
    }
}