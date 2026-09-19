using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class SrsReviewLog
    {
        [Key]
        public int SrsReviewLogId { get; set; }

        [Required]
        [ForeignKey("User")]
        public Guid UserId { get; set; }

        [Required]
        [ForeignKey("SrsCardReview")]
        public int SrsCardReviewId { get; set; }

        public int Grade { get; set; } // 0=Again, 1=Hard, 2=Good, 3=Easy

        public DateTime ReviewedAt { get; set; } = DateTime.UtcNow;

        // Pre-review state (for Undo functionality)
        public int OldInterval { get; set; }
        public int OldRepetitions { get; set; }
        public DateTime OldNextReviewAt { get; set; }
        public bool OldIsLearning { get; set; } = false;
        public int OldCurrentLearningStepIndex { get; set; } = 0;
        public DateTime? OldLastReviewedAt { get; set; }
        public bool OldHasEverGraduated { get; set; } = false;
        public double? OldStability { get; set; }
        public double? OldDifficulty { get; set; }
        public int OldLapses { get; set; }

        // What was reviewed (SrsReviewKind: 0 learn, 1 review, 2 relearn, 3 reading credit)
        // and the interval it produced, for retention and maturity statistics.
        public int Kind { get; set; }
        public int? NewInterval { get; set; }

        // Word status before and after this review changed it (word-status sync), so undo can
        // restore it, but only while the word still has the status the review gave it.
        public int? WordStatusBefore { get; set; }
        public int? WordStatusAfter { get; set; }

        // Client-generated idempotency key for offline replays; filtered-unique per user.
        [StringLength(64)]
        public string? ClientEventId { get; set; }

        // Navigation properties
        public virtual User User { get; set; } = null!;
        public virtual SrsCardReview SrsCardReview { get; set; } = null!;
    }
}
