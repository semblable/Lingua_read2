using System;
using System.ComponentModel.DataAnnotations;

namespace LinguaReadApi.Models
{
    /// <summary>
    /// An RSS/Atom feed a user follows. While <see cref="UserSettings.NewsImportEnabled"/> is on,
    /// NewsFeedBackgroundService imports its new articles as texts into <see cref="FolderId"/>.
    /// </summary>
    public class NewsFeed
    {
        public const int MaxUrlLength = 2000;
        public const int MaxTitleLength = 200;
        public const int MaxErrorLength = 500;

        [Key]
        public int NewsFeedId { get; set; }

        public Guid UserId { get; set; }

        // The feed document's address (after autodiscovery, when the user gave a web page).
        [Required]
        [StringLength(MaxUrlLength)]
        public string Url { get; set; } = string.Empty;

        // The feed's own title; also names the folder its articles go to.
        [Required]
        [StringLength(MaxTitleLength)]
        public string Title { get; set; } = string.Empty;

        // The language its articles are imported as.
        public int LanguageId { get; set; }

        // Where its articles go. Created on the first import (News › <Title>); null again if the
        // user deletes the folder, and then recreated.
        public int? FolderId { get; set; }

        // A paused feed stays in the list but isn't checked.
        public bool Enabled { get; set; } = true;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Last check, successful or not; the background service spaces checks by it.
        public DateTime? LastCheckedAt { get; set; }

        public DateTime? LastSuccessAt { get; set; }

        // Why the last check failed; null after a successful one.
        [StringLength(MaxErrorLength)]
        public string? LastError { get; set; }

        // Failed checks in a row; each one doubles the wait before the next check (up to a day).
        public int ConsecutiveFailures { get; set; }

        public virtual User User { get; set; } = null!;
        public virtual Language Language { get; set; } = null!;
        public virtual Folder? Folder { get; set; }
    }
}
