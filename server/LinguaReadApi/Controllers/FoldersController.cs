using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using LinguaReadApi.Models;

namespace LinguaReadApi.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class FoldersController : ControllerBase
    {
        private readonly AppDbContext _context;

        public FoldersController(AppDbContext context)
        {
            _context = context;
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

        // GET: api/folders/library?folderId=&languageId=
        [HttpGet("library")]
        public async Task<ActionResult<LibraryContentsDto>> GetLibraryContents(
            [FromQuery] int? folderId = null,
            [FromQuery] int? languageId = null)
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

                // Build breadcrumb chain by walking up parents
                var visited = new HashSet<int>();
                int? parentId = folderId;
                while (parentId.HasValue)
                {
                    if (!visited.Add(parentId.Value)) break; // prevent infinite loop
                    var parent = await _context.Folders
                        .Where(f => f.FolderId == parentId.Value && f.UserId == userId)
                        .Select(f => new { f.FolderId, f.Name, f.ParentFolderId })
                        .FirstOrDefaultAsync();
                    if (parent == null) break;
                    breadcrumbs.Insert(0, new BreadcrumbDto { FolderId = parent.FolderId, Name = parent.Name });
                    parentId = parent.ParentFolderId;
                }
            }

            // Get child folders
            var foldersQuery = _context.Folders
                .Where(f => f.UserId == userId && f.ParentFolderId == folderId);

            if (languageId.HasValue)
                foldersQuery = foldersQuery.Where(f => f.LanguageId == null || f.LanguageId == languageId.Value);

            var folders = await foldersQuery
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
            var booksQuery = _context.Books
                .Where(b => b.UserId == userId && b.FolderId == folderId);

            if (languageId.HasValue)
                booksQuery = booksQuery.Where(b => b.LanguageId == languageId.Value);

            var books = await booksQuery
                .Include(b => b.Language)
                .Include(b => b.Texts)
                .Include(b => b.BookTags).ThenInclude(bt => bt.Tag)
                .OrderBy(b => b.SortOrder)
                .ThenByDescending(b => b.CreatedAt)
                .Select(b => new LibraryBookDto
                {
                    BookId = b.BookId,
                    Title = b.Title,
                    Description = b.Description,
                    CoverImagePath = b.CoverImagePath,
                    LanguageName = b.Language.Name,
                    PartCount = b.Texts.Count,
                    LastReadTextId = b.LastReadTextId,
                    LastReadAt = b.LastReadAt,
                    TotalWords = b.TotalWords,
                    KnownWords = b.KnownWords,
                    LearningWords = b.LearningWords,
                    IsFinished = b.IsFinished,
                    SortOrder = b.SortOrder,
                    FolderId = b.FolderId,
                    Tags = b.BookTags.Select(bt => bt.Tag.Name).ToList()
                })
                .ToListAsync();

            // Get standalone texts in this folder (not part of a book, not srs-story)
            var textsQuery = _context.Texts
                .Where(t => t.UserId == userId && t.BookId == null && t.Tag != "srs-story" && t.FolderId == folderId);

            if (languageId.HasValue)
                textsQuery = textsQuery.Where(t => t.LanguageId == languageId.Value);

            var texts = await textsQuery
                .Include(t => t.Language)
                .OrderBy(t => t.SortOrder)
                .ThenByDescending(t => t.CreatedAt)
                .Select(t => new LibraryTextDto
                {
                    TextId = t.TextId,
                    Title = t.Title,
                    LanguageName = t.Language.Name,
                    CreatedAt = t.CreatedAt,
                    Tag = t.Tag,
                    IsAudioLesson = t.IsAudioLesson,
                    IsFinished = t.IsFinished,
                    SortOrder = t.SortOrder,
                    FolderId = t.FolderId
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

        // POST: api/folders
        [HttpPost]
        public async Task<ActionResult<FolderDto>> CreateFolder(CreateFolderDto dto)
        {
            var userId = GetUserId();

            // Validate parent folder belongs to user
            if (dto.ParentFolderId.HasValue)
            {
                var parentExists = await _context.Folders
                    .AnyAsync(f => f.FolderId == dto.ParentFolderId.Value && f.UserId == userId);
                if (!parentExists)
                    return BadRequest("Parent folder not found");
            }

            // Get max sort order in target location
            var maxSortOrder = await _context.Folders
                .Where(f => f.UserId == userId && f.ParentFolderId == dto.ParentFolderId)
                .MaxAsync(f => (int?)f.SortOrder) ?? -1;

            var folder = new Folder
            {
                Name = dto.Name,
                ParentFolderId = dto.ParentFolderId,
                Color = dto.Color,
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

            if (dto.Name != null) folder.Name = dto.Name;
            if (dto.Color != null) folder.Color = dto.Color == "" ? null : dto.Color;
            if (dto.ParentFolderId.HasValue)
            {
                // Prevent moving a folder into itself or its descendants
                if (dto.ParentFolderId.Value == id)
                    return BadRequest("Cannot move folder into itself");

                if (dto.ParentFolderId.Value != 0)
                {
                    var parentExists = await _context.Folders
                        .AnyAsync(f => f.FolderId == dto.ParentFolderId.Value && f.UserId == userId);
                    if (!parentExists)
                        return BadRequest("Target parent folder not found");
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

        // PUT: api/folders/move-items
        [HttpPut("move-items")]
        public async Task<IActionResult> MoveItems(MoveItemsDto dto)
        {
            var userId = GetUserId();

            // Validate target folder if specified
            if (dto.TargetFolderId.HasValue)
            {
                var folderExists = await _context.Folders
                    .AnyAsync(f => f.FolderId == dto.TargetFolderId.Value && f.UserId == userId);
                if (!folderExists)
                    return BadRequest("Target folder not found");
            }

            // Move texts
            if (dto.TextIds?.Any() == true)
            {
                var texts = await _context.Texts
                    .Where(t => dto.TextIds.Contains(t.TextId) && t.UserId == userId)
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
                var folders = await _context.Folders
                    .Where(f => dto.FolderIds.Contains(f.FolderId) && f.UserId == userId)
                    .ToListAsync();

                foreach (var folder in folders)
                {
                    // Prevent moving folder into itself
                    if (folder.FolderId == dto.TargetFolderId) continue;
                    folder.ParentFolderId = dto.TargetFolderId;
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

            // Group by type and update sort orders
            var folderIds = dto.Items.Where(i => i.Type == "folder").Select(i => i.Id).ToList();
            var bookIds = dto.Items.Where(i => i.Type == "book").Select(i => i.Id).ToList();
            var textIds = dto.Items.Where(i => i.Type == "text").Select(i => i.Id).ToList();

            if (folderIds.Any())
            {
                var folders = await _context.Folders
                    .Where(f => folderIds.Contains(f.FolderId) && f.UserId == userId)
                    .ToListAsync();
                foreach (var folder in folders)
                {
                    var item = dto.Items.First(i => i.Type == "folder" && i.Id == folder.FolderId);
                    folder.SortOrder = item.SortOrder;
                }
            }

            if (bookIds.Any())
            {
                var books = await _context.Books
                    .Where(b => bookIds.Contains(b.BookId) && b.UserId == userId)
                    .ToListAsync();
                foreach (var book in books)
                {
                    var item = dto.Items.First(i => i.Type == "book" && i.Id == book.BookId);
                    book.SortOrder = item.SortOrder;
                }
            }

            if (textIds.Any())
            {
                var texts = await _context.Texts
                    .Where(t => textIds.Contains(t.TextId) && t.UserId == userId)
                    .ToListAsync();
                foreach (var text in texts)
                {
                    var item = dto.Items.First(i => i.Type == "text" && i.Id == text.TextId);
                    text.SortOrder = item.SortOrder;
                }
            }

            await _context.SaveChangesAsync();
            return NoContent();
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
        public string Description { get; set; } = string.Empty;
        public string? CoverImagePath { get; set; }
        public string LanguageName { get; set; } = string.Empty;
        public int PartCount { get; set; }
        public int? LastReadTextId { get; set; }
        public DateTime? LastReadAt { get; set; }
        public int TotalWords { get; set; }
        public int KnownWords { get; set; }
        public int LearningWords { get; set; }
        public bool IsFinished { get; set; }
        public int SortOrder { get; set; }
        public int? FolderId { get; set; }
        public List<string> Tags { get; set; } = new();
        public double CompletionPercentage => TotalWords > 0
            ? Math.Round((double)(KnownWords + LearningWords) / TotalWords * 100, 1) : 0;
    }

    public class LibraryTextDto
    {
        public int TextId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string LanguageName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public string? Tag { get; set; }
        public bool IsAudioLesson { get; set; }
        public bool IsFinished { get; set; }
        public int SortOrder { get; set; }
        public int? FolderId { get; set; }
    }

    public class CreateFolderDto
    {
        public string Name { get; set; } = string.Empty;
        public int? ParentFolderId { get; set; }
        public string? Color { get; set; }
        public int? LanguageId { get; set; }
    }

    public class UpdateFolderDto
    {
        public string? Name { get; set; }
        public string? Color { get; set; }
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
