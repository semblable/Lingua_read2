using System.Globalization;
using System.Text;

namespace LinguaReadApi.Utilities
{
    /// <summary>
    /// Search that ignores case and accents, so "sob sancao" finds "Sob sanção" and "strasse" finds
    /// "Straße" without a keyboard for them. Queries compare
    /// <c>SearchText.Fold(column).Contains(SearchText.Fold(query))</c>: on Postgres, AppDbContext
    /// maps <see cref="Fold"/> to <c>unaccent(lower(x))</c> for both sides; on other providers (the
    /// in-memory test database) this C# version runs. It follows unaccent's rules for the letters
    /// the app's languages use, and the client's foldForSearch (utils/searchText.ts) mirrors it.
    /// </summary>
    public static class SearchText
    {
        public static string Fold(string? text)
        {
            if (string.IsNullOrEmpty(text)) return string.Empty;

            var decomposed = text.Normalize(NormalizationForm.FormD);
            var stripped = new StringBuilder(decomposed.Length);
            var keepMarks = false;
            foreach (var ch in decomposed)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark)
                {
                    // unaccent only strips the accents of Latin and Greek letters: Cyrillic й, ї and ў
                    // stay letters of their own, and other scripts keep their marks.
                    keepMarks = !IsLatinOrGreek(ch);
                }
                else if (!keepMarks)
                {
                    continue;
                }
                stripped.Append(ch);
            }

            // Lowercased after the accents are gone, so "İ" becomes "i" rather than "I".
            var lower = stripped.ToString().Normalize(NormalizationForm.FormC).ToLowerInvariant();
            var folded = new StringBuilder(lower.Length);
            foreach (var ch in lower)
            {
                // Letters with no decomposition that unaccent still spells out, plus the typographic
                // apostrophes and dashes it turns into ' and -, so "l'etranger" finds "L’Étranger".
                folded.Append(ch switch
                {
                    'ß' => "ss",
                    'æ' => "ae",
                    'œ' => "oe",
                    'ø' => "o",
                    'ł' => "l",
                    'đ' or 'ð' => "d",
                    'þ' => "th",
                    'ı' => "i",
                    'ª' => "a",
                    'º' => "o",
                    'ё' => "е", // Cyrillic, the one letter of that script unaccent folds
                    '‘' or '’' or '‛' => "'",
                    >= (char)0x2010 and <= (char)0x2015 => "-", // hyphens and dashes
                    _ => ch.ToString()
                });
            }
            return folded.ToString();
        }

        // Latin (incl. IPA) and Greek blocks, and their Extended Additional blocks.
        private static bool IsLatinOrGreek(char ch) => ch < 0x0400 || (ch >= 0x1E00 && ch < 0x2000);
    }
}
