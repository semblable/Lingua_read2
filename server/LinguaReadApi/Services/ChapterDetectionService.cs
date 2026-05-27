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
        public List<string>? FilePaths { get; set; }
        public int CharacterCount => Content.Length;
    }

    public class ChapterDetectionService
    {
        // Compilation of multilingual chapter pattern regexes
        private static readonly Regex[] ChapterRegexes = new[]
        {
            // English / French / German / Spanish / Italian / Portuguese / Dutch / Polish
            new Regex(@"^\s*(?:Chapter|Part|Section|Book|Act|Volume|Kapitel|Teil|Abschnitt|Buch|Akt|Chapitre|Partie|Livre|Acte|Capítulo|Parte|Sección|Libro|Acto|Capitolo|Sezione|Libro|Atto|Capítulo|Parte|Seção|Livro|Ato|Hoofdstuk|Deel|Boek|Rozdział|Część|Księga)\s+(?:[0-9a-zA-Z\-\.\s]+|[IVXLCDMivxlcdm]+)(?:\s*[:\-–—\.]\s*(.+))?$", RegexOptions.Compiled | RegexOptions.IgnoreCase),
            // English written-out numbers: "Chapter One", "Chapter Twenty"
            new Regex(@"^\s*(?:Chapter|Part|Section|Book)\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty|Thirty|Forty|Fifty|Sixty|Seventy|Eighty|Ninety|Hundred)(?:\s*[\-–—]\s*(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine))?(?:\s*[:\-–—\.]\s*(.+))?$", RegexOptions.Compiled | RegexOptions.IgnoreCase),
            // Russian
            new Regex(@"^\s*(?:Глава|Часть|Раздел|Книга|Том|Акт)\s+(?:[0-9a-zA-Z\-\.\sа-яА-ЯёЁ]+|[IVXLCDMivxlcdm]+)(?:\s*[:\-–—\.]\s*(.+))?$", RegexOptions.Compiled | RegexOptions.IgnoreCase),
            // Chinese / Japanese / Korean
            new Regex(@"^\s*(?:第\s*[一二三四五六七八九十百千0-9]+\s*[章节卷部回篇幕])(?:\s*[:\-–—\.\s]\s*(.+))?$", RegexOptions.Compiled),
            // Korean: 제1장, 제2장, etc.
            new Regex(@"^\s*제\s*[0-9]+\s*[장절편부권막](?:\s*[:\-–—\.\s]\s*(.+))?$", RegexOptions.Compiled),
            // Japanese structural keywords
            new Regex(@"^\s*(?:プロローグ|エピローグ|序章|終章|序幕|後書き|前書き|あとがき|まえがき)\s*$", RegexOptions.Compiled),
            // Standalone structural headings (multilingual) — no number required
            new Regex(@"^\s*(?:Prologue|Epilogue|Foreword|Afterword|Preface|Introduction|Conclusion|Appendix|Interlude|Intermission|Postscript|Preamble|Prolog|Epilog|Vorwort|Nachwort|Einleitung|Einführung|Anhang|Schluss|Zwischenspiel|Prologue|Épilogue|Préface|Avant-propos|Postface|Conclusion|Annexe|Prólogo|Epílogo|Prefacio|Introducción|Conclusión|Apéndice|Interludio|Prologo|Prefazione|Introduzione|Conclusione|Appendice|Interludio|Prólogo|Epílogo|Prefácio|Introdução|Conclusão|Apéndice|Interlúdio|Пролог|Эпилог|Предисловие|Послесловие|Введение|Заключение|Приложение|Voorwoord|Nawoord|Inleiding|Conclusie|Bijlage|Wstęp|Zakończenie|Dodatek)(?:\s*[:\-–—\.]\s*(.+))?\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase),
            // Standalone Roman numerals (e.g. "I", "II", "III", "XVII")
            new Regex(@"^\s*[IVXLCDMivxlcdm]+\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase)
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
                            Blocks = new List<ReaderContentBlock>(), // To hold blocks later
                            FilePaths = currentChapterFiles.Select(f => f.FilePath).ToList()
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
                    Blocks = new List<ReaderContentBlock>(),
                    FilePaths = currentChapterFiles.Select(f => f.FilePath).ToList()
                });
            }

            return chapters;
        }

        // EPUB Heading Detection
        public List<DetectedChapter> DetectChaptersFromEpubHeadings(List<ReaderContentBlock> blocks)
        {
            var chapters = new List<DetectedChapter>();
            if (blocks == null || !blocks.Any()) return chapters;

            // 1. Pre-analyze titles to see if they are actually page numbers
            var titleBlocks = blocks.Where(b => b != null 
                                                && string.Equals(b.Type, "title", StringComparison.OrdinalIgnoreCase) 
                                                && !string.IsNullOrWhiteSpace(b.Text) 
                                                && (b.Text?.Trim() ?? string.Empty).Length < 120).ToList();
            
            bool filterNumericTitles = false;
            if (titleBlocks.Count > 10)
            {
                var numericTitles = titleBlocks.Where(b => b != null && int.TryParse(b.Text?.Trim() ?? string.Empty, out _)).ToList();
                // If more than 50% of headings are purely numeric, or there's a page number higher than 50
                if (numericTitles.Count > 0 && (numericTitles.Count > titleBlocks.Count * 0.5 || numericTitles.Any(b => b != null && int.Parse(b.Text?.Trim() ?? "0") > 50)))
                {
                    filterNumericTitles = true;
                }
            }

            var romanRegex = new Regex(@"^\s*[IVXLCDMivxlcdm]+\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
            var currentChapterTitle = "Start";
            var currentChapterBlocks = new List<ReaderContentBlock>();

            foreach (var block in blocks)
            {
                if (block == null) continue;
                var text = block.Text?.Trim() ?? string.Empty;
                bool isHeading = string.Equals(block.Type, "title", StringComparison.OrdinalIgnoreCase);
                
                // Match paragraph block that is a standalone Roman Numeral (e.g. "I", "II", "XVII")
                bool isParagraphHeading = string.Equals(block.Type, "paragraph", StringComparison.OrdinalIgnoreCase) 
                                          && text.Length < 20 
                                          && romanRegex.IsMatch(text);

                // If filtering page numbers, completely ignore purely numeric Title blocks (strip them)
                if (isHeading && filterNumericTitles && int.TryParse(text, out _))
                {
                    continue;
                }

                if ((isHeading || isParagraphHeading) && 
                    !string.IsNullOrWhiteSpace(block.Text) && 
                    text.Length < 120)
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

                    currentChapterTitle = text;
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

        // EPUB Page-Break Detection — splits on blocks tagged with chapterBreak metadata
        public List<DetectedChapter> DetectChaptersFromPageBreaks(List<ReaderContentBlock> blocks)
        {
            var chapters = new List<DetectedChapter>();
            if (blocks == null || !blocks.Any()) return chapters;

            var currentChapterTitle = "Start";
            var currentChapterBlocks = new List<ReaderContentBlock>();

            foreach (var block in blocks)
            {
                bool isBreak = block.Meta != null &&
                    block.Meta.TryGetValue("chapterBreak", out var breakVal) &&
                    string.Equals(breakVal, "true", StringComparison.OrdinalIgnoreCase);

                if (isBreak)
                {
                    // Flush previous chapter if we have content
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

                    // If this break block is also a title, use its text as the chapter title
                    if (string.Equals(block.Type, "title", StringComparison.OrdinalIgnoreCase) &&
                        !string.IsNullOrWhiteSpace(block.Text))
                    {
                        currentChapterTitle = block.Text.Trim();
                    }
                    else
                    {
                        // Try to find a title from the first title-block after the break
                        int chapterNum = (chapters.Count > 0 && chapters[0].Title == "Start") ? chapters.Count : chapters.Count + 1;
                        currentChapterTitle = $"Chapter {chapterNum}";
                        // Add this block as content of the new chapter
                        currentChapterBlocks.Add(block);
                    }
                }
                else if (string.Equals(block.Type, "title", StringComparison.OrdinalIgnoreCase) &&
                         !string.IsNullOrWhiteSpace(block.Text) &&
                         !currentChapterBlocks.Any() &&
                         currentChapterTitle.StartsWith("Chapter "))
                {
                    // First title block after a page-break — use it as the chapter title
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

            // Only return page-break chapters if we actually found breaks (more than 1 chapter)
            return chapters.Count > 1 ? chapters : new List<DetectedChapter>();
        }

        /// <summary>
        /// Scans raw CSS text for selectors whose declarations include
        /// page-break-before:always, break-before:page, or break-before:always.
        /// Returns class names (without the dot) that trigger a chapter break.
        /// </summary>
        public static HashSet<string> BuildPageBreakClasses(IEnumerable<string> cssTexts)
        {
            var classes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (cssTexts == null) return classes;

            // Match CSS rule blocks: selectors { ... page-break-before: always ... }
            var ruleRegex = new Regex(
                @"([^{}]+)\{[^}]*(?:page-break-before\s*:\s*always|break-before\s*:\s*(?:page|always))[^}]*\}",
                RegexOptions.IgnoreCase | RegexOptions.Singleline);

            var classInSelectorRegex = new Regex(@"\.([a-zA-Z_][\w-]*)", RegexOptions.Compiled);

            foreach (var css in cssTexts)
            {
                if (string.IsNullOrWhiteSpace(css)) continue;

                foreach (Match ruleMatch in ruleRegex.Matches(css))
                {
                    var selectorPart = ruleMatch.Groups[1].Value;
                    foreach (Match classMatch in classInSelectorRegex.Matches(selectorPart))
                    {
                        classes.Add(classMatch.Groups[1].Value);
                    }
                }
            }

            return classes;
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

        /// <summary>
        /// Consolidates small metadata and cover/copyright pages at the beginning of the book
        /// into a single "Front Matter" chapter to prevent micro-lesson clutter in the dashboard.
        /// </summary>
        public List<DetectedChapter> ConsolidateFrontMatter(List<DetectedChapter> chapters)
        {
            if (chapters == null) return new List<DetectedChapter>();
            if (chapters.Count < 3) return chapters;

            var consolidated = new List<DetectedChapter>();
            var frontMatterBlocks = new List<ReaderContentBlock>();
            var frontMatterContent = new List<string>();
            var filePaths = new List<string>();
            
            var frontMatterKeywords = new[] { "capa", "rosto", "créditos", "sumário", "dedicatória", "epígrafe", "cover", "titlepage", "copyright", "toc", "dedication" };

            int i = 0;
            while (i < chapters.Count)
            {
                var chapter = chapters[i];
                var titleLower = chapter.Title.ToLowerInvariant();
                
                // Do not consolidate if the chapter looks like a regular, numbered book chapter
                bool isRegularChapter = IsRegularChapterTitle(chapter.Title);
                
                bool isFrontMatter = !isRegularChapter && (frontMatterKeywords.Any(k => titleLower.Contains(k)) || chapter.CharacterCount < 400);

                // Stop consolidation before the last/only chapters
                if (isFrontMatter && i < chapters.Count - 1)
                {
                    frontMatterContent.Add($"=== {chapter.Title} ===");
                    frontMatterContent.Add(chapter.Content);
                    if (chapter.Blocks != null)
                    {
                        frontMatterBlocks.AddRange(chapter.Blocks);
                    }
                    if (chapter.FilePaths != null)
                    {
                        filePaths.AddRange(chapter.FilePaths);
                    }
                    i++;
                }
                else
                {
                    break;
                }
            }

            if (frontMatterContent.Any())
            {
                consolidated.Add(new DetectedChapter
                {
                    Title = "Front Matter",
                    Content = string.Join("\n\n", frontMatterContent),
                    Blocks = frontMatterBlocks.Any() ? frontMatterBlocks : null,
                    FilePaths = filePaths.Any() ? filePaths.Distinct().ToList() : null
                });
            }

            while (i < chapters.Count)
            {
                consolidated.Add(chapters[i]);
                i++;
            }

            return consolidated;
        }

        private bool IsRegularChapterTitle(string title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;

            // Check regular chapter pattern regexes (indexes 0 to 4 in ChapterRegexes are regular chapters)
            for (int j = 0; j < 5; j++)
            {
                if (ChapterRegexes[j].IsMatch(title)) return true;
            }

            // Check NumberedHeadingRegex
            if (NumberedHeadingRegex.IsMatch(title)) return true;

            // Check purely numeric or standalone Roman numerals
            var pureNumericOrRoman = new Regex(@"^\s*(?:[0-9]+|[IVXLCDMivxlcdm]+)\s*$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
            if (pureNumericOrRoman.IsMatch(title)) return true;

            return false;
        }

        /// <summary>
        /// Merges any chapter that has no readable alphanumeric text (e.g. only contains images or whitespace)
        /// into the next chapter (prepend), or if it is the last chapter, the previous chapter (append).
        /// </summary>
        public List<DetectedChapter> ConsolidateEmptyChapters(List<DetectedChapter> chapters)
        {
            if (chapters == null || chapters.Count <= 1) return chapters ?? new List<DetectedChapter>();

            var result = new List<DetectedChapter>();

            for (int i = 0; i < chapters.Count; i++)
            {
                var chap = chapters[i];
                bool hasText = !string.IsNullOrWhiteSpace(chap.Content) && chap.Content.Any(char.IsLetterOrDigit);

                if (!hasText)
                {
                    // Empty chapter! Merge it.
                    if (i + 1 < chapters.Count)
                    {
                        var nextChap = chapters[i + 1];

                        nextChap.Content = string.IsNullOrWhiteSpace(chap.Content)
                            ? nextChap.Content
                            : chap.Content + "\n\n" + nextChap.Content;

                        if (chap.Blocks != null && chap.Blocks.Any())
                        {
                            nextChap.Blocks ??= new List<ReaderContentBlock>();
                            nextChap.Blocks.InsertRange(0, chap.Blocks);
                        }

                        if (chap.FilePaths != null && chap.FilePaths.Any())
                        {
                            nextChap.FilePaths ??= new List<string>();
                            nextChap.FilePaths.InsertRange(0, chap.FilePaths);
                            nextChap.FilePaths = nextChap.FilePaths.Distinct().ToList();
                        }

                        if (nextChap.Title == "Start" && chap.Title != "Start")
                        {
                            nextChap.Title = chap.Title;
                        }
                    }
                    else if (result.Any())
                    {
                        var prevChap = result.Last();

                        prevChap.Content = string.IsNullOrWhiteSpace(chap.Content)
                            ? prevChap.Content
                            : prevChap.Content + "\n\n" + chap.Content;

                        if (chap.Blocks != null && chap.Blocks.Any())
                        {
                            prevChap.Blocks ??= new List<ReaderContentBlock>();
                            prevChap.Blocks.AddRange(chap.Blocks);
                        }

                        if (chap.FilePaths != null && chap.FilePaths.Any())
                        {
                            prevChap.FilePaths ??= new List<string>();
                            prevChap.FilePaths.AddRange(chap.FilePaths);
                            prevChap.FilePaths = prevChap.FilePaths.Distinct().ToList();
                        }
                    }
                    else
                    {
                        // No next chapter and no previous chapter (only chapter in book). Keep it.
                        result.Add(chap);
                    }
                }
                else
                {
                    result.Add(chap);
                }
            }

            return result;
        }

        /// <summary>
        /// Detects chapters from EPUB blocks by grouping them based on changes in their source file metadata.
        /// Useful as a robust fallback for EPUBs when standard heading or TOC split has failed or is unavailable.
        /// </summary>
        public List<DetectedChapter> DetectChaptersFromEpubSourceFiles(List<ReaderContentBlock> blocks)
        {
            var chapters = new List<DetectedChapter>();
            if (blocks == null || !blocks.Any()) return chapters;

            var currentChapterTitle = "Start";
            var currentChapterBlocks = new List<ReaderContentBlock>();
            string? currentSourceFile = null;
            int chapterCounter = 1;

            foreach (var block in blocks)
            {
                if (block == null) continue;

                string? sourceFile = null;
                block.Meta?.TryGetValue("sourceFile", out sourceFile);

                if (sourceFile != null && currentSourceFile != null && !string.Equals(sourceFile, currentSourceFile, StringComparison.OrdinalIgnoreCase))
                {
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

                    currentChapterTitle = $"Chapter {chapterCounter++}";
                }

                if (sourceFile != null)
                {
                    currentSourceFile = sourceFile;
                }

                // If this is a title block and we are at the start of a source file, use its text as the title
                if (string.Equals(block.Type, "title", StringComparison.OrdinalIgnoreCase) &&
                    !string.IsNullOrWhiteSpace(block.Text) &&
                    !currentChapterBlocks.Any(b => string.Equals(b.Type, "paragraph", StringComparison.OrdinalIgnoreCase)))
                {
                    currentChapterTitle = block.Text.Trim();
                }

                currentChapterBlocks.Add(block);
            }

            if (currentChapterBlocks.Any() || chapters.Count == 0)
            {
                chapters.Add(new DetectedChapter
                {
                    Title = currentChapterTitle,
                    Content = string.Join("\n\n", currentChapterBlocks.Select(b => b.Text).Where(t => !string.IsNullOrWhiteSpace(t))),
                    Blocks = currentChapterBlocks.ToList()
                });
            }

            return chapters.Count > 1 ? chapters : new List<DetectedChapter>();
        }
    }
}
