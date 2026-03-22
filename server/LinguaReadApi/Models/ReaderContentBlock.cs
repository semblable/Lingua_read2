using System.Collections.Generic;

namespace LinguaReadApi.Models
{
    public static class ReaderContentBlockTypes
    {
        public const string Title = "title";
        public const string Paragraph = "paragraph";
        public const string Image = "image";
    }

    public class ReaderContentBlock
    {
        public string Type { get; set; } = ReaderContentBlockTypes.Paragraph;
        public string? Text { get; set; }
        public string? ImageUrl { get; set; }
        public string? AltText { get; set; }
        public string? Caption { get; set; }
        public Dictionary<string, string>? Meta { get; set; }
    }
}
