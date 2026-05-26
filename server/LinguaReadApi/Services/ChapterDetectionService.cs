using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using VersOne.Epub;
using LinguaReadApi.Models;

namespace LinguaReadApi.Services
{
    public class DetectedChapter
    {
        public string Title { get; set; } = string.Empty;
        public string Content { get; set; } = string.Empty;
        public List<ReaderContentBlock>? Blocks { get; set; }
        public int CharacterCount => Content.Length;
    }

    public class ChapterDetectionService
    {
        // Compilation of multilingual chapter pattern regexes
        private static readonly Regex[] ChapterRegexes = new[]
        {
            // English / French / German / Spanish
            new Regex(@"^\s*(?:Chapter|Part|Section|Book|Kapitel|Teil|Abschnitt|Buch|Chapitre|Partie|Livre|Capítulo|Parte|Sección|Libro)\s+(?:[0-9a-zA-Z\-\.\s]+|[IVXLCDMivxlcdm]+)(?:\s*[:\-–—\.]\s*(.+))?$", RegexOptions.Compiled | RegexOptions.IgnoreCase),
            // Russian
            new Regex(@"^\s*(?:Глава|Часть|Раздел|Книга)\s+(?:[0-9a-zA-Z\-\.\sа-яА-ЯёЁ]+|[IVXLCDMivxlcdm]+)(?:\s*[:\-–—\.]\s*(.+))?$", RegexOptions.Compiled | RegexOptions.IgnoreCase),
            // Chinese / Japanese / Korean
            new Regex(@"^\s*(?:第\s*[一二三四五六七八九十百千0-9]+\s*[章节卷部回])(?:\s*[:\-–—\.\s]\s*(.+))?$", RegexOptions.Compiled),
            new Regex(@"^\s*(?:プロローグ|エピローグ|序章|終章|序幕|後書き|前書き)\s*$", RegexOptions.Compiled)
        };

        private static readonly Regex NumberedHeadingRegex = new Regex(@"^\s*(?:[0-9]+|[IVXLCDMivxlcdm]+)\s*[\.\-–—:]\s+(.+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);

        // Plain Text Heading Detection
        public List<DetectedChapter> DetectChaptersFromTextHeadings(string content)
        {
            var chapters = new List<DetectedChapter>();
            if (string.IsNullOrWhiteSpace(content)) return chapters;

            // Split content into lines to analyze headings
            var lines = content.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            var currentChapterTitle = "Start";
            var currentChapterLines = new List<string>();

            for (int i = 0; i < lines.Length; i++)
            {
                var line = lines[i].Trim();
                
                // If a line is potential heading (not too long, and matches a regex)
                if (line.Length > 0 && line.Length < 120 && IsChapterHeading(line, out var capturedTitle))
                {
                    // If we have accumulated lines, flush the previous chapter
                    if (currentChapterLines.Any(l => !string.IsNullOrWhiteSpace(l)))
                    {
                        chapters.Add(new DetectedChapter
                        {
                            Title = currentChapterTitle,
                            Content = string.Join("\n", currentChapterLines)
                        });
                        currentChapterLines.Clear();
                    }

                    currentChapterTitle = !string.IsNullOrWhiteSpace(capturedTitle) ? capturedTitle : line;
                }
                else
                {
                    currentChapterLines.Add(lines[i]);
                }
            }

            // Flush the last chapter
            if (currentChapterLines.Any(l => !string.IsNullOrWhiteSpace(l)))
            {
                chapters.Add(new DetectedChapter
                {
                    Title = currentChapterTitle,
                    Content = string.Join("\n", currentChapterLines)
                });
            }

            return chapters;
        }

        // Plain Text Section Break Detection
        public List<DetectedChapter> DetectChaptersFromSectionBreaks(string content)
        {
            var chapters = new List<DetectedChapter>();
            if (string.IsNullOrWhiteSpace(content)) return chapters;

            // Split by 3 or more blank lines
            var sections = Regex.Split(content, @"(?:\r?\n\s*){3,}")
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToList();

            for (int i = 0; i < sections.Count; i++)
            {
                var sec = sections[i];
                // Try to extract a title from the first line
                var firstLine = sec.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim() ?? "";
                var title = (firstLine.Length > 0 && firstLine.Length < 60) ? firstLine : $"Section {i + 1}";

                chapters.Add(new DetectedChapter
                {
                    Title = title,
                    Content = sec
                });
            }

            return chapters;
        }

        // EPUB TOC Detection
        public List<DetectedChapter> DetectChaptersFromEpubToc(EpubBook epubBook)
        {
            var chapters = new List<DetectedChapter>();
            if (epubBook?.Navigation == null) return chapters;

            // Map navigation files to titles.
            var navItems = FlattenNavItems(epubBook.Navigation);
            
            // Build a lookup of filepath -> navigation item title
            var fileToTitleLookup = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var nav in navItems)
            {
                if (nav.HtmlContentFile?.FilePath != null && !fileToTitleLookup.ContainsKey(nav.HtmlContentFile.FilePath))
                {
                    fileToTitleLookup[nav.HtmlContentFile.FilePath] = nav.Title;
                }
            }

            // Group ReadingOrder files into chapters based on TOC.
            var currentChapterTitle = epubBook.Title ?? "Introduction";
            var currentChapterFiles = new List<EpubLocalTextContentFile>();

            foreach (var textFile in epubBook.ReadingOrder)
            {
                var fileName = textFile.FilePath;
                
                // If this file starts a new navigation chapter
                if (fileToTitleLookup.TryGetValue(fileName, out var newTitle))
                {
                    // Flush current chapter if we have files in it
                    if (currentChapterFiles.Any())
                    {
                        chapters.Add(new DetectedChapter
                        {
                            Title = currentChapterTitle,
                            Content = string.Empty, // Will be filled when parsing/extracting blocks
                            Blocks = new List<ReaderContentBlock>() // To hold blocks later
                        });
                        currentChapterFiles.Clear();
                    }
                    currentChapterTitle = newTitle;
                }

                currentChapterFiles.Add(textFile);
            }

            // Flush last chapter
            if (currentChapterFiles.Any())
            {
                chapters.Add(new DetectedChapter
                {
                    Title = currentChapterTitle,
                    Content = string.Empty,
                    Blocks = new List<ReaderContentBlock>()
                });
            }

            return chapters;
        }

        // EPUB Heading Detection
        public List<DetectedChapter> DetectChaptersFromEpubHeadings(List<ReaderContentBlock> blocks)
        {
            var chapters = new List<DetectedChapter>();
            if (blocks == null || !blocks.Any()) return chapters;

            var currentChapterTitle = "Start";
            var currentChapterBlocks = new List<ReaderContentBlock>();

            foreach (var block in blocks)
            {
                // If it's a heading block (Title type)
                if (string.Equals(block.Type, "title", StringComparison.OrdinalIgnoreCase) && 
                    !string.IsNullOrWhiteSpace(block.Text) && 
                    block.Text.Trim().Length < 120)
                {
                    // Flush previous chapter
                    if (currentChapterBlocks.Any())
                    {
                        chapters.Add(new DetectedChapter
                        {
                            Title = currentChapterTitle,
                            Content = string.Join("\n\n", currentChapterBlocks.Select(b => b.Text).Where(t => !string.IsNullOrWhiteSpace(t))),
                            Blocks = currentChapterBlocks.ToList()
                        });
                        currentChapterBlocks.Clear();
                    }

                    currentChapterTitle = block.Text.Trim();
                }
                else
                {
                    currentChapterBlocks.Add(block);
                }
            }

            // Flush last chapter
            if (currentChapterBlocks.Any() || chapters.Count == 0)
            {
                chapters.Add(new DetectedChapter
                {
                    Title = currentChapterTitle,
                    Content = string.Join("\n\n", currentChapterBlocks.Select(b => b.Text).Where(t => !string.IsNullOrWhiteSpace(t))),
                    Blocks = currentChapterBlocks.ToList()
                });
            }

            return chapters;
        }

        private bool IsChapterHeading(string line, out string? capturedTitle)
        {
            capturedTitle = null;

            foreach (var regex in ChapterRegexes)
            {
                var match = regex.Match(line);
                if (match.Success)
                {
                    if (match.Groups.Count > 1 && match.Groups[1].Success)
                    {
                        capturedTitle = match.Groups[1].Value.Trim();
                    }
                    return true;
                }
            }

            var numMatch = NumberedHeadingRegex.Match(line);
            if (numMatch.Success)
            {
                capturedTitle = numMatch.Groups[1].Value.Trim();
                return true;
            }

            return false;
        }

        private List<EpubNavigationItem> FlattenNavItems(List<EpubNavigationItem> items)
        {
            var result = new List<EpubNavigationItem>();
            if (items == null) return result;

            foreach (var item in items)
            {
                result.Add(item);
                if (item.NestedItems != null && item.NestedItems.Any())
                {
                    result.AddRange(FlattenNavItems(item.NestedItems));
                }
            }

            return result;
        }
    }
}
