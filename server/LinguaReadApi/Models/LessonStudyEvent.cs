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
    // Integer tenths avoid floating-point drift; existing completed passes are 10.
    public int PassTenths { get; set; } = 10;
    // Unrounded source-audio exposure. Small playback flushes retain their
    // remainder until they collectively earn the next tenth of a listen.
    public double PlaybackPasses { get; set; }
    public int? TargetPassTenths { get; set; }
    public bool? ReconcilesSentenceCredit { get; set; }
    public int CreditedWords { get; set; }
    public int CreditedListeningSeconds { get; set; }
    public int CountingVersion { get; set; } = 1; // Legacy activity unit; no retokenization.
    public bool CountsTowardStatistics { get; set; } = true;
    public bool IsCompletionCheckpoint { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
