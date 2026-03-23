using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class SrsPhrase
    {
        [Key]
        public int SrsPhraseId { get; set; }

        [Required]
        [ForeignKey("Word")]
        public int WordId { get; set; }

        [Required]
        [ForeignKey("User")]
        public Guid UserId { get; set; }

        [Required]
        public string Sentence { get; set; } = string.Empty;

        [ForeignKey("Text")]
        public int? TextId { get; set; }          // Source text (nullable if text is deleted)

        [StringLength(200)]
        public string? TextTitle { get; set; }     // Denormalized for display

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation properties
        public virtual Word Word { get; set; } = null!;
        public virtual User User { get; set; } = null!;
        public virtual Text? Text { get; set; }
    }
}
