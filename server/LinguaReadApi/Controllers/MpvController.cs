using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Claims;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using LinguaReadApi.Services.Srs;
using LinguaReadApi.Services.Tokenization;
using LinguaReadApi.Utilities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/mpv")]
    public class MpvController : ControllerBase
    {
        private const int MaxCuesPerSession = 5000;
        private const int MaxTermLength = 100;
        private const int WiktionaryMaxBatchLookups = 200;

        private static readonly HashSet<string> CyrillicOnlyLanguages = new(StringComparer.Ordinal)
        {
            "ru", "uk", "bg", "be", "mk"
        };

        private static readonly HashSet<string> LatinEuropeanLanguages = new(StringComparer.Ordinal)
        {
            "en", "es", "fr", "de", "it", "pt", "pl", "nl", "cs", "sk", "sl", "hr",
            "da", "sv", "no", "nb", "nn", "fi", "et", "hu", "lv", "lt", "ro", "ca",
            "tr", "sq", "is", "ga", "eu", "gl", "mt", "cy", "af", "bs"
        };

        private readonly AppDbContext _context;
        private readonly IWordTranslationServiceFactory _wordTranslationServiceFactory;
        private readonly ITranslationServiceFactory _sentenceTranslationServiceFactory;
        private readonly ILogger<MpvController> _logger;

        public MpvController(
            AppDbContext context,
            IWordTranslationServiceFactory wordTranslationServiceFactory,
            ITranslationServiceFactory sentenceTranslationServiceFactory,
            ILogger<MpvController> logger)
        {
            _context = context;
            _wordTranslationServiceFactory = wordTranslationServiceFactory;
            _sentenceTranslationServiceFactory = sentenceTranslationServiceFactory;
            _logger = logger;
        }

        [HttpGet("languages")]
        public async Task<ActionResult<MpvLanguagesResponseDto>> GetLanguages(CancellationToken cancellationToken)
        {
            if (!TryGetUserId(out var userId)) return Unauthorized();

            var languages = await _context.Languages
                .AsNoTracking()
                .OrderBy(l => l.Name)
                .Select(l => new MpvLanguageDto
                {
                    LanguageId = l.LanguageId,
                    Name = l.Name,
                    Code = l.Code,
                    ParserType = l.ParserType,
                    RightToLeft = l.RightToLeft
                })
                .ToListAsync(cancellationToken);

            var settings = await _context.UserSettings
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken);

            return Ok(new MpvLanguagesResponseDto
            {
                TranslationTargetLanguageCode = string.IsNullOrWhiteSpace(settings?.TranslationTargetLanguageCode)
                    ? "EN"
                    : settings.TranslationTargetLanguageCode,
                PauseOnWordClick = settings?.PauseOnWordClick ?? false,
                AutoTranslateWords = settings?.AutoTranslateWords ?? true,
                AutoTranslateOnOpen = settings?.AutoTranslateOnOpen ?? false,
                AutoTranslateWordStatus = Math.Clamp(settings?.AutoTranslateWordStatus ?? 5, 1, 5),
                WordTranslationProvider = string.IsNullOrWhiteSpace(settings?.WordTranslationProvider)
                    ? "deepl"
                    : settings.WordTranslationProvider,
                DefaultLanguageId = settings?.DefaultLanguageId ?? 0,
                Languages = languages
            });
        }

        [HttpPost("session")]
        public async Task<ActionResult<MpvSessionResponseDto>> CreateOrSyncSession(
            [FromBody] MpvSessionRequestDto request,
            CancellationToken cancellationToken)
        {
            if (!TryGetUserId(out var userId)) return Unauthorized();

            if (request == null || request.LanguageId <= 0 || request.Cues == null || request.Cues.Count == 0)
            {
                return BadRequest(new { message = "LanguageId and at least one subtitle cue are required." });
            }

            if (request.Cues.Count > MaxCuesPerSession)
            {
                return BadRequest(new { message = $"A session can contain at most {MaxCuesPerSession} subtitle cues." });
            }

            var language = await _context.Languages
                .AsNoTracking()
                .FirstOrDefaultAsync(l => l.LanguageId == request.LanguageId, cancellationToken);
            if (language == null)
            {
                return BadRequest(new { message = $"Language with ID {request.LanguageId} not found." });
            }

            var validCues = new List<MpvValidCue>(request.Cues.Count);
            foreach (var cue in request.Cues)
            {
                if (cue == null || string.IsNullOrWhiteSpace(cue.Text)) continue;
                if (!double.IsFinite(cue.StartSeconds) || cue.StartSeconds < 0) continue;
                if (!double.IsFinite(cue.EndSeconds) || cue.EndSeconds < cue.StartSeconds) continue;

                var normalizedCueText = cue.Text.Replace("\r\n", "\n").Replace('\r', '\n').Trim();
                if (string.IsNullOrWhiteSpace(normalizedCueText)) continue;

                validCues.Add(new MpvValidCue(cue.StartSeconds, cue.EndSeconds, normalizedCueText));
            }

            if (validCues.Count == 0)
            {
                return BadRequest(new { message = "At least one valid subtitle cue is required." });
            }

            if (!MatchesEuropeanScript(validCues, language))
            {
                return BadRequest(new
                {
                    message = $"Selected subtitle track does not appear to contain {language.Name} text. Check your subtitle track selection in mpv."
                });
            }

            var normalizedTitle = NormalizeSessionTitle(request.Title);
            var srtContent = BuildSrtContent(validCues);
            var transcriptContent = string.Join("\n", validCues.Select(c => c.Text));

            var (folderId, linked) = await LessonStudyActivity.AtomicAsync(_context, userId, async () =>
            {
                var now = DateTime.UtcNow;
                var mpvFolder = await _context.Folders
                    .Where(f => f.UserId == userId && f.ParentFolderId == null && f.Name == "mpv")
                    .OrderBy(f => f.FolderId)
                    .FirstOrDefaultAsync(cancellationToken);

                if (mpvFolder == null)
                {
                    mpvFolder = new Folder
                    {
                        Name = "mpv",
                        UserId = userId,
                        ParentFolderId = null,
                        LanguageId = null,
                        SortOrder = await LibrarySortOrder.MaxAsync(_context, userId, null) + 1,
                        CreatedAt = now
                    };
                    _context.Folders.Add(mpvFolder);
                    await _context.SaveChangesAsync(cancellationToken);
                }

                var resolvedFolderId = mpvFolder.FolderId;
                var existingText = await _context.Texts
                    .Where(t => t.UserId == userId
                             && t.FolderId == resolvedFolderId
                             && t.LanguageId == language.LanguageId
                             && t.BookId == null
                             && t.Title == normalizedTitle)
                    .OrderBy(t => t.TextId)
                    .FirstOrDefaultAsync(cancellationToken);

                int textId;
                if (existingText == null)
                {
                    var created = new Text
                    {
                        Title = normalizedTitle,
                        Content = transcriptContent,
                        SrtContent = srtContent,
                        SegmentationProfile = null,
                        LanguageId = language.LanguageId,
                        UserId = userId,
                        FolderId = resolvedFolderId,
                        SortOrder = await LibrarySortOrder.MaxAsync(_context, userId, resolvedFolderId) + 1,
                        IsAudioLesson = true,
                        AudioFilePath = null,
                        Tag = "mpv",
                        WordLinkingStatus = "processing",
                        CreatedAt = now,
                        LastAccessedAt = now
                    };
                    _context.Texts.Add(created);
                    await _context.SaveChangesAsync(cancellationToken);
                    textId = created.TextId;

                    await WordLinker.LinkAsync(_context, textId, transcriptContent, language.LanguageId, userId, cancellationToken);
                }
                else if (!string.Equals(existingText.Content, transcriptContent, StringComparison.Ordinal))
                {
                    textId = existingText.TextId;
                    existingText.Content = transcriptContent;
                    existingText.SrtContent = srtContent;
                    existingText.LastAccessedAt = now;
                    existingText.WordLinkingStatus = "processing";
                    await _context.SaveChangesAsync(cancellationToken);

                    await WordLinker.RelinkAsync(_context, textId, transcriptContent, language.LanguageId, userId, cancellationToken);
                }
                else
                {
                    textId = existingText.TextId;
                    existingText.LastAccessedAt = now;
                    if (!string.Equals(existingText.SrtContent, srtContent, StringComparison.Ordinal))
                    {
                        existingText.SrtContent = srtContent;
                    }
                    await _context.SaveChangesAsync(cancellationToken);
                }

                // LinkAsync and RelinkAsync call _context.ChangeTracker.Clear(), so always re-query.
                var linkedText = await _context.Texts.SingleAsync(t => t.TextId == textId && t.UserId == userId, cancellationToken);
                var counts = await _context.TextWords
                    .AsNoTracking()
                    .Where(tw => tw.TextId == textId)
                    .Select(tw => new { tw.OccurrenceCount, tw.Word.Status })
                    .ToListAsync(cancellationToken);

                linkedText.TotalWords = counts.Where(w => w.Status != 6).Sum(w => w.OccurrenceCount);
                linkedText.KnownWords = counts.Where(w => w.Status >= 4 && w.Status <= 5).Sum(w => w.OccurrenceCount);
                linkedText.StatsUpdatedAt = DateTime.UtcNow;
                linkedText.WordLinkingStatus = "completed";
                await _context.SaveChangesAsync(cancellationToken);

                return (resolvedFolderId, linkedText);
            });

            var effectiveLanguage = Tokenizer.ForTextProfile(language, linked.SegmentationProfile);
            var userWords = await _context.Words
                .AsNoTracking()
                .Include(w => w.Translation)
                .Where(w => w.UserId == userId && w.LanguageId == language.LanguageId)
                .ToListAsync(cancellationToken);

            var (exactMap, foldedMap) = BuildLookupMaps(userWords, effectiveLanguage);
            var phraseBuckets = BuildPhraseBuckets(userWords, effectiveLanguage);

            var pretokenizedCues = new List<MpvCueResponseDto>(validCues.Count);
            foreach (var cue in validCues)
            {
                pretokenizedCues.Add(new MpvCueResponseDto
                {
                    StartSeconds = cue.StartSeconds,
                    EndSeconds = cue.EndSeconds,
                    Text = cue.Text,
                    Tokens = TokenizeCue(cue.Text, effectiveLanguage, exactMap, foldedMap, phraseBuckets)
                });
            }

            return Ok(new MpvSessionResponseDto
            {
                TextId = linked.TextId,
                Title = linked.Title,
                FolderId = folderId,
                LanguageId = language.LanguageId,
                LanguageCode = language.Code,
                StudyRevision = LessonStudyActivity.Revision(linked.Content, linked.LanguageId, linked.AudioFilePath),
                Cues = pretokenizedCues
            });
        }

        [HttpPost("auto-translate")]
        public async Task<ActionResult<MpvAutoTranslateResponseDto>> AutoTranslate(
            [FromBody] MpvAutoTranslateRequestDto request,
            CancellationToken cancellationToken)
        {
            if (!TryGetUserId(out var userId)) return Unauthorized();
            if (request == null || request.TextId <= 0)
            {
                return BadRequest(new { message = "A valid TextId is required." });
            }

            var settings = await _context.UserSettings
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken);

            if (!request.Force && !(settings?.AutoTranslateOnOpen ?? false))
            {
                return Ok(new MpvAutoTranslateResponseDto
                {
                    Skipped = true,
                    Reason = "AutoTranslateOnOpen is disabled.",
                    TranslatedCount = 0,
                    Capped = false,
                    Words = new List<MpvAutoTranslatedWordDto>()
                });
            }

            var text = await _context.Texts
                .AsNoTracking()
                .Include(t => t.Language)
                .FirstOrDefaultAsync(t => t.TextId == request.TextId && t.UserId == userId, cancellationToken);
            if (text == null)
            {
                return NotFound(new { message = "Text not found." });
            }

            var effectiveLanguage = Tokenizer.ForTextProfile(text.Language, text.SegmentationProfile);
            var userWords = await _context.Words
                .AsNoTracking()
                .Include(w => w.Translation)
                .Where(w => w.UserId == userId && w.LanguageId == text.LanguageId)
                .ToListAsync(cancellationToken);

            var (exactMap, foldedMap) = BuildLookupMaps(userWords, effectiveLanguage);

            var tokResult = Tokenizer.Tokenize(text.Content, effectiveLanguage);
            var rawTokens = new List<string>();
            foreach (var token in tokResult.Tokens)
            {
                if (!token.IsWord) continue;
                var trimmed = token.Text.Trim();
                if (trimmed.Length == 0) continue;
                rawTokens.Add(trimmed);
                if (trimmed.Contains('-'))
                {
                    foreach (var part in trimmed.Split('-', StringSplitOptions.RemoveEmptyEntries))
                    {
                        if (!string.IsNullOrWhiteSpace(part))
                        {
                            rawTokens.Add(part);
                        }
                    }
                }
            }

            var seenKeys = new HashSet<string>(StringComparer.Ordinal);
            var candidateTerms = new List<string>();
            foreach (var raw in rawTokens)
            {
                var key = Tokenizer.NormalizeKey(raw, effectiveLanguage);
                if (string.IsNullOrWhiteSpace(key) || key.Length > MaxTermLength || Tokenizer.IsPureNumericToken(key))
                {
                    continue;
                }

                var saved = ResolveSingleWord(raw, effectiveLanguage, exactMap, foldedMap);
                var targetKey = saved != null ? Tokenizer.NormalizeKey(saved.Term, effectiveLanguage) : key;
                if (string.IsNullOrWhiteSpace(targetKey) || targetKey.Length > MaxTermLength || Tokenizer.IsPureNumericToken(targetKey))
                {
                    continue;
                }

                if (!seenKeys.Add(targetKey))
                {
                    continue;
                }

                if (saved == null || (saved.Status <= 2 && string.IsNullOrWhiteSpace(saved.Translation?.Translation)))
                {
                    candidateTerms.Add(targetKey);
                }
            }

            if (candidateTerms.Count == 0)
            {
                return Ok(new MpvAutoTranslateResponseDto
                {
                    Skipped = false,
                    TranslatedCount = 0,
                    Capped = false,
                    Words = new List<MpvAutoTranslatedWordDto>()
                });
            }

            var targetCode = string.IsNullOrWhiteSpace(settings?.TranslationTargetLanguageCode)
                ? "EN"
                : settings.TranslationTargetLanguageCode;
            var wordTranslationService = await _wordTranslationServiceFactory.GetServiceForUserAsync(userId);
            var capped = (wordTranslationService is WiktionaryTranslationService ||
                          string.Equals(settings?.WordTranslationProvider?.Trim(), "wiktionary", StringComparison.OrdinalIgnoreCase))
                         && candidateTerms.Count > WiktionaryMaxBatchLookups;

            Dictionary<string, string> translations;
            try
            {
                translations = await wordTranslationService.TranslateBatchAsync(candidateTerms, targetCode, text.Language.Code);
            }
            catch (TranslationProviderNotConfiguredException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (WiktionaryRateLimitException)
            {
                return StatusCode(StatusCodes.Status429TooManyRequests, new
                {
                    message = "Wiktionary rate limit reached. Try again in a few seconds."
                });
            }

            var translatedPairs = new List<(string Term, string Translation)>();
            if (translations != null)
            {
                foreach (var term in candidateTerms)
                {
                    if (translations.TryGetValue(term, out var translated) && !string.IsNullOrWhiteSpace(translated))
                    {
                        translatedPairs.Add((term, translated.Trim()));
                    }
                    else
                    {
                        var fallbackPair = translations.FirstOrDefault(kvp =>
                            string.Equals(kvp.Key, term, StringComparison.OrdinalIgnoreCase) &&
                            !string.IsNullOrWhiteSpace(kvp.Value));
                        if (!string.IsNullOrWhiteSpace(fallbackPair.Value))
                        {
                            translatedPairs.Add((term, fallbackPair.Value.Trim()));
                        }
                    }
                }
            }

            if (translatedPairs.Count == 0)
            {
                return Ok(new MpvAutoTranslateResponseDto
                {
                    Skipped = false,
                    TranslatedCount = 0,
                    Capped = capped,
                    Words = new List<MpvAutoTranslatedWordDto>()
                });
            }

            var newWordStatus = Math.Clamp(settings?.AutoTranslateWordStatus ?? 5, 1, 5);
            var savedWords = await LessonStudyActivity.AtomicAsync(_context, userId, async () =>
            {
                var trackedText = await _context.Texts
                    .Include(t => t.Language)
                    .FirstOrDefaultAsync(t => t.TextId == text.TextId && t.UserId == userId, cancellationToken);
                if (trackedText == null)
                {
                    return (List<MpvAutoTranslatedWordDto>?)null;
                }

                var trackedLanguage = Tokenizer.ForTextProfile(trackedText.Language, trackedText.SegmentationProfile);
                var existingWords = await _context.Words
                    .Include(w => w.Translation)
                    .Where(w => w.UserId == userId && w.LanguageId == trackedText.LanguageId)
                    .ToListAsync(cancellationToken);

                var (trackedExactMap, _) = BuildLookupMaps(existingWords, trackedLanguage);
                var existingLinkedWordIds = (await _context.TextWords
                    .Where(tw => tw.TextId == trackedText.TextId)
                    .Select(tw => tw.WordId)
                    .ToListAsync(cancellationToken))
                    .ToHashSet();

                var now = DateTime.UtcNow;
                now = now.AddTicks(-(now.Ticks % 10));
                var createdWords = new List<Word>();
                var statusChangedExistingWords = new List<Word>();
                var touchedWords = new List<Word>();

                foreach (var (term, translationText) in translatedPairs)
                {
                    if (trackedExactMap.TryGetValue(term, out var word))
                    {
                        var statusChanged = word.Status == 0;
                        if (statusChanged)
                        {
                            word.Status = newWordStatus;
                            statusChangedExistingWords.Add(word);
                        }
                        else if (word.Status > 2 || !string.IsNullOrWhiteSpace(word.Translation?.Translation))
                        {
                            continue;
                        }

                        var revision = word.LastEditedAt is { } prev && prev >= now ? prev.AddMicroseconds(1) : now;
                        word.LastEditedAt = revision;
                        word.LastTranslationEditedAt = revision;
                        if (statusChanged)
                        {
                            word.LastStatusEditedAt = revision;
                            word.LastManualStatusAt = revision;
                        }
                        else
                        {
                            word.LastStatusEditedAt ??= word.LastManualStatusAt ?? (word.Status > 0 ? word.CreatedAt : null);
                        }

                        if (word.Translation == null)
                        {
                            var wt = new WordTranslation
                            {
                                Word = word,
                                Translation = translationText,
                                CreatedAt = now
                            };
                            _context.WordTranslations.Add(wt);
                            word.Translation = wt;
                        }
                        else
                        {
                            word.Translation.Translation = translationText;
                            word.Translation.UpdatedAt = now;
                        }

                        if (existingLinkedWordIds.Add(word.WordId))
                        {
                            _context.TextWords.Add(new TextWord
                            {
                                TextId = trackedText.TextId,
                                Word = word,
                                OccurrenceCount = 1,
                                CreatedAt = now
                            });
                        }

                        touchedWords.Add(word);
                    }
                    else
                    {
                        var newWord = new Word
                        {
                            UserId = userId,
                            LanguageId = trackedText.LanguageId,
                            Term = term,
                            Status = newWordStatus,
                            CreatedAt = now,
                            LastEditedAt = now,
                            LastStatusEditedAt = now,
                            LastTranslationEditedAt = now,
                            LastManualStatusAt = now
                        };
                        var wt = new WordTranslation
                        {
                            Word = newWord,
                            Translation = translationText,
                            CreatedAt = now
                        };
                        newWord.Translation = wt;
                        _context.Words.Add(newWord);
                        _context.WordTranslations.Add(wt);
                        _context.TextWords.Add(new TextWord
                        {
                            TextId = trackedText.TextId,
                            Word = newWord,
                            OccurrenceCount = 1,
                            CreatedAt = now
                        });
                        trackedExactMap[term] = newWord;
                        createdWords.Add(newWord);
                        touchedWords.Add(newWord);
                    }
                }

                await SrsCardLifecycle.ApplyStatusRulesAsync(_context, userId, statusChangedExistingWords, settings);
                foreach (var createdWord in createdWords)
                {
                    await SrsCardLifecycle.ApplyStatusRulesAsync(_context, createdWord, hasSentence: false, settings);
                }

                await _context.SaveChangesAsync(cancellationToken);

                var counts = await _context.TextWords
                    .AsNoTracking()
                    .Where(tw => tw.TextId == trackedText.TextId)
                    .Select(tw => new { tw.OccurrenceCount, tw.Word.Status })
                    .ToListAsync(cancellationToken);
                trackedText.TotalWords = counts.Where(w => w.Status != 6).Sum(w => w.OccurrenceCount);
                trackedText.KnownWords = counts.Where(w => w.Status >= 4 && w.Status <= 5).Sum(w => w.OccurrenceCount);
                trackedText.StatsUpdatedAt = DateTime.UtcNow;
                await _context.SaveChangesAsync(cancellationToken);

                return touchedWords.Select(w => new MpvAutoTranslatedWordDto
                {
                    Term = w.Term,
                    WordId = w.WordId,
                    Status = w.Status,
                    Translation = w.Translation?.Translation ?? string.Empty
                }).ToList();
            });

            if (savedWords == null)
            {
                return NotFound(new { message = "Text not found." });
            }

            return Ok(new MpvAutoTranslateResponseDto
            {
                Skipped = false,
                TranslatedCount = savedWords.Count,
                Capped = capped,
                Words = savedWords
            });
        }

        [HttpPost("lookup")]
        public async Task<ActionResult<MpvLookupResponseDto>> Lookup(
            [FromBody] MpvLookupRequestDto request,
            CancellationToken cancellationToken)
        {
            if (!TryGetUserId(out var userId)) return Unauthorized();

            var trimmedTerm = (request?.Term ?? string.Empty).Trim();
            if (request == null || request.LanguageId <= 0 || string.IsNullOrWhiteSpace(trimmedTerm) || trimmedTerm.Length > MaxTermLength)
            {
                return BadRequest(new { message = $"LanguageId and a Term (1..{MaxTermLength} chars) are required." });
            }

            var language = await _context.Languages
                .AsNoTracking()
                .FirstOrDefaultAsync(l => l.LanguageId == request.LanguageId, cancellationToken);
            if (language == null)
            {
                return BadRequest(new { message = $"Language with ID {request.LanguageId} not found." });
            }

            var settings = await _context.UserSettings
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.UserId == userId, cancellationToken);

            var targetCode = !string.IsNullOrWhiteSpace(request.TargetLanguageCode)
                ? request.TargetLanguageCode.Trim()
                : (!string.IsNullOrWhiteSpace(settings?.TranslationTargetLanguageCode)
                    ? settings.TranslationTargetLanguageCode.Trim()
                    : "EN");
            var wordProviderName = string.IsNullOrWhiteSpace(settings?.WordTranslationProvider)
                ? "deepl"
                : settings.WordTranslationProvider.Trim().ToLowerInvariant();
            var mode = (request.Mode ?? "word").Trim().ToLowerInvariant();
            var sentenceContext = string.IsNullOrWhiteSpace(request.SentenceContext)
                ? null
                : request.SentenceContext.Trim();

            var translation = string.Empty;
            var provider = wordProviderName;

            if (mode == "context" && sentenceContext != null)
            {
                try
                {
                    var aiService = await _sentenceTranslationServiceFactory.GetServiceForUserAsync(userId);
                    var aiResult = await aiService.TranslateSelectionWithContextAsync(trimmedTerm, sentenceContext, language.Code, targetCode);
                    var extracted = PairedTranslationTagExtractor.ExtractTranslatedTextOnly(aiResult);
                    if (!IsAiErrorResult(extracted))
                    {
                        translation = extracted;
                        provider = "ai";
                    }
                }
                catch (TranslationProviderNotConfiguredException ex)
                {
                    _logger.LogDebug(ex, "AI provider not configured for context lookup; falling back to word provider.");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "AI context lookup failed; falling back to word provider.");
                }
            }

            if (string.IsNullOrWhiteSpace(translation))
            {
                try
                {
                    var wordService = await _wordTranslationServiceFactory.GetServiceForUserAsync(userId);
                    translation = (await (sentenceContext != null
                        ? wordService.TranslateTextAsync(trimmedTerm, language.Code, targetCode, sentenceContext)
                        : wordService.TranslateTextAsync(trimmedTerm, language.Code, targetCode)) ?? string.Empty).Trim();
                    provider = wordProviderName;
                }
                catch (TranslationProviderNotConfiguredException ex)
                {
                    return BadRequest(new { message = ex.Message });
                }
                catch (WiktionaryRateLimitException)
                {
                    return StatusCode(StatusCodes.Status429TooManyRequests, new
                    {
                        message = "Wiktionary rate limit reached. Try again in a few seconds."
                    });
                }
            }

            string? sentenceTranslation = null;
            if (request.IncludeSentenceTranslation && sentenceContext != null)
            {
                try
                {
                    var aiService = await _sentenceTranslationServiceFactory.GetServiceForUserAsync(userId);
                    var rawSentence = await aiService.TranslateSentenceAsync(sentenceContext, language.Code, targetCode);
                    var extracted = PairedTranslationTagExtractor.ExtractTranslatedTextOnly(rawSentence);
                    if (!IsAiErrorResult(extracted))
                    {
                        sentenceTranslation = extracted;
                    }
                }
                catch (TranslationProviderNotConfiguredException ex)
                {
                    _logger.LogDebug(ex, "AI provider not configured for sentence lookup; falling back to word provider.");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "AI sentence translation failed; falling back to word provider.");
                }

                if (string.IsNullOrWhiteSpace(sentenceTranslation))
                {
                    try
                    {
                        var wordService = await _wordTranslationServiceFactory.GetServiceForUserAsync(userId);
                        var fallbackSentence = await wordService.TranslateTextAsync(sentenceContext, language.Code, targetCode);
                        if (!string.IsNullOrWhiteSpace(fallbackSentence))
                        {
                            sentenceTranslation = fallbackSentence.Trim();
                        }
                    }
                    catch (TranslationProviderNotConfiguredException ex)
                    {
                        if (string.IsNullOrWhiteSpace(translation))
                        {
                            return BadRequest(new { message = ex.Message });
                        }
                    }
                    catch (WiktionaryRateLimitException)
                    {
                        return StatusCode(StatusCodes.Status429TooManyRequests, new
                        {
                            message = "Wiktionary rate limit reached. Try again in a few seconds."
                        });
                    }
                }
            }

            return Ok(new MpvLookupResponseDto
            {
                Term = trimmedTerm,
                Translation = translation,
                Provider = provider,
                SentenceTranslation = sentenceTranslation
            });
        }

        private bool TryGetUserId(out Guid userId)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            return Guid.TryParse(userIdClaim, out userId);
        }

        private static bool IsAiErrorResult(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return true;
            var trimmed = value.Trim();
            return trimmed.StartsWith("Translation error:", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("Translation failed:", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("Explanation error:", StringComparison.OrdinalIgnoreCase)
                || trimmed.StartsWith("Explanation failed:", StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeSessionTitle(string? rawTitle)
        {
            var trimmed = (rawTitle ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(trimmed))
            {
                return "Untitled mpv Session";
            }

            if (trimmed.Length > 200)
            {
                var cutoff = char.IsHighSurrogate(trimmed[199]) ? 199 : 200;
                trimmed = trimmed[..cutoff].Trim();
            }

            return string.IsNullOrWhiteSpace(trimmed) ? "Untitled mpv Session" : trimmed;
        }

        private static string BuildSrtContent(IReadOnlyList<MpvValidCue> cues)
        {
            var sb = new StringBuilder();
            for (var i = 0; i < cues.Count; i++)
            {
                if (i > 0) sb.Append('\n');
                var cue = cues[i];
                sb.Append(i + 1).Append('\n')
                  .Append(FormatSrtTimestamp(cue.StartSeconds))
                  .Append(" --> ")
                  .Append(FormatSrtTimestamp(cue.EndSeconds))
                  .Append('\n')
                  .Append(cue.Text)
                  .Append('\n');
            }
            return sb.ToString();
        }

        private static string FormatSrtTimestamp(double seconds)
        {
            if (!double.IsFinite(seconds) || seconds <= 0)
            {
                return "00:00:00,000";
            }

            var roundedMs = Math.Round(seconds * 1000.0, MidpointRounding.AwayFromZero);
            var totalMs = roundedMs >= 3_599_999_999d ? 3_599_999_999L : (long)roundedMs;
            var hours = totalMs / 3_600_000;
            var rem = totalMs % 3_600_000;
            var minutes = rem / 60_000;
            rem %= 60_000;
            var secs = rem / 1_000;
            var ms = rem % 1_000;
            return string.Create(CultureInfo.InvariantCulture, $"{hours:D2}:{minutes:D2}:{secs:D2},{ms:D3}");
        }

        private static bool MatchesEuropeanScript(IReadOnlyList<MpvValidCue> cues, Language language)
        {
            var baseCode = (language.Code ?? string.Empty).Trim().Split('-', '_')[0].ToLowerInvariant();
            var totalLetters = 0;
            var cyrillicLetters = 0;
            var greekLetters = 0;
            var latinLetters = 0;

            foreach (var cue in cues)
            {
                foreach (var rune in cue.Text.EnumerateRunes())
                {
                    if (!Rune.IsLetter(rune)) continue;
                    totalLetters++;
                    var cp = rune.Value;
                    if (cp is >= 0x0400 and <= 0x04FF)
                    {
                        cyrillicLetters++;
                    }
                    else if (cp is (>= 0x0370 and <= 0x03FF) or (>= 0x1F00 and <= 0x1FFF))
                    {
                        greekLetters++;
                    }
                    else if (cp is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or (>= 0x00C0 and <= 0x024F) or (>= 0x1E00 and <= 0x1EFF))
                    {
                        latinLetters++;
                    }
                }
            }

            if (totalLetters < 10)
            {
                return true;
            }

            if (CyrillicOnlyLanguages.Contains(baseCode))
            {
                return (double)cyrillicLetters / totalLetters >= 0.20;
            }

            if (baseCode == "sr")
            {
                return (double)cyrillicLetters / totalLetters >= 0.20
                    || (double)latinLetters / totalLetters >= 0.20;
            }

            if (baseCode == "el")
            {
                return (double)greekLetters / totalLetters >= 0.20;
            }

            if (LatinEuropeanLanguages.Contains(baseCode))
            {
                return (double)latinLetters / totalLetters >= 0.50;
            }

            return true;
        }

        private static int WordPriorityCompare(Word candidate, Word current)
        {
            var cmp = (candidate.Status > 0).CompareTo(current.Status > 0);
            if (cmp != 0) return cmp;
            cmp = (candidate.Translation != null).CompareTo(current.Translation != null);
            if (cmp != 0) return cmp;
            cmp = string.CompareOrdinal(current.Term, candidate.Term);
            if (cmp != 0) return cmp;
            return current.WordId.CompareTo(candidate.WordId);
        }

        private static (Dictionary<string, Word> ExactMap, Dictionary<string, Word> FoldedMap) BuildLookupMaps(
            IEnumerable<Word> words,
            Language? effectiveLanguage)
        {
            var exactMap = new Dictionary<string, Word>(StringComparer.Ordinal);
            var foldedMap = new Dictionary<string, Word>(StringComparer.Ordinal);

            foreach (var word in words)
            {
                var exactKey = Tokenizer.NormalizeKey(word.Term, effectiveLanguage);
                if (!string.IsNullOrEmpty(exactKey) &&
                    (!exactMap.TryGetValue(exactKey, out var existingExact) || WordPriorityCompare(word, existingExact) > 0))
                {
                    exactMap[exactKey] = word;
                }

                var foldedKey = Tokenizer.FoldLookupKey(word.Term, effectiveLanguage);
                if (!string.IsNullOrEmpty(foldedKey) &&
                    (!foldedMap.TryGetValue(foldedKey, out var existingFolded) || WordPriorityCompare(word, existingFolded) > 0))
                {
                    foldedMap[foldedKey] = word;
                }
            }

            return (exactMap, foldedMap);
        }

        private static Dictionary<string, List<PhraseEntry>> BuildPhraseBuckets(
            IEnumerable<Word> words,
            Language? effectiveLanguage)
        {
            var buckets = new Dictionary<string, List<PhraseEntry>>(StringComparer.Ordinal);
            foreach (var word in words)
            {
                if ((word.Status <= 0 && word.Translation == null) || !word.Term.Contains(' '))
                {
                    continue;
                }

                var wordKeys = Tokenizer.ExtractLookupKeys(word.Term, effectiveLanguage).ToArray();
                if (wordKeys.Length < 2)
                {
                    continue;
                }

                var foldedKeys = wordKeys.Select(k => Tokenizer.FoldLookupKey(k, effectiveLanguage)).ToArray();
                if (!buckets.TryGetValue(foldedKeys[0], out var bucket))
                {
                    bucket = new List<PhraseEntry>();
                    buckets[foldedKeys[0]] = bucket;
                }

                bucket.Add(new PhraseEntry(word, wordKeys, foldedKeys));
            }

            foreach (var bucket in buckets.Values)
            {
                bucket.Sort((a, b) =>
                {
                    var cmp = b.WordKeys.Length.CompareTo(a.WordKeys.Length);
                    if (cmp != 0) return cmp;
                    cmp = b.Word.Term.Length.CompareTo(a.Word.Term.Length);
                    if (cmp != 0) return cmp;
                    return WordPriorityCompare(b.Word, a.Word);
                });
            }

            return buckets;
        }

        private static List<MpvCueTokenDto> TokenizeCue(
            string cueText,
            Language? effectiveLanguage,
            Dictionary<string, Word> exactMap,
            Dictionary<string, Word> foldedMap,
            Dictionary<string, List<PhraseEntry>> phraseBuckets)
        {
            var tokResult = Tokenizer.Tokenize(cueText, effectiveLanguage);
            var tokens = tokResult.Tokens;
            var output = new List<MpvCueTokenDto>(tokens.Count);

            for (var i = 0; i < tokens.Count; i++)
            {
                var token = tokens[i];
                if (!token.IsWord)
                {
                    output.Add(new MpvCueTokenDto
                    {
                        Text = token.Text,
                        Term = string.Empty,
                        IsWord = false,
                        WordId = null,
                        Status = 0,
                        Translation = null
                    });
                    continue;
                }

                var firstKey = Tokenizer.NormalizeKey(token.Text, effectiveLanguage);
                var firstFoldedKey = Tokenizer.FoldLookupKey(token.Text, effectiveLanguage);
                if (phraseBuckets.TryGetValue(firstFoldedKey, out var bucket) &&
                    TryMatchPhrase(tokResult.Processed, tokens, i, bucket, effectiveLanguage, out var matchedPhrase, out var lastTokenIdx))
                {
                    var spanText = tokResult.Processed.Substring(token.Start, tokens[lastTokenIdx].End - token.Start);
                    output.Add(new MpvCueTokenDto
                    {
                        Text = spanText,
                        Term = matchedPhrase.Term,
                        IsWord = true,
                        WordId = matchedPhrase.WordId,
                        Status = matchedPhrase.Status,
                        Translation = matchedPhrase.Translation?.Translation
                    });
                    i = lastTokenIdx;
                    continue;
                }

                var matchedWord = ResolveSingleWord(token.Text, effectiveLanguage, exactMap, foldedMap);
                var status = matchedWord?.Status ?? (Tokenizer.IsPureNumericToken(firstKey) ? 6 : 0);
                output.Add(new MpvCueTokenDto
                {
                    Text = token.Text,
                    Term = matchedWord?.Term ?? firstKey,
                    IsWord = true,
                    WordId = matchedWord?.WordId,
                    Status = status,
                    Translation = matchedWord?.Translation?.Translation
                });
            }

            return output;
        }

        private static bool TryMatchPhrase(
            string processed,
            IReadOnlyList<Tokenizer.Token> tokens,
            int startIdx,
            List<PhraseEntry> bucket,
            Language? effectiveLanguage,
            out Word matchedWord,
            out int lastTokenIdx)
        {
            foreach (var useFolded in new[] { false, true })
            {
                var firstTokenKey = useFolded
                    ? Tokenizer.FoldLookupKey(tokens[startIdx].Text, effectiveLanguage)
                    : Tokenizer.NormalizeKey(tokens[startIdx].Text, effectiveLanguage);

                foreach (var entry in bucket)
                {
                    var targetKeys = useFolded ? entry.FoldedKeys : entry.WordKeys;
                    if (!string.Equals(firstTokenKey, targetKeys[0], StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var cursor = startIdx;
                    var matched = true;
                    for (var k = 1; k < targetKeys.Length; k++)
                    {
                        cursor++;
                        while (cursor < tokens.Count && !tokens[cursor].IsWord && string.IsNullOrWhiteSpace(tokens[cursor].Text))
                        {
                            cursor++;
                        }

                        if (cursor >= tokens.Count || !tokens[cursor].IsWord)
                        {
                            matched = false;
                            break;
                        }

                        var key = useFolded
                            ? Tokenizer.FoldLookupKey(tokens[cursor].Text, effectiveLanguage)
                            : Tokenizer.NormalizeKey(tokens[cursor].Text, effectiveLanguage);
                        if (!string.Equals(key, targetKeys[k], StringComparison.Ordinal))
                        {
                            matched = false;
                            break;
                        }
                    }

                    if (matched && tokens[cursor].End > tokens[startIdx].Start && tokens[cursor].End <= processed.Length)
                    {
                        matchedWord = entry.Word;
                        lastTokenIdx = cursor;
                        return true;
                    }
                }
            }

            matchedWord = null!;
            lastTokenIdx = startIdx;
            return false;
        }

        private static Word? ResolveSingleWord(
            string tokenText,
            Language? effectiveLanguage,
            Dictionary<string, Word> exactMap,
            Dictionary<string, Word> foldedMap)
        {
            Word? fallbackZero = null;
            foreach (var candidate in Tokenizer.GetLookupCandidates(tokenText, effectiveLanguage))
            {
                if (exactMap.TryGetValue(candidate, out var exactWord))
                {
                    if (exactWord.Status > 0 || exactWord.Translation != null) return exactWord;
                    fallbackZero ??= exactWord;
                }

                if (foldedMap.TryGetValue(candidate, out var foldedWord))
                {
                    if (foldedWord.Status > 0 || foldedWord.Translation != null) return foldedWord;
                    fallbackZero ??= foldedWord;
                }
            }

            return fallbackZero;
        }

        private sealed record MpvValidCue(double StartSeconds, double EndSeconds, string Text);
        private sealed record PhraseEntry(Word Word, string[] WordKeys, string[] FoldedKeys);
    }

    public class MpvLanguageDto
    {
        public int LanguageId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Code { get; set; } = string.Empty;
        public string ParserType { get; set; } = string.Empty;
        public bool RightToLeft { get; set; }
    }

    public class MpvLanguagesResponseDto
    {
        public string TranslationTargetLanguageCode { get; set; } = "EN";
        public bool PauseOnWordClick { get; set; }
        public bool AutoTranslateWords { get; set; }
        public bool AutoTranslateOnOpen { get; set; }
        public int AutoTranslateWordStatus { get; set; } = 5;
        public string WordTranslationProvider { get; set; } = "deepl";
        public int DefaultLanguageId { get; set; }
        public List<MpvLanguageDto> Languages { get; set; } = new();
    }

    public class MpvSessionRequestDto
    {
        public int LanguageId { get; set; }
        public string? Title { get; set; }
        public List<MpvCueInputDto>? Cues { get; set; }
    }

    public class MpvCueInputDto
    {
        public double StartSeconds { get; set; }
        public double EndSeconds { get; set; }
        public string? Text { get; set; }
    }

    public class MpvSessionResponseDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public int FolderId { get; set; }
        public int LanguageId { get; set; }
        public string LanguageCode { get; set; } = string.Empty;
        public string StudyRevision { get; set; } = string.Empty;
        public List<MpvCueResponseDto> Cues { get; set; } = new();
    }

    public class MpvCueResponseDto
    {
        public double StartSeconds { get; set; }
        public double EndSeconds { get; set; }
        public string Text { get; set; } = string.Empty;
        public List<MpvCueTokenDto> Tokens { get; set; } = new();
    }

    public class MpvCueTokenDto
    {
        public string Text { get; set; } = string.Empty;
        public string Term { get; set; } = string.Empty;
        public bool IsWord { get; set; }
        public int? WordId { get; set; }
        public int Status { get; set; }
        public string? Translation { get; set; }
    }

    public class MpvAutoTranslateRequestDto
    {
        public int TextId { get; set; }
        public bool Force { get; set; }
    }

    public class MpvAutoTranslateResponseDto
    {
        public bool Skipped { get; set; }
        public string? Reason { get; set; }
        public int TranslatedCount { get; set; }
        public bool Capped { get; set; }
        public List<MpvAutoTranslatedWordDto> Words { get; set; } = new();
    }

    public class MpvAutoTranslatedWordDto
    {
        public string Term { get; set; } = string.Empty;
        public int WordId { get; set; }
        public int Status { get; set; }
        public string Translation { get; set; } = string.Empty;
    }

    public class MpvLookupRequestDto
    {
        public int LanguageId { get; set; }
        public string Term { get; set; } = string.Empty;
        public string? SentenceContext { get; set; }
        public string? TargetLanguageCode { get; set; }
        public string Mode { get; set; } = "word";
        public bool IncludeSentenceTranslation { get; set; }
    }

    public class MpvLookupResponseDto
    {
        public string Term { get; set; } = string.Empty;
        public string Translation { get; set; } = string.Empty;
        public string Provider { get; set; } = string.Empty;
        public string? SentenceTranslation { get; set; }
    }
}
