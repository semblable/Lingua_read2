using System;
using System.Collections.Generic;
using System.Linq;

namespace LinguaReadApi.Controllers
{
    /// <summary>
    /// Parses the raw AI response from story generation to extract story text and used words.
    /// </summary>
    public static class SrsStoryResponseParser
    {
        /// <summary>
        /// Parses the raw response, separating story text from the USED_WORDS marker.
        /// Falls back to all target words if no marker is found.
        /// </summary>
        public static (string Story, List<string> UsedWords) Parse(string rawResponse, List<string> targetWordTerms)
        {
            if (string.IsNullOrEmpty(rawResponse))
                return (rawResponse ?? "", new List<string>(targetWordTerms));

            var usedWordsIndex = rawResponse.LastIndexOf("USED_WORDS:", StringComparison.OrdinalIgnoreCase);
            if (usedWordsIndex >= 0)
            {
                var storyText = rawResponse.Substring(0, usedWordsIndex).Trim();
                var usedWordsLine = rawResponse.Substring(usedWordsIndex + "USED_WORDS:".Length).Trim();
                var usedWords = usedWordsLine.Split(',')
                    .Select(w => w.Trim())
                    .Where(w => !string.IsNullOrEmpty(w))
                    .ToList();
                return (storyText, usedWords);
            }

            // Fallback: assume all target words were used
            return (rawResponse, new List<string>(targetWordTerms));
        }
    }
}
