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
        [Range(1.0, 3.0)]
        public double LineSpacing { get; set; } = 1.5; // reading line height multiplier
        public bool ShowWordInfoPanel { get; set; } = true; // show desktop word info panel by default
        public bool TooltipOnlyForSavedWords { get; set; } = false; // when true, clicking an already-saved single word only shows hover tooltip
        public bool ReaderParagraphIndent { get; set; } = true; // indent body paragraphs in reading mode
        [StringLength(20)]
        public string ReaderTextAlignment { get; set; } = "left"; // left, justify
        public int LeftPanelWidth { get; set; } = 85; // Reading panel width percentage (default 85%)

        // Reading Preferences
        public bool AutoTranslateWords { get; set; } = true; // automatically translate words on click
        public bool AutoTranslateOnOpen { get; set; } = false; // auto-translate all unknown words when opening a text
        public bool PauseOnWordClick { get; set; } = false; // pause lesson audio before opening word details
        public bool HighlightKnownWords { get; set; } = true; // highlight words based on knowledge level
        public bool SentenceMode { get; set; } = false; // default reader mode
        public int SentenceAudioRepeats { get; set; } = 1; // play each audio segment N times in sentence mode
        public bool SentenceTtsEnabled { get; set; } = false; // enable browser TTS controls in sentence mode
        public double SentenceTtsRate { get; set; } = 1.0; // browser TTS playback speed
        public int DefaultLanguageId { get; set; } = 0; // default language for new texts
        [StringLength(20)]
        public string TranslationTargetLanguageCode { get; set; } = "EN"; // target language for glossary translations

        // Word translation provider: "deepl" (default) or "wiktionary".
        // Affects only word-level lookups (TranslationController); sentence/full-text
        // translation always uses the AI providers since Wiktionary is a dictionary.
        [StringLength(20)]
        public string WordTranslationProvider { get; set; } = "deepl";

        // When the Wiktionary provider is active, show rich definitions (part of speech +
        // multiple senses) in the Word Info panel instead of just the flattened gloss.
        public bool WiktionaryRichDisplay { get; set; } = false;

        // Optional Wikimedia OAuth 2.0 access token. When set, Wiktionary word lookups are
        // authenticated, raising the rate limit from <5 req/s (anonymous) to 10 req/s. Tokens
        // can be long (JWTs). Null/empty = anonymous (falls back to the server-level
        // Wiktionary:AccessToken config if one is set).
        // Encrypted at rest → stored as unbounded text; input length is capped on the DTO.
        public string? WiktionaryAccessToken { get; set; }

        // Optional per-user credentials for the Azure Translator word provider. Null/empty falls
        // back to the server-level Azure:Translator:* config. Region is only needed for a regional
        // Azure resource (a global resource needs just the key).
        // Encrypted at rest → stored as unbounded text; input length is capped on the DTO.
        public string? AzureTranslatorKey { get; set; }

        // Region is not a secret (e.g. "westeurope"), so it keeps its length cap and is not encrypted.
        [StringLength(64)]
        public string? AzureTranslatorRegion { get; set; }

        // Optional per-user Google Cloud Translation (v2) API key for the Google word provider.
        // Null/empty falls back to the server-level Google:Translate:ApiKey config.
        // Encrypted at rest → stored as unbounded text; input length is capped on the DTO.
        public string? GoogleTranslateApiKey { get; set; }

        // Navigation Preferences
        public bool AutoAdvanceToNextLesson { get; set; } = false; // automatically go to next lesson after completion
        public bool ShowProgressStats { get; set; } = true; // show progress statistics
        public bool AutoMoveFinishedLessons { get; set; } = false; // automatically move finished lessons to "Finished" folder
        public bool ShowDesktopLessonControls { get; set; } = true; // persist lesson controls panel visibility

        // Audiobook Playback State
        public int? CurrentAudiobookTrackId { get; set; } // FK to AudiobookTrack
        public double? CurrentAudiobookPosition { get; set; } // Position in seconds
        public bool AutoAdvanceAudiobookTracks { get; set; } = true; // play next track automatically when the current one ends

        // Discord reporting
        public bool DiscordWeeklyReportEnabled { get; set; } = false;

        // Encrypted at rest → stored as unbounded text; input length is capped on the DTO.
        public string? DiscordWebhookUrl { get; set; }

        [StringLength(20)]
        public string DiscordWeeklyReportDayOfWeek { get; set; } = "Monday";

        [Range(0, 23)]
        public int DiscordWeeklyReportHourLocal { get; set; } = 8;

        [Range(-840, 840)]
        public int DiscordTimezoneOffsetMinutes { get; set; } = 0;

        public DateTime? DiscordWeeklyReportLastSentAt { get; set; }

        // Hardcover integration
        public bool HardcoverSyncEnabled { get; set; } = false;

        // Encrypted at rest → stored as unbounded text; input length is capped on the DTO.
        public string? HardcoverApiToken { get; set; }

        public DateTime? HardcoverLastSyncAt { get; set; }

        // AI Provider Settings (OpenRouter)
        public bool UseOpenRouter { get; set; } = false; // Toggle between Gemini/OpenRouter
        
        // Encrypted at rest → stored as unbounded text; input length is capped on the DTO.
        public string? OpenRouterApiKey { get; set; }

        [StringLength(100)]
        public string OpenRouterModel { get; set; } = "google/gemini-2.5-flash-preview-05-20:free";

        public bool OpenRouterReasoningEnabled { get; set; } = false;

        [StringLength(20)]
        public string OpenRouterReasoningEffort { get; set; } = "medium";

        // Separate reasoning settings for story generation (translation uses the above)
        public bool OpenRouterStoryReasoningEnabled { get; set; } = false;

        [StringLength(20)]
        public string OpenRouterStoryReasoningEffort { get; set; } = "medium";

        // Per-task model overrides (OpenRouter). Empty/null = fall back to OpenRouterModel.
        [StringLength(100)]
        public string? OpenRouterTranslationModel { get; set; }

        [StringLength(100)]
        public string? OpenRouterExplanationModel { get; set; }

        [StringLength(100)]
        public string? OpenRouterStoryModel { get; set; }

        [StringLength(100)]
        public string? OpenRouterSummarizationModel { get; set; }

        // Per-task custom prompt overrides. Empty/null = use built-in default template.
        [StringLength(8000)]
        public string? CustomTranslationPrompt { get; set; }

        [StringLength(8000)]
        public string? CustomExplanationPrompt { get; set; }

        [StringLength(8000)]
        public string? CustomStoryPrompt { get; set; }

        [StringLength(8000)]
        public string? CustomSummarizationPrompt { get; set; }

        // SRS Limits & Preferences
        public int SrsMaxNewCards { get; set; } = 20;
        public int SrsMaxReviews { get; set; } = 200;
        public string SrsReviewOrder { get; set; } = "mix"; // "mix", "new_first", "reviews_first"

        // SRS Daily Tracking
        public DateTime? SrsDailyStudyDate { get; set; }
        public int SrsDailyNewCardsStudied { get; set; } = 0;
        public int SrsDailyReviewsStudied { get; set; } = 0;

        // SRS Learning Steps
        public string SrsLearningStepMinutes { get; set; } = "1,10"; // comma-separated step intervals in minutes

        // SRS Advanced Settings
        public int SrsMaxIntervalDays { get; set; } = 36500; // Maximum review interval in days (Anki default ~100 years)
        public int SrsLapseMinimumIntervalDays { get; set; } = 1; // Minimum interval after lapse re-graduation

        // SRS Streak Tracking
        public int SrsCurrentStreak { get; set; } = 0;
        public int SrsLongestStreak { get; set; } = 0;

        // SRS Card Type — "translation" (default; show term, recall translation),
        // "cloze" (show mined sentence with target word masked, recall the word),
        // or "mixed" (per-card alternation between the two styles).
        [StringLength(20)]
        public string SrsCardType { get; set; } = "translation";
        
        // Creation timestamps
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
        
        // Navigation property
        public virtual User User { get; set; } = null!;
    }
} 