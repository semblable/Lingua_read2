using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class Text
    {
        [Key]
        public int TextId { get; set; }

        [Required]
        [StringLength(200)]
        public string Title { get; set; } = string.Empty;

        [Required]
        public string Content { get; set; } = string.Empty;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // New field to track last access time
        public DateTime? LastAccessedAt { get; set; }

        // Position within a book (if part of a book)
        public int? PartNumber { get; set; }

        // Optional tag for categorization
        [StringLength(100)] // Optional: Add a reasonable length limit
        public string? Tag { get; set; }

        // Foreign keys
        [ForeignKey("User")]
        public Guid UserId { get; set; }

        [ForeignKey("Language")]
        public int LanguageId { get; set; }

        // Optional Book relationship
        [ForeignKey("Book")]
        public int? BookId { get; set; }

        // Navigation properties
        public virtual User User { get; set; } = null!;
        public virtual Language Language { get; set; } = null!;
        public virtual Book? Book { get; set; } // Made nullable to match BookId
        public virtual ICollection<TextWord> TextWords { get; set; } = new List<TextWord>();

        // Properties for Audio Lessons
        public bool IsAudioLesson { get; set; } = false;
        public string? AudioFilePath { get; set; } // Path to the associated audio file
        public string? SrtContent { get; set; } // Raw content of the SRT file

        // New field to track completion status
        public bool IsFinished { get; set; } = false;
    }
}