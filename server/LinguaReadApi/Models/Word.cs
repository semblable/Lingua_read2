using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class Word
    {
        [Key]
        public int WordId { get; set; }
        
        [Required]
        [StringLength(100)]
        public string Term { get; set; } = string.Empty;
        
        [Required]
        [Range(1, 6)]
        public int Status { get; set; } = 1; // 1: New, 2-3: Learning, 4: Advanced, 5: Known, 6: Ignored
        
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        
        [ForeignKey("Language")]
        public int LanguageId { get; set; }
        
        [ForeignKey("User")]
        public Guid UserId { get; set; }
        
        // Navigation properties
        public virtual Language Language { get; set; } = null!;
        public virtual User User { get; set; } = null!;
        public virtual WordTranslation Translation { get; set; } = null!;
        public virtual ICollection<TextWord> TextWords { get; set; } = new List<TextWord>();
    }

    public class TextWord
    {
        [Key]
        public int TextWordId { get; set; }

        [ForeignKey("Text")]
        public int TextId { get; set; }

        [ForeignKey("Word")]
        public int WordId { get; set; }

        // Number of running tokens of this word inside the linked text.
        // Drives running-word stats (TotalWords/KnownWords) on Text and
        // Book. Defaults to 1 so legacy rows produced before this column
        // existed still aggregate to a sensible (under-counted) value
        // until the tokenizer-version bump re-links them.
        public int OccurrenceCount { get; set; } = 1;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation properties
        public virtual Text Text { get; set; } = null!;
        public virtual Word Word { get; set; } = null!;
    }
} 