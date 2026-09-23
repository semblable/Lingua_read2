using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    /// <summary>
    /// A bookmarked sentence in a text. Composite key (UserId, TextId, SentenceIndex),
    /// defined in AppDbContext.
    ///
    /// Removing a bookmark keeps the row with IsActive = false (a tombstone) so its
    /// UpdatedAt still wins against a stale offline "add" replayed later from
    /// another device; deleting the row would let that replay resurrect it.
    /// </summary>
    public class TextBookmark
    {
        [Required]
        public Guid UserId { get; set; }

        [Required]
        public int TextId { get; set; }

        [Required]
        public int SentenceIndex { get; set; }

        public bool IsActive { get; set; } = true;

        // When the bookmark was (last) added; the newest active one is the
        // reader's scroll-on-open anchor.
        public DateTime BookmarkedAt { get; set; } = DateTime.UtcNow;

        // Last add or remove; the stale-replay guard compares against it.
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        [ForeignKey("UserId")]
        public virtual User User { get; set; } = null!;

        [ForeignKey("TextId")]
        public virtual Text Text { get; set; } = null!;
    }
}
