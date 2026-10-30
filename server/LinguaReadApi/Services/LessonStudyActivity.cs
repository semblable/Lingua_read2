using System.Data;
using System.Security.Cryptography;
using System.Text;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services;

public static class LessonStudyActivity
{
    public static string Revision(string content, int languageId, string? audioPath) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{languageId}\n{audioPath}\n{content}")));

    public static bool ValidId(string? id) => id == null || (id.Length is > 0 and <= 64 && !string.IsNullOrWhiteSpace(id));

    // Store this identity in a time receipt's SourceRevision, leaving ClientEventId
    // independent so arbitrary explicit lesson-pass IDs cannot collide with it.
    public static string ListeningResetReceiptKey(string clientEventId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"listening-reset-receipt:v1\n{clientEventId}")));

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

    public static async Task<T> AtomicAsync<T>(AppDbContext context, Guid userId, Func<Task<T>> action) =>
        await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            context.ChangeTracker.Clear();
            await using var transaction = context.Database.IsRelational()
                ? await context.Database.BeginTransactionAsync(IsolationLevel.Serializable) : null;
            await LockAsync(context, userId);
            var result = await action();
            if (transaction != null) await transaction.CommitAsync();
            return result;
        });

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
