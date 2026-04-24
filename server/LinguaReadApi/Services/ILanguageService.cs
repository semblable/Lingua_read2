using LinguaReadApi.Models;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace LinguaReadApi.Services
{
    /// <summary>
    /// Defines the contract for managing language configurations.
    /// </summary>
    public interface ILanguageService
    {
        /// <summary>
        /// Gets all configured languages, including their dictionaries and exceptions.
        /// </summary>
        Task<IEnumerable<Language>> GetAllLanguagesAsync();

        /// <summary>
        /// Gets a specific language by its ID, including related configurations.
        /// </summary>
        Task<Language?> GetLanguageByIdAsync(int id);

        /// <summary>
        /// Creates a new language configuration.
        /// </summary>
        Task<Language> CreateLanguageAsync(Language language);

        /// <summary>
        /// Updates an existing language configuration.
        /// </summary>
        /// <returns>True if update was successful, false otherwise (e.g., not found).</returns>
        Task<bool> UpdateLanguageAsync(int id, Language language);

        /// <summary>
        /// Deletes a language configuration by its ID.
        /// </summary>
        /// <returns>True if deletion was successful, false otherwise (e.g., not found).</returns>
        Task<bool> DeleteLanguageAsync(int id);

        /// <summary>
        /// Deletes all user-owned content (texts, books, words, activity, stats) for a language
        /// while preserving the language configuration, dictionaries, and sentence-split exceptions.
        /// </summary>
        /// <returns>True if the reset was performed, false if the language does not exist.</returns>
        Task<bool> ResetLanguageContentAsync(int languageId, Guid userId);

        /// <summary>
        /// Gets languages marked as active for translation.
        /// </summary>
        Task<IEnumerable<Language>> GetLanguagesForTranslationAsync();
    }
}