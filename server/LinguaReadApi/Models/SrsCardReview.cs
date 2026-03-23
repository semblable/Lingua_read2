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

        // Learning Steps
        public bool IsLearning { get; set; } = false;
        public int CurrentLearningStepIndex { get; set; } = 0;

        // Suspend & Bury
        public bool IsSuspended { get; set; } = false;
        public DateTime? BuriedUntil { get; set; }

        // Card Flags/Tags
        public int Flag { get; set; } = 0;        // 0=none, 1-4=colored flags
        public string? Tags { get; set; }          // comma-separated user tags

        // Navigation properties
        public virtual Word Word { get; set; } = null!;
        public virtual User User { get; set; } = null!;
    }
}
