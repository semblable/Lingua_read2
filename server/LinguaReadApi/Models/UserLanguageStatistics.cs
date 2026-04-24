using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class UserLanguageStatistics
    {
        [Key]
        public int UserLanguageStatisticsId { get; set; }

        [Required]
        public Guid UserId { get; set; }
        public User User { get; set; } = null!; // Navigation property

        [Required]
        public int LanguageId { get; set; }
        public Language Language { get; set; } = null!; // Navigation property

        public long TotalWordsRead { get; set; } = 0;
        public int TotalTextsCompleted { get; set; } = 0; // Unique texts finished (first-time only)
        public int TotalTextCompletions { get; set; } = 0; // Every completion incl. re-reads
        public int TotalBooksCompleted { get; set; } = 0; // Add field for books too
        public long TotalSecondsListened { get; set; } = 0; // Add field for listening

        // Consider adding KnownWords, LearningWords if needed later

        public DateTime LastUpdatedAt { get; set; }
    }
}