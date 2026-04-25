using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public enum GoalType
    {
        WordsRead = 1,
        ListeningSeconds = 2,
        WordsKnown = 3
    }

    public enum GoalMode
    {
        Delta = 1,
        Milestone = 2
    }

    public enum GoalRecurrence
    {
        None = 0,
        Weekly = 1,
        Monthly = 2
    }

    public class UserGoal
    {
        [Key]
        public int GoalId { get; set; }

        [Required]
        [ForeignKey("User")]
        public Guid UserId { get; set; }

        // null => "all languages"
        [ForeignKey("Language")]
        public int? LanguageId { get; set; }

        [Required]
        public GoalType GoalType { get; set; }

        [Required]
        public GoalMode Mode { get; set; } = GoalMode.Delta;

        [Required]
        public GoalRecurrence Recurrence { get; set; } = GoalRecurrence.None;

        // Delta: target delta from baseline; Milestone: absolute target value.
        // Native unit per type (words / listening seconds).
        [Required]
        public long TargetValue { get; set; }

        // Snapshot at creation; 0 for Milestone.
        [Required]
        public long BaselineValue { get; set; }

        // For recurring goals only: start date of current period (user-TZ)
        // and metric snapshot at that period start.
        public DateOnly? CurrentPeriodStart { get; set; }
        public long? CurrentPeriodBaseline { get; set; }

        // One-shot goals only.
        public DateOnly? Deadline { get; set; }

        [Required]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Captured at creation; used to anchor period boundaries.
        public int CreatedTzOffsetMin { get; set; }

        // One-shot goals: sticky once set.
        public DateTime? CompletedAt { get; set; }

        public DateTime? ArchivedAt { get; set; }

        [StringLength(200)]
        public string? Title { get; set; }

        // Navigation
        public virtual User User { get; set; } = null!;
        public virtual Language? Language { get; set; }
        public virtual ICollection<UserGoalPeriod> Periods { get; set; } = new List<UserGoalPeriod>();
    }
}
