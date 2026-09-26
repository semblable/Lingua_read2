using System;
using System.Threading.Tasks;
using LinguaReadApi.Data;
using Microsoft.EntityFrameworkCore;

namespace LinguaReadApi.Utilities
{
    /// <summary>
    /// Library folders are per user. Anything that files an item into a folder, or nests a folder
    /// under another one, checks the folder belongs to the caller first.
    /// </summary>
    public static class FolderOwnership
    {
        public static Task<bool> UserOwnsFolderAsync(this AppDbContext context, Guid userId, int folderId) =>
            context.Folders.AnyAsync(f => f.FolderId == folderId && f.UserId == userId);
    }
}
