using LinguaReadApi.Models;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace LinguaReadApi.Services
{
    public enum DeleteLanguageStatus
    {
        Deleted,
        NotFound,
        BlockedByDependencies
    }

    public sealed record LanguageDeleteDependencies(
        int Texts,
        int Books,
        int Words,
        int UserActivities,
        int UserLanguageStatistics)
    {
        public bool HasAny =>
            Texts > 0 ||
            Books > 0 ||
            Words > 0 ||
            UserActivities > 0 ||
            UserLanguageStatistics > 0;
    }

    public sealed record DeleteLanguageResult(
        DeleteLanguageStatus Status,
        LanguageDeleteDependencies Dependencies)
    {
        public static DeleteLanguageResult Deleted() =>
            new(DeleteLanguageStatus.Deleted, EmptyDependencies);

        public static DeleteLanguageResult NotFound() =>
            new(DeleteLanguageStatus.NotFound, EmptyDependencies);

        public static DeleteLanguageResult Blocked(LanguageDeleteDependencies dependencies) =>
            new(DeleteLanguageStatus.BlockedByDependencies, dependencies);

        private static readonly LanguageDeleteDependencies EmptyDependencies = new(0, 0, 0, 0, 0);
    }

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
        Task<DeleteLanguageResult> DeleteLanguageAsync(int id);

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