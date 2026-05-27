using System.Collections.Generic;
using System.Linq;
using LinguaReadApi.Models;
using LinguaReadApi.Services;
using Xunit;

namespace LinguaReadApi.Tests
{
    public class ChapterDetectionServiceTests
    {
        private readonly ChapterDetectionService _service;

        public ChapterDetectionServiceTests()
        {
            _service = new ChapterDetectionService();
        }

        [Fact]
        public void DetectChaptersFromTextHeadings_EnglishHeading_PartitionsCorrectly()
        {
            var content = "Some intro text.\n\nChapter 1: The Journey Begins\nThis is content for chapter 1.\nIt has multiple lines.\n\nChapter II - A New Ally\nThis is the content for chapter 2.";
            
            var chapters = _service.DetectChaptersFromTextHeadings(content);

            Assert.Equal(3, chapters.Count);
            
            Assert.Equal("Start", chapters[0].Title);
            Assert.Contains("Some intro text.", chapters[0].Content);

            Assert.Equal("The Journey Begins", chapters[1].Title);
            Assert.Contains("This is content for chapter 1.", chapters[1].Content);

            // "-" is in the regex number character class, so it falls back to the full matched heading line
            Assert.Equal("Chapter II - A New Ally", chapters[2].Title);
            Assert.Contains("This is the content for chapter 2.", chapters[2].Content);
        }

        [Fact]
        public void DetectChaptersFromTextHeadings_FrenchAndSpanishHeadings_PartitionsCorrectly()
        {
            var content = "Chapitre 1. Le Commencement\nContenu en français.\n\nCapítulo II: El Regreso\nContenido en español.";

            var chapters = _service.DetectChaptersFromTextHeadings(content);

            // Since it starts immediately with a chapter heading, there is no "Start" chapter.
            Assert.Equal(2, chapters.Count);
            
            // "." is in the number class, so it falls back to full line
            Assert.Equal("Chapitre 1. Le Commencement", chapters[0].Title);
            Assert.Contains("Contenu en français.", chapters[0].Content);

            // ":" correctly splits and extracts the clean title
            Assert.Equal("El Regreso", chapters[1].Title);
            Assert.Contains("Contenido en español.", chapters[1].Content);
        }

        [Fact]
        public void DetectChaptersFromTextHeadings_RussianAndChineseHeadings_PartitionsCorrectly()
        {
            var content = "Глава 1: Приключение\nСодержимое на русском.\n\n第一章 开始\n中文内容。";

            var chapters = _service.DetectChaptersFromTextHeadings(content);

            // Since it starts immediately with a heading, no "Start" chapter is created.
            Assert.Equal(2, chapters.Count);

            Assert.Equal("Приключение", chapters[0].Title);
            Assert.Contains("Содержимое на русском.", chapters[0].Content);

            Assert.Equal("开始", chapters[1].Title);
            Assert.Contains("中文内容。", chapters[1].Content);
        }

        [Fact]
        public void DetectChaptersFromTextHeadings_NumberedHeading_PartitionsCorrectly()
        {
            var content = "1. Introduction\nWelcome text.\n\n2 - Discussion\nDeep analysis here.";

            var chapters = _service.DetectChaptersFromTextHeadings(content);

            // Since it starts immediately with a heading, no "Start" chapter is created.
            Assert.Equal(2, chapters.Count);

            Assert.Equal("Introduction", chapters[0].Title);
            Assert.Contains("Welcome text.", chapters[0].Content);

            Assert.Equal("Discussion", chapters[1].Title);
            Assert.Contains("Deep analysis here.", chapters[1].Content);
        }

        [Fact]
        public void DetectChaptersFromTextHeadings_EmptyContent_ReturnsEmpty()
        {
            var chapters = _service.DetectChaptersFromTextHeadings("");
            Assert.Empty(chapters);
        }

        [Fact]
        public void DetectChaptersFromSectionBreaks_SplitsByDoubleOrTripleNewlines()
        {
            var content = "First Section Title\nSome content for the first part.\n\n\n\nSecond Section Title\nThis is content for part 2.\n\n\n\nThird Section Content without short title, this is a very long line that should fallback.";

            var chapters = _service.DetectChaptersFromSectionBreaks(content);

            Assert.Equal(3, chapters.Count);

            Assert.Equal("First Section Title", chapters[0].Title);
            Assert.Contains("Some content for the first part.", chapters[0].Content);

            Assert.Equal("Second Section Title", chapters[1].Title);
            Assert.Contains("This is content for part 2.", chapters[1].Content);

            Assert.Equal("Section 3", chapters[2].Title);
            Assert.Contains("Third Section Content without", chapters[2].Content);
        }

        [Fact]
        public void DetectChaptersFromEpubHeadings_GroupsBlocksByTitleType()
        {
            var blocks = new List<ReaderContentBlock>
            {
                new ReaderContentBlock { Type = "paragraph", Text = "Introduction text" },
                new ReaderContentBlock { Type = "title", Text = "Chapter I: Discovery" },
                new ReaderContentBlock { Type = "paragraph", Text = "Found some code." },
                new ReaderContentBlock { Type = "paragraph", Text = "It compiles." },
                new ReaderContentBlock { Type = "title", Text = "Chapter II: Execution" },
                new ReaderContentBlock { Type = "paragraph", Text = "Running in production." }
            };

            var chapters = _service.DetectChaptersFromEpubHeadings(blocks);

            Assert.Equal(3, chapters.Count);

            Assert.Equal("Start", chapters[0].Title);
            Assert.Single(chapters[0].Blocks!);
            Assert.Equal("Introduction text", chapters[0].Blocks![0].Text);

            Assert.Equal("Chapter I: Discovery", chapters[1].Title);
            Assert.Equal(2, chapters[1].Blocks!.Count);
            Assert.Contains("Found some code.", chapters[1].Content);

            Assert.Equal("Chapter II: Execution", chapters[2].Title);
            Assert.Single(chapters[2].Blocks!);
            Assert.Contains("Running in production.", chapters[2].Content);
        }

        [Fact]
        public void DetectChaptersFromTextHeadings_StandaloneKeywords_PartitionsCorrectly()
        {
            var content = "Prologue\nSome backstory.\n\nChapter 1: The Start\nMain content.\n\nEpilogue\nFinal thoughts.";

            var chapters = _service.DetectChaptersFromTextHeadings(content);

            Assert.Equal(3, chapters.Count);

            Assert.Equal("Prologue", chapters[0].Title);
            Assert.Contains("Some backstory.", chapters[0].Content);

            Assert.Equal("The Start", chapters[1].Title);
            Assert.Contains("Main content.", chapters[1].Content);

            Assert.Equal("Epilogue", chapters[2].Title);
            Assert.Contains("Final thoughts.", chapters[2].Content);
        }

        [Fact]
        public void DetectChaptersFromTextHeadings_WrittenOutNumbers_PartitionsCorrectly()
        {
            var content = "Chapter One: Awakening\nContent of chapter one.\n\nChapter Two: Discovery\nContent of chapter two.";

            var chapters = _service.DetectChaptersFromTextHeadings(content);

            Assert.Equal(2, chapters.Count);

            Assert.Equal("Awakening", chapters[0].Title);
            Assert.Contains("Content of chapter one.", chapters[0].Content);

            Assert.Equal("Discovery", chapters[1].Title);
            Assert.Contains("Content of chapter two.", chapters[1].Content);
        }

        [Fact]
        public void DetectChaptersFromTextHeadings_ItalianAndKorean_PartitionsCorrectly()
        {
            var content = "Capitolo 1: Il Viaggio\nContenuto italiano.\n\n제1장 시작\n한국어 내용.";

            var chapters = _service.DetectChaptersFromTextHeadings(content);

            Assert.Equal(2, chapters.Count);

            Assert.Equal("Il Viaggio", chapters[0].Title);
            Assert.Contains("Contenuto italiano.", chapters[0].Content);

            Assert.Equal("시작", chapters[1].Title);
            Assert.Contains("한국어 내용.", chapters[1].Content);
        }

        [Fact]
        public void BuildPageBreakClasses_ScansCssDeclarationsCorrectly()
        {
            var css = new List<string>
            {
                ".break-class { page-break-before: always; }",
                ".no-break { color: red; }",
                "h2.another-break, div.some-other { break-before: page; }",
                ".yet-another { break-before: always; }"
            };

            var classes = ChapterDetectionService.BuildPageBreakClasses(css);

            Assert.Equal(4, classes.Count);
            Assert.Contains("break-class", classes);
            Assert.Contains("another-break", classes);
            Assert.Contains("some-other", classes);
            Assert.Contains("yet-another", classes);
            Assert.DoesNotContain("no-break", classes);
        }

        [Fact]
        public void DetectChaptersFromPageBreaks_SplitsOnTaggedMetadata()
        {
            var blocks = new List<ReaderContentBlock>
            {
                new ReaderContentBlock { Type = "paragraph", Text = "Introduction info." },
                new ReaderContentBlock 
                { 
                    Type = "paragraph", 
                    Text = "First paragraph in chapter break.",
                    Meta = new Dictionary<string, string> { { "chapterBreak", "true" } }
                },
                new ReaderContentBlock { Type = "paragraph", Text = "Chapter 1 content." },
                new ReaderContentBlock 
                { 
                    Type = "title", 
                    Text = "Custom Title Name",
                    Meta = new Dictionary<string, string> { { "chapterBreak", "true" } }
                },
                new ReaderContentBlock { Type = "paragraph", Text = "Chapter 2 content." }
            };

            var chapters = _service.DetectChaptersFromPageBreaks(blocks);

            // Expecting 3 chapters: "Start", "Chapter 1", and "Custom Title Name"
            Assert.Equal(3, chapters.Count);

            Assert.Equal("Start", chapters[0].Title);
            Assert.Contains("Introduction info.", chapters[0].Content);

            Assert.Equal("Chapter 1", chapters[1].Title);
            Assert.Contains("First paragraph in chapter break.", chapters[1].Content);
            Assert.Contains("Chapter 1 content.", chapters[1].Content);

            Assert.Equal("Custom Title Name", chapters[2].Title);
            Assert.Contains("Chapter 2 content.", chapters[2].Content);
        }

        [Fact]
        public void DetectChaptersFromEpubHeadings_FiltersOutNumericPageNumbers()
        {
            var blocks = new List<ReaderContentBlock>
            {
                new ReaderContentBlock { Type = "title", Text = "1" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 1 content." },
                new ReaderContentBlock { Type = "title", Text = "2" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 2 content." },
                new ReaderContentBlock { Type = "title", Text = "15" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 15 content." },
                new ReaderContentBlock { Type = "title", Text = "20" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 20 content." },
                new ReaderContentBlock { Type = "title", Text = "30" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 30 content." },
                new ReaderContentBlock { Type = "title", Text = "40" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 40 content." },
                new ReaderContentBlock { Type = "title", Text = "51" }, // Over 50 trigger
                new ReaderContentBlock { Type = "paragraph", Text = "Page 51 content." },
                new ReaderContentBlock { Type = "title", Text = "60" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 60 content." },
                new ReaderContentBlock { Type = "title", Text = "70" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 70 content." },
                new ReaderContentBlock { Type = "title", Text = "80" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 80 content." },
                new ReaderContentBlock { Type = "title", Text = "90" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 90 content." },
                new ReaderContentBlock { Type = "title", Text = "100" },
                new ReaderContentBlock { Type = "paragraph", Text = "Page 100 content." },
                new ReaderContentBlock { Type = "title", Text = "Chapter I: Main Story" }, // A real header
                new ReaderContentBlock { Type = "paragraph", Text = "Actual story starts." }
            };

            var chapters = _service.DetectChaptersFromEpubHeadings(blocks);

            // Since it filtered out the numeric page numbers (they triggered the page-number detection),
            // it should only split on "Chapter I: Main Story", yielding 2 chapters: "Start" and "Chapter I: Main Story".
            Assert.Equal(2, chapters.Count);
            Assert.Equal("Start", chapters[0].Title);
            Assert.Contains("Page 51 content.", chapters[0].Content);
            Assert.Equal("Chapter I: Main Story", chapters[1].Title);
            Assert.Contains("Actual story starts.", chapters[1].Content);
        }

        [Fact]
        public void DetectChaptersFromEpubHeadings_DoesNotStripNormalNumbers()
        {
            var blocks = new List<ReaderContentBlock>
            {
                // We must trigger the filter numeric titles threshold
                new ReaderContentBlock { Type = "title", Text = "1" },
                new ReaderContentBlock { Type = "title", Text = "2" },
                new ReaderContentBlock { Type = "title", Text = "3" },
                new ReaderContentBlock { Type = "title", Text = "4" },
                new ReaderContentBlock { Type = "title", Text = "5" },
                new ReaderContentBlock { Type = "title", Text = "6" },
                new ReaderContentBlock { Type = "title", Text = "7" },
                new ReaderContentBlock { Type = "title", Text = "8" },
                new ReaderContentBlock { Type = "title", Text = "9" },
                new ReaderContentBlock { Type = "title", Text = "10" },
                new ReaderContentBlock { Type = "title", Text = "101" }, // Trigger (> 50)
                
                // Normal numbers inside paragraph blocks
                new ReaderContentBlock { Type = "paragraph", Text = "In 1905, D. Carlos had 3 dogs and spent 25000 Reis." },
                new ReaderContentBlock { Type = "paragraph", Text = "15" }, // Standalone number but inside paragraph, NOT title!
                
                new ReaderContentBlock { Type = "title", Text = "Chapter I" },
                new ReaderContentBlock { Type = "paragraph", Text = "Actual story starts." }
            };

            var chapters = _service.DetectChaptersFromEpubHeadings(blocks);

            // Expecting 2 chapters: "Start" and "Chapter I"
            Assert.Equal(2, chapters.Count);
            
            // Verify that the normal numbers inside paragraphs are preserved!
            Assert.Contains("In 1905, D. Carlos had 3 dogs and spent 25000 Reis.", chapters[0].Content);
            Assert.Contains("15", chapters[0].Content);
        }

        [Fact]
        public void DetectChaptersFromEpubHeadings_DetectsParagraphLevelRomanNumerals()
        {
            var blocks = new List<ReaderContentBlock>
            {
                new ReaderContentBlock { Type = "paragraph", Text = "Intro" },
                new ReaderContentBlock { Type = "paragraph", Text = "I" }, // Standalone Roman numeral
                new ReaderContentBlock { Type = "paragraph", Text = "Chapter 1 content." },
                new ReaderContentBlock { Type = "paragraph", Text = "II" }, // Standalone Roman numeral
                new ReaderContentBlock { Type = "paragraph", Text = "Chapter 2 content." }
            };

            var chapters = _service.DetectChaptersFromEpubHeadings(blocks);

            Assert.Equal(3, chapters.Count);
            Assert.Equal("Start", chapters[0].Title);
            Assert.Contains("Intro", chapters[0].Content);

            Assert.Equal("I", chapters[1].Title);
            Assert.Contains("Chapter 1 content.", chapters[1].Content);

            Assert.Equal("II", chapters[2].Title);
            Assert.Contains("Chapter 2 content.", chapters[2].Content);
        }

        [Fact]
        public void ConsolidateFrontMatter_ConsolidatesCorrectly()
        {
            var chapters = new List<DetectedChapter>
            {
                new DetectedChapter { Title = "Capa", Content = "Book cover text", Blocks = new List<ReaderContentBlock>{ new ReaderContentBlock{ Text = "Book cover text" } } },
                new DetectedChapter { Title = "Folha de Rosto", Content = "Title Page Info", Blocks = new List<ReaderContentBlock>{ new ReaderContentBlock{ Text = "Title Page Info" } } },
                new DetectedChapter { Title = "Créditos", Content = "Copyright 2026", Blocks = new List<ReaderContentBlock>{ new ReaderContentBlock{ Text = "Copyright 2026" } } },
                new DetectedChapter { Title = "Chapter 1: The Beginning", Content = new string('A', 500), Blocks = new List<ReaderContentBlock>{ new ReaderContentBlock{ Text = "This is the real story." } } },
                new DetectedChapter { Title = "Chapter 2: The Middle", Content = new string('B', 500), Blocks = new List<ReaderContentBlock>{ new ReaderContentBlock{ Text = "More story content." } } }
            };

            var consolidated = _service.ConsolidateFrontMatter(chapters);

            // Capa, Folha de Rosto, and Créditos should be merged into "Front Matter"
            Assert.Equal(3, consolidated.Count);
            
            Assert.Equal("Front Matter", consolidated[0].Title);
            Assert.Contains("=== Capa ===", consolidated[0].Content);
            Assert.Contains("=== Folha de Rosto ===", consolidated[0].Content);
            Assert.Contains("=== Créditos ===", consolidated[0].Content);
            Assert.Contains("Copyright 2026", consolidated[0].Content);
            Assert.Equal(3, consolidated[0].Blocks!.Count);

            Assert.Equal("Chapter 1: The Beginning", consolidated[1].Title);
            Assert.Equal("Chapter 2: The Middle", consolidated[2].Title);
        }
    }
}

