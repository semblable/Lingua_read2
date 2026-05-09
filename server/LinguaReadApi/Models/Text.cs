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

        public string? StructuredContent { get; set; }

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

        // Optional Folder relationship
        [ForeignKey("Folder")]
        public int? FolderId { get; set; }

        // Position within folder for custom ordering
        public int SortOrder { get; set; } = 0;

        // Navigation properties
        public virtual User User { get; set; } = null!;
        public virtual Language Language { get; set; } = null!;
        public virtual Book? Book { get; set; } // Made nullable to match BookId
        public virtual Folder? Folder { get; set; }
        public virtual ICollection<TextWord> TextWords { get; set; } = new List<TextWord>();

        // Properties for Audio Lessons
        public bool IsAudioLesson { get; set; } = false;
        public string? AudioFilePath { get; set; } // Path to the associated audio file
        public string? SrtContent { get; set; } // Raw content of the SRT file

        // New field to track completion status
        public bool IsFinished { get; set; } = false;

        // Timestamp of the most recent completion (first-time or re-read).
        // Used by CompleteLesson to dedupe retries within a short window.
        public DateTime? LastCompletedAt { get; set; }

        // Background word-linking status: null (legacy/done), "processing", "completed", "failed"
        [StringLength(20)]
        public string? WordLinkingStatus { get; set; }

        // Cached unique-word stats for this text. Populated by CompleteText
        // and the nightly StatsRecomputeService; surfaced as a "% unknown"
        // indicator on standalone texts in the library.
        public int TotalWords { get; set; } = 0;
        public int KnownWords { get; set; } = 0;
        public DateTime? StatsUpdatedAt { get; set; }

        // Version of the tokenizer that produced the current TextWord
        // links. Bumped when the tokenization algorithm changes in a way
        // that would alter the token sequence (e.g. apostrophe/hyphen
        // glue, char substitutions). The migration BackgroundService
        // re-links texts whose version is below the current one. Null
        // means "legacy" (pre-versioning) and is treated as < any value.
        public int? WordLinkingTokenizerVersion { get; set; }
    }
}