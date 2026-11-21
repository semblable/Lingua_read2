using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class SentenceModeActivityTests
{
    [Fact]
    public async Task LogSentenceRead_CreditsOnlyNewSegments()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        SeedUserLanguageAndText(context, userId, textId: 10, content: "Alpha beta. Gamma delta.");

        var controller = CreateUserActivityController(context, userId);

        var firstResult = await controller.LogSentenceRead(new UserActivityController.LogSentenceReadRequest
        {
            TextId = 10,
            CurrentSegmentIndex = 1,
            Segments =
            [
                new UserActivityController.SentenceSegmentDto { SegmentIndex = 0, SegmentText = "Alpha beta." },
                new UserActivityController.SentenceSegmentDto { SegmentIndex = 1, SegmentText = "Gamma delta." }
            ]
        });

        var firstOk = Assert.IsType<OkObjectResult>(firstResult.Result);
        var firstDto = Assert.IsType<UserActivityController.SentenceProgressDto>(firstOk.Value);
        Assert.Equal(new[] { 0, 1 }, firstDto.CreditedSegmentIndices);
        Assert.Equal(4, firstDto.CreditedWordCount);
        Assert.Equal(1, firstDto.LastSegmentIndex);

        var secondResult = await controller.LogSentenceRead(new UserActivityController.LogSentenceReadRequest
        {
            TextId = 10,
            CurrentSegmentIndex = 0,
            Segments =
            [
                new UserActivityController.SentenceSegmentDto { SegmentIndex = 0, SegmentText = "Alpha beta." }
            ]
        });

        var secondOk = Assert.IsType<OkObjectResult>(secondResult.Result);
        var secondDto = Assert.IsType<UserActivityController.SentenceProgressDto>(secondOk.Value);
        Assert.Equal(4, secondDto.CreditedWordCount);
        Assert.Equal(0, secondDto.LastSegmentIndex);

        var readingActivities = await context.UserActivities
            .Where(activity => activity.ActivityType == "Reading")
            .ToListAsync();
        Assert.Single(readingActivities);
        Assert.Equal(4, readingActivities[0].WordCount);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
    }

    [Fact]
    public async Task LogSentenceRead_AppliesLateCreditWithoutReplacingNewerCursor()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 11;
        SeedUserLanguageAndText(context, userId, textId, "Alpha beta. Gamma delta. Epsilon zeta.");
        var controller = CreateUserActivityController(context, userId);
        var firstReadingAt = DateTimeOffset.UtcNow.AddMinutes(-10);

        async Task<UserActivityController.SentenceProgressDto> RecordAsync(
            int? cursor, DateTimeOffset? clientUpdatedAt, int creditedIndex, string sentence)
        {
            var result = await controller.LogSentenceRead(new UserActivityController.LogSentenceReadRequest
            {
                TextId = textId,
                CurrentSegmentIndex = cursor,
                ClientUpdatedAt = clientUpdatedAt,
                Segments = [new() { SegmentIndex = creditedIndex, SegmentText = sentence }]
            });
            var ok = Assert.IsType<OkObjectResult>(result.Result);
            return Assert.IsType<UserActivityController.SentenceProgressDto>(ok.Value);
        }

        var nearEnd = await RecordAsync(2, firstReadingAt.AddMinutes(2), 2, "Epsilon zeta.");
        Assert.Equal(2, nearEnd.LastSegmentIndex);
        Assert.Equal(firstReadingAt.AddMinutes(2).UtcDateTime, nearEnd.CursorUpdatedAt);

        var laterReplay = await RecordAsync(1, firstReadingAt.AddMinutes(1), 1, "Gamma delta.");
        Assert.Equal(2, laterReplay.LastSegmentIndex);
        Assert.Equal(nearEnd.CursorUpdatedAt, laterReplay.CursorUpdatedAt);
        Assert.Equal(new[] { 1, 2 }, laterReplay.CreditedSegmentIndices);
        Assert.Equal(4, laterReplay.CreditedWordCount);

        var creditOnly = await RecordAsync(null, null, 0, "Alpha beta.");
        Assert.Equal(2, creditOnly.LastSegmentIndex);
        Assert.Equal(nearEnd.CursorUpdatedAt, creditOnly.CursorUpdatedAt);
        Assert.Equal(6, creditOnly.CreditedWordCount);

        var backwardSeek = await RecordAsync(0, firstReadingAt.AddMinutes(3), 0, "Alpha beta.");
        Assert.Equal(0, backwardSeek.LastSegmentIndex);
        Assert.Equal(firstReadingAt.AddMinutes(3).UtcDateTime, backwardSeek.CursorUpdatedAt);
        Assert.Equal(new[] { 0, 1, 2 }, backwardSeek.CreditedSegmentIndices);
        Assert.Equal(6, backwardSeek.CreditedWordCount);
        Assert.Equal(6, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
    }

    [Fact]
    public async Task LogSentenceRead_AheadClockCreditsWordsWithoutMovingTheSavedCursor()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 11;
        SeedUserLanguageAndText(context, userId, textId, "Alpha beta. Gamma delta.");
        var controller = CreateUserActivityController(context, userId);

        var saved = await controller.LogSentenceRead(new()
        {
            TextId = textId, CurrentSegmentIndex = 1, Segments = [new() { SegmentIndex = 1, SegmentText = "Gamma delta." }]
        });
        var replay = await controller.LogSentenceRead(new()
        {
            TextId = textId, CurrentSegmentIndex = 0, ClientUpdatedAt = DateTimeOffset.UtcNow.AddDays(1),
            Segments = [new() { SegmentIndex = 0, SegmentText = "Alpha beta." }]
        });

        var before = Assert.IsType<UserActivityController.SentenceProgressDto>(Assert.IsType<OkObjectResult>(saved.Result).Value);
        var after = Assert.IsType<UserActivityController.SentenceProgressDto>(Assert.IsType<OkObjectResult>(replay.Result).Value);
        Assert.Equal(1, after.LastSegmentIndex);
        Assert.Equal(before.CursorUpdatedAt, after.CursorUpdatedAt);
        Assert.Equal(4, after.CreditedWordCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LogSentenceRead_UsesSourceCoverageAfterSplittingAndMergingSegments(bool legacy)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 11;
        const string content = "Alpha. Beta. Gamma.";
        SeedUserLanguageAndText(context, userId, textId, content);
        var controller = CreateUserActivityController(context, userId);
        var text = await context.Texts.SingleAsync();
        var revision = LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath);

        async Task<UserActivityController.SentenceProgressDto> Read(UserActivityController.SentenceSegmentDto segment,
            string? sourceRevision, List<UserActivityController.SentenceSegmentDto>? legacySegments = null)
        {
            var result = await controller.LogSentenceRead(new()
            {
                TextId = textId, SourceRevision = sourceRevision, LegacySegments = legacySegments, Segments = [segment]
            });
            return Assert.IsType<UserActivityController.SentenceProgressDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        }

        UserActivityController.SentenceSegmentDto original = new()
        {
            SegmentIndex = 0, SegmentText = "Alpha. Beta.", SourceStart = 0, SourceText = "Alpha. Beta. "
        };
        Assert.Equal(2, (await Read(original, legacy ? null : revision)).CreditedWordCount);
        if (legacy) Assert.Equal(2, (await Read(original, revision, [original])).CreditedWordCount);

        Assert.Equal(2, (await Read(new()
        {
            SegmentIndex = 1, SegmentText = "Beta.", SourceStart = 7, SourceText = "Beta. "
        }, revision)).CreditedWordCount);
        Assert.Equal(3, (await Read(new()
        {
            SegmentIndex = 1, SegmentText = "Beta. Gamma.", SourceStart = 7, SourceText = "Beta. Gamma."
        }, revision)).CreditedWordCount);
        Assert.Equal(3, (await Read(new()
        {
            SegmentIndex = 2, SegmentText = "Gamma.", SourceStart = 13, SourceText = "Gamma."
        }, revision)).CreditedWordCount);
        Assert.Equal(3, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
    }

    [Fact]
    public async Task OfflineSentenceReplay_EarnsUnreadCreditWithoutMovingAnEditedTextsCursor()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 11;
        SeedUserLanguageAndText(context, userId, textId, "Alpha. Beta. Gamma.");
        var controller = CreateUserActivityController(context, userId);

        var text = await context.Texts.SingleAsync();
        var original = LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath);
        UserActivityController.SentenceSegmentDto alpha = new() { SegmentIndex = 0, SegmentText = "Alpha.", SourceStart = 0, SourceText = "Alpha. " };
        UserActivityController.SentenceSegmentDto beta = new() { SegmentIndex = 1, SegmentText = "Beta.", SourceStart = 7, SourceText = "Beta. " };
        UserActivityController.SentenceSegmentDto gamma = new() { SegmentIndex = 2, SegmentText = "Gamma.", SourceStart = 13, SourceText = "Gamma." };

        async Task<UserActivityController.SentenceProgressDto> Read(string revision, int index, params UserActivityController.SentenceSegmentDto[] segments)
        {
            var result = await controller.LogSentenceRead(new()
            {
                TextId = textId, SourceRevision = revision, CurrentSegmentIndex = index, Segments = [..segments]
            });
            return Assert.IsType<UserActivityController.SentenceProgressDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        }

        Assert.Equal(1, (await Read(original, 0, alpha)).CreditedWordCount);
        text = await context.Texts.SingleAsync();
        text.Content = "Alpha. Beta! Gamma.";
        await context.SaveChangesAsync();
        var edited = LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath);
        Assert.Equal(2, (await Read(edited, 2, gamma)).CreditedWordCount);

        var replay = await Read(original, 1, alpha, beta);
        Assert.Equal(3, replay.CreditedWordCount);
        Assert.Equal(2, replay.LastSegmentIndex);
        Assert.Equal(new[] { 0, 2 }, replay.CreditedSegmentIndices);
        Assert.Equal(edited, replay.SourceCoverage?.SourceRevision);
        Assert.Equal(new SentenceSourceRange(13, 19), Assert.Single(replay.SourceCoverage!.Ranges));
        Assert.Empty(replay.SourceCoverage!.LegacyIndices);
        Assert.Equal(3, (await Read(original, 1, alpha, beta)).CreditedWordCount);
    }

    [Fact]
    public async Task EditingText_DoesNotLeakEarlierRevisionIndicesOntoNewSentences()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 12;
        SeedUserLanguageAndText(context, userId, textId, "Alpha. Beta.");
        var controller = CreateUserActivityController(context, userId);

        var text = await context.Texts.SingleAsync();
        var original = LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath);
        Assert.IsType<OkObjectResult>((await controller.LogSentenceRead(new()
        {
            TextId = textId,
            SourceRevision = original,
            CurrentSegmentIndex = 0,
            Segments = [new() { SegmentIndex = 0, SegmentText = "Alpha.", SourceStart = 0, SourceText = "Alpha. " }]
        })).Result);

        text = await context.Texts.SingleAsync();
        text.Content = "New opening sentence. Alpha. Beta.";
        await context.SaveChangesAsync();
        var edited = LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath);

        var loaded = Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>((await controller.GetSentenceProgress(textId)).Result).Value);
        Assert.Equal(edited, loaded.SourceCoverage?.SourceRevision);
        Assert.Empty(loaded.SourceCoverage!.Ranges);
        Assert.Empty(loaded.SourceCoverage!.LegacyIndices);

        // Even if a client sends LegacySegments for index 0, the edited opening sentence is unread and must earn credit.
        UserActivityController.SentenceSegmentDto opening = new()
        {
            SegmentIndex = 0, SegmentText = "New opening sentence.", SourceStart = 0, SourceText = "New opening sentence. "
        };
        var readEdited = Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>((await controller.LogSentenceRead(new()
            {
                TextId = textId, SourceRevision = edited, LegacySegments = [opening], Segments = [opening]
            })).Result).Value);
        Assert.Equal(4, readEdited.CreditedWordCount);
        Assert.Equal(4, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
    }

    [Fact]
    public async Task LegacyReadOnEditedText_AddsOnlyNewLegacyIndexWithoutInheritingEarlierRevisionIndices()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 13;
        SeedUserLanguageAndText(context, userId, textId, "Alpha. Beta.");
        var controller = CreateUserActivityController(context, userId);

        var text = await context.Texts.SingleAsync();
        var original = LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath);
        Assert.IsType<OkObjectResult>((await controller.LogSentenceRead(new()
        {
            TextId = textId,
            SourceRevision = original,
            CurrentSegmentIndex = 0,
            Segments = [new() { SegmentIndex = 0, SegmentText = "Alpha.", SourceStart = 0, SourceText = "Alpha. " }]
        })).Result);

        text = await context.Texts.SingleAsync();
        text.Content = "New opening. Alpha. Beta.";
        await context.SaveChangesAsync();
        var edited = LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath);

        // A legacy (revisionless) read of segment 0 on the edited text must not be skipped
        // just because revision 1 previously credited segment 0.
        var legacyZero = Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>((await controller.LogSentenceRead(new()
            {
                TextId = textId,
                CurrentSegmentIndex = 0,
                Segments = [new() { SegmentIndex = 0, SegmentText = "New opening." }]
            })).Result).Value);
        Assert.Equal(edited, legacyZero.SourceCoverage?.SourceRevision);
        Assert.Equal([0], legacyZero.SourceCoverage!.LegacyIndices);
        Assert.Equal(3, legacyZero.CreditedWordCount);

        // Repeating that legacy read on the same revision must deduplicate to 0 extra words.
        var duplicateZero = Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>((await controller.LogSentenceRead(new()
            {
                TextId = textId,
                CurrentSegmentIndex = 0,
                Segments = [new() { SegmentIndex = 0, SegmentText = "New opening." }]
            })).Result).Value);
        Assert.Equal(3, duplicateZero.CreditedWordCount);

        // A span-aware read of segment 1 (migrating legacy 0) keeps both ordinals deduplicated
        // against any later revisionless client read.
        UserActivityController.SentenceSegmentDto opening = new()
        {
            SegmentIndex = 0, SegmentText = "New opening.", SourceStart = 0, SourceText = "New opening. "
        };
        UserActivityController.SentenceSegmentDto alphaEdited = new()
        {
            SegmentIndex = 1, SegmentText = "Alpha.", SourceStart = 13, SourceText = "Alpha. "
        };
        var spanRead = Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>((await controller.LogSentenceRead(new()
            {
                TextId = textId,
                SourceRevision = edited,
                LegacySegments = [opening],
                Segments = [alphaEdited]
            })).Result).Value);
        Assert.Equal(4, spanRead.CreditedWordCount);
        Assert.Empty(spanRead.SourceCoverage!.LegacyIndices);

        var lateLegacy = Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>((await controller.LogSentenceRead(new()
            {
                TextId = textId,
                Segments =
                [
                    new() { SegmentIndex = 0, SegmentText = "New opening." },
                    new() { SegmentIndex = 1, SegmentText = "Alpha." }
                ]
            })).Result).Value);
        Assert.Equal(4, lateLegacy.CreditedWordCount);
    }

    [Fact]
    public async Task PreExistingCoverageJsonWithoutCreditedIndices_DeduplicatesSameRevisionLegacyReads()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 14;
        SeedUserLanguageAndText(context, userId, textId, "Alpha. Beta.");
        var text = await context.Texts.SingleAsync();
        var revision = LessonStudyActivity.Revision(text.Content, text.LanguageId, text.AudioFilePath);

        // Stored JSON format created prior to per-revision CreditedIndices persistence.
        context.UserSentenceProgresses.Add(new UserSentenceProgress
        {
            UserId = userId,
            TextId = textId,
            CreditedSegmentIndicesJson = "[0]",
            SourceCoverageJson = $$$"""{"{{{revision}}}":{"SourceRevision":"{{{revision}}}","Ranges":[{"Start":0,"End":7}],"LegacyIndices":[]}}""",
            CreditedWordCount = 1,
            LastSegmentIndex = 0,
            UpdatedAt = DateTime.UtcNow
        });
        context.UserLanguageStatistics.Add(new UserLanguageStatistics
        {
            UserId = userId,
            LanguageId = 1,
            TotalWordsRead = 1,
            LastUpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var controller = CreateUserActivityController(context, userId);
        var replay = Assert.IsType<UserActivityController.SentenceProgressDto>(
            Assert.IsType<OkObjectResult>((await controller.LogSentenceRead(new()
            {
                TextId = textId,
                Segments = [new() { SegmentIndex = 0, SegmentText = "Alpha." }]
            })).Result).Value);
        Assert.Equal(1, replay.CreditedWordCount);
        Assert.Empty(replay.SourceCoverage!.LegacyIndices);
        Assert.Equal(1, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
        Assert.Empty(await context.UserActivities.ToListAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FirstHistoricalReplay_DoesNotClaimTheCurrentTextsLegacyCredit(bool legacyRow)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 15;
        const string newOpening = "New opening.";
        SeedUserLanguageAndText(context, userId, textId, $"{newOpening} Beta.");
        var current = LessonStudyActivity.Revision($"{newOpening} Beta.", 1, null);
        var original = LessonStudyActivity.Revision("Alpha. Beta.", 1, null);
        var controller = CreateUserActivityController(context, userId);

        if (legacyRow)
        {
            context.UserSentenceProgresses.Add(new() { UserId = userId, TextId = textId,
                CreditedSegmentIndicesJson = "[0]", CreditedWordCount = 2, LastSegmentIndex = 0 });
            context.UserLanguageStatistics.Add(new() { UserId = userId, LanguageId = 1, TotalWordsRead = 2 });
            await context.SaveChangesAsync();
        }
        else
        {
            Assert.Equal(2, (await ReadSentence(controller, textId, 0, newOpening)).CreditedWordCount);
        }

        var replay = await ReadSentence(controller, textId, 0, "Alpha.", original);
        Assert.Equal(3, replay.CreditedWordCount);
        Assert.Equal(current, replay.SourceCoverage!.SourceRevision);
        Assert.Equal([0], replay.SourceCoverage.LegacyIndices);

        Assert.Equal(3, (await ReadSentence(controller, textId, 0, newOpening, current)).CreditedWordCount);
        Assert.Equal(3, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
    }

    [Fact]
    public async Task TextEdit_PinsExistingOrdinalCreditToTheOutgoingRevision()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 16;
        SeedUserLanguageAndText(context, userId, textId, "Alpha. Beta.");
        var original = LessonStudyActivity.Revision("Alpha. Beta.", 1, null);
        context.UserSentenceProgresses.Add(new() { UserId = userId, TextId = textId,
            CreditedSegmentIndicesJson = "[0]", CreditedWordCount = 1, LastSegmentIndex = 0 });
        context.UserLanguageStatistics.Add(new() { UserId = userId, LanguageId = 1, TotalWordsRead = 1 });
        await context.SaveChangesAsync();

        var texts = CreateTextsController(context, userId);
        Assert.IsType<NoContentResult>(await texts.UpdateText(textId,
            new() { TextId = textId, Title = "Edited", Content = "New opening. Beta." }));
        var current = LessonStudyActivity.Revision("New opening. Beta.", 1, null);
        var controller = CreateUserActivityController(context, userId);

        Assert.Equal(1, (await ReadSentence(controller, textId, 0, "Alpha.", original)).CreditedWordCount);
        Assert.Equal(3, (await ReadSentence(controller, textId, 0, "New opening.", current)).CreditedWordCount);
        Assert.Equal(3, (await context.UserLanguageStatistics.SingleAsync()).TotalWordsRead);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task OfflineRead_KeepsItsLanguageAcrossAnEditAndCompletion(bool completeBeforeReplay)
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 17;
        SeedUserLanguageAndText(context, userId, textId, "Alfa beta.");
        context.Languages.Add(new() { LanguageId = 2, Code = "en", Name = "English" });
        await context.SaveChangesAsync();
        var original = LessonStudyActivity.Revision("Alfa beta.", 1, null);
        const string editedText = "First. Another line.";
        var current = LessonStudyActivity.Revision(editedText, 2, null);

        var texts = CreateTextsController(context, userId);
        Assert.IsType<NoContentResult>(await texts.UpdateText(textId,
            new() { TextId = textId, Title = "Edited", Content = editedText, LanguageId = 2 }));
        var controller = CreateUserActivityController(context, userId);

        if (!completeBeforeReplay)
            Assert.Null((await ReadSentence(controller, textId, 0, "Alfa beta.", original)).LastSegmentIndex);

        await ReadSentence(controller, textId, 0, "First.", current);
        Assert.IsType<OkObjectResult>((await texts.CompleteText(textId, sourceRevision: current)).Result);
        Assert.Equal(3, (await ReadSentence(controller, textId, 0, "Alfa beta.", original)).CreditedWordCount);

        var stats = await context.UserLanguageStatistics.ToDictionaryAsync(s => s.LanguageId, s => s.TotalWordsRead);
        Assert.Equal(2, stats[1]);
        Assert.Equal(3, stats[2]);
        Assert.Equal(2, (await context.UserActivities.SingleAsync(a => a.LanguageId == 1)).WordCount);
    }

    [Fact]
    public async Task SavingAnUnchangedPassCountAfterALanguageEdit_DoesNotDoubleCreditSentences()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        const int textId = 18;
        const string originalText = "Alfa beta. Gamma delta.";
        const string editedText = "First words. Another line.";
        SeedUserLanguageAndText(context, userId, textId, originalText);
        context.Languages.Add(new() { LanguageId = 2, Code = "en", Name = "English" });
        await context.SaveChangesAsync();
        var original = LessonStudyActivity.Revision(originalText, 1, null);
        var current = LessonStudyActivity.Revision(editedText, 2, null);

        var study = new LessonStudyController(context) { ControllerContext = BuildControllerContext(userId) };
        Assert.IsType<OkObjectResult>(await study.SetCount(textId, new()
        {
            Kind = "read", Count = 0.5m, ExpectedCount = 0m, ClientEventId = "original-half-pass", SourceRevision = original
        }));
        var texts = CreateTextsController(context, userId);
        Assert.IsType<NoContentResult>(await texts.UpdateText(textId,
            new() { TextId = textId, Title = "Edited", Content = editedText, LanguageId = 2 }));
        await ReadSentence(CreateUserActivityController(context, userId), textId, 0, "First words.", current);
        Assert.IsType<OkObjectResult>(await study.SetCount(textId, new()
        {
            Kind = "read", Count = 0.5m, ExpectedCount = 0.5m, ClientEventId = "unchanged-total", SourceRevision = current
        }));

        Assert.IsType<OkObjectResult>((await texts.CompleteText(textId, sourceRevision: current)).Result);
        var stats = await context.UserLanguageStatistics.ToDictionaryAsync(s => s.LanguageId, s => s.TotalWordsRead);
        Assert.Equal(2, stats[1]);
        Assert.Equal(4, stats[2]);
    }

    [Fact]
    public async Task CompleteText_OnlyCreditsRemainingWordsAfterSentenceMode()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var textId = 22;
        const int languageId = 1;

        SeedUserLanguageAndText(context, userId, textId, "one two three four");

        var words = new[]
        {
            new Word { WordId = 100, UserId = userId, LanguageId = languageId, Term = "one", Status = 5 },
            new Word { WordId = 101, UserId = userId, LanguageId = languageId, Term = "two", Status = 4 },
            new Word { WordId = 102, UserId = userId, LanguageId = languageId, Term = "three", Status = 3 },
            new Word { WordId = 103, UserId = userId, LanguageId = languageId, Term = "four", Status = 2 }
        };
        await context.Words.AddRangeAsync(words);
        await context.TextWords.AddRangeAsync(words.Select((word, index) => new TextWord
        {
            TextWordId = 200 + index,
            TextId = textId,
            WordId = word.WordId,
            CreatedAt = DateTime.UtcNow
        }));
        await context.UserSentenceProgresses.AddAsync(new UserSentenceProgress
        {
            UserId = userId,
            TextId = textId,
            CreditedSegmentIndicesJson = "[0]",
            CreditedWordCount = 2,
            LastSegmentIndex = 0,
            UpdatedAt = DateTime.UtcNow
        });
        await context.UserLanguageStatistics.AddAsync(new UserLanguageStatistics
        {
            UserId = userId,
            LanguageId = languageId,
            TotalWordsRead = 2,
            LastUpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service, new WordLinkingChannel(), CreateStatsRecompute(context))
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.CompleteText(textId);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.NotNull(ok.Value);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
        Assert.Equal(1, stats.TotalTextsCompleted);
        Assert.Equal(1, stats.TotalTextCompletions);

        var completionActivity = await context.UserActivities.SingleAsync(activity => activity.ActivityType == "TextCompleted");
        Assert.Equal(2, completionActivity.WordCount);
    }

    [Fact]
    public async Task CompleteText_CreditsZeroWords_WhenSentenceProgressAlreadyCoversFullText()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var textId = 30;
        const int languageId = 1;

        SeedUserLanguageAndText(context, userId, textId, "one two three four");

        var words = new[]
        {
            new Word { WordId = 110, UserId = userId, LanguageId = languageId, Term = "one", Status = 5 },
            new Word { WordId = 111, UserId = userId, LanguageId = languageId, Term = "two", Status = 4 },
            new Word { WordId = 112, UserId = userId, LanguageId = languageId, Term = "three", Status = 3 },
            new Word { WordId = 113, UserId = userId, LanguageId = languageId, Term = "four", Status = 2 }
        };
        await context.Words.AddRangeAsync(words);
        await context.TextWords.AddRangeAsync(words.Select((word, index) => new TextWord
        {
            TextWordId = 210 + index,
            TextId = textId,
            WordId = word.WordId,
            CreatedAt = DateTime.UtcNow
        }));
        await context.UserSentenceProgresses.AddAsync(new UserSentenceProgress
        {
            UserId = userId,
            TextId = textId,
            CreditedSegmentIndicesJson = "[0,1]",
            CreditedWordCount = 4,
            LastSegmentIndex = 1,
            UpdatedAt = DateTime.UtcNow
        });
        await context.UserLanguageStatistics.AddAsync(new UserLanguageStatistics
        {
            UserId = userId,
            LanguageId = languageId,
            TotalWordsRead = 4,
            LastUpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service, new WordLinkingChannel(), CreateStatsRecompute(context))
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.CompleteText(textId);

        Assert.IsType<OkObjectResult>(result.Result);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
        Assert.Equal(1, stats.TotalTextsCompleted);
        Assert.Equal(1, stats.TotalTextCompletions);

        var completionActivity = await context.UserActivities.SingleAsync(a => a.ActivityType == "TextCompleted");
        Assert.Equal(0, completionActivity.WordCount);
    }

    [Fact]
    public async Task CompleteText_CountsRepeatCompletionsWithoutDoubleCountingUniqueTexts()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var textId = 35;
        const int languageId = 1;

        SeedUserLanguageAndText(context, userId, textId, "hello world");
        var words = new[]
        {
            new Word { WordId = 115, UserId = userId, LanguageId = languageId, Term = "hello", Status = 5 },
            new Word { WordId = 116, UserId = userId, LanguageId = languageId, Term = "world", Status = 4 }
        };
        await context.Words.AddRangeAsync(words);
        await context.TextWords.AddRangeAsync(words.Select((word, index) => new TextWord
        {
            TextWordId = 215 + index,
            TextId = textId,
            WordId = word.WordId,
            CreatedAt = DateTime.UtcNow
        }));
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service, new WordLinkingChannel(), CreateStatsRecompute(context))
        {
            ControllerContext = BuildControllerContext(userId)
        };

        await controller.CompleteText(textId);

        // Push the last-completed timestamp well outside the retry window, so the second call is a
        // genuine re-read rather than a duplicate of the first (see CompleteText_DedupsImmediateRetry).
        var completedText = await context.Texts.SingleAsync(t => t.TextId == textId);
        completedText.LastCompletedAt = DateTime.UtcNow.AddMinutes(-5);
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        await controller.CompleteText(textId);

        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(4, stats.TotalWordsRead);
        Assert.Equal(1, stats.TotalTextsCompleted);
        Assert.Equal(2, stats.TotalTextCompletions);
    }

    [Fact]
    public async Task CompleteText_SetsTagToFinished_WhenAutoMoveFinishedLessonsEnabled()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        var textId = 40;
        const int languageId = 1;

        SeedUserLanguageAndText(context, userId, textId, "hello");
        await context.UserSettings.AddAsync(new UserSettings
        {
            UserId = userId,
            AutoMoveFinishedLessons = true,
            CreatedAt = DateTime.UtcNow
        });

        var word = new Word { WordId = 120, UserId = userId, LanguageId = languageId, Term = "hello", Status = 5 };
        await context.Words.AddAsync(word);
        await context.TextWords.AddAsync(new TextWord
        {
            TextWordId = 220,
            TextId = textId,
            WordId = word.WordId,
            CreatedAt = DateTime.UtcNow
        });
        await context.UserSentenceProgresses.AddAsync(new UserSentenceProgress
        {
            UserId = userId,
            TextId = textId,
            CreditedSegmentIndicesJson = "[0]",
            CreditedWordCount = 1,
            LastSegmentIndex = 0,
            UpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();
        context.ChangeTracker.Clear();

        var service = new UserActivityService(context, NullLogger<UserActivityService>.Instance);
        var controller = new TextsController(context, NullLogger<TextsController>.Instance, service, new WordLinkingChannel(), CreateStatsRecompute(context))
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.CompleteText(textId);

        Assert.IsType<OkObjectResult>(result.Result);

        var textAfter = await context.Texts.AsNoTracking().SingleAsync(t => t.TextId == textId);
        Assert.True(textAfter.IsFinished);
        Assert.Equal("Finished", textAfter.Tag);
    }

    [Fact]
    public async Task ResetStatistics_ClearsTotalTextCompletions()
    {
        await using var context = CreateContext();
        var userId = Guid.NewGuid();
        await context.UserLanguageStatistics.AddAsync(new UserLanguageStatistics
        {
            UserId = userId,
            LanguageId = 1,
            TotalWordsRead = 100,
            TotalTextsCompleted = 3,
            TotalTextCompletions = 7,
            TotalBooksCompleted = 2,
            TotalSecondsListened = 60,
            LastUpdatedAt = DateTime.UtcNow
        });
        await context.SaveChangesAsync();

        var controller = new UsersController(context, NullLogger<UsersController>.Instance)
        {
            ControllerContext = BuildControllerContext(userId)
        };

        var result = await controller.ResetStatistics();

        Assert.IsType<OkObjectResult>(result);
        var stats = await context.UserLanguageStatistics.SingleAsync();
        Assert.Equal(0, stats.TotalWordsRead);
        Assert.Equal(0, stats.TotalTextsCompleted);
        Assert.Equal(0, stats.TotalTextCompletions);
        Assert.Equal(0, stats.TotalBooksCompleted);
        Assert.Equal(0, stats.TotalSecondsListened);
    }

    private static UserActivityController CreateUserActivityController(AppDbContext context, Guid userId)
    {
        return new UserActivityController(context, null!, NullLogger<UserActivityController>.Instance)
        {
            ControllerContext = BuildControllerContext(userId)
        };
    }

    private static TextsController CreateTextsController(AppDbContext context, Guid userId) => new(context,
        NullLogger<TextsController>.Instance, new UserActivityService(context, NullLogger<UserActivityService>.Instance),
        new WordLinkingChannel(), CreateStatsRecompute(context)) { ControllerContext = BuildControllerContext(userId) };

    private static async Task<UserActivityController.SentenceProgressDto> ReadSentence(UserActivityController controller,
        int textId, int index, string sentence, string? revision = null)
    {
        var result = await controller.LogSentenceRead(new()
        {
            TextId = textId, SourceRevision = revision, CurrentSegmentIndex = index,
            Segments = [new() { SegmentIndex = index, SegmentText = sentence,
                SourceStart = revision == null ? null : 0, SourceText = revision == null ? null : sentence }]
        });
        return Assert.IsType<UserActivityController.SentenceProgressDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
    }

    private static ControllerContext BuildControllerContext(Guid userId)
    {
        return new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, userId.ToString())
                ], "TestAuth"))
            }
        };
    }

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            // InMemory is non-transactional; suppress the warning so BeginTransactionAsync() is a no-op instead of throwing.
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new AppDbContext(options);
    }

    private static StatsRecomputeService CreateStatsRecompute(AppDbContext context)
    {
        var services = new ServiceCollection();
        services.AddSingleton(context);
        return new StatsRecomputeService(services.BuildServiceProvider(), NullLogger<StatsRecomputeService>.Instance, new MigrationSignal());
    }

    private static void SeedUserLanguageAndText(AppDbContext context, Guid userId, int textId, string content)
    {
        var user = new User
        {
            Id = userId,
            UserName = "tester",
            Email = "tester@example.com"
        };
        var language = new Language
        {
            LanguageId = 1,
            Name = "Spanish",
            Code = "ES"
        };
        var text = new Text
        {
            TextId = textId,
            UserId = userId,
            LanguageId = 1,
            Title = "Test text",
            Content = content
        };

        context.Users.Add(user);
        context.Languages.Add(language);
        context.Texts.Add(text);
        context.SaveChanges();
    }
}
