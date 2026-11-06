using System.Security.Claims;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests;

public class FolderReparentOrderTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task DeletedFolders_AppendChildrenWithoutSortCollisions(bool bulk)
    {
        await using var context = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var user = Guid.NewGuid();
        context.Users.Add(new User { Id = user, UserName = "folder-test" });
        context.Languages.Add(new Language { LanguageId = 1, Name = "English", Code = "en" });
        context.Folders.AddRange(new Folder { FolderId = 1, UserId = user, Name = "Delete A" },
            new Folder { FolderId = 2, UserId = user, Name = "Delete B" },
            new Folder { FolderId = 3, UserId = user, Name = "Existing", SortOrder = 50 },
            new Folder { FolderId = 4, UserId = user, ParentFolderId = 1, Name = "Child", SortOrder = 0 });
        context.Texts.Add(new Text { TextId = 1, UserId = user, LanguageId = 1, Title = "Moved text", Content = "text", FolderId = 1 });
        context.Books.Add(new Book { BookId = 1, UserId = user, LanguageId = 1, Title = "Moved book", FolderId = bulk ? 2 : 1 });
        await context.SaveChangesAsync();
        var controller = new FoldersController(context, NullLogger<FoldersController>.Instance) {
            ControllerContext = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimTypes.NameIdentifier, user.ToString())], "test")) } }
        };
        if (bulk) await controller.DeleteItems(folderIds: "1,2");
        else await controller.DeleteFolder(1);
        context.ChangeTracker.Clear();
        var folder = await context.Folders.SingleAsync(f => f.FolderId == 4);
        var text = await context.Texts.SingleAsync();
        var book = await context.Books.SingleAsync();
        Assert.Null(folder.ParentFolderId);
        Assert.Null(text.FolderId);
        Assert.Null(book.FolderId);
        var orders = new[] { folder.SortOrder, text.SortOrder, book.SortOrder };
        Assert.All(orders, order => Assert.True(order > 50));
        Assert.Equal(orders.Length, orders.Distinct().Count());
    }
}
