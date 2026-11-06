using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Utilities;

public static class LibrarySortOrder
{
    public static async Task<int> MaxAsync(AppDbContext context, Guid userId, int? folderId)
    {
        var folders = await context.Folders.Where(f => f.UserId == userId && f.ParentFolderId == folderId)
            .MaxAsync(f => (int?)f.SortOrder) ?? -1;
        var books = await context.Books.Where(b => b.UserId == userId && b.FolderId == folderId)
            .MaxAsync(b => (int?)b.SortOrder) ?? -1;
        var texts = await context.Texts.Where(t => t.UserId == userId && t.FolderId == folderId && t.BookId == null)
            .MaxAsync(t => (int?)t.SortOrder) ?? -1;
        // Batch imports can have siblings staged before the next SaveChanges.
        var pendingBooks = context.Books.Local.Where(b => b.UserId == userId && b.FolderId == folderId).Select(b => b.SortOrder);
        var pendingFolders = context.Folders.Local.Where(f => f.UserId == userId && f.ParentFolderId == folderId).Select(f => f.SortOrder);
        var pendingTexts = context.Texts.Local.Where(t => t.UserId == userId && t.FolderId == folderId && t.BookId == null).Select(t => t.SortOrder);
        return pendingBooks.Concat(pendingTexts).Concat(pendingFolders).Append(folders).Append(books).Append(texts).Max();
    }
}
