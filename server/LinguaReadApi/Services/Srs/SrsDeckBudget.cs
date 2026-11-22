using LinguaReadApi.Models;

namespace LinguaReadApi.Services.Srs;

internal readonly record struct SrsDeckLimits(int MaxNewCards, int MaxReviews, bool NewCardsIgnoreReviewLimit)
{
    public static SrsDeckLimits FromDefaults(UserSettings? settings) => new(
        SrsQueuePolicy.EffectiveMaxNew(settings?.SrsMaxNewCards),
        SrsQueuePolicy.EffectiveMaxReviews(settings?.SrsMaxReviews),
        settings?.SrsNewCardsIgnoreReviewLimit ?? false);

    public SrsDeckLimits WithOverrides(SrsDeckSettings? deck, DateOnly studyDay, DateTime now)
    {
        if (deck == null) return this;
        bool today = deck.HasTodayLimits(studyDay, now);
        return new(
            (today ? deck.TodayMaxNewCards : null) ?? deck.MaxNewCards ?? MaxNewCards,
            (today ? deck.TodayMaxReviews : null) ?? deck.MaxReviews ?? MaxReviews,
            deck.NewCardsIgnoreReviewLimit ?? NewCardsIgnoreReviewLimit);
    }
}

internal readonly record struct SrsDueCounts(int Learning, int NewCards, int Reviews);
internal readonly record struct SrsStudyCounts(int NewCards, int Reviews);

internal sealed class SrsDeckBudget(SrsDeckLimits limits, SrsStudyCounts studied, SrsDueCounts due)
{
    public SrsDeckLimits Limits { get; } = limits;
    public SrsStudyCounts Studied { get; } = studied;
    public SrsDueCounts Due { get; } = due;

    public int RemainingNew { get; } = SrsQueuePolicy.RemainingNew(
        limits.MaxNewCards, limits.MaxReviews, studied.NewCards, studied.Reviews, due.Reviews,
        limits.NewCardsIgnoreReviewLimit);

    public int RemainingReviews { get; } = SrsQueuePolicy.RemainingReviews(
        limits.MaxReviews, studied.Reviews, studied.NewCards, limits.NewCardsIgnoreReviewLimit);

    public int ReviewableNew => Math.Min(Due.NewCards, RemainingNew);
    public int ReviewableReviews => Math.Min(Due.Reviews, RemainingReviews);

    public bool NewCardsPausedByReviewLimit => SrsQueuePolicy.IsNewPausedByReviewLimit(
        Limits.MaxNewCards, Limits.MaxReviews, Studied.NewCards, Studied.Reviews, Due.Reviews, Due.NewCards,
        Limits.NewCardsIgnoreReviewLimit);
}
