using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class UserActivity
    {
        [Key]
        public int ActivityId { get; set; }
        
        [Required]
        public Guid UserId { get; set; }
        
        [Required]
        public int LanguageId { get; set; }
        
        [Required]
        [StringLength(50)]
        public string ActivityType { get; set; } = string.Empty;
        
        [Required]
        public int WordCount { get; set; }
        
        [Required]
        public DateTime Timestamp { get; set; }

        // Duration for listening activities
        public int? ListeningDurationSeconds { get; set; }

        // Client-generated idempotency key. Set by offline listening flushes so a
        // queued replay (or a request whose response was lost on a flaky link)
        // can be deduped instead of double-counting the seconds. Nullable +
        // filtered-unique on (UserId, ClientEventId) so legacy rows are unaffected.
        [StringLength(64)]
        public string? ClientEventId { get; set; }

        // Audiobook progress tracking is handled in UserSettings model
        // public int? CurrentAudiobookTrackId { get; set; } // Foreign key to AudiobookTrack
        // public double? CurrentAudiobookPosition { get; set; } // Position in seconds within the current track
        
        // Navigation properties
        public virtual Language? Language { get; set; }
    }
} 