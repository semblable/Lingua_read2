using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class UserSentenceProgress
    {
        [Required]
        public Guid UserId { get; set; }

        [Required]
        public int TextId { get; set; }

        [Required]
        public string CreditedSegmentIndicesJson { get; set; } = "[]";

        public int CreditedWordCount { get; set; } = 0;

        public int? LastSegmentIndex { get; set; }

        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey("UserId")]
        public virtual User User { get; set; } = null!;

        [ForeignKey("TextId")]
        public virtual Text Text { get; set; } = null!;
    }
}
