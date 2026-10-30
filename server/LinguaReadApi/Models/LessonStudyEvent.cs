using System.ComponentModel.DataAnnotations;

namespace LinguaReadApi.Models;

// Append-only operation identity and credit snapshot. SourceTextId deliberately
// has no cascading FK: deleting a lesson must not erase earned event history.
public class LessonStudyEvent
{
    public long LessonStudyEventId { get; set; }
    public Guid UserId { get; set; }
    public int SourceTextId { get; set; }
    [MaxLength(200)] public string SourceTitle { get; set; } = "";
    public int LanguageId { get; set; }
    [MaxLength(64)] public string SourceRevision { get; set; } = "";
    [MaxLength(64)] public string ClientEventId { get; set; } = "";
    [MaxLength(8)] public string Kind { get; set; } = "read";
    public int CreditedWords { get; set; }
    public int CreditedListeningSeconds { get; set; }
    public int CountingVersion { get; set; } = 1; // Legacy activity unit; no retokenization.
    public bool CountsTowardStatistics { get; set; } = true;
    public bool IsCompletionCheckpoint { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
