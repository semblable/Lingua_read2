using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class Folder
    {
        [Key]
        public int FolderId { get; set; }

        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;

        // Self-referencing for nested folders
        [ForeignKey("ParentFolder")]
        public int? ParentFolderId { get; set; }

        public int SortOrder { get; set; } = 0;

        // Optional color label for visual organization
        [StringLength(20)]
        public string? Color { get; set; }

        // Foreign keys
        [ForeignKey("User")]
        public Guid UserId { get; set; }

        [ForeignKey("Language")]
        public int? LanguageId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation properties
        public virtual User User { get; set; } = null!;
        public virtual Language? Language { get; set; }
        public virtual Folder? ParentFolder { get; set; }
        public virtual ICollection<Folder> ChildFolders { get; set; } = new List<Folder>();
        public virtual ICollection<Text> Texts { get; set; } = new List<Text>();
        public virtual ICollection<Book> Books { get; set; } = new List<Book>();
    }
}
