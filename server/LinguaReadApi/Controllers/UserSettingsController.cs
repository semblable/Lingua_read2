using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Ai;
using LinguaReadApi.Services.Srs;
using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class UserSettingsController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly DiscordReportService _discordReportService;

        public UserSettingsController(
            AppDbContext context,
            DiscordReportService discordReportService)
        {
            _context = context;
            _discordReportService = discordReportService;
        }

        // GET: api/usersettings
        [HttpGet]
        public async Task<ActionResult<UserSettingsDto>> GetUserSettings()
        {
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            
            var settings = await _context.UserSettings
                .FirstOrDefaultAsync(s => s.UserId == userId);
                
            if (settings == null)
            {
                // Create default settings if they don't exist
                settings = new UserSettings
                {
                    UserId = userId,
                    Theme = "light",
                    TextSize = 16,
                    TextFont = "default",
                    ReadingUiMode = "classic",
                    ReaderContentWidth = 740,
                    ReadingDensity = "balanced",
                    LineSpacing = 1.5,
                    ShowWordInfoPanel = true,
                    TooltipOnlyForSavedWords = false,
                    ReaderParagraphIndent = true,
                    ReaderTextAlignment = "left",
                    AutoTranslateWords = true,
                    AutoTranslateOnOpen = false,
                    PauseOnWordClick = false,
                    HighlightKnownWords = true,
                    SentenceMode = false,
                    SentenceAudioRepeats = 1,
                    SentenceTtsEnabled = false,
                    SentenceTtsRate = 1.0,
                    DefaultLanguageId = 0,
                    TranslationTargetLanguageCode = "EN",
                    WordTranslationProvider = "deepl",
                    WiktionaryRichDisplay = false,
                    WiktionaryAccessToken = null,
                    AutoAdvanceToNextLesson = false,
                    AutoAdvanceAudiobookTracks = true,
                    AutoMoveFinishedLessons = false, // Added property
                    ShowProgressStats = true,
                    CreatedAt = DateTime.UtcNow,
                    LeftPanelWidth = 85, // Set default panel width
                    DiscordWeeklyReportEnabled = false,
                    DiscordWebhookUrl = null,
                    DiscordWeeklyReportDayOfWeek = "Monday",
                    DiscordWeeklyReportHourLocal = 8,
                    DiscordTimezoneOffsetMinutes = 0,
                    HardcoverSyncEnabled = false,
                    HardcoverApiToken = null,
                    AiProvider = AiProviderCatalog.BuiltInGemini,
                    OpenRouterReasoningEnabled = false,
                    OpenRouterReasoningEffort = "medium",
                    OpenRouterStoryReasoningEnabled = false,
                    OpenRouterStoryReasoningEffort = "medium"
                };

                _context.UserSettings.Add(settings);
                await _context.SaveChangesAsync();
            }

            var aiProviders = await _context.UserAiProviders.Where(p => p.UserId == userId).ToListAsync();

            return new UserSettingsDto
            {
                Theme = settings.Theme,
                TextSize = settings.TextSize,
                TextFont = settings.TextFont,
                ReadingUiMode = settings.ReadingUiMode,
                ReaderContentWidth = settings.ReaderContentWidth,
                ReadingDensity = settings.ReadingDensity,
                LineSpacing = settings.LineSpacing,
                ShowWordInfoPanel = settings.ShowWordInfoPanel,
                TooltipOnlyForSavedWords = settings.TooltipOnlyForSavedWords,
                ReaderParagraphIndent = settings.ReaderParagraphIndent,
                ReaderTextAlignment = settings.ReaderTextAlignment,
                AutoTranslateWords = settings.AutoTranslateWords,
                AutoTranslateOnOpen = settings.AutoTranslateOnOpen,
                PauseOnWordClick = settings.PauseOnWordClick,
                HighlightKnownWords = settings.HighlightKnownWords,
                SentenceMode = settings.SentenceMode,
                SentenceAudioRepeats = settings.SentenceAudioRepeats,
                SentenceTtsEnabled = settings.SentenceTtsEnabled,
                SentenceTtsRate = settings.SentenceTtsRate,
                DefaultLanguageId = settings.DefaultLanguageId,
                TranslationTargetLanguageCode = settings.TranslationTargetLanguageCode,
                WordTranslationProvider = settings.WordTranslationProvider,
                WiktionaryRichDisplay = settings.WiktionaryRichDisplay,
                HasWiktionaryAccessToken = !string.IsNullOrWhiteSpace(settings.WiktionaryAccessToken),
                HasAzureTranslatorKey = !string.IsNullOrWhiteSpace(settings.AzureTranslatorKey),
                AzureTranslatorRegion = settings.AzureTranslatorRegion,
                HasGoogleTranslateApiKey = !string.IsNullOrWhiteSpace(settings.GoogleTranslateApiKey),
                AutoAdvanceToNextLesson = settings.AutoAdvanceToNextLesson,
                AutoAdvanceAudiobookTracks = settings.AutoAdvanceAudiobookTracks,
                AutoMoveFinishedLessons = settings.AutoMoveFinishedLessons, // Added
                ShowProgressStats = settings.ShowProgressStats,
                ShowDesktopLessonControls = settings.ShowDesktopLessonControls,
                CurrentAudiobookTrackId = settings.CurrentAudiobookTrackId, // Added
                CurrentAudiobookPosition = settings.CurrentAudiobookPosition, // Added
                LeftPanelWidth = settings.LeftPanelWidth, // Map panel width to DTO
                DiscordWeeklyReportEnabled = settings.DiscordWeeklyReportEnabled,
                HasDiscordWebhookUrl = !string.IsNullOrWhiteSpace(settings.DiscordWebhookUrl),
                DiscordWeeklyReportDayOfWeek = settings.DiscordWeeklyReportDayOfWeek,
                DiscordWeeklyReportHourLocal = settings.DiscordWeeklyReportHourLocal,
                DiscordTimezoneOffsetMinutes = settings.DiscordTimezoneOffsetMinutes,
                HardcoverSyncEnabled = settings.HardcoverSyncEnabled,
                HasHardcoverApiToken = !string.IsNullOrWhiteSpace(settings.HardcoverApiToken),
                HardcoverLastSyncAt = settings.HardcoverLastSyncAt,
                AiProvider = AiProviderCatalog.NormalizeSelection(settings.AiProvider) ?? AiProviderCatalog.BuiltInGemini,
                AiProviders = aiProviders.ToDictionary(p => p.Provider, AiProviderConfigDto.From),
                AiProvidersWithApiKey = aiProviders.Where(p => !string.IsNullOrWhiteSpace(p.ApiKey)).Select(p => p.Provider).Order().ToList(),
                OpenRouterReasoningEnabled = settings.OpenRouterReasoningEnabled,
                OpenRouterReasoningEffort = settings.OpenRouterReasoningEffort,
                OpenRouterStoryReasoningEnabled = settings.OpenRouterStoryReasoningEnabled,
                OpenRouterStoryReasoningEffort = settings.OpenRouterStoryReasoningEffort,
                CustomTranslationPrompt = settings.CustomTranslationPrompt,
                CustomExplanationPrompt = settings.CustomExplanationPrompt,
                CustomStoryPrompt = settings.CustomStoryPrompt,
                CustomSummarizationPrompt = settings.CustomSummarizationPrompt,
                SrsMaxNewCards = settings.SrsMaxNewCards,
                SrsMaxReviews = settings.SrsMaxReviews,
                SrsReviewOrder = settings.SrsReviewOrder ?? "mix",
                SrsLearningStepMinutes = settings.SrsLearningStepMinutes ?? "1,10",
                SrsMaxIntervalDays = settings.SrsMaxIntervalDays,
                SrsLapseMinimumIntervalDays = settings.SrsLapseMinimumIntervalDays,
                SrsCardType = NormalizeSrsCardType(settings.SrsCardType),
                SrsRelearningStepMinutes = settings.SrsRelearningStepMinutes ?? "10",
                SrsDesiredRetention = settings.SrsDesiredRetention,
                SrsDayStartHour = settings.SrsDayStartHour,
                SrsFsrsWeights = settings.SrsFsrsWeights,
                SrsAutoCreateCards = SrsCardLifecycle.AutoCreateMode(settings),
                SrsStatusSyncMode = SrsCardLifecycle.StatusSyncMode(settings),
                SrsStatusLevel3Days = settings.SrsStatusLevel3Days,
                SrsStatusLevel4Days = settings.SrsStatusLevel4Days,
                SrsAutoKnownDays = settings.SrsAutoKnownDays,
                SrsKnownCardAction = SrsCardLifecycle.KnownCardAction(settings),
                SrsLeechThreshold = SrsLeeches.Threshold(settings),
                SrsLeechAction = SrsLeeches.LeechAction(settings)
            };
        }

        // PUT: api/usersettings?timezoneOffsetMinutes=120
        // The offset is the user's (as on the SRS endpoints); it only matters when a change
        // reschedules SRS cards, which fall due at the start of a local day.
        [HttpPut]
        public async Task<ActionResult<UserSettingsDto>> UpdateUserSettings(
            [FromBody] UpdateUserSettingsDto updateDto,
            [FromQuery] int timezoneOffsetMinutes = 0)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }
            
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            
            var settings = await _context.UserSettings
                .FirstOrDefaultAsync(s => s.UserId == userId);
                
            if (settings == null)
            {
                // Create settings if they don't exist
                settings = new UserSettings
                {
                    UserId = userId,
                    CreatedAt = DateTime.UtcNow
                };
                _context.UserSettings.Add(settings);
            }
            
            // Update settings with provided values
            settings.Theme = updateDto.Theme ?? settings.Theme;
            settings.TextSize = updateDto.TextSize ?? settings.TextSize;
            settings.TextFont = updateDto.TextFont ?? settings.TextFont;
            if (!string.IsNullOrWhiteSpace(updateDto.ReadingUiMode))
            {
                var normalizedReadingUiMode = updateDto.ReadingUiMode.Trim().ToLowerInvariant();
                if (normalizedReadingUiMode == "classic" || normalizedReadingUiMode == "modern")
                {
                    settings.ReadingUiMode = normalizedReadingUiMode;
                }
            }
            if (updateDto.ReaderContentWidth.HasValue &&
                updateDto.ReaderContentWidth.Value >= 520 &&
                updateDto.ReaderContentWidth.Value <= 980)
            {
                settings.ReaderContentWidth = updateDto.ReaderContentWidth.Value;
            }
            if (!string.IsNullOrWhiteSpace(updateDto.ReadingDensity))
            {
                var normalizedReadingDensity = updateDto.ReadingDensity.Trim().ToLowerInvariant();
                if (normalizedReadingDensity == "compact" || normalizedReadingDensity == "balanced" || normalizedReadingDensity == "spacious")
                {
                    settings.ReadingDensity = normalizedReadingDensity;
                }
            }
            settings.LineSpacing = updateDto.LineSpacing ?? settings.LineSpacing;
            settings.ShowWordInfoPanel = updateDto.ShowWordInfoPanel ?? settings.ShowWordInfoPanel;
            settings.TooltipOnlyForSavedWords = updateDto.TooltipOnlyForSavedWords ?? settings.TooltipOnlyForSavedWords;
            settings.ReaderParagraphIndent = updateDto.ReaderParagraphIndent ?? settings.ReaderParagraphIndent;
            if (!string.IsNullOrWhiteSpace(updateDto.ReaderTextAlignment))
            {
                var normalizedReaderTextAlignment = updateDto.ReaderTextAlignment.Trim().ToLowerInvariant();
                if (normalizedReaderTextAlignment == "left" || normalizedReaderTextAlignment == "justify")
                {
                    settings.ReaderTextAlignment = normalizedReaderTextAlignment;
                }
            }
            settings.AutoTranslateWords = updateDto.AutoTranslateWords ?? settings.AutoTranslateWords;
            settings.AutoTranslateOnOpen = updateDto.AutoTranslateOnOpen ?? settings.AutoTranslateOnOpen;
            settings.PauseOnWordClick = updateDto.PauseOnWordClick ?? settings.PauseOnWordClick;
            settings.HighlightKnownWords = updateDto.HighlightKnownWords ?? settings.HighlightKnownWords;
            settings.SentenceMode = updateDto.SentenceMode ?? settings.SentenceMode;
            settings.SentenceAudioRepeats = updateDto.SentenceAudioRepeats ?? settings.SentenceAudioRepeats;
            settings.SentenceTtsEnabled = updateDto.SentenceTtsEnabled ?? settings.SentenceTtsEnabled;
            settings.SentenceTtsRate = updateDto.SentenceTtsRate ?? settings.SentenceTtsRate;
            settings.DefaultLanguageId = updateDto.DefaultLanguageId ?? settings.DefaultLanguageId;
            if (!string.IsNullOrWhiteSpace(updateDto.TranslationTargetLanguageCode))
            {
                settings.TranslationTargetLanguageCode = updateDto.TranslationTargetLanguageCode.Trim().ToUpperInvariant();
            }
            if (!string.IsNullOrWhiteSpace(updateDto.WordTranslationProvider))
            {
                var normalizedProvider = updateDto.WordTranslationProvider.Trim().ToLowerInvariant();
                if (normalizedProvider is "deepl" or "wiktionary" or "azure" or "google")
                {
                    settings.WordTranslationProvider = normalizedProvider;
                }
            }
            settings.WiktionaryRichDisplay = updateDto.WiktionaryRichDisplay ?? settings.WiktionaryRichDisplay;
            // null = leave unchanged; empty string = clear it (back to anonymous). Mirrors the
            // AI provider key handling below.
            if (updateDto.WiktionaryAccessToken != null)
            {
                settings.WiktionaryAccessToken = string.IsNullOrWhiteSpace(updateDto.WiktionaryAccessToken)
                    ? null
                    : updateDto.WiktionaryAccessToken.Trim();
            }
            // Per-user Azure/Google credentials: null = leave unchanged, empty = clear (fall back
            // to the server-level config). Same convention as the Wiktionary token above.
            if (updateDto.AzureTranslatorKey != null)
            {
                settings.AzureTranslatorKey = string.IsNullOrWhiteSpace(updateDto.AzureTranslatorKey)
                    ? null
                    : updateDto.AzureTranslatorKey.Trim();
            }
            if (updateDto.AzureTranslatorRegion != null)
            {
                settings.AzureTranslatorRegion = string.IsNullOrWhiteSpace(updateDto.AzureTranslatorRegion)
                    ? null
                    : updateDto.AzureTranslatorRegion.Trim();
            }
            if (updateDto.GoogleTranslateApiKey != null)
            {
                settings.GoogleTranslateApiKey = string.IsNullOrWhiteSpace(updateDto.GoogleTranslateApiKey)
                    ? null
                    : updateDto.GoogleTranslateApiKey.Trim();
            }
            settings.AutoAdvanceToNextLesson = updateDto.AutoAdvanceToNextLesson ?? settings.AutoAdvanceToNextLesson;
            settings.AutoAdvanceAudiobookTracks = updateDto.AutoAdvanceAudiobookTracks ?? settings.AutoAdvanceAudiobookTracks;
            settings.AutoMoveFinishedLessons = updateDto.AutoMoveFinishedLessons ?? settings.AutoMoveFinishedLessons; // Update property
            settings.ShowProgressStats = updateDto.ShowProgressStats ?? settings.ShowProgressStats;
            settings.ShowDesktopLessonControls = updateDto.ShowDesktopLessonControls ?? settings.ShowDesktopLessonControls;
            settings.LeftPanelWidth = updateDto.LeftPanelWidth ?? settings.LeftPanelWidth; // Update panel width
            settings.DiscordWeeklyReportEnabled = updateDto.DiscordWeeklyReportEnabled ?? settings.DiscordWeeklyReportEnabled;
            if (updateDto.DiscordWebhookUrl != null)
            {
                settings.DiscordWebhookUrl = string.IsNullOrWhiteSpace(updateDto.DiscordWebhookUrl)
                    ? null
                    : updateDto.DiscordWebhookUrl.Trim();
            }
            if (!string.IsNullOrWhiteSpace(updateDto.DiscordWeeklyReportDayOfWeek) &&
                Enum.TryParse(updateDto.DiscordWeeklyReportDayOfWeek, true, out DayOfWeek dayOfWeek))
            {
                settings.DiscordWeeklyReportDayOfWeek = dayOfWeek.ToString();
            }
            if (updateDto.DiscordWeeklyReportHourLocal.HasValue &&
                updateDto.DiscordWeeklyReportHourLocal.Value >= 0 &&
                updateDto.DiscordWeeklyReportHourLocal.Value <= 23)
            {
                settings.DiscordWeeklyReportHourLocal = updateDto.DiscordWeeklyReportHourLocal.Value;
            }
            if (updateDto.DiscordTimezoneOffsetMinutes.HasValue &&
                updateDto.DiscordTimezoneOffsetMinutes.Value >= -840 &&
                updateDto.DiscordTimezoneOffsetMinutes.Value <= 840)
            {
                settings.DiscordTimezoneOffsetMinutes = updateDto.DiscordTimezoneOffsetMinutes.Value;
            }
            settings.HardcoverSyncEnabled = updateDto.HardcoverSyncEnabled ?? settings.HardcoverSyncEnabled;
            if (updateDto.ClearHardcoverApiToken == true)
            {
                settings.HardcoverApiToken = null;
                settings.HardcoverSyncEnabled = false;
            }
            else if (updateDto.HardcoverApiToken != null)
            {
                settings.HardcoverApiToken = string.IsNullOrWhiteSpace(updateDto.HardcoverApiToken)
                    ? null
                    : updateDto.HardcoverApiToken.Trim();
            }
            if (updateDto.AiProvider != null)
            {
                var selection = AiProviderCatalog.NormalizeSelection(updateDto.AiProvider);
                if (selection == null)
                {
                    return BadRequest(new { message = $"aiProvider must be one of: {string.Join(", ", AllAiProviderSelections())} (got '{updateDto.AiProvider}')." });
                }
                settings.AiProvider = selection;
            }
            var aiProviders = await _context.UserAiProviders.Where(p => p.UserId == userId).ToListAsync();
            if (ApplyAiProviderChanges(updateDto, userId, aiProviders) is { } aiProviderError)
            {
                return BadRequest(new { message = aiProviderError });
            }
            settings.OpenRouterReasoningEnabled = updateDto.OpenRouterReasoningEnabled ?? settings.OpenRouterReasoningEnabled;
            if (!string.IsNullOrWhiteSpace(updateDto.OpenRouterReasoningEffort))
            {
                var normalizedEffort = updateDto.OpenRouterReasoningEffort.Trim().ToLowerInvariant();
                if (normalizedEffort is "xhigh" or "high" or "medium" or "low" or "minimal" or "none")
                {
                    settings.OpenRouterReasoningEffort = normalizedEffort;
                }
            }
            settings.OpenRouterStoryReasoningEnabled = updateDto.OpenRouterStoryReasoningEnabled ?? settings.OpenRouterStoryReasoningEnabled;
            if (!string.IsNullOrWhiteSpace(updateDto.OpenRouterStoryReasoningEffort))
            {
                var normalizedEffort = updateDto.OpenRouterStoryReasoningEffort.Trim().ToLowerInvariant();
                if (normalizedEffort is "xhigh" or "high" or "medium" or "low" or "minimal" or "none")
                {
                    settings.OpenRouterStoryReasoningEffort = normalizedEffort;
                }
            }
            if (updateDto.CustomTranslationPrompt != null)
            {
                settings.CustomTranslationPrompt = string.IsNullOrWhiteSpace(updateDto.CustomTranslationPrompt)
                    ? null
                    : updateDto.CustomTranslationPrompt;
            }
            if (updateDto.CustomExplanationPrompt != null)
            {
                settings.CustomExplanationPrompt = string.IsNullOrWhiteSpace(updateDto.CustomExplanationPrompt)
                    ? null
                    : updateDto.CustomExplanationPrompt;
            }
            if (updateDto.CustomStoryPrompt != null)
            {
                settings.CustomStoryPrompt = string.IsNullOrWhiteSpace(updateDto.CustomStoryPrompt)
                    ? null
                    : updateDto.CustomStoryPrompt;
            }
            if (updateDto.CustomSummarizationPrompt != null)
            {
                settings.CustomSummarizationPrompt = string.IsNullOrWhiteSpace(updateDto.CustomSummarizationPrompt)
                    ? null
                    : updateDto.CustomSummarizationPrompt;
            }
            // Retention, maximum interval and weights shift every graduated card's ideal
            // interval, and the day start moves the local hour cards fall due at (raised, a
            // stored due time would land on the previous day), so a change to any of them
            // reschedules those cards (in the same save).
            var scheduleBefore = (settings.SrsDesiredRetention, settings.SrsMaxIntervalDays, settings.SrsFsrsWeights, settings.SrsDayStartHour);
            settings.SrsMaxNewCards = updateDto.SrsMaxNewCards ?? settings.SrsMaxNewCards;
            settings.SrsMaxReviews = updateDto.SrsMaxReviews ?? settings.SrsMaxReviews;
            if (!string.IsNullOrWhiteSpace(updateDto.SrsReviewOrder))
            {
                var normalizedOrder = updateDto.SrsReviewOrder.Trim().ToLowerInvariant();
                if (normalizedOrder is "mix" or "new_first" or "reviews_first")
                {
                    settings.SrsReviewOrder = normalizedOrder;
                }
            }
            if (updateDto.SrsLearningStepMinutes != null)
            {
                settings.SrsLearningStepMinutes = string.IsNullOrWhiteSpace(updateDto.SrsLearningStepMinutes)
                    ? "1,10"
                    : updateDto.SrsLearningStepMinutes.Trim();
            }
            settings.SrsMaxIntervalDays = updateDto.SrsMaxIntervalDays ?? settings.SrsMaxIntervalDays;
            settings.SrsLapseMinimumIntervalDays = updateDto.SrsLapseMinimumIntervalDays ?? settings.SrsLapseMinimumIntervalDays;
            if (updateDto.SrsRelearningStepMinutes != null)
            {
                settings.SrsRelearningStepMinutes = string.IsNullOrWhiteSpace(updateDto.SrsRelearningStepMinutes)
                    ? "10"
                    : updateDto.SrsRelearningStepMinutes.Trim();
            }
            if (updateDto.SrsDesiredRetention is { } desiredRetention)
            {
                settings.SrsDesiredRetention = Math.Round(desiredRetention, 3);
            }
            settings.SrsDayStartHour = updateDto.SrsDayStartHour ?? settings.SrsDayStartHour;
            if (updateDto.SrsFsrsWeights != null)
            {
                if (!FsrsParameters.TryParse(updateDto.SrsFsrsWeights, out _, out var weightsError))
                {
                    return BadRequest(new { message = weightsError });
                }
                settings.SrsFsrsWeights = string.IsNullOrWhiteSpace(updateDto.SrsFsrsWeights)
                    ? null
                    : updateDto.SrsFsrsWeights.Trim();
            }
            if (!string.IsNullOrWhiteSpace(updateDto.SrsCardType))
            {
                var normalizedCardType = updateDto.SrsCardType.Trim().ToLowerInvariant();
                if (normalizedCardType is "translation" or "cloze" or "mixed")
                {
                    settings.SrsCardType = normalizedCardType;
                }
                else
                {
                    // Reject explicitly instead of silently keeping the old value —
                    // a client sending an unknown SrsCardType would otherwise see a
                    // 200 OK with no change and have no way to know its request was
                    // dropped.
                    return BadRequest(new
                    {
                        message = $"srsCardType must be one of: translation, cloze, mixed (got '{updateDto.SrsCardType}')."
                    });
                }
            }
            // Word-status sync. Enumerations are rejected rather than silently ignored,
            // like SrsCardType above.
            string? NormalizeChoice(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToLowerInvariant();
            if (NormalizeChoice(updateDto.SrsAutoCreateCards) is { } autoCreate)
            {
                if (!SrsCardLifecycle.IsAutoCreate(autoCreate))
                    return BadRequest(new { message = "srsAutoCreateCards must be one of: always, with_sentence, never." });
                settings.SrsAutoCreateCards = autoCreate;
            }
            if (NormalizeChoice(updateDto.SrsStatusSyncMode) is { } syncMode)
            {
                if (!SrsCardLifecycle.IsSyncMode(syncMode))
                    return BadRequest(new { message = "srsStatusSyncMode must be one of: off, promote, promote_demote." });
                settings.SrsStatusSyncMode = syncMode;
            }
            if (NormalizeChoice(updateDto.SrsKnownCardAction) is { } knownAction)
            {
                if (!SrsCardLifecycle.IsKnownAction(knownAction))
                    return BadRequest(new { message = "srsKnownCardAction must be one of: keep, suspend." });
                settings.SrsKnownCardAction = knownAction;
            }
            if (NormalizeChoice(updateDto.SrsLeechAction) is { } leechAction)
            {
                if (!SrsLeeches.IsAction(leechAction))
                    return BadRequest(new { message = "srsLeechAction must be one of: tag, suspend." });
                settings.SrsLeechAction = leechAction;
            }
            settings.SrsLeechThreshold = updateDto.SrsLeechThreshold ?? settings.SrsLeechThreshold;
            var level3Days = updateDto.SrsStatusLevel3Days ?? settings.SrsStatusLevel3Days;
            var level4Days = updateDto.SrsStatusLevel4Days ?? settings.SrsStatusLevel4Days;
            var autoKnownDays = updateDto.SrsAutoKnownDays ?? settings.SrsAutoKnownDays;
            if (level4Days < level3Days || (autoKnownDays > 0 && autoKnownDays < level4Days))
            {
                return BadRequest(new { message = "Status thresholds must rise: level 3 <= level 4 <= auto-Known (or auto-Known off)." });
            }
            settings.SrsStatusLevel3Days = level3Days;
            settings.SrsStatusLevel4Days = level4Days;
            settings.SrsAutoKnownDays = autoKnownDays;
            settings.UpdatedAt = DateTime.UtcNow;

            // One save for the settings and the cards: if rescheduling failed after the settings
            // were stored, a retry would see nothing changed and never reschedule.
            if (scheduleBefore != (settings.SrsDesiredRetention, settings.SrsMaxIntervalDays, settings.SrsFsrsWeights, settings.SrsDayStartHour))
            {
                await SrsRescheduler.RescheduleUserAsync(_context, userId, settings, timezoneOffsetMinutes);
            }

            await _context.SaveChangesAsync();

            return new UserSettingsDto
            {
                Theme = settings.Theme,
                TextSize = settings.TextSize,
                TextFont = settings.TextFont,
                ReadingUiMode = settings.ReadingUiMode,
                ReaderContentWidth = settings.ReaderContentWidth,
                ReadingDensity = settings.ReadingDensity,
                LineSpacing = settings.LineSpacing,
                ShowWordInfoPanel = settings.ShowWordInfoPanel,
                TooltipOnlyForSavedWords = settings.TooltipOnlyForSavedWords,
                ReaderParagraphIndent = settings.ReaderParagraphIndent,
                ReaderTextAlignment = settings.ReaderTextAlignment,
                AutoTranslateWords = settings.AutoTranslateWords,
                AutoTranslateOnOpen = settings.AutoTranslateOnOpen,
                PauseOnWordClick = settings.PauseOnWordClick,
                HighlightKnownWords = settings.HighlightKnownWords,
                SentenceMode = settings.SentenceMode,
                SentenceAudioRepeats = settings.SentenceAudioRepeats,
                SentenceTtsEnabled = settings.SentenceTtsEnabled,
                SentenceTtsRate = settings.SentenceTtsRate,
                DefaultLanguageId = settings.DefaultLanguageId,
                TranslationTargetLanguageCode = settings.TranslationTargetLanguageCode,
                WordTranslationProvider = settings.WordTranslationProvider,
                WiktionaryRichDisplay = settings.WiktionaryRichDisplay,
                HasWiktionaryAccessToken = !string.IsNullOrWhiteSpace(settings.WiktionaryAccessToken),
                HasAzureTranslatorKey = !string.IsNullOrWhiteSpace(settings.AzureTranslatorKey),
                AzureTranslatorRegion = settings.AzureTranslatorRegion,
                HasGoogleTranslateApiKey = !string.IsNullOrWhiteSpace(settings.GoogleTranslateApiKey),
                AutoAdvanceToNextLesson = settings.AutoAdvanceToNextLesson,
                AutoAdvanceAudiobookTracks = settings.AutoAdvanceAudiobookTracks,
                AutoMoveFinishedLessons = settings.AutoMoveFinishedLessons, // Update property
                ShowProgressStats = settings.ShowProgressStats,
                ShowDesktopLessonControls = settings.ShowDesktopLessonControls,
                LeftPanelWidth = settings.LeftPanelWidth, // Map panel width to DTO
                DiscordWeeklyReportEnabled = settings.DiscordWeeklyReportEnabled,
                HasDiscordWebhookUrl = !string.IsNullOrWhiteSpace(settings.DiscordWebhookUrl),
                DiscordWeeklyReportDayOfWeek = settings.DiscordWeeklyReportDayOfWeek,
                DiscordWeeklyReportHourLocal = settings.DiscordWeeklyReportHourLocal,
                DiscordTimezoneOffsetMinutes = settings.DiscordTimezoneOffsetMinutes,
                HardcoverSyncEnabled = settings.HardcoverSyncEnabled,
                HasHardcoverApiToken = !string.IsNullOrWhiteSpace(settings.HardcoverApiToken),
                HardcoverLastSyncAt = settings.HardcoverLastSyncAt,
                AiProvider = AiProviderCatalog.NormalizeSelection(settings.AiProvider) ?? AiProviderCatalog.BuiltInGemini,
                AiProviders = aiProviders.ToDictionary(p => p.Provider, AiProviderConfigDto.From),
                AiProvidersWithApiKey = aiProviders.Where(p => !string.IsNullOrWhiteSpace(p.ApiKey)).Select(p => p.Provider).Order().ToList(),
                OpenRouterReasoningEnabled = settings.OpenRouterReasoningEnabled,
                OpenRouterReasoningEffort = settings.OpenRouterReasoningEffort,
                OpenRouterStoryReasoningEnabled = settings.OpenRouterStoryReasoningEnabled,
                OpenRouterStoryReasoningEffort = settings.OpenRouterStoryReasoningEffort,
                CustomTranslationPrompt = settings.CustomTranslationPrompt,
                CustomExplanationPrompt = settings.CustomExplanationPrompt,
                CustomStoryPrompt = settings.CustomStoryPrompt,
                CustomSummarizationPrompt = settings.CustomSummarizationPrompt,
                SrsMaxNewCards = settings.SrsMaxNewCards,
                SrsMaxReviews = settings.SrsMaxReviews,
                SrsReviewOrder = settings.SrsReviewOrder ?? "mix",
                SrsLearningStepMinutes = settings.SrsLearningStepMinutes ?? "1,10",
                SrsMaxIntervalDays = settings.SrsMaxIntervalDays,
                SrsLapseMinimumIntervalDays = settings.SrsLapseMinimumIntervalDays,
                SrsCardType = NormalizeSrsCardType(settings.SrsCardType),
                SrsRelearningStepMinutes = settings.SrsRelearningStepMinutes ?? "10",
                SrsDesiredRetention = settings.SrsDesiredRetention,
                SrsDayStartHour = settings.SrsDayStartHour,
                SrsFsrsWeights = settings.SrsFsrsWeights,
                SrsAutoCreateCards = SrsCardLifecycle.AutoCreateMode(settings),
                SrsStatusSyncMode = SrsCardLifecycle.StatusSyncMode(settings),
                SrsStatusLevel3Days = settings.SrsStatusLevel3Days,
                SrsStatusLevel4Days = settings.SrsStatusLevel4Days,
                SrsAutoKnownDays = settings.SrsAutoKnownDays,
                SrsKnownCardAction = SrsCardLifecycle.KnownCardAction(settings),
                SrsLeechThreshold = SrsLeeches.Threshold(settings),
                SrsLeechAction = SrsLeeches.LeechAction(settings)
            };
        }

        // Defensive normalizer: legacy rows or hand-edits could land outside the
        // ("translation"|"cloze"|"mixed") set. Default to translation so the
        // existing card UI keeps working.
        private static string NormalizeSrsCardType(string? value)
        {
            var normalized = (value ?? "translation").Trim().ToLowerInvariant();
            return normalized is "translation" or "cloze" or "mixed" ? normalized : "translation";
        }

        private static IEnumerable<string> AllAiProviderSelections() =>
            new[] { AiProviderCatalog.BuiltInGemini }.Concat(AiProviderCatalog.Providers.Select(p => p.Id));

        /// <summary>
        /// Applies the per-provider settings and keys of an update to the user's provider rows,
        /// adding rows as needed. Returns an error message for an unknown provider or invalid value,
        /// before changing anything.
        /// </summary>
        private string? ApplyAiProviderChanges(UpdateUserSettingsDto updateDto, Guid userId, List<UserAiProvider> rows)
        {
            var configs = updateDto.AiProviders ?? new Dictionary<string, AiProviderConfigDto>();
            var keys = updateDto.AiApiKeys ?? new Dictionary<string, string?>();

            // Validate first, so a bad entry leaves every provider untouched.
            var normalizedBaseUrls = new Dictionary<string, string?>();
            foreach (var (providerId, config) in configs)
            {
                var definition = AiProviderCatalog.Find(providerId);
                if (definition == null) return $"Unknown AI provider '{providerId}'.";
                if (config == null) continue;
                foreach (var model in new[] { config.Model, config.TranslationModel, config.ExplanationModel, config.StoryModel, config.SummarizationModel })
                {
                    if (model != null && model.Trim().Length > AiProviderConfigDto.MaxModelLength)
                        return $"{definition.DisplayName}: model names are limited to {AiProviderConfigDto.MaxModelLength} characters.";
                }
                if (definition.RequiresBaseUrl && config.BaseUrl != null)
                {
                    if (config.BaseUrl.Length > AiProviderConfigDto.MaxBaseUrlLength)
                        return $"{definition.DisplayName}: the base URL is limited to {AiProviderConfigDto.MaxBaseUrlLength} characters.";
                    if (!AiProviderCatalog.TryNormalizeBaseUrl(config.BaseUrl, out var baseUrl, out var baseUrlError))
                        return $"{definition.DisplayName}: {baseUrlError}";
                    normalizedBaseUrls[definition.Id] = baseUrl;
                }
            }
            foreach (var (providerId, key) in keys)
            {
                var definition = AiProviderCatalog.Find(providerId);
                if (definition == null) return $"Unknown AI provider '{providerId}'.";
                if (key != null && key.Trim().Length > MaxAiApiKeyLength)
                    return $"{definition.DisplayName}: the API key is limited to {MaxAiApiKeyLength} characters.";
            }

            UserAiProvider RowFor(AiProviderDefinition definition)
            {
                var row = rows.FirstOrDefault(r => r.Provider == definition.Id);
                if (row == null)
                {
                    row = new UserAiProvider { UserId = userId, Provider = definition.Id };
                    rows.Add(row);
                    _context.UserAiProviders.Add(row);
                }
                return row;
            }

            // Every field: null = leave unchanged, empty = clear.
            static string? Clean(string? value, string? current) =>
                value == null ? current : string.IsNullOrWhiteSpace(value) ? null : value.Trim();

            foreach (var (providerId, config) in configs)
            {
                if (config == null) continue;
                var definition = AiProviderCatalog.Find(providerId)!;
                var row = RowFor(definition);
                row.Model = Clean(config.Model, row.Model);
                row.TranslationModel = Clean(config.TranslationModel, row.TranslationModel);
                row.ExplanationModel = Clean(config.ExplanationModel, row.ExplanationModel);
                row.StoryModel = Clean(config.StoryModel, row.StoryModel);
                row.SummarizationModel = Clean(config.SummarizationModel, row.SummarizationModel);
                if (normalizedBaseUrls.TryGetValue(definition.Id, out var baseUrl))
                {
                    row.BaseUrl = baseUrl;
                }
            }
            foreach (var (providerId, key) in keys)
            {
                if (key == null) continue;
                var row = RowFor(AiProviderCatalog.Find(providerId)!);
                row.ApiKey = string.IsNullOrWhiteSpace(key) ? null : key.Trim();
            }
            return null;
        }

        private const int MaxAiApiKeyLength = 1024;

        // PUT: api/usersettings/audiobook-progress
        [HttpPut("audiobook-progress")]
        public async Task<IActionResult> UpdateAudiobookProgress([FromBody] UpdateAudiobookProgressDto updateDto)
        {
            if (!ModelState.IsValid)
            {
                return BadRequest(ModelState);
            }

            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            var settings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);

            if (settings == null)
            {
                // Optionally create settings if they don't exist, or return NotFound/BadRequest
                 return NotFound("User settings not found.");
                // Or create default:
                // settings = new UserSettings { UserId = userId, CreatedAt = DateTime.UtcNow };
                // _context.UserSettings.Add(settings);
            }

            // Optional: Validate if the trackId exists and belongs to the user
            if (updateDto.CurrentAudiobookTrackId.HasValue)
            {
                 var trackExists = await _context.AudiobookTracks
                     .AnyAsync(at => at.Id == updateDto.CurrentAudiobookTrackId.Value && at.Book.UserId == userId);
                 if (!trackExists)
                 {
                     return BadRequest("Invalid Audiobook Track ID or track does not belong to user.");
                 }
            }
             else // If trackId is null, position should also be null
             {
                 if (updateDto.CurrentAudiobookPosition.HasValue)
                 {
                     return BadRequest("Audiobook position cannot be set without a valid Track ID.");
                 }
             }


            settings.CurrentAudiobookTrackId = updateDto.CurrentAudiobookTrackId;
            settings.CurrentAudiobookPosition = updateDto.CurrentAudiobookPosition;
            settings.UpdatedAt = DateTime.UtcNow;

            await _context.SaveChangesAsync();

            return NoContent(); // Indicate success without returning data
        }

        // POST: api/usersettings/discord/report
        [HttpPost("discord/report")]
        public async Task<IActionResult> SendDiscordReport([FromQuery] string period = "week", [FromQuery] int? days = null)
        {
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            var settings = await _context.UserSettings.FirstOrDefaultAsync(s => s.UserId == userId);
            if (settings == null)
            {
                settings = new UserSettings { UserId = userId, CreatedAt = DateTime.UtcNow };
                _context.UserSettings.Add(settings);
                await _context.SaveChangesAsync();
            }

            var nowUtc = DateTime.UtcNow;
            var range = ResolveReportRange(nowUtc, period, days);
            if (!range.IsValid)
            {
                return BadRequest(range.Error);
            }

            var sendResult = await _discordReportService.SendReportForUserAsync(
                settings,
                range.StartUtc,
                range.EndUtc,
                false,
                HttpContext.RequestAborted);

            if (sendResult.Sent)
            {
                return Ok(new { message = "Report sent successfully." });
            }

            if (sendResult.Skipped)
            {
                return Ok(new { message = sendResult.Reason ?? "Report skipped." });
            }

            return BadRequest(new { message = sendResult.Reason ?? "Unable to send report." });
        }

        // GET: api/usersettings/audio-storage-size
        [HttpGet("audio-storage-size")]
        public async Task<ActionResult<AudioStorageSizeDto>> GetAudioStorageSize()
        {
            if (!TryGetUserIdFromClaims(out var userId, out var unauthorizedBody))
                return Unauthorized(unauthorizedBody);
            
            long totalSize = 0;
            int totalFiles = 0;

            try
            {
                // Get the wwwroot path
                var wwwrootPath = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot");
                
                // Calculate audiobooks size
                var audiobooksPath = Path.Combine(wwwrootPath, "audiobooks");
                if (Directory.Exists(audiobooksPath))
                {
                    var userBooks = await _context.Books
                        .Where(b => b.UserId == userId)
                        .Select(b => b.BookId)
                        .ToListAsync();

                    foreach (var bookId in userBooks)
                    {
                        var bookPath = Path.Combine(audiobooksPath, bookId.ToString());
                        if (Directory.Exists(bookPath))
                        {
                            var files = Directory.GetFiles(bookPath, "*", SearchOption.AllDirectories);
                            foreach (var file in files)
                            {
                                var fileInfo = new FileInfo(file);
                                totalSize += fileInfo.Length;
                                totalFiles++;
                            }
                        }
                    }
                }

                // Calculate audio lessons size
                var audioLessonsPath = Path.Combine(wwwrootPath, "audio_lessons");
                if (Directory.Exists(audioLessonsPath))
                {
                    var userTexts = await _context.Texts
                        .Where(t => t.UserId == userId && t.IsAudioLesson && !string.IsNullOrEmpty(t.AudioFilePath))
                        .Select(t => t.AudioFilePath)
                        .ToListAsync();

                    foreach (var audioPath in userTexts)
                    {
                        var fullPath = Path.Combine(wwwrootPath, audioPath!.TrimStart('/'));
                        if (System.IO.File.Exists(fullPath))
                        {
                            var fileInfo = new FileInfo(fullPath);
                            totalSize += fileInfo.Length;
                            totalFiles++;
                        }
                    }
                }

                return new AudioStorageSizeDto
                {
                    TotalSizeBytes = totalSize,
                    TotalSizeMB = Math.Round(totalSize / (1024.0 * 1024.0), 2),
                    TotalSizeGB = Math.Round(totalSize / (1024.0 * 1024.0 * 1024.0), 2),
                    TotalFiles = totalFiles
                };
            }
            catch (Exception ex)
            {
                return BadRequest(new { message = $"Failed to calculate storage size: {ex.Message}" });
            }
        }

        private static ReportRange ResolveReportRange(DateTime nowUtc, string period, int? days)
        {
            var normalized = (period ?? string.Empty).Trim().ToLowerInvariant();
            if (normalized == "days")
            {
                if (!days.HasValue || days.Value <= 0)
                {
                    return ReportRange.Invalid("Days must be a positive number when period=days.");
                }

                var cappedDays = Math.Min(days.Value, 3650);
                return ReportRange.Valid(nowUtc.AddDays(-cappedDays), nowUtc);
            }

            return normalized switch
            {
                "week" => ReportRange.Valid(nowUtc.AddDays(-7), nowUtc),
                "month" => ReportRange.Valid(nowUtc.AddDays(-30), nowUtc),
                "year" => ReportRange.Valid(nowUtc.AddDays(-365), nowUtc),
                "all" => ReportRange.Valid(DateTime.MinValue, nowUtc),
                _ => ReportRange.Invalid("Unsupported period. Use week, month, year, all, or days.")
            };
        }

        private readonly record struct ReportRange(DateTime StartUtc, DateTime EndUtc, bool IsValid, string? Error)
        {
            public static ReportRange Valid(DateTime startUtc, DateTime endUtc) =>
                new(startUtc, endUtc, true, null);

            public static ReportRange Invalid(string error) =>
                new(DateTime.MinValue, DateTime.MinValue, false, error);
        }

        /// <summary>Returns false if NameIdentifier is missing or not a valid GUID.</summary>
        private bool TryGetUserIdFromClaims(out Guid userId, out object unauthorizedBody)
        {
            userId = default;
            unauthorizedBody = new { message = "User ID not found in token" };
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrEmpty(userIdClaim))
                return false;
            if (!Guid.TryParse(userIdClaim, out userId))
            {
                unauthorizedBody = new { message = "Invalid user identifier in token" };
                return false;
            }

            return true;
        }
    }

    public class UserSettingsDto
    {
        public string Theme { get; set; } = "light";
        public int TextSize { get; set; } = 16;
        public string TextFont { get; set; } = "default";
        public string ReadingUiMode { get; set; } = "classic";
        public int ReaderContentWidth { get; set; } = 740;
        public string ReadingDensity { get; set; } = "balanced";
        public double LineSpacing { get; set; } = 1.5;
        public bool ShowWordInfoPanel { get; set; } = true;
        public bool TooltipOnlyForSavedWords { get; set; } = false;
        public bool ReaderParagraphIndent { get; set; } = true;
        public string ReaderTextAlignment { get; set; } = "left";
        public int LeftPanelWidth { get; set; } // Already added in previous step, ensure it's correct
        public bool AutoTranslateWords { get; set; } = true;
        public bool AutoTranslateOnOpen { get; set; } = false;
        public bool PauseOnWordClick { get; set; } = false;
        public bool HighlightKnownWords { get; set; } = true;
        public bool SentenceMode { get; set; } = false;
        public int SentenceAudioRepeats { get; set; } = 1;
        public bool SentenceTtsEnabled { get; set; } = false;
        public double SentenceTtsRate { get; set; } = 1.0;
        public int DefaultLanguageId { get; set; } = 0;
        public string TranslationTargetLanguageCode { get; set; } = "EN";
        public string WordTranslationProvider { get; set; } = "deepl";
        public bool WiktionaryRichDisplay { get; set; } = false;
        // Write-only secrets: never returned to the client (any logged-in XSS could otherwise
        // read them). Surfaced only as a boolean "is one configured?"; the raw value is set via
        // UpdateUserSettingsDto. Mirrors HasHardcoverApiToken.
        public bool HasWiktionaryAccessToken { get; set; }
        public bool HasAzureTranslatorKey { get; set; }
        public string? AzureTranslatorRegion { get; set; }
        public bool HasGoogleTranslateApiKey { get; set; }
        public bool AutoAdvanceToNextLesson { get; set; } = false;
        public bool AutoAdvanceAudiobookTracks { get; set; } = true;
        public bool AutoMoveFinishedLessons { get; set; } = false; // Added property
        public bool ShowProgressStats { get; set; } = true;
        public bool ShowDesktopLessonControls { get; set; } = true;
        public int? CurrentAudiobookTrackId { get; set; } // Added
        public double? CurrentAudiobookPosition { get; set; } // Added
        public bool DiscordWeeklyReportEnabled { get; set; } = false;
        // Write-only secret: the webhook URL is a posting capability, so it is never returned to
        // the browser (only whether one is configured). Set/cleared via UpdateUserSettingsDto.
        public bool HasDiscordWebhookUrl { get; set; }
        public string DiscordWeeklyReportDayOfWeek { get; set; } = "Monday";
        public int DiscordWeeklyReportHourLocal { get; set; } = 8;
        public int DiscordTimezoneOffsetMinutes { get; set; } = 0;
        public bool HardcoverSyncEnabled { get; set; } = false;
        public bool HasHardcoverApiToken { get; set; } = false;
        public DateTime? HardcoverLastSyncAt { get; set; }
        // "gemini" (built-in) or an AiProviderCatalog id.
        public string AiProvider { get; set; } = AiProviderCatalog.BuiltInGemini;
        // The settings of each provider the user has set up, by provider id.
        public Dictionary<string, AiProviderConfigDto> AiProviders { get; set; } = new();
        // Write-only secrets: only which providers have a key is returned, never the key.
        public List<string> AiProvidersWithApiKey { get; set; } = new();
        public bool OpenRouterReasoningEnabled { get; set; } = false;
        public string OpenRouterReasoningEffort { get; set; } = "medium";
        public bool OpenRouterStoryReasoningEnabled { get; set; } = false;
        public string OpenRouterStoryReasoningEffort { get; set; } = "medium";

        // Per-task custom prompt overrides
        public string? CustomTranslationPrompt { get; set; }
        public string? CustomExplanationPrompt { get; set; }
        public string? CustomStoryPrompt { get; set; }
        public string? CustomSummarizationPrompt { get; set; }

        // SRS Settings
        public int SrsMaxNewCards { get; set; } = 20;
        public int SrsMaxReviews { get; set; } = 200;
        public string SrsReviewOrder { get; set; } = "mix";
        public string? SrsLearningStepMinutes { get; set; } = "1,10";
        public int SrsMaxIntervalDays { get; set; } = 36500;
        public int SrsLapseMinimumIntervalDays { get; set; } = 1;
        public string SrsCardType { get; set; } = "translation";
        public string SrsRelearningStepMinutes { get; set; } = "10";
        public double SrsDesiredRetention { get; set; } = 0.9;
        public int SrsDayStartHour { get; set; } = 4;
        public string? SrsFsrsWeights { get; set; }
        public string SrsAutoCreateCards { get; set; } = "always";
        public string SrsStatusSyncMode { get; set; } = "promote";
        public int SrsStatusLevel3Days { get; set; } = 7;
        public int SrsStatusLevel4Days { get; set; } = 21;
        public int SrsAutoKnownDays { get; set; }
        public string SrsKnownCardAction { get; set; } = "keep";
        public int SrsLeechThreshold { get; set; } = 8;
        public string SrsLeechAction { get; set; } = "tag";
    }

    public class UpdateUserSettingsDto
    {
        public string? Theme { get; set; }
        
        [Range(10, 36)]
        public int? TextSize { get; set; }
        
        public string? TextFont { get; set; }
        [StringLength(20)]
        public string? ReadingUiMode { get; set; }
        [Range(520, 980)]
        public int? ReaderContentWidth { get; set; }
        [StringLength(20)]
        public string? ReadingDensity { get; set; }
        [Range(1.0, 3.0)]
        public double? LineSpacing { get; set; }
        public bool? ShowWordInfoPanel { get; set; }
        public bool? TooltipOnlyForSavedWords { get; set; }
        public bool? ReaderParagraphIndent { get; set; }
        [StringLength(20)]
        public string? ReaderTextAlignment { get; set; }

        [Range(10, 100)] // Widen range to accept broader values
        public int? LeftPanelWidth { get; set; } // Already added in previous step, ensure it's correct
        public bool? AutoTranslateWords { get; set; }
        public bool? AutoTranslateOnOpen { get; set; }
        public bool? PauseOnWordClick { get; set; }
        public bool? HighlightKnownWords { get; set; }
        public bool? SentenceMode { get; set; }
        [Range(1, 10)]
        public int? SentenceAudioRepeats { get; set; }
        public bool? SentenceTtsEnabled { get; set; }
        [Range(0.5, 1.5)]
        public double? SentenceTtsRate { get; set; }
        public int? DefaultLanguageId { get; set; }
        [StringLength(20)]
        public string? TranslationTargetLanguageCode { get; set; }
        [StringLength(20)]
        public string? WordTranslationProvider { get; set; }
        public bool? WiktionaryRichDisplay { get; set; }
        [StringLength(2048)]
        public string? WiktionaryAccessToken { get; set; }
        [StringLength(512)]
        public string? AzureTranslatorKey { get; set; }
        [StringLength(64)]
        public string? AzureTranslatorRegion { get; set; }
        [StringLength(512)]
        public string? GoogleTranslateApiKey { get; set; }
        public bool? AutoAdvanceToNextLesson { get; set; }
        public bool? AutoAdvanceAudiobookTracks { get; set; }
        public bool? AutoMoveFinishedLessons { get; set; } // Added property
        public bool? ShowProgressStats { get; set; }
        public bool? ShowDesktopLessonControls { get; set; }

        public bool? DiscordWeeklyReportEnabled { get; set; }

        [StringLength(2048)]
        public string? DiscordWebhookUrl { get; set; }

        [StringLength(20)]
        public string? DiscordWeeklyReportDayOfWeek { get; set; }

        [Range(0, 23)]
        public int? DiscordWeeklyReportHourLocal { get; set; }

        [Range(-840, 840)]
        public int? DiscordTimezoneOffsetMinutes { get; set; }

        // Hardcover Settings
        public bool? HardcoverSyncEnabled { get; set; }

        [StringLength(2048)]
        public string? HardcoverApiToken { get; set; }

        public bool? ClearHardcoverApiToken { get; set; }

        // AI provider: "gemini" or an AiProviderCatalog id.
        [StringLength(32)]
        public string? AiProvider { get; set; }

        // Per-provider settings by provider id. In each entry null leaves a field unchanged and an
        // empty string clears it.
        public Dictionary<string, AiProviderConfigDto>? AiProviders { get; set; }

        // Write-only API keys by provider id; an empty string removes the key.
        public Dictionary<string, string?>? AiApiKeys { get; set; }

        public bool? OpenRouterReasoningEnabled { get; set; }

        [StringLength(20)]
        public string? OpenRouterReasoningEffort { get; set; }

        public bool? OpenRouterStoryReasoningEnabled { get; set; }

        [StringLength(20)]
        public string? OpenRouterStoryReasoningEffort { get; set; }

        // Per-task custom prompts (empty/whitespace clears the override)
        [StringLength(8000)]
        public string? CustomTranslationPrompt { get; set; }

        [StringLength(8000)]
        public string? CustomExplanationPrompt { get; set; }

        [StringLength(8000)]
        public string? CustomStoryPrompt { get; set; }

        [StringLength(8000)]
        public string? CustomSummarizationPrompt { get; set; }

        // SRS Settings
        [Range(1, 9999)]
        public int? SrsMaxNewCards { get; set; }

        [Range(1, 9999)]
        public int? SrsMaxReviews { get; set; }

        [StringLength(20)]
        public string? SrsReviewOrder { get; set; }

        [StringLength(50)]
        public string? SrsLearningStepMinutes { get; set; }

        [Range(1, 36500)]
        public int? SrsMaxIntervalDays { get; set; }

        [Range(1, 365)]
        public int? SrsLapseMinimumIntervalDays { get; set; }

        [StringLength(20)]
        public string? SrsCardType { get; set; }

        [StringLength(50)]
        public string? SrsRelearningStepMinutes { get; set; }

        // FSRS target recall probability when a card comes due.
        [Range(0.70, 0.97)]
        public double? SrsDesiredRetention { get; set; }

        // Local hour at which a new SRS day begins.
        [Range(0, 23)]
        public int? SrsDayStartHour { get; set; }

        // 21 comma-separated FSRS weights; empty string resets to the defaults.
        [StringLength(1000)]
        public string? SrsFsrsWeights { get; set; }

        // Word-status sync (see SrsCardLifecycle).
        [StringLength(20)]
        public string? SrsAutoCreateCards { get; set; }

        [StringLength(20)]
        public string? SrsStatusSyncMode { get; set; }

        [Range(1, 3650)]
        public int? SrsStatusLevel3Days { get; set; }

        [Range(1, 3650)]
        public int? SrsStatusLevel4Days { get; set; }

        // 0 turns auto-Known off.
        [Range(0, 36500)]
        public int? SrsAutoKnownDays { get; set; }

        [StringLength(20)]
        public string? SrsKnownCardAction { get; set; }

        // Lapses that make a card a leech; 0 turns leech detection off.
        [Range(0, 100)]
        public int? SrsLeechThreshold { get; set; }

        [StringLength(20)]
        public string? SrsLeechAction { get; set; }
    }

    public class UpdateAudiobookProgressDto
    {
        // Nullable to allow clearing the current track
        public int? CurrentAudiobookTrackId { get; set; }

        // Nullable, should only be non-null if TrackId is non-null
        [Range(0, double.MaxValue)]
        public double? CurrentAudiobookPosition { get; set; } // Position in seconds
    }

    public class AudioStorageSizeDto
    {
        public long TotalSizeBytes { get; set; }
        public double TotalSizeMB { get; set; }
        public double TotalSizeGB { get; set; }
        public int TotalFiles { get; set; }
    }

    /// <summary>One AI provider's settings (never its key). Model fields left empty fall back as described on UserAiProvider.</summary>
    public class AiProviderConfigDto
    {
        public const int MaxModelLength = 200;
        public const int MaxBaseUrlLength = 500;

        // Only used by the "custom" provider.
        public string? BaseUrl { get; set; }
        public string? Model { get; set; }
        public string? TranslationModel { get; set; }
        public string? ExplanationModel { get; set; }
        public string? StoryModel { get; set; }
        public string? SummarizationModel { get; set; }

        public static AiProviderConfigDto From(UserAiProvider row) => new()
        {
            BaseUrl = row.BaseUrl,
            Model = row.Model,
            TranslationModel = row.TranslationModel,
            ExplanationModel = row.ExplanationModel,
            StoryModel = row.StoryModel,
            SummarizationModel = row.SummarizationModel
        };
    }
} 