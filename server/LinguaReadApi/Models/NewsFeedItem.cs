using System;
using System.ComponentModel.DataAnnotations;

namespace LinguaReadApi.Models
{
    /// <summary>
    /// A feed entry the importer has already dealt with, imported or skipped (too short, page
    /// unreachable). Keeps an article from coming back after the user deletes it. Rows of entries
    /// that have left the feed are pruned after a while.
    /// </summary>
    public class NewsFeedItem
    {
        [Key]
        public long NewsFeedItemId { get; set; }

        public int NewsFeedId { get; set; }

        // SHA-256 (hex) of the entry's guid/id, or of its link when it has none.
        [Required]
        [StringLength(64)]
        public string ItemKey { get; set; } = string.Empty;

        // True when it became a text; false when it was skipped.
        public bool Imported { get; set; }

        public DateTime FirstSeenAt { get; set; }

        // Last time the entry was still in the feed.
        public DateTime LastSeenAt { get; set; }

        public virtual NewsFeed NewsFeed { get; set; } = null!;
    }
}
