namespace LinguaReadApi.Models;

public class SrsDeckStudyEntry
{
    public long SrsDeckStudyEntryId { get; set; }
    public Guid UserId { get; set; }
    public int LanguageId { get; set; }
    public DateOnly StudyDay { get; set; }
    public bool IsNewCard { get; set; }

    // A deleted card can take its log with it. Keep the spent slot for the study day.
    public int? SrsReviewLogId { get; set; }
    public SrsReviewLog? ReviewLog { get; set; }
}
