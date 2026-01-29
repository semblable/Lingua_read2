using System;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace LinguaReadApi.Models
{
    public class UserSettings
    {
        [Key]
        [ForeignKey("User")]
        public Guid UserId { get; set; }
        
        // UI Preferences
        public string Theme { get; set; } = "light"; // light, dark, system
        public int TextSize { get; set; } = 16; // font size for reading
        public string TextFont { get; set; } = "default"; // font family for reading
        public int LeftPanelWidth { get; set; } = 85; // Reading panel width percentage (default 85%)

        // Reading Preferences
        public bool AutoTranslateWords { get; set; } = true; // automatically translate words on click
        public bool HighlightKnownWords { get; set; } = true; // highlight words based on knowledge level
        public int DefaultLanguageId { get; set; } = 0; // default language for new texts
        
        // Navigation Preferences
        public bool AutoAdvanceToNextLesson { get; set; } = false; // automatically go to next lesson after completion
        public bool ShowProgressStats { get; set; } = true; // show progress statistics

        // Audiobook Playback State
        public int? CurrentAudiobookTrackId { get; set; } // FK to AudiobookTrack
        public double? CurrentAudiobookPosition { get; set; } // Position in seconds

        // Discord reporting
        public bool DiscordWeeklyReportEnabled { get; set; } = false;

        [StringLength(2048)]
        public string? DiscordWebhookUrl { get; set; }

        [StringLength(20)]
        public string DiscordWeeklyReportDayOfWeek { get; set; } = "Monday";

        [Range(0, 23)]
        public int DiscordWeeklyReportHourLocal { get; set; } = 8;

        [Range(-840, 840)]
        public int DiscordTimezoneOffsetMinutes { get; set; } = 0;

        public DateTime? DiscordWeeklyReportLastSentAt { get; set; }
        
        // Creation timestamps
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
        
        // Navigation property
        public virtual User User { get; set; } = null!;
    }
} 