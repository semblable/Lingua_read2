using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Controllers
{
    /// <summary>
    /// Sentence bookmarks in the reader, stored per user so they follow the
    /// reader from device to device.
    /// </summary>
    [Route("api/bookmarks")]
    [ApiController]
    [Authorize]
    public class BookmarksController : ControllerBase
    {
        // Bounds for the one-time localStorage import; anything past them is skipped.
        internal const int MaxImportTexts = 2000;
        internal const int MaxImportIndicesPerText = 1000;

        // Imported bookmarks have no time of their own, but all of them predate
        // sync, so they're stamped with when the TextBookmarks table was created
        // (migration 20260922200737). Every synced bookmark is then newer: an import
        // from a device that sat offline for weeks can't take over a text's
        // scroll-on-open anchor, and a toggle that races the import still wins.
        internal static readonly DateTime LegacyBookmarkTime = new(2026, 9, 22, 20, 7, 37, DateTimeKind.Utc);

        private readonly AppDbContext _context;

        public BookmarksController(AppDbContext context)
        {
            _context = context;
        }

        // GET: api/bookmarks/{textId}
        [HttpGet("{textId:int}")]
        public async Task<ActionResult<TextBookmarksDto>> GetBookmarks(int textId)
        {
            var userId = GetUserId();
            if (userId == Guid.Empty) return Unauthorized("User ID not found in token.");

            if (!await OwnsText(userId, textId)) return NotFound("Text not found.");

            return Ok(await LoadBookmarks(userId, textId));
        }

        // PUT: api/bookmarks/{textId}/{sentenceIndex}
        // Adds or removes one bookmark. Last write wins by client time, so an
        // offline toggle that drains late can't undo a newer one from another device.
        [HttpPut("{textId:int}/{sentenceIndex:int}")]
        public async Task<ActionResult<TextBookmarksDto>> SetBookmark(
            int textId,
            int sentenceIndex,
            [FromBody] SetBookmarkRequest request)
        {
            if (sentenceIndex < 0) return BadRequest("Sentence index must not be negative.");

            var userId = GetUserId();
            if (userId == Guid.Empty) return Unauthorized("User ID not found in token.");

            if (!await OwnsText(userId, textId)) return NotFound("Text not found.");

            // Clamp the client timestamp to server "now" (see UpdateAudioLessonProgress)
            // so a fast client clock can't persist a future UpdatedAt.
            var nowUtc = DateTime.UtcNow;
            var clientTs = AsUtc(request.ClientUpdatedAt);
            var effectiveTs = clientTs.HasValue && clientTs.Value <= nowUtc ? clientTs.Value : nowUtc;

            var bookmark = await _context.TextBookmarks.FindAsync(userId, textId, sentenceIndex);
            if (bookmark == null)
            {
                // A removal the server never saw the add for still gets a tombstone:
                // the add may yet arrive (a racing request, or a late offline drain)
                // with an older timestamp, and must then lose.
                _context.TextBookmarks.Add(new TextBookmark
                {
                    UserId = userId,
                    TextId = textId,
                    SentenceIndex = sentenceIndex,
                    IsActive = request.Bookmarked,
                    BookmarkedAt = effectiveTs,
                    UpdatedAt = effectiveTs
                });
                try
                {
                    await _context.SaveChangesAsync();
                    return Ok(await LoadBookmarks(userId, textId));
                }
                catch (DbUpdateException)
                {
                    // A concurrent request inserted this sentence's row first (another
                    // device, or the one-time import). Apply this write to that row
                    // like any other instead of failing it.
                    _context.ChangeTracker.Clear();
                    bookmark = await _context.TextBookmarks.FindAsync(userId, textId, sentenceIndex);
                    if (bookmark == null) throw;
                }
            }

            if (bookmark.UpdatedAt <= effectiveTs)
            {
                bookmark.IsActive = request.Bookmarked;
                if (request.Bookmarked) bookmark.BookmarkedAt = effectiveTs;
                bookmark.UpdatedAt = effectiveTs;
                await _context.SaveChangesAsync();
            }
            // else: stale replay; a newer add or remove already landed.

            return Ok(await LoadBookmarks(userId, textId));
        }

        // POST: api/bookmarks/import
        // One-time upload of the bookmarks older clients kept only in localStorage.
        // Inserts only rows the server doesn't have, so it never overrides a
        // bookmark (or a removal) made after sync existed, and a retry is harmless.
        [HttpPost("import")]
        public async Task<ActionResult<ImportBookmarksResult>> ImportBookmarks([FromBody] ImportBookmarksRequest request)
        {
            var userId = GetUserId();
            if (userId == Guid.Empty) return Unauthorized("User ID not found in token.");

            try
            {
                return Ok(await ImportMissing(userId, request));
            }
            catch (DbUpdateException)
            {
                // A toggle (or another tab's import) inserted one of these rows first.
                // Nothing was saved; the retry skips the rows that are there now.
                _context.ChangeTracker.Clear();
                return Ok(await ImportMissing(userId, request));
            }
        }

        private async Task<ImportBookmarksResult> ImportMissing(Guid userId, ImportBookmarksRequest request)
        {
            var groups = (request.Texts ?? new List<ImportedTextBookmarks>())
                .GroupBy(t => t.TextId)
                .ToList();

            var candidateIds = groups.Take(MaxImportTexts).Select(g => g.Key).ToList();
            var ownedIds = (await _context.Texts
                    .Where(t => t.UserId == userId && candidateIds.Contains(t.TextId))
                    .Select(t => t.TextId)
                    .ToListAsync())
                .ToHashSet();

            var existing = (await _context.TextBookmarks
                    .Where(b => b.UserId == userId && ownedIds.Contains(b.TextId))
                    .Select(b => new { b.TextId, b.SentenceIndex })
                    .ToListAsync())
                .Select(b => (b.TextId, b.SentenceIndex))
                .ToHashSet();

            var imported = 0;
            var skippedTexts = groups.Count - candidateIds.Count;

            foreach (var group in groups.Take(MaxImportTexts))
            {
                if (!ownedIds.Contains(group.Key))
                {
                    // Deleted or re-split texts leave orphaned local bookmarks behind.
                    skippedTexts++;
                    continue;
                }

                var lastIndex = group.Select(t => t.LastSentenceIndex).LastOrDefault(i => i.HasValue);
                var indices = group
                    .SelectMany(t => t.SentenceIndices ?? new List<int>())
                    .Where(i => i >= 0)
                    .Distinct()
                    .Take(MaxImportIndicesPerText);

                foreach (var index in indices)
                {
                    if (existing.Contains((group.Key, index))) continue;

                    // The local "last bookmark" gets the newest time among the
                    // imported ones so it stays the scroll-on-open anchor.
                    var at = index == lastIndex ? LegacyBookmarkTime : LegacyBookmarkTime.AddSeconds(-1);
                    _context.TextBookmarks.Add(new TextBookmark
                    {
                        UserId = userId,
                        TextId = group.Key,
                        SentenceIndex = index,
                        IsActive = true,
                        BookmarkedAt = at,
                        UpdatedAt = at
                    });
                    imported++;
                }
            }

            await _context.SaveChangesAsync();

            return new ImportBookmarksResult { Imported = imported, SkippedTexts = skippedTexts };
        }

        private Task<bool> OwnsText(Guid userId, int textId) =>
            _context.Texts.AnyAsync(t => t.TextId == textId && t.UserId == userId);

        private async Task<TextBookmarksDto> LoadBookmarks(Guid userId, int textId)
        {
            var active = await _context.TextBookmarks
                .AsNoTracking()
                .Where(b => b.UserId == userId && b.TextId == textId && b.IsActive)
                .Select(b => new { b.SentenceIndex, b.BookmarkedAt })
                .ToListAsync();

            return new TextBookmarksDto
            {
                TextId = textId,
                SentenceIndices = active.Select(b => b.SentenceIndex).OrderBy(i => i).ToList(),
                LastSentenceIndex = active
                    .OrderByDescending(b => b.BookmarkedAt)
                    .ThenByDescending(b => b.SentenceIndex)
                    .Select(b => (int?)b.SentenceIndex)
                    .FirstOrDefault()
            };
        }

        // Npgsql only writes UTC DateTimes to timestamptz columns; a timestamp
        // sent without a zone is taken as UTC, one with an offset is converted.
        private static DateTime? AsUtc(DateTime? value) => value switch
        {
            null => null,
            { Kind: DateTimeKind.Utc } utc => utc,
            { Kind: DateTimeKind.Local } local => local.ToUniversalTime(),
            { } unspecified => DateTime.SpecifyKind(unspecified, DateTimeKind.Utc)
        };

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
            return Guid.TryParse(userIdClaim, out var userId) ? userId : Guid.Empty;
        }
    }

    public class TextBookmarksDto
    {
        public int TextId { get; set; }
        public List<int> SentenceIndices { get; set; } = new();
        // The newest active bookmark; the reader scrolls to it on open.
        public int? LastSentenceIndex { get; set; }
    }

    public class SetBookmarkRequest
    {
        public bool Bookmarked { get; set; }
        public DateTime? ClientUpdatedAt { get; set; }
    }

    public class ImportBookmarksRequest
    {
        public List<ImportedTextBookmarks> Texts { get; set; } = new();
    }

    public class ImportedTextBookmarks
    {
        public int TextId { get; set; }
        public List<int> SentenceIndices { get; set; } = new();
        public int? LastSentenceIndex { get; set; }
    }

    public class ImportBookmarksResult
    {
        public int Imported { get; set; }
        public int SkippedTexts { get; set; }
    }
}
