using System.Data;
using System.Security.Cryptography;
using System.Text;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Utilities;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services;

public static class LessonStudyActivity
{
    public static async Task<(long Read, long Listen)> PassCountsAsync(AppDbContext context, Guid userId, int textId)
    {
        var counts = await context.LessonStudyEvents
            .Where(e => e.UserId == userId && e.SourceTextId == textId && e.CountsTowardStatistics)
            .GroupBy(e => e.Kind).Select(g => new { Kind = g.Key, Tenths = g.Sum(e => (long)e.PassTenths) })
            .ToDictionaryAsync(g => g.Kind, g => g.Tenths);
        return (counts.GetValueOrDefault("read") + counts.GetValueOrDefault("read-set"),
            counts.GetValueOrDefault("listen") + counts.GetValueOrDefault("list-set") + counts.GetValueOrDefault("playback"));
    }

    public static long RoundedWords(long tenths, int words) =>
        (long)Math.Round(tenths * (decimal)words / 10, MidpointRounding.AwayFromZero);

    internal sealed record ReadingPass(int CreditedWords, string SourceRevision, bool? ReconcilesSentenceCredit,
        int LanguageId, int PassTenths, int? TargetPassTenths, int CountingVersion, long? ReadingVolumeWords);

    internal static Task<List<ReadingPass>> ReadingPassesAsync(AppDbContext context, Guid userId, int textId) =>
        context.LessonStudyEvents.Where(e => e.UserId == userId && e.SourceTextId == textId
                && e.CountsTowardStatistics && (e.Kind == "read" || e.Kind == "read-set"))
            .OrderBy(e => e.LessonStudyEventId)
            .Select(e => new ReadingPass(e.CreditedWords, e.SourceRevision, e.ReconcilesSentenceCredit, e.LanguageId,
                e.PassTenths, e.TargetPassTenths, e.CountingVersion, e.ReadingVolumeWords)).ToListAsync();

    // Sentence reconciliation events have zero pass tenths. For older events without a
    // volume snapshot, retain the units used by that counting version.
    internal static long ReadingVolume(IReadOnlyList<ReadingPass> reads, int end, int words, int whitespaceWords)
    {
        long previous = 0, whitespaceTenths = 0, profiledTenths = 0;
        for (var i = end - 1; i >= 0; i--)
        {
            var read = reads[i];
            if (read.ReadingVolumeWords is { } saved) { previous = saved; break; }
            if (read.CountingVersion == WordCountUtility.WhitespaceCountingVersion) whitespaceTenths += read.PassTenths;
            else profiledTenths += read.PassTenths;
        }
        return Math.Max(0, previous + RoundedWords(whitespaceTenths, whitespaceWords) + RoundedWords(profiledTenths, words));
    }

    // Reconcile whole-pass and fractional credit with the initial sentence read.
    // A normal completion always adds one pass, including after a partial read.
    internal static async Task<(int CreditedWords, long ReadingVolumeWords)> CompletionCreditAsync(
        AppDbContext context, Guid userId, int textId, int languageId, int words, bool isFinished, int whitespaceWords)
    {
        var reads = await ReadingPassesAsync(context, userId, textId);
        var previousVolume = ReadingVolume(reads, reads.Count, words, whitespaceWords);
        var volume = previousVolume + words;
        // Previously finished lessons (including Finish without credit) are deliberate rereads.
        if (isFinished) return (words, volume);
        var sentence = await context.UserSentenceProgresses.FindAsync(userId, textId);
        var sentenceWords = SentenceSourceCoverage.CreditedWordsForLanguage(sentence, languageId);
        var languageVolume = previousVolume;
        if (reads.Any(read => read.LanguageId != languageId))
        {
            // Saving an unchanged count can repeat volume earned in another language.
            var languageReads = reads.Where(read => read.LanguageId == languageId && read.PassTenths != 0).ToList();
            languageVolume = ReadingVolume(languageReads, languageReads.Count, words, whitespaceWords);
        }
        var outstandingSentenceCredit = Math.Max(0L, sentenceWords - languageVolume);
        return (words - (int)Math.Min(words, outstandingSentenceCredit), volume);
    }

    public static string Revision(string content, int languageId, string? audioPath) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{languageId}\n{audioPath}\n{content}")));

    public static bool ValidId(string? id) => id == null || (id.Length is > 0 and <= 64 && !string.IsNullOrWhiteSpace(id));

    // Store this identity in a time receipt's SourceRevision, leaving ClientEventId
    // independent so arbitrary explicit lesson-pass IDs cannot collide with it.
    public static string ListeningResetReceiptKey(string clientEventId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"listening-reset-receipt:v1\n{clientEventId}")));

    public static string ManualActivityReceiptKey(string operationId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"manual-activity-receipt:v1\n{operationId}")));

    // Reset receipts carry identity only: they never count toward statistics.
    public static IQueryable<LessonStudyEvent> ListeningResetReceipts(AppDbContext context, Guid userId) =>
        context.LessonStudyEvents.Where(e => e.UserId == userId && e.Kind == "time" && e.SourceTextId == 0 && !e.CountsTowardStatistics);

    // Any reset that erases keyed listening activity must retain its playback
    // identity, so an old offline or lost-response retry cannot restore the time.
    public static async Task AddListeningResetReceiptsAsync(AppDbContext context, Guid userId, IEnumerable<UserActivity> removedActivities)
    {
        var keyed = removedActivities
            .Where(a => a.UserId == userId && a.ActivityType == "Listening" && !string.IsNullOrEmpty(a.ClientEventId))
            .ToList();
        if (keyed.Count == 0) return;

        var receiptKeys = (await ListeningResetReceipts(context, userId)
            .Select(e => e.SourceRevision).ToListAsync()).ToHashSet();
        foreach (var activity in keyed)
        {
            var receiptKey = ListeningResetReceiptKey(activity.ClientEventId!);
            if (receiptKeys.Add(receiptKey))
                context.LessonStudyEvents.Add(new LessonStudyEvent
                {
                    UserId = userId, LanguageId = activity.LanguageId, SourceTextId = 0,
                    SourceRevision = receiptKey, ClientEventId = Guid.NewGuid().ToString(), Kind = "time",
                    CountingVersion = 1, CountsTowardStatistics = false,
                    CreditedListeningSeconds = activity.ListeningDurationSeconds ?? 0,
                    CreatedAt = activity.Timestamp.Kind == DateTimeKind.Local
                        ? activity.Timestamp.ToUniversalTime()
                        : DateTime.SpecifyKind(activity.Timestamp, DateTimeKind.Utc)
                });
        }
    }

    // A user-wide transaction lock also protects totals shared by different
    // lessons. The stable hash is evaluated by PostgreSQL, not .NET GetHashCode.
    public static async Task LockAsync(AppDbContext context, Guid userId)
    {
        if (context.Database.IsNpgsql())
            await context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtextextended({userId.ToString()}, 0))");
    }

    // On PostgreSQL, pg_advisory_xact_lock(userId) serializes locked user writes.
    // Using ReadCommitted lets a waiter see rows committed by the previous lock holder
    // immediately after acquiring the lock instead of reading a pre-lock Serializable snapshot.
    public static IsolationLevel LockedIsolation(AppDbContext context) =>
        context.Database.IsNpgsql() ? IsolationLevel.ReadCommitted : IsolationLevel.Serializable;

    public static async Task<T> AtomicAsync<T>(AppDbContext context, Guid userId, Func<Task<T>> action,
        IsolationLevel? isolation = null)
    {
        var level = isolation ?? LockedIsolation(context);
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
                {
                    context.ChangeTracker.Clear();
                    await using var transaction = context.Database.IsRelational()
                        ? await context.Database.BeginTransactionAsync(level) : null;
                    await LockAsync(context, userId);
                    var result = await action();
                    if (transaction != null) await transaction.CommitAsync();
                    return result;
                });
            }
            catch (DbUpdateException ex) when (attempt < 3 && context.Database.IsRelational() &&
                ex.InnerException is Npgsql.PostgresException { SqlState: "23505", ConstraintName: "IX_Words_UserId_LanguageId_Term" })
            {
                // A concurrent vocabulary save outside the user lock can win the probe/insert race.
                // Retrying in a fresh transaction observes the committed row and updates it.
                // The await-using above has disposed/rolled back before this catch.
                context.ChangeTracker.Clear();
            }
        }
    }

    public static LessonStudyEvent Record(AppDbContext context, Guid userId, int textId, string title,
        int languageId, string content, string? audioPath, string? clientEventId, string kind,
        int words = 0, int seconds = 0)
    {
        var record = new LessonStudyEvent { UserId = userId, SourceTextId = textId,
            SourceTitle = title, LanguageId = languageId, SourceRevision = Revision(content, languageId, audioPath),
            ClientEventId = clientEventId ?? Guid.NewGuid().ToString(), Kind = kind,
            CreditedWords = words, CreditedListeningSeconds = seconds, IsCompletionCheckpoint = kind == "read" };
        context.LessonStudyEvents.Add(record);
        return record;
    }
}
