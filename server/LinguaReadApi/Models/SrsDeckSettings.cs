namespace LinguaReadApi.Models;

public class SrsDeckSettings
{
    public Guid UserId { get; set; }
    public int LanguageId { get; set; }

    public int? MaxNewCards { get; set; }
    public int? MaxReviews { get; set; }
    public bool? NewCardsIgnoreReviewLimit { get; set; }

    public DateOnly? TodayStudyDay { get; set; }
    public DateTime? TodayExpiresAt { get; set; }
    public int? TodayMaxNewCards { get; set; }
    public int? TodayMaxReviews { get; set; }

    public bool HasTodayLimits(DateOnly studyDay, DateTime now) =>
        TodayStudyDay == studyDay && TodayExpiresAt > now;
}
