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
        public double OldEaseFactor { get; set; }
        public int OldRepetitions { get; set; }
        public DateTime OldNextReviewAt { get; set; }

        // Navigation properties
        public virtual User User { get; set; } = null!;
        public virtual SrsCardReview SrsCardReview { get; set; } = null!;
    }
}
