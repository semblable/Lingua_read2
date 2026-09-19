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

        public int Interval { get; set; } = 0;        // Scheduled interval in days (0 while on a learning step)
        public int Repetitions { get; set; } = 0;     // Total reviews (under SM-2: consecutive successes)

        // FSRS memory state. Null until the card's first review, or until
        // SrsFsrsBackfillService rebuilds it from the review history of an SM-2-era card.
        public double? Stability { get; set; }        // Days until recall probability drops to 90%
        public double? Difficulty { get; set; }       // 1 (easy) .. 10 (hard)
        public int Lapses { get; set; } = 0;          // Times the card was forgotten after graduating

        public DateTime? LastReviewedAt { get; set; }
        public DateTime NextReviewAt { get; set; } = DateTime.UtcNow; // Due immediately on creation
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Learning Steps
        public bool IsLearning { get; set; } = false;
        public int CurrentLearningStepIndex { get; set; } = 0;

        // Suspend & Bury
        public bool IsSuspended { get; set; } = false;
        // Why the card is suspended: see SrsSuspendReasons. Lets un-ignoring a word lift an
        // automatic suspension without also lifting one the user made by hand.
        [StringLength(16)]
        public string? SuspendReason { get; set; }
        public DateTime? BuriedUntil { get; set; }

        // Graduation tracking
        public bool HasEverGraduated { get; set; } = false;

        // Card Flags/Tags
        public int Flag { get; set; } = 0;        // 0=none, 1-4=colored flags
        public string? Tags { get; set; }          // comma-separated user tags

        // Navigation properties
        public virtual Word Word { get; set; } = null!;
        public virtual User User { get; set; } = null!;
    }
}
