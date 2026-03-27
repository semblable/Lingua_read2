using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class Book
    {
        [Key]
        public int BookId { get; set; }
        
        [Required]
        [StringLength(200)]
        public string Title { get; set; } = string.Empty;
        
        [StringLength(1000)]
        public string Description { get; set; } = string.Empty;

        [StringLength(500)]
        public string? CoverImagePath { get; set; }
        
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        
        // Last read part tracking
        public int? LastReadPartId { get; set; }
        
        // Reading statistics
        public int TotalWords { get; set; } = 0;
        public int KnownWords { get; set; } = 0;
        public int LearningWords { get; set; } = 0;
        public DateTime? LastReadAt { get; set; }
        public bool IsFinished { get; set; } = false;
        
        // Track which texts have been read
        [NotMapped] // Not stored directly in the database
        public List<int> ReadTextIds { get; set; } = new List<int>();
        
        // Foreign keys
        [ForeignKey("User")]
        public Guid UserId { get; set; }
        
        // [ForeignKey("Language")] // Removed redundant attribute, configured via Fluent API in AppDbContext
        public int LanguageId { get; set; }
        
        [ForeignKey("LastReadText")]
        public int? LastReadTextId { get; set; }

        // Optional Folder relationship
        [ForeignKey("Folder")]
        public int? FolderId { get; set; }

        // Position within folder for custom ordering
        public int SortOrder { get; set; } = 0;
        
        // Navigation properties
        public virtual User User { get; set; } = null!;
        public virtual Language Language { get; set; } = null!;
        public virtual Text LastReadText { get; set; } = null!;
        public virtual ICollection<Text> Texts { get; set; } = new List<Text>();
        public virtual Folder? Folder { get; set; }
        public virtual ICollection<BookTag> BookTags { get; set; } = new List<BookTag>();
        public virtual ICollection<AudiobookTrack> AudiobookTracks { get; set; } = new List<AudiobookTrack>(); // Added for Audiobook feature
    }
} 