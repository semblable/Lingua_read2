using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace LinguaReadApi.Services
{
    public class LanguageService : ILanguageService
    {
        private readonly AppDbContext _context;

        public LanguageService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Language>> GetAllLanguagesAsync()
        {
            var languages = await _context.Languages
                                 .Include(l => l.Dictionaries)
                                 .Include(l => l.SentenceSplitExceptions)
                                 .AsSplitQuery()
                                 .AsNoTracking()
                                 .ToListAsync();

            foreach (var lang in languages)
            {
                if (lang.Dictionaries != null)
                {
                    lang.Dictionaries = lang.Dictionaries.OrderBy(d => d.SortOrder).ToList();
                }
            }

            return languages;
        }

        public async Task<Language?> GetLanguageByIdAsync(int id)
        {
            var language = await _context.Languages
                                 .Include(l => l.Dictionaries)
                                 .Include(l => l.SentenceSplitExceptions)
                                 .AsSplitQuery()
                                 .AsNoTracking()
                                 .FirstOrDefaultAsync(l => l.LanguageId == id);

            if (language != null && language.Dictionaries != null)
            {
                language.Dictionaries = language.Dictionaries.OrderBy(d => d.SortOrder).ToList();
            }

            return language;
        }

        public async Task<Language> CreateLanguageAsync(Language language)
        {
            if (language == null)
            {
                throw new ArgumentNullException(nameof(language));
            }

            // Ensure related collections are initialized if they are null
            language.Dictionaries ??= new List<LanguageDictionary>();
            language.SentenceSplitExceptions ??= new List<LanguageSentenceSplitException>();

            // EF Core will automatically handle inserting the related entities
            _context.Languages.Add(language);
            await _context.SaveChangesAsync();
            return language; // The language object will have its ID populated
        }

        public async Task<bool> UpdateLanguageAsync(int id, Language language)
        {
            if (id != language?.LanguageId)
            {
                // Consider throwing an exception or returning a specific error code
                return false; // ID mismatch
            }

            var existingLanguage = await _context.Languages
                                                 .Include(l => l.Dictionaries)
                                                 .Include(l => l.SentenceSplitExceptions)
                                                 .AsSplitQuery()
                                                 .FirstOrDefaultAsync(l => l.LanguageId == id);

            if (existingLanguage == null)
            {
                return false; // Not found
            }

            // Update scalar properties
            _context.Entry(existingLanguage).CurrentValues.SetValues(language);

            // --- Handle related collections (more complex update logic) ---

            // 1. Dictionaries: Remove old ones not in the new list, update existing, add new ones
            existingLanguage.Dictionaries ??= new List<LanguageDictionary>();
            language.Dictionaries ??= new List<LanguageDictionary>();

            // Remove dictionaries that are no longer present
            var dictionariesToRemove = existingLanguage.Dictionaries
                .Where(ed => !language.Dictionaries.Any(nd => nd.DictionaryId == ed.DictionaryId && ed.DictionaryId != 0))
                .ToList();
            _context.LanguageDictionaries.RemoveRange(dictionariesToRemove);

            // Update existing and add new dictionaries
            foreach (var updatedDict in language.Dictionaries)
            {
                var existingDict = existingLanguage.Dictionaries
                    .FirstOrDefault(ed => ed.DictionaryId == updatedDict.DictionaryId && ed.DictionaryId != 0);

                if (existingDict != null)
                {
                    // Update existing dictionary
                    _context.Entry(existingDict).CurrentValues.SetValues(updatedDict);
                }
                else
                {
                    // Add new dictionary (ensure LanguageId is set correctly)
                    updatedDict.LanguageId = existingLanguage.LanguageId;
                    existingLanguage.Dictionaries.Add(updatedDict);
                    // _context.LanguageDictionaries.Add(updatedDict); // Can add directly to context too
                }
            }


            // 2. Sentence Split Exceptions: Simpler approach - remove all old, add all new
            existingLanguage.SentenceSplitExceptions ??= new List<LanguageSentenceSplitException>();
            language.SentenceSplitExceptions ??= new List<LanguageSentenceSplitException>();

            // Remove all existing exceptions for this language
            _context.LanguageSentenceSplitExceptions.RemoveRange(existingLanguage.SentenceSplitExceptions);

            // Add the new exceptions (ensure LanguageId is set)
            foreach (var newException in language.SentenceSplitExceptions)
            {
                newException.LanguageId = existingLanguage.LanguageId;
                // Ensure we don't try to re-add with an existing ID if client sends one
                newException.ExceptionId = 0;
                existingLanguage.SentenceSplitExceptions.Add(newException);
                // _context.LanguageSentenceSplitExceptions.Add(newException); // Can add directly to context too
            }

            try
            {
                await _context.SaveChangesAsync();
                return true;
            }
            catch (DbUpdateConcurrencyException)
            {
                // Handle concurrency issues if necessary
                return false;
            }
            catch (DbUpdateException ex)
            {
                // Log the exception details
                Console.WriteLine($"Error updating language: {ex.InnerException?.Message ?? ex.Message}");
                return false;
            }
        }


        public async Task<bool> DeleteLanguageAsync(int id)
        {
            var language = await _context.Languages.FindAsync(id);
            if (language == null)
            {
                return false; // Not found
            }

            // EF Core cascade delete should handle related entities based on configuration in AppDbContext
            _context.Languages.Remove(language);

            try
            {
                await _context.SaveChangesAsync();
                return true;
            }
            catch (DbUpdateException ex)
            {
                 // Handle potential foreign key constraint issues if cascade delete isn't configured correctly
                 // or if other entities still reference this language restrictively.
                 Console.WriteLine($"Error deleting language: {ex.InnerException?.Message ?? ex.Message}");
                 return false;
            }
        }

        public async Task<bool> ResetLanguageContentAsync(int languageId, Guid userId)
        {
            var languageExists = await _context.Languages
                .AsNoTracking()
                .AnyAsync(l => l.LanguageId == languageId);
            if (!languageExists)
            {
                return false;
            }

            await using var transaction = await _context.Database.BeginTransactionAsync();

            // SrsPhrase.WordId is Restrict, so remove phrases tied to this user's words in this language
            // before deleting the words themselves.
            await _context.SrsPhrases
                .Where(sp => sp.UserId == userId
                             && _context.Words.Any(w => w.WordId == sp.WordId
                                                        && w.UserId == userId
                                                        && w.LanguageId == languageId))
                .ExecuteDeleteAsync();

            // Texts first — cascades TextWords, UserSentenceProgress, UserAudioLessonProgress,
            // and nulls SrsPhrase.TextId for phrases in other languages that happened to reference these texts.
            await _context.Texts
                .Where(t => t.UserId == userId && t.LanguageId == languageId)
                .ExecuteDeleteAsync();

            // Books — cascades UserBookProgress, AudiobookTracks, and any remaining linked texts.
            await _context.Books
                .Where(b => b.UserId == userId && b.LanguageId == languageId)
                .ExecuteDeleteAsync();

            // Words — cascades WordTranslation, SrsCardReview (and SrsReviewLog via SrsCardReview).
            await _context.Words
                .Where(w => w.UserId == userId && w.LanguageId == languageId)
                .ExecuteDeleteAsync();

            await _context.UserActivities
                .Where(ua => ua.UserId == userId && ua.LanguageId == languageId)
                .ExecuteDeleteAsync();

            await _context.UserLanguageStatistics
                .Where(uls => uls.UserId == userId && uls.LanguageId == languageId)
                .ExecuteDeleteAsync();

            await transaction.CommitAsync();
            return true;
        }

        public async Task<IEnumerable<Language>> GetLanguagesForTranslationAsync()
        {
            return await _context.Languages
                                 .Where(l => l.IsActiveForTranslation)
                                 .AsNoTracking()
                                 .OrderBy(l => l.Name)
                                 .ToListAsync();
        }
    }
}