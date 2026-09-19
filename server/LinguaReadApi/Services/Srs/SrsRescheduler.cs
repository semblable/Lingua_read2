using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Services.Srs
{
    public static class SrsRescheduler
    {
        /// <summary>
        /// Recomputes the due day of every graduated card of <paramref name="userId"/> from its
        /// memory state and the user's current FSRS settings. Run after desired retention,
        /// maximum interval or weights change, since each shifts every card's ideal interval,
        /// and after the day start changes, since cards fall due at the start of a day.
        /// Days are the user's local days (<paramref name="tzOffsetMinutes"/>, as on the SRS
        /// endpoints): on UTC days a card could land on the wrong local day, e.g. fall due
        /// again the evening it was reviewed for a user west of UTC.
        /// Does not save; returns the number of cards rescheduled.
        /// </summary>
        public static async Task<int> RescheduleUserAsync(
            AppDbContext db, Guid userId, UserSettings? settings, int tzOffsetMinutes, CancellationToken cancellationToken = default)
        {
            var scheduler = new SrsScheduler(SrsSchedulerSettings.FromUserSettings(settings, tzOffsetMinutes));
            var cards = await db.SrsCardReviews
                .Where(c => c.UserId == userId && !c.IsLearning && c.LastReviewedAt != null && c.Stability != null)
                .ToListAsync(cancellationToken);

            foreach (var card in cards)
                card.Apply(scheduler.Reschedule(card.ToSnapshot()));

            return cards.Count;
        }
    }
}
