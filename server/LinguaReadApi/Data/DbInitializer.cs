using System;
using System.Linq;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Identity; // Required for User properties

namespace LinguaReadApi.Data
{
    public static class DbInitializer
    {
        // Define constants for the default user
        private static readonly Guid DefaultUserId = new Guid("a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5");
        private const string DefaultUserEmail = "localuser@lingua.read";

        public static void Initialize(IServiceProvider serviceProvider)
        {
            using (var context = new AppDbContext(
                serviceProvider.GetRequiredService<DbContextOptions<AppDbContext>>()))
            {
                bool languagesSeeded = false;
                bool userSeeded = false;

                // --- Seed Languages ---
                // Check if languages need seeding first
                if (!context.Languages.Any())
                {
                    Console.WriteLine("Seeding Languages..."); // Add log
                    // Seed languages with default configurations
                    var languages = new List<Language> // Use List for easier modification later
                    {
                         new Language { // English
                            Name = "English", Code = "en",
                            ShowRomanization = false, RightToLeft = false, ParserType = "spacedel",
                            SplitSentences = ",.!?", WordCharacters = "a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ",
                            IsActiveForTranslation = true,
                            CharacterSubstitutions = "´='|`='|’='|‘='|...=…|..=‥",
                            Dictionaries = new List<LanguageDictionary> { }
                        },
                        new Language { // Spanish
                            Name = "Spanish", Code = "es",
                            ShowRomanization = false, RightToLeft = false, ParserType = "spacedel",
                            SplitSentences = ",.!?", WordCharacters = "a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ",
                            IsActiveForTranslation = true,
                            CharacterSubstitutions = "´='|`='|’='|‘='|...=…|..=‥",
                            Dictionaries = new List<LanguageDictionary> { }
                        },
                        new Language { // French
                            Name = "French", Code = "fr",
                            ShowRomanization = false, RightToLeft = false, ParserType = "spacedel",
                            SplitSentences = ",.!?", WordCharacters = "a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ",
                            IsActiveForTranslation = true,
                            CharacterSubstitutions = "´='|`='|’='|‘='|...=…|..=‥",
                            Dictionaries = new List<LanguageDictionary> { }
                        },
                        new Language { // German
                            Name = "German", Code = "de",
                            ShowRomanization = false, RightToLeft = false, ParserType = "spacedel",
                            SplitSentences = ",.!?", WordCharacters = "a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ\\u200C\\u200D",
                            IsActiveForTranslation = true,
                            CharacterSubstitutions = "´='|`='|’='|‘='|...=…|..=‥",
                            Dictionaries = new List<LanguageDictionary> { }
                        },
                        new Language { // Italian
                            Name = "Italian", Code = "it",
                            ShowRomanization = false, RightToLeft = false, ParserType = "spacedel",
                            SplitSentences = ",.!?", WordCharacters = "a-zA-ZÀàÉéÈèÌìÎîÓóÒòÙù",
                            IsActiveForTranslation = true,
                            CharacterSubstitutions = "´='|`='|’='|‘='|...=…|..=‥",
                            Dictionaries = new List<LanguageDictionary> { }
                        },
                        new Language { // Portuguese
                            Name = "Portuguese", Code = "pt",
                            ShowRomanization = false, RightToLeft = false, ParserType = "spacedel",
                            SplitSentences = ",.!?", WordCharacters = "a-zA-ZÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü",
                            IsActiveForTranslation = true,
                            CharacterSubstitutions = "´='|`='|’='|‘='|...=…|..=‥",
                            Dictionaries = new List<LanguageDictionary> { }
                        },
                        new Language { // Russian
                            Name = "Russian", Code = "ru",
                            ShowRomanization = true, RightToLeft = false, ParserType = "spacedel",
                            SplitSentences = ".!?", WordCharacters = @"\p{L}\p{M}'-", IsActiveForTranslation = true,
                            CharacterSubstitutions = "’='|‘='|“=\"|”=\"|...=…|--=—",
                             Dictionaries = new List<LanguageDictionary> {
                                new LanguageDictionary { Purpose = "terms", DisplayType = "popup", UrlTemplate = "https://www.wordreference.com/enru/###", IsActive = true, SortOrder = 0 },
                                new LanguageDictionary { Purpose = "terms", DisplayType = "popup", UrlTemplate = "https://ru.wiktionary.org/wiki/###", IsActive = false, SortOrder = 1 }
                            }
                        },
                    };
                    // AddRange will also add the related entities (Dictionaries, SentenceSplitExceptions)
                    context.Languages.AddRange(languages);
                    languagesSeeded = true; // Mark that languages were added
                }

                // --- Seed Default User ---
                // Check if the default user needs seeding (INDEPENDENTLY of languages)
                if (!context.Users.Any(u => u.Id == DefaultUserId))
                {
                    Console.WriteLine($"Creating default user: {DefaultUserEmail} with ID: {DefaultUserId}"); // Add log
                    var defaultUser = new User
                    {
                        Id = DefaultUserId,
                        UserName = DefaultUserEmail,
                        NormalizedUserName = DefaultUserEmail.ToUpperInvariant(),
                        Email = DefaultUserEmail,
                        NormalizedEmail = DefaultUserEmail.ToUpperInvariant(),
                        EmailConfirmed = true, // Assume confirmed for simplicity
                        PasswordHash = null, // No password needed
                        SecurityStamp = Guid.NewGuid().ToString("D"), // Required by Identity
                        CreatedAt = DateTime.UtcNow,
                        // Initialize other User properties if necessary
                        LockoutEnabled = false,
                        TwoFactorEnabled = false,
                        PhoneNumberConfirmed = false,
                        AccessFailedCount = 0
                    };
                    Console.WriteLine("[DbInitializer] Attempting to add default user to context...");
                    context.Users.Add(defaultUser);
                    Console.WriteLine("[DbInitializer] Default user added to context.");
                    userSeeded = true; // Mark that the user was added
                } else {
                    Console.WriteLine($"[DbInitializer] Default user with ID {DefaultUserId} already exists. Skipping creation.");
                }


                // --- Save Changes if any seeding occurred ---
                if (languagesSeeded || userSeeded) // Save if either languages OR user were added
                {
                    Console.WriteLine("[DbInitializer] Attempting to save seeding changes...");
                    try
                    {
                        context.SaveChanges();
                        Console.WriteLine("[DbInitializer] SaveChanges completed successfully."); // Add log
                    }
                    catch (Exception ex)
                    {
                         Console.WriteLine($"[DbInitializer] Error saving seeding changes: {ex.Message}");
                         throw new InvalidOperationException(
                             "Database seeding failed (languages and/or default user). The API cannot start without a consistent seed.",
                             ex);
                    }
                } else {
                     Console.WriteLine("[DbInitializer] No seeding changes detected (Languages or User). Skipping SaveChanges.");
                }
            }
        }
    }
}