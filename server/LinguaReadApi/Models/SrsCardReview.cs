using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class SrsCardReview
    {
        [Key]
        public int SrsCardReviewId { get; set; }

        [Required]
        [ForeignKey("Word")]
        public int WordId { get; set; }

        [Required]
        [ForeignKey("User")]
        public Guid UserId { get; set; }

        // SM-2 algorithm fields
        public double EaseFactor { get; set; } = 2.5;
        public int Interval { get; set; } = 0;        // Days until next review
        public int Repetitions { get; set; } = 0;     // Consecutive correct reviews

        public DateTime? LastReviewedAt { get; set; }
        public DateTime NextReviewAt { get; set; } = DateTime.UtcNow; // Due immediately on creation
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation properties
        public virtual Word Word { get; set; } = null!;
        public virtual User User { get; set; } = null!;
    }
}
