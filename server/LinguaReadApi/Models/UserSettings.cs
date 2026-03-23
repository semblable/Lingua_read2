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
        [StringLength(20)]
        public string ReadingUiMode { get; set; } = "classic"; // classic, modern
        public int ReaderContentWidth { get; set; } = 740; // max readable text column width in px
        [StringLength(20)]
        public string ReadingDensity { get; set; } = "balanced"; // compact, balanced, spacious
        public bool ShowWordInfoPanel { get; set; } = true; // show desktop word info panel by default
        public bool ReaderParagraphIndent { get; set; } = true; // indent body paragraphs in reading mode
        [StringLength(20)]
        public string ReaderTextAlignment { get; set; } = "left"; // left, justify
        public int LeftPanelWidth { get; set; } = 85; // Reading panel width percentage (default 85%)

        // Reading Preferences
        public bool AutoTranslateWords { get; set; } = true; // automatically translate words on click
        public bool PauseOnWordClick { get; set; } = false; // pause lesson audio before opening word details
        public bool HighlightKnownWords { get; set; } = true; // highlight words based on knowledge level
        public bool SentenceMode { get; set; } = false; // default reader mode
        public int SentenceAudioRepeats { get; set; } = 1; // play each audio segment N times in sentence mode
        public bool SentenceTtsEnabled { get; set; } = false; // enable browser TTS controls in sentence mode
        public double SentenceTtsRate { get; set; } = 1.0; // browser TTS playback speed
        public int DefaultLanguageId { get; set; } = 0; // default language for new texts
        
        // Navigation Preferences
        public bool AutoAdvanceToNextLesson { get; set; } = false; // automatically go to next lesson after completion
        public bool ShowProgressStats { get; set; } = true; // show progress statistics
        public bool AutoMoveFinishedLessons { get; set; } = false; // automatically move finished lessons to "Finished" folder

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

        // AI Provider Settings (OpenRouter)
        public bool UseOpenRouter { get; set; } = false; // Toggle between Gemini/OpenRouter
        
        [StringLength(256)]
        public string? OpenRouterApiKey { get; set; }
        
        [StringLength(100)]
        public string OpenRouterModel { get; set; } = "google/gemini-2.5-flash-preview-05-20:free";
        
        // SRS Limits & Preferences
        public int SrsMaxNewCards { get; set; } = 20;
        public int SrsMaxReviews { get; set; } = 100;
        public string SrsReviewOrder { get; set; } = "mix"; // "mix", "new_first", "reviews_first"

        // SRS Daily Tracking
        public DateTime? SrsDailyStudyDate { get; set; }
        public int SrsDailyNewCardsStudied { get; set; } = 0;
        public int SrsDailyReviewsStudied { get; set; } = 0;

        // SRS Streak Tracking
        public int SrsCurrentStreak { get; set; } = 0;
        public int SrsLongestStreak { get; set; } = 0;
        
        // Creation timestamps
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
        
        // Navigation property
        public virtual User User { get; set; } = null!;
    }
} 