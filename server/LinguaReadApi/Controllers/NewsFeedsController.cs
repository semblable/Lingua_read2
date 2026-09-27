using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services.News;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Controllers
{
    /// <summary>
    /// The user's news feeds (Settings › News feeds). Importing runs in NewsFeedBackgroundService
    /// while the user's NewsImportEnabled setting is on; POST {id}/fetch checks one feed right away.
    /// </summary>
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class NewsFeedsController : ControllerBase
    {
        public const int MaxFeedsPerUser = 30;

        private readonly AppDbContext _context;
        private readonly NewsFeedImporter _importer;
        private readonly TimeProvider _timeProvider;

        public NewsFeedsController(AppDbContext context, NewsFeedImporter importer, TimeProvider? timeProvider = null)
        {
            _context = context;
            _importer = importer;
            _timeProvider = timeProvider ?? TimeProvider.System;
        }

        // GET: api/newsfeeds
        [HttpGet]
        public async Task<ActionResult<List<NewsFeedDto>>> GetFeeds()
        {
            var userId = GetUserId();
            var feeds = await _context.NewsFeeds
                .Where(f => f.UserId == userId)
                .OrderBy(f => f.CreatedAt)
                .ThenBy(f => f.NewsFeedId)
                .Select(f => f.NewsFeedId)
                .ToListAsync();
            return await ToDtosAsync(userId, feeds);
        }

        // POST: api/newsfeeds
        // Takes a feed address or a web page that links to its feed, and follows the feed found.
        [HttpPost]
        public async Task<ActionResult<NewsFeedDto>> AddFeed([FromBody] AddNewsFeedDto dto, CancellationToken cancellationToken)
        {
            var userId = GetUserId();
            var input = dto.Url?.Trim() ?? "";
            if (!input.Contains("://", StringComparison.Ordinal))
            {
                input = "https://" + input;
            }
            if (!Uri.TryCreate(input, UriKind.Absolute, out var url) || !NewsFetcher.IsWebUrl(url) || !string.IsNullOrEmpty(url.UserInfo))
            {
                return BadRequest(new { message = "Enter the feed's web address, e.g. https://feeds.bbci.co.uk/portuguese/rss.xml." });
            }
            if (!await _context.Languages.AnyAsync(l => l.LanguageId == dto.LanguageId, cancellationToken))
            {
                return BadRequest(new { message = "Choose the language of the feed's articles." });
            }
            if (await _context.NewsFeeds.CountAsync(f => f.UserId == userId, cancellationToken) >= MaxFeedsPerUser)
            {
                return BadRequest(new { message = $"You can follow up to {MaxFeedsPerUser} feeds." });
            }

            FeedDiscovery discovery;
            try
            {
                discovery = await _importer.DiscoverAsync(url, cancellationToken);
            }
            catch (NewsFetchException ex)
            {
                return BadRequest(new { message = ex.Message });
            }

            var feedUrl = discovery.FeedUrl.AbsoluteUri;
            if (feedUrl.Length > NewsFeed.MaxUrlLength)
            {
                return BadRequest(new { message = "The feed's address is too long." });
            }
            if (await _context.NewsFeeds.AnyAsync(f => f.UserId == userId && f.Url == feedUrl, cancellationToken))
            {
                return Conflict(new { message = "You already follow this feed." });
            }

            var title = discovery.Feed.Title ?? discovery.FeedUrl.Host;
            var feed = new NewsFeed
            {
                UserId = userId,
                Url = feedUrl,
                Title = title.Length <= NewsFeed.MaxTitleLength ? title : title[..NewsFeed.MaxTitleLength].TrimEnd(),
                LanguageId = dto.LanguageId,
                Enabled = true,
                CreatedAt = _timeProvider.GetUtcNow().UtcDateTime
            };
            _context.NewsFeeds.Add(feed);
            await _context.SaveChangesAsync(cancellationToken);

            var created = (await ToDtosAsync(userId, new List<int> { feed.NewsFeedId }))[0];
            return CreatedAtAction(nameof(GetFeeds), created);
        }

        // PUT: api/newsfeeds/5
        [HttpPut("{id}")]
        public async Task<ActionResult<NewsFeedDto>> UpdateFeed(int id, [FromBody] UpdateNewsFeedDto dto)
        {
            var userId = GetUserId();
            var feed = await _context.NewsFeeds.FirstOrDefaultAsync(f => f.NewsFeedId == id && f.UserId == userId);
            if (feed == null)
            {
                return NotFound(new { message = "Feed not found." });
            }

            if (dto.LanguageId is int languageId && languageId != feed.LanguageId)
            {
                if (!await _context.Languages.AnyAsync(l => l.LanguageId == languageId))
                {
                    return BadRequest(new { message = "Language not found." });
                }
                feed.LanguageId = languageId;
                // Its folder follows, so the Library shows the folder under the new language.
                var folder = feed.FolderId == null ? null
                    : await _context.Folders.FirstOrDefaultAsync(f => f.FolderId == feed.FolderId && f.UserId == userId);
                if (folder != null)
                {
                    folder.LanguageId = languageId;
                }
            }
            if (dto.Enabled is bool enabled)
            {
                feed.Enabled = enabled;
            }
            await _context.SaveChangesAsync();
            return (await ToDtosAsync(userId, new List<int> { feed.NewsFeedId }))[0];
        }

        // DELETE: api/newsfeeds/5
        // The feed's articles stay in the Library as ordinary texts.
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteFeed(int id)
        {
            var userId = GetUserId();
            var feed = await _context.NewsFeeds.FirstOrDefaultAsync(f => f.NewsFeedId == id && f.UserId == userId);
            if (feed == null)
            {
                return NotFound(new { message = "Feed not found." });
            }
            // The database unsets the articles' NewsFeedId and deletes the seen entries.
            _context.NewsFeeds.Remove(feed);
            await _context.SaveChangesAsync();
            return NoContent();
        }

        // POST: api/newsfeeds/5/fetch
        // Checks the feed now, within the same daily limit as the background import.
        [HttpPost("{id}/fetch")]
        public async Task<ActionResult<NewsFeedFetchResultDto>> FetchFeed(int id, CancellationToken cancellationToken)
        {
            var userId = GetUserId();
            if (!await _context.NewsFeeds.AnyAsync(f => f.NewsFeedId == id && f.UserId == userId, cancellationToken))
            {
                return NotFound(new { message = "Feed not found." });
            }

            var result = await _importer.ImportAsync(id, cancellationToken);
            return new NewsFeedFetchResultDto
            {
                Success = result.Success,
                Imported = result.Imported,
                Skipped = result.Skipped,
                Message = result.Message,
                Feed = (await ToDtosAsync(userId, new List<int> { id }))[0]
            };
        }

        private async Task<List<NewsFeedDto>> ToDtosAsync(Guid userId, List<int> feedIds)
        {
            var dayAgo = _timeProvider.GetUtcNow().UtcDateTime.AddDays(-1);
            var rows = await _context.NewsFeeds
                .AsNoTracking()
                .Where(f => f.UserId == userId && feedIds.Contains(f.NewsFeedId))
                .Select(f => new NewsFeedDto
                {
                    NewsFeedId = f.NewsFeedId,
                    Url = f.Url,
                    Title = f.Title,
                    LanguageId = f.LanguageId,
                    LanguageName = f.Language.Name,
                    FolderId = f.FolderId,
                    Enabled = f.Enabled,
                    CreatedAt = f.CreatedAt,
                    LastCheckedAt = f.LastCheckedAt,
                    LastSuccessAt = f.LastSuccessAt,
                    LastError = f.LastError,
                    ImportedLast24Hours = _context.NewsFeedItems.Count(i => i.NewsFeedId == f.NewsFeedId && i.Imported && i.FirstSeenAt > dayAgo),
                    ArticleCount = _context.Texts.Count(t => t.NewsFeedId == f.NewsFeedId)
                })
                .ToListAsync();
            // Keep the requested order.
            return feedIds.Select(id => rows.First(r => r.NewsFeedId == id)).ToList();
        }

        private Guid GetUserId()
        {
            var userIdClaim = User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
            {
                throw new UnauthorizedAccessException("User ID not found or invalid in token.");
            }
            return userId;
        }
    }

    public class NewsFeedDto
    {
        public int NewsFeedId { get; set; }
        public string Url { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public int LanguageId { get; set; }
        public string LanguageName { get; set; } = string.Empty;
        public int? FolderId { get; set; }
        public bool Enabled { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? LastCheckedAt { get; set; }
        public DateTime? LastSuccessAt { get; set; }
        public string? LastError { get; set; }
        public int ImportedLast24Hours { get; set; }
        // Articles of this feed still in the Library.
        public int ArticleCount { get; set; }
    }

    public class AddNewsFeedDto
    {
        // Not [Required]: an empty address gets the controller's own message, not a validation error.
        [StringLength(NewsFeed.MaxUrlLength)]
        public string Url { get; set; } = string.Empty;

        public int LanguageId { get; set; }
    }

    public class UpdateNewsFeedDto
    {
        public bool? Enabled { get; set; }
        public int? LanguageId { get; set; }
    }

    public class NewsFeedFetchResultDto
    {
        public bool Success { get; set; }
        public int Imported { get; set; }
        public int Skipped { get; set; }
        public string Message { get; set; } = string.Empty;
        public NewsFeedDto Feed { get; set; } = new();
    }
}
