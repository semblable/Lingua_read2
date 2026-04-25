using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    // History row written when a recurring goal's period rolls over.
    public class UserGoalPeriod
    {
        [Key]
        public int PeriodId { get; set; }

        [Required]
        [ForeignKey("Goal")]
        public int GoalId { get; set; }

        [Required]
        public DateOnly PeriodStart { get; set; }

        [Required]
        public DateOnly PeriodEnd { get; set; }

        [Required]
        public long FinalProgress { get; set; }

        // Captured target so editing the parent goal's target doesn't rewrite history.
        [Required]
        public long TargetAtTime { get; set; }

        [Required]
        public bool Completed { get; set; }

        [Required]
        public DateTime ClosedAt { get; set; }

        public virtual UserGoal Goal { get; set; } = null!;
    }
}
