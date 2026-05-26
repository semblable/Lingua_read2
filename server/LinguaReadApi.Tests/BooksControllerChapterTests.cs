using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using LinguaReadApi.Controllers;
using LinguaReadApi.Data;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LinguaReadApi.Tests
{
    public class BooksControllerChapterTests
    {
        [Fact]
        public void PreviewSplitManual_NoContent_ReturnsBadRequest()
        {
            using var context = CreateContext();
            var userId = Guid.NewGuid();
            var controller = CreateController(context, userId);

            var dto = new CreateBookDto { Content = "" };
            var result = controller.PreviewSplitManual(dto);

            Assert.IsType<BadRequestObjectResult>(result.Result);
        }

        [Fact]
        public void PreviewSplitManual_ValidContent_ReturnsSplitPreview()
        {
            using var context = CreateContext();
            var userId = Guid.NewGuid();
            var controller = CreateController(context, userId);

            var dto = new CreateBookDto
            {
                Content = "Chapter 1: The Beginning\nContent here.\n\nChapter 2: The Next Step\nMore content.",
                SplitMethod = "chapter",
                MaxSegmentSize = 3000,
                SubSplitOversized = true
            };

            var result = controller.PreviewSplitManual(dto);

            var okResult = Assert.IsType<OkObjectResult>(result.Result);
            var preview = Assert.IsType<SplitPreviewDto>(okResult.Value);
            
            Assert.Equal("text-heading", preview.DetectionMethod);
            Assert.Equal(2, preview.Chapters.Count);
            Assert.Equal("The Beginning", preview.Chapters[0].Title);
            Assert.Equal("The Next Step", preview.Chapters[1].Title);
        }

        [Fact]
        public async Task PreviewReSplitBook_ValidRequest_ReconstructsAndAppliesCustomTitles()
        {
            await using var context = CreateContext();
            var userId = Guid.NewGuid();
            SeedUserAndLanguage(context, userId);
            
            // Seed a book with two existing text parts
            var book = new Book { BookId = 10, UserId = userId, LanguageId = 1, Title = "My Novel" };
            context.Books.Add(book);
            context.Texts.AddRange(
                new Text { TextId = 100, BookId = 10, UserId = userId, LanguageId = 1, Title = "Old Title 1", Content = "Chapter 1: Part One\nOriginal content.", PartNumber = 1 },
                new Text { TextId = 101, BookId = 10, UserId = userId, LanguageId = 1, Title = "Old Title 2", Content = "Chapter 2: Part Two\nSecond original content.", PartNumber = 2 }
            );
            await context.SaveChangesAsync();

            var controller = CreateController(context, userId);
            var request = new ReSplitRequestDto
            {
                SplitMethod = "chapter",
                MaxSegmentSize = 3000,
                SubSplitOversized = false,
                ChapterTitles = new List<string> { "Custom Chapter 1", "Custom Chapter 2" }
            };

            var result = await controller.PreviewReSplitBook(10, request);

            var okResult = Assert.IsType<OkObjectResult>(result.Result);
            var preview = Assert.IsType<SplitPreviewDto>(okResult.Value);

            Assert.Equal(2, preview.Chapters.Count);
            Assert.Equal("Custom Chapter 1", preview.Chapters[0].Title);
            Assert.Equal("Custom Chapter 2", preview.Chapters[1].Title);
        }

        [Fact]
        public async Task PreviewReSplitBook_OtherUserBook_ReturnsNotFound()
        {
            await using var context = CreateContext();
            var ownerId = Guid.NewGuid();
            var intruderId = Guid.NewGuid();
            SeedUserAndLanguage(context, ownerId);
            SeedUserAndLanguage(context, intruderId);

            var book = new Book { BookId = 10, UserId = ownerId, LanguageId = 1, Title = "My Novel" };
            context.Books.Add(book);
            await context.SaveChangesAsync();

            var controller = CreateController(context, intruderId);
            var request = new ReSplitRequestDto { SplitMethod = "paragraph" };

            var result = await controller.PreviewReSplitBook(10, request);
            Assert.IsType<NotFoundResult>(result.Result);
        }

        [Fact]
        public async Task ReSplitBook_ExecutesDestructiveSplitAndResetsReadProgress()
        {
            await using var context = CreateContext();
            var userId = Guid.NewGuid();
            SeedUserAndLanguage(context, userId);

            // Seed a book with existing parts, and set a last read progress marker
            var book = new Book 
            { 
                BookId = 20, 
                UserId = userId, 
                LanguageId = 1, 
                Title = "My Novel",
                LastReadTextId = 200,
                LastReadPartId = 200
            };
            context.Books.Add(book);
            context.Texts.AddRange(
                new Text { TextId = 200, BookId = 20, UserId = userId, LanguageId = 1, Title = "Old 1", Content = "Paragraph one.\n\nParagraph two.", PartNumber = 1 },
                new Text { TextId = 201, BookId = 20, UserId = userId, LanguageId = 1, Title = "Old 2", Content = "Paragraph three.", PartNumber = 2 }
            );
            await context.SaveChangesAsync();

            var controller = CreateController(context, userId);
            
            // Set MaxSegmentSize = 20 to force splitting each paragraph into its own part
            var request = new ReSplitRequestDto
            {
                SplitMethod = "paragraph",
                MaxSegmentSize = 20,
                SubSplitOversized = false
            };

            var result = await controller.ReSplitBook(20, request);
            Assert.IsType<NoContentResult>(result);

            // Verify database state:
            context.ChangeTracker.Clear();
            var reloadedBook = await context.Books.Include(b => b.Texts).FirstAsync(b => b.BookId == 20);
            
            // Progress reset verification
            Assert.Null(reloadedBook.LastReadTextId);
            Assert.Null(reloadedBook.LastReadPartId);

            // Re-split partitions count (three paragraphs in total across old contents)
            Assert.Equal(3, reloadedBook.Texts.Count);
            
            var sortedTexts = reloadedBook.Texts.OrderBy(t => t.PartNumber).ToList();
            Assert.Equal("Paragraph one.", sortedTexts[0].Content);
            Assert.Equal("Paragraph two.", sortedTexts[1].Content);
            Assert.Equal("Paragraph three.", sortedTexts[2].Content);
        }

        [Fact]
        public async Task ReSplitBook_WithChapterGroupings_MergesChaptersCorrectly()
        {
            await using var context = CreateContext();
            var userId = Guid.NewGuid();
            SeedUserAndLanguage(context, userId);

            // Seed a book with existing parts
            var book = new Book 
            { 
                BookId = 30, 
                UserId = userId, 
                LanguageId = 1, 
                Title = "My Novel"
            };
            context.Books.Add(book);
            context.Texts.AddRange(
                new Text { TextId = 300, BookId = 30, UserId = userId, LanguageId = 1, Title = "Old 1", Content = "Paragraph one.\n\nParagraph two.", PartNumber = 1 },
                new Text { TextId = 301, BookId = 30, UserId = userId, LanguageId = 1, Title = "Old 2", Content = "Paragraph three.", PartNumber = 2 }
            );
            await context.SaveChangesAsync();

            var controller = CreateController(context, userId);
            
            // We split by paragraph with MaxSegmentSize = 20, which would normally create 3 parts.
            // We pass ChapterGroupings: [[1, 2], [3]], which merges Part 1 and Part 2 together.
            var request = new ReSplitRequestDto
            {
                SplitMethod = "paragraph",
                MaxSegmentSize = 20,
                SubSplitOversized = false,
                ChapterGroupings = new List<List<int>>
                {
                    new List<int> { 1, 2 },
                    new List<int> { 3 }
                },
                ChapterTitles = new List<string> { "Merged Part 1 & 2", "Part 3" }
            };

            var result = await controller.ReSplitBook(30, request);
            Assert.IsType<NoContentResult>(result);

            // Verify database state
            context.ChangeTracker.Clear();
            var reloadedBook = await context.Books.Include(b => b.Texts).FirstAsync(b => b.BookId == 30);
            
            // We should have 2 texts now (since Part 1 and 2 were merged)
            Assert.Equal(2, reloadedBook.Texts.Count);
            
            var sortedTexts = reloadedBook.Texts.OrderBy(t => t.PartNumber).ToList();
            Assert.Equal("Merged Part 1 & 2", sortedTexts[0].Title);
            Assert.Equal("Paragraph one.\n\nParagraph two.", sortedTexts[0].Content);
            Assert.Equal("Part 3", sortedTexts[1].Title);
            Assert.Equal("Paragraph three.", sortedTexts[1].Content);
        }

        // --- Helpers ---

        private static BooksController CreateController(AppDbContext context, Guid userId)
        {
            return new BooksController(context, NullLogger<BooksController>.Instance, new ChapterDetectionService(), hardcoverService: null, wordLinkingChannel: null)
            {
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim(ClaimTypes.NameIdentifier, userId.ToString()) }, "TestAuth"))
                    }
                }
            };
        }

        private static AppDbContext CreateContext()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;
            return new AppDbContext(options);
        }

        private static void SeedUserAndLanguage(AppDbContext context, Guid userId)
        {
            if (!context.Users.Any(u => u.Id == userId))
            {
                context.Users.Add(new User { Id = userId, UserName = "tester", Email = $"{userId}@example.com" });
            }
            if (!context.Languages.Any(l => l.LanguageId == 1))
            {
                context.Languages.Add(new Language { LanguageId = 1, Name = "Spanish", Code = "ES" });
            }
            context.SaveChanges();
            context.ChangeTracker.Clear();
        }
    }
}
