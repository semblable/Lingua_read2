using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Utilities;
using Microsoft.Extensions.Logging;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class FoldersController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly ILogger<FoldersController> _logger;

        public FoldersController(AppDbContext context, ILogger<FoldersController> logger)
        {
            _context = context;
            _logger = logger;
        }

        // GET: api/folders
        [HttpGet]
        public async Task<ActionResult<IEnumerable<FolderDto>>> GetFolders()
        {
            var userId = GetUserId();

            var folders = await _context.Folders
                .Where(f => f.UserId == userId)
                .OrderBy(f => f.SortOrder)
                .Select(f => new FolderDto
                {
                    FolderId = f.FolderId,
                    Name = f.Name,
                    ParentFolderId = f.ParentFolderId,
                    SortOrder = f.SortOrder,
                    Color = f.Color,
                    LanguageId = f.LanguageId,
                    CreatedAt = f.CreatedAt,
                    ItemCount = f.Texts.Count(t => t.Tag != "srs-story" && t.BookId == null) + f.Books.Count + f.ChildFolders.Count
                })
                .ToListAsync();

            return folders;
        }

        // GET: api/folders/library?folderId=
        [HttpGet("library")]
        public async Task<ActionResult<LibraryContentsDto>> GetLibraryContents(
            [FromQuery] int? folderId = null)
        {
            var userId = GetUserId();

            // Build breadcrumbs
            var breadcrumbs = new List<BreadcrumbDto>();
            FolderDto? currentFolder = null;

            if (folderId.HasValue)
            {
                var folder = await _context.Folders
                    .Where(f => f.FolderId == folderId.Value && f.UserId == userId)
                    .Select(f => new FolderDto
                    {
                        FolderId = f.FolderId,
                        Name = f.Name,
                        ParentFolderId = f.ParentFolderId,
                        SortOrder = f.SortOrder,
                        Color = f.Color,
                        LanguageId = f.LanguageId,
                        CreatedAt = f.CreatedAt,
                        ItemCount = 0
                    })
                    .FirstOrDefaultAsync();

                if (folder == null)
                    return NotFound("Folder not found");

                currentFolder = folder;
                breadcrumbs = BuildFolderChain(await LoadFolderLookupAsync(userId), folderId);
            }

            // Get child folders
            var folders = await _context.Folders
                .Where(f => f.UserId == userId && f.ParentFolderId == folderId)
                .OrderBy(f => f.SortOrder)
                .ThenBy(f => f.Name)
                .Select(f => new FolderDto
                {
                    FolderId = f.FolderId,
                    Name = f.Name,
                    ParentFolderId = f.ParentFolderId,
                    SortOrder = f.SortOrder,
                    Color = f.Color,
                    LanguageId = f.LanguageId,
                    CreatedAt = f.CreatedAt,
                    ItemCount = f.Texts.Count(t => t.Tag != "srs-story" && t.BookId == null) + f.Books.Count + f.ChildFolders.Count
                })
                .ToListAsync();

            // Get books in this folder
            var books = await _context.Books
                .Where(b => b.UserId == userId && b.FolderId == folderId)
                .Include(b => b.Language)
                .Include(b => b.Texts)
                .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
                .AsSplitQuery()
                .OrderBy(b => b.SortOrder)
                .ThenByDescending(b => b.CreatedAt)
                .Select(b => new LibraryBookDto
                {
                    BookId = b.BookId,
                    Title = b.Title,
                    Author = b.Author,
                    Description = b.Description,
                    CoverImagePath = b.CoverImagePath,
                    LanguageName = b.Language.Name,
                    CreatedAt = b.CreatedAt,
                    PartCount = b.Texts.Count,
                    FinishedPartCount = b.Texts.Count(t => t.IsFinished),
                    LastReadTextId = b.LastReadTextId,
                    LastReadAt = b.LastReadAt,
                    TotalWords = b.TotalWords,
                    KnownWords = b.KnownWords,
                    LearningWords = b.LearningWords,
                    StatsUpdatedAt = b.StatsUpdatedAt,
                    IsFinished = b.IsFinished,
                    SortOrder = b.SortOrder,
                    FolderId = b.FolderId,
                    Tags = b.BookTags.Select(bt => bt.Tag.Name).ToList()
                })
                .ToListAsync();

            // Get standalone texts in this folder (not part of a book, not srs-story)
            var texts = await _context.Texts
                .Where(t => t.UserId == userId && t.BookId == null && t.Tag != "srs-story" && t.FolderId == folderId)
                .Include(t => t.Language)
                .OrderBy(t => t.SortOrder)
                .ThenByDescending(t => t.CreatedAt)
                .Select(t => new LibraryTextDto
                {
                    TextId = t.TextId,
                    Title = t.Title,
                    LanguageName = t.Language.Name,
                    CreatedAt = t.CreatedAt,
                    LastAccessedAt = t.LastAccessedAt,
                    Tag = t.Tag,
                    IsAudioLesson = t.IsAudioLesson,
                    IsFinished = t.IsFinished,
                    SortOrder = t.SortOrder,
                    FolderId = t.FolderId,
                    TotalWords = t.TotalWords,
                    KnownWords = t.KnownWords,
                    StatsUpdatedAt = t.StatsUpdatedAt
                })
                .ToListAsync();

            return new LibraryContentsDto
            {
                CurrentFolder = currentFolder,
                Breadcrumbs = breadcrumbs,
                Folders = folders,
                Books = books,
                Texts = texts
            };
        }

        private const int MinSearchLength = 2;
        private const int SearchLimitPerType = 20;

        // GET: api/folders/search?q=
        // Finds folders, books (title or author) and standalone texts anywhere in the library, each
        // with the path of the folder it lives in, so the Library can point at matches outside the
        // folder being viewed.
        [HttpGet("search")]
        public async Task<ActionResult<LibrarySearchResultDto>> SearchLibrary([FromQuery] string? q = null)
        {
            var userId = GetUserId();
            var query = q?.Trim() ?? string.Empty;
            if (query.Length < MinSearchLength)
                return new LibrarySearchResultDto();

            // ToLower().Contains() rather than ILike: it translates on Npgsql (strpos, so % and _ are
            // literal) and also runs on the InMemory provider the tests use.
            var needle = query.ToLower();

            var folders = await _context.Folders
                .Where(f => f.UserId == userId && f.Name.ToLower().Contains(needle))
                .OrderBy(f => f.Name)
                .Take(SearchLimitPerType)
                .Select(f => new { f.FolderId, f.Name, f.ParentFolderId })
                .ToListAsync();

            var books = await _context.Books
                .Where(b => b.UserId == userId &&
                            (b.Title.ToLower().Contains(needle) ||
                             (b.Author != null && b.Author.ToLower().Contains(needle))))
                .OrderBy(b => b.Title)
                .Take(SearchLimitPerType)
                .Select(b => new { b.BookId, b.Title, b.Author, LanguageName = b.Language.Name, b.FolderId })
                .ToListAsync();

            var texts = await _context.Texts
                .Where(t => t.UserId == userId && t.BookId == null && t.Tag != "srs-story" &&
                            t.Title.ToLower().Contains(needle))
                .OrderBy(t => t.Title)
                .Take(SearchLimitPerType)
                .Select(t => new { t.TextId, t.Title, LanguageName = t.Language.Name, t.IsAudioLesson, t.FolderId })
                .ToListAsync();

            var lookup = await LoadFolderLookupAsync(userId);
            string PathOf(int? id) => string.Join(" / ", BuildFolderChain(lookup, id).Select(c => c.Name));

            return new LibrarySearchResultDto
            {
                Folders = folders.Select(f => new LibrarySearchFolderDto
                {
                    FolderId = f.FolderId,
                    Name = f.Name,
                    ParentFolderId = f.ParentFolderId,
                    FolderPath = PathOf(f.ParentFolderId)
                }).ToList(),
                Books = books.Select(b => new LibrarySearchBookDto
                {
                    BookId = b.BookId,
                    Title = b.Title,
                    Author = b.Author,
                    LanguageName = b.LanguageName,
                    FolderId = b.FolderId,
                    FolderPath = PathOf(b.FolderId)
                }).ToList(),
                Texts = texts.Select(t => new LibrarySearchTextDto
                {
                    TextId = t.TextId,
                    Title = t.Title,
                    LanguageName = t.LanguageName,
                    IsAudioLesson = t.IsAudioLesson,
                    FolderId = t.FolderId,
                    FolderPath = PathOf(t.FolderId)
                }).ToList()
            };
        }

        // POST: api/folders
        [HttpPost]
        public async Task<ActionResult<FolderDto>> CreateFolder(CreateFolderDto dto)
        {
            var userId = GetUserId();

            var name = dto.Name?.Trim() ?? string.Empty;
            if (FolderNameError(name) is { } nameError)
                return BadRequest(nameError);
            if (dto.Color?.Length > MaxFolderColorLength)
                return BadRequest("Folder color is too long");

            // Validate parent folder belongs to user
            if (dto.ParentFolderId.HasValue && !await _context.UserOwnsFolderAsync(userId, dto.ParentFolderId.Value))
                return BadRequest("Parent folder not found");

            // Get max sort order in target location
            var maxSortOrder = await _context.Folders
                .Where(f => f.UserId == userId && f.ParentFolderId == dto.ParentFolderId)
                .MaxAsync(f => (int?)f.SortOrder) ?? -1;

            var folder = new Folder
            {
                Name = name,
                ParentFolderId = dto.ParentFolderId,
                Color = string.IsNullOrEmpty(dto.Color) ? null : dto.Color,
                LanguageId = dto.LanguageId,
                UserId = userId,
                SortOrder = maxSortOrder + 1,
                CreatedAt = DateTime.UtcNow
            };

            _context.Folders.Add(folder);
            await _context.SaveChangesAsync();

            return CreatedAtAction(nameof(GetFolders), new FolderDto
            {
                FolderId = folder.FolderId,
                Name = folder.Name,
                ParentFolderId = folder.ParentFolderId,
                SortOrder = folder.SortOrder,
                Color = folder.Color,
                LanguageId = folder.LanguageId,
                CreatedAt = folder.CreatedAt,
                ItemCount = 0
            });
        }

        // PUT: api/folders/5
        [HttpPut("{id}")]
        public async Task<IActionResult> UpdateFolder(int id, UpdateFolderDto dto)
        {
            var userId = GetUserId();

            var folder = await _context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id && f.UserId == userId);

            if (folder == null)
                return NotFound();

            if (dto.Name != null)
            {
                var name = dto.Name.Trim();
                if (FolderNameError(name) is { } nameError)
                    return BadRequest(nameError);
                folder.Name = name;
            }
            if (dto.Color?.Length > MaxFolderColorLength)
                return BadRequest("Folder color is too long");
            if (dto.Color != null) folder.Color = dto.Color == "" ? null : dto.Color;
            if (dto.ParentFolderId.HasValue)
            {
                // Prevent moving a folder into itself or its descendants
                if (dto.ParentFolderId.Value == id)
                    return BadRequest("Cannot move folder into itself");

                if (dto.ParentFolderId.Value != 0)
                {
                    if (!await _context.UserOwnsFolderAsync(userId, dto.ParentFolderId.Value))
                        return BadRequest("Target parent folder not found");

                    if (await WouldCreateCycle(id, dto.ParentFolderId.Value, userId))
                        return BadRequest("Cannot move a folder into its own descendant");
                }

                folder.ParentFolderId = dto.ParentFolderId.Value == 0 ? null : dto.ParentFolderId.Value;
            }

            await _context.SaveChangesAsync();
            return NoContent();
        }

        // DELETE: api/folders/5
        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteFolder(int id)
        {
            var userId = GetUserId();

            var folder = await _context.Folders
                .FirstOrDefaultAsync(f => f.FolderId == id && f.UserId == userId);

            if (folder == null)
                return NotFound();

            // Move child folders to parent
            var childFolders = await _context.Folders
                .Where(f => f.ParentFolderId == id)
                .ToListAsync();
            foreach (var child in childFolders)
                child.ParentFolderId = folder.ParentFolderId;

            // Move texts to parent folder (SetNull handles this via cascade, but be explicit)
            var texts = await _context.Texts
                .Where(t => t.FolderId == id)
                .ToListAsync();
            foreach (var text in texts)
                text.FolderId = folder.ParentFolderId;

            // Move books to parent folder
            var books = await _context.Books
                .Where(b => b.FolderId == id)
                .ToListAsync();
            foreach (var book in books)
                book.FolderId = folder.ParentFolderId;

            _context.Folders.Remove(folder);
            await _context.SaveChangesAsync();

            return NoContent();
        }

        // DELETE: api/folders/delete-items
        [HttpDelete("delete-items")]
        public async Task<IActionResult> DeleteItems([FromQuery] string? textIds = null, [FromQuery] string? bookIds = null, [FromQuery] string? folderIds = null)
        {
            var userId = GetUserId();

            // Parse comma-separated IDs, ignoring any non-integer values
            var textIdList = textIds?.Split(',').Select(s => int.TryParse(s, out var id) ? (int?)id : null).Where(id => id.HasValue).Select(id => id!.Value).ToList() ?? new List<int>();
            var bookIdList = bookIds?.Split(',').Select(s => int.TryParse(s, out var id) ? (int?)id : null).Where(id => id.HasValue).Select(id => id!.Value).ToList() ?? new List<int>();
            var folderIdList = folderIds?.Split(',').Select(s => int.TryParse(s, out var id) ? (int?)id : null).Where(id => id.HasValue).Select(id => id!.Value).ToList() ?? new List<int>();

            // Media paths are collected before the delete so they can be removed from disk once the
            // database change has committed. Without this the Library grid — the usual way books are
            // deleted — leaves every EPUB image, audiobook track and cover on the volume forever.
            var audioFilePathsToDelete = new List<string>();
            var bookIdsToDelete = new List<int>();

            // Delete texts (and their TextWords via cascade)
            if (textIdList.Any())
            {
                var texts = await _context.Texts
                    .Where(t => textIdList.Contains(t.TextId) && t.UserId == userId)
                    .ToListAsync();
                audioFilePathsToDelete.AddRange(texts
                    .Where(t => t.IsAudioLesson && !string.IsNullOrEmpty(t.AudioFilePath))
                    .Select(t => t.AudioFilePath!));
                _context.Texts.RemoveRange(texts);
            }

            // Delete books (and their texts via cascade)
            if (bookIdList.Any())
            {
                var books = await _context.Books
                    .Where(b => bookIdList.Contains(b.BookId) && b.UserId == userId)
                    .ToListAsync();
                bookIdsToDelete.AddRange(books.Select(b => b.BookId));

                // A book's lessons go with it via cascade, so their audio files have to go too.
                var bookAudioPaths = await _context.Texts
                    .Where(t => t.BookId != null && bookIdsToDelete.Contains(t.BookId.Value)
                             && t.UserId == userId && t.IsAudioLesson && t.AudioFilePath != null)
                    .Select(t => t.AudioFilePath!)
                    .ToListAsync();
                audioFilePathsToDelete.AddRange(bookAudioPaths);

                _context.Books.RemoveRange(books);
            }

            // Delete folders (move contents to parent first)
            if (folderIdList.Any())
            {
                foreach (var fId in folderIdList)
                {
                    var folder = await _context.Folders
                        .FirstOrDefaultAsync(f => f.FolderId == fId && f.UserId == userId);
                    if (folder == null) continue;

                    // Move children to parent
                    var childFolders = await _context.Folders.Where(f => f.ParentFolderId == fId).ToListAsync();
                    foreach (var child in childFolders) child.ParentFolderId = folder.ParentFolderId;

                    var childTexts = await _context.Texts.Where(t => t.FolderId == fId).ToListAsync();
                    foreach (var t in childTexts) t.FolderId = folder.ParentFolderId;

                    var childBooks = await _context.Books.Where(b => b.FolderId == fId).ToListAsync();
                    foreach (var b in childBooks) b.FolderId = folder.ParentFolderId;

                    _context.Folders.Remove(folder);
                }
            }

            await _context.SaveChangesAsync();

            // Best-effort, after the commit: a disk failure here must not undo the delete.
            foreach (var bookId in bookIdsToDelete)
            {
                BookAssetStorage.DeleteBookAssets(userId, bookId, _logger);
            }
            // A lesson can be listed both directly and via its book; deleting twice would log a
            // spurious "not found on disk" warning for the second pass.
            foreach (var audioPath in audioFilePathsToDelete.Distinct())
            {
                BookAssetStorage.DeleteAudioLessonFile(audioPath, _logger);
            }

            return NoContent();
        }

        // PUT: api/folders/move-items
        [HttpPut("move-items")]
        public async Task<IActionResult> MoveItems(MoveItemsDto dto)
        {
            var userId = GetUserId();

            // Validate target folder if specified
            if (dto.TargetFolderId.HasValue && !await _context.UserOwnsFolderAsync(userId, dto.TargetFolderId.Value))
                return BadRequest("Target folder not found");

            // Move texts
            if (dto.TextIds?.Any() == true)
            {
                // Book parts live in their book, never directly in a folder.
                var texts = await _context.Texts
                    .Where(t => dto.TextIds.Contains(t.TextId) && t.UserId == userId && t.BookId == null)
                    .ToListAsync();

                // Get max sort order in target
                var maxSort = await GetMaxSortOrderInFolder(userId, dto.TargetFolderId);
                foreach (var text in texts)
                {
                    text.FolderId = dto.TargetFolderId;
                    text.SortOrder = ++maxSort;
                }
            }

            // Move books
            if (dto.BookIds?.Any() == true)
            {
                var books = await _context.Books
                    .Where(b => dto.BookIds.Contains(b.BookId) && b.UserId == userId)
                    .ToListAsync();

                var maxSort = await GetMaxSortOrderInFolder(userId, dto.TargetFolderId);
                foreach (var book in books)
                {
                    book.FolderId = dto.TargetFolderId;
                    book.SortOrder = ++maxSort;
                }
            }

            // Move folders
            if (dto.FolderIds?.Any() == true)
            {
                if (dto.TargetFolderId.HasValue)
                {
                    foreach (var fId in dto.FolderIds)
                    {
                        if (fId == dto.TargetFolderId.Value) continue;
                        if (await WouldCreateCycle(fId, dto.TargetFolderId.Value, userId))
                            return BadRequest($"Cannot move a folder into its own descendant");
                    }
                }

                var folders = await _context.Folders
                    .Where(f => dto.FolderIds.Contains(f.FolderId) && f.UserId == userId)
                    .ToListAsync();

                // Moved folders go after what is already there, like moved books and texts, instead
                // of keeping a sort order from their old parent that may clash with the new one's.
                var maxSort = await GetMaxSortOrderInFolder(userId, dto.TargetFolderId);
                foreach (var folder in folders)
                {
                    // Prevent moving folder into itself
                    if (folder.FolderId == dto.TargetFolderId) continue;
                    folder.ParentFolderId = dto.TargetFolderId;
                    folder.SortOrder = ++maxSort;
                }
            }

            await _context.SaveChangesAsync();
            return NoContent();
        }

        // PUT: api/folders/reorder
        [HttpPut("reorder")]
        public async Task<IActionResult> ReorderItems(ReorderItemsDto dto)
        {
            var userId = GetUserId();

            if (dto.Items == null || !dto.Items.Any())
                return BadRequest("No items to reorder");

            // Group by type and update sort orders. Only rows that really sit in dto.FolderId are
            // touched: a reorder sent while the client still showed another folder's items must not
            // rewrite that folder's order.
            Dictionary<int, int> OrdersFor(string type) => dto.Items
                .Where(i => i.Type == type)
                .GroupBy(i => i.Id)
                .ToDictionary(g => g.Key, g => g.Last().SortOrder);

            var folderOrders = OrdersFor("folder");
            var bookOrders = OrdersFor("book");
            var textOrders = OrdersFor("text");

            if (folderOrders.Count > 0)
            {
                var folderIds = folderOrders.Keys.ToList();
                var folders = await _context.Folders
                    .Where(f => folderIds.Contains(f.FolderId) && f.UserId == userId && f.ParentFolderId == dto.FolderId)
                    .ToListAsync();
                foreach (var folder in folders)
                    folder.SortOrder = folderOrders[folder.FolderId];
            }

            if (bookOrders.Count > 0)
            {
                var bookIds = bookOrders.Keys.ToList();
                var books = await _context.Books
                    .Where(b => bookIds.Contains(b.BookId) && b.UserId == userId && b.FolderId == dto.FolderId)
                    .ToListAsync();
                foreach (var book in books)
                    book.SortOrder = bookOrders[book.BookId];
            }

            if (textOrders.Count > 0)
            {
                var textIds = textOrders.Keys.ToList();
                var texts = await _context.Texts
                    .Where(t => textIds.Contains(t.TextId) && t.UserId == userId && t.FolderId == dto.FolderId && t.BookId == null)
                    .ToListAsync();
                foreach (var text in texts)
                    text.SortOrder = textOrders[text.TextId];
            }

            await _context.SaveChangesAsync();
            return NoContent();
        }

        private const int MaxFolderNameLength = 200;
        private const int MaxFolderColorLength = 20;

        // Folder names are trimmed first; the column is varchar(200).
        private static string? FolderNameError(string name) =>
            name.Length == 0 ? "Folder name is required"
            : name.Length > MaxFolderNameLength ? $"Folder name must be at most {MaxFolderNameLength} characters"
            : null;

        private sealed record FolderNode(int FolderId, string Name, int? ParentFolderId);

        // All of the user's folders in one query, for walking parent chains without N+1 lookups.
        private async Task<Dictionary<int, FolderNode>> LoadFolderLookupAsync(Guid userId)
        {
            return await _context.Folders
                .Where(f => f.UserId == userId)
                .Select(f => new FolderNode(f.FolderId, f.Name, f.ParentFolderId))
                .ToDictionaryAsync(f => f.FolderId);
        }

        // Root-to-folder chain for folderId (empty for the library root).
        private static List<BreadcrumbDto> BuildFolderChain(IReadOnlyDictionary<int, FolderNode> lookup, int? folderId)
        {
            var chain = new List<BreadcrumbDto>();
            var visited = new HashSet<int>();
            var current = folderId;
            while (current.HasValue)
            {
                if (!visited.Add(current.Value)) break; // prevent infinite loop on corrupt data
                if (!lookup.TryGetValue(current.Value, out var node)) break;
                chain.Insert(0, new BreadcrumbDto { FolderId = node.FolderId, Name = node.Name });
                current = node.ParentFolderId;
            }
            return chain;
        }

        private async Task<int> GetMaxSortOrderInFolder(Guid userId, int? folderId)
        {
            var maxFolderSort = await _context.Folders
                .Where(f => f.UserId == userId && f.ParentFolderId == folderId)
                .MaxAsync(f => (int?)f.SortOrder) ?? -1;

            var maxBookSort = await _context.Books
                .Where(b => b.UserId == userId && b.FolderId == folderId)
                .MaxAsync(b => (int?)b.SortOrder) ?? -1;

            var maxTextSort = await _context.Texts
                .Where(t => t.UserId == userId && t.FolderId == folderId && t.BookId == null)
                .MaxAsync(t => (int?)t.SortOrder) ?? -1;

            return Math.Max(maxFolderSort, Math.Max(maxBookSort, maxTextSort));
        }

        // Returns true if moving movingFolderId to targetParentId would create a cycle
        // (i.e., targetParentId is a descendant of movingFolderId)
        private async Task<bool> WouldCreateCycle(int movingFolderId, int targetParentId, Guid userId)
        {
            var visited = new HashSet<int>();
            int? current = targetParentId;
            while (current.HasValue)
            {
                if (!visited.Add(current.Value)) return false; // existing cycle guard
                if (current.Value == movingFolderId) return true;
                current = await _context.Folders
                    .Where(f => f.FolderId == current.Value && f.UserId == userId)
                    .Select(f => f.ParentFolderId)
                    .FirstOrDefaultAsync();
            }
            return false;
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

    // DTOs
    public class FolderDto
    {
        public int FolderId { get; set; }
        public string Name { get; set; } = string.Empty;
        public int? ParentFolderId { get; set; }
        public int SortOrder { get; set; }
        public string? Color { get; set; }
        public int? LanguageId { get; set; }
        public DateTime CreatedAt { get; set; }
        public int ItemCount { get; set; }
    }

    public class BreadcrumbDto
    {
        public int FolderId { get; set; }
        public string Name { get; set; } = string.Empty;
    }

    public class LibraryContentsDto
    {
        public FolderDto? CurrentFolder { get; set; }
        public List<BreadcrumbDto> Breadcrumbs { get; set; } = new();
        public List<FolderDto> Folders { get; set; } = new();
        public List<LibraryBookDto> Books { get; set; } = new();
        public List<LibraryTextDto> Texts { get; set; } = new();
    }

    public class LibraryBookDto
    {
        public int BookId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string? Author { get; set; }
        public DateTime CreatedAt { get; set; }
        public string Description { get; set; } = string.Empty;
        public string? CoverImagePath { get; set; }
        public string LanguageName { get; set; } = string.Empty;
        public int PartCount { get; set; }
        public int FinishedPartCount { get; set; }
        public int? LastReadTextId { get; set; }
        public DateTime? LastReadAt { get; set; }
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public int LearningWords { get; set; }
        public DateTime? StatsUpdatedAt { get; set; }
        public int UnknownWords => Math.Max(TotalWords - KnownWords, 0);
        public double? UnknownWordPercentage =>
            TotalWords > 0 ? Math.Round((double)(TotalWords - KnownWords) / TotalWords * 100, 1) : (double?)null;
        public bool IsFinished { get; set; }
        public int SortOrder { get; set; }
        public int? FolderId { get; set; }
        public List<string> Tags { get; set; } = new();
        public double CompletionPercentage => PartCount > 0
            ? Math.Round((double)FinishedPartCount / PartCount * 100, 1) : 0;
    }

    public class LibraryTextDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string LanguageName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public DateTime? LastAccessedAt { get; set; }
        public string? Tag { get; set; }
        public bool IsAudioLesson { get; set; }
        public bool IsFinished { get; set; }
        public int SortOrder { get; set; }
        public int? FolderId { get; set; }
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public DateTime? StatsUpdatedAt { get; set; }
        public int UnknownWords => Math.Max(TotalWords - KnownWords, 0);
        public double? UnknownWordPercentage =>
            TotalWords > 0 ? Math.Round((double)(TotalWords - KnownWords) / TotalWords * 100, 1) : (double?)null;
    }

    public class LibrarySearchResultDto
    {
        public List<LibrarySearchFolderDto> Folders { get; set; } = new();
        public List<LibrarySearchBookDto> Books { get; set; } = new();
        public List<LibrarySearchTextDto> Texts { get; set; } = new();
    }

    // FolderPath is the containing folder's path ("A / B"); empty = library root.
    public class LibrarySearchFolderDto
    {
        public int FolderId { get; set; }
        public string Name { get; set; } = string.Empty;
        public int? ParentFolderId { get; set; }
        public string FolderPath { get; set; } = string.Empty;
    }

    public class LibrarySearchBookDto
    {
        public int BookId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string? Author { get; set; }
        public string LanguageName { get; set; } = string.Empty;
        public int? FolderId { get; set; }
        public string FolderPath { get; set; } = string.Empty;
    }

    public class LibrarySearchTextDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string LanguageName { get; set; } = string.Empty;
        public bool IsAudioLesson { get; set; }
        public int? FolderId { get; set; }
        public string FolderPath { get; set; } = string.Empty;
    }

    public class CreateFolderDto
    {
        [Required]
        [StringLength(200)]
        public string Name { get; set; } = string.Empty;
        public int? ParentFolderId { get; set; }
        [StringLength(20)]
        public string? Color { get; set; }
        public int? LanguageId { get; set; }
    }

    public class UpdateFolderDto
    {
        [StringLength(200)]
        public string? Name { get; set; }
        [StringLength(20)]
        public string? Color { get; set; }
        // null = no change; 0 = move to root (library root); positive int = target folder ID
        public int? ParentFolderId { get; set; }
    }

    public class MoveItemsDto
    {
        public List<int>? TextIds { get; set; }
        public List<int>? BookIds { get; set; }
        public List<int>? FolderIds { get; set; }
        public int? TargetFolderId { get; set; }
    }

    public class ReorderItemsDto
    {
        public int? FolderId { get; set; }
        public List<ReorderItemDto> Items { get; set; } = new();
    }

    public class ReorderItemDto
    {
        public int Id { get; set; }
        public string Type { get; set; } = string.Empty; // "folder", "book", "text"
        public int SortOrder { get; set; }
    }
}
