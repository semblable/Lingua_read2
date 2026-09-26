// Case- and accent-insensitive search text, so "sancao" finds "Sob sanção" and "strasse" finds
// "Straße" without a keyboard for them. Mirrors the server's SearchText.Fold (Postgres's
// unaccent(lower(x))), so the Library's in-folder filter agrees with its cross-folder search.

// Letters with no decomposition that unaccent still spells out, plus the typographic apostrophes
// it turns into ', so "l'etranger" finds "L’Étranger".
const SPELLED_OUT: Record<string, string> = {
  'ß': 'ss',
  'æ': 'ae',
  'œ': 'oe',
  'ø': 'o',
  'ł': 'l',
  'đ': 'd',
  'ð': 'd',
  'þ': 'th',
  'ı': 'i',
  'ª': 'a',
  'º': 'o',
  'ё': 'е', // Cyrillic, the one letter of that script unaccent folds
  '‘': "'",
  '’': "'",
  '‛': "'",
};

const NON_SPACING_MARK = /\p{Mn}/u;

// Latin (incl. IPA) and Greek blocks, and their Extended Additional blocks.
const isLatinOrGreek = (codePoint: number): boolean =>
  codePoint < 0x0400 || (codePoint >= 0x1e00 && codePoint < 0x2000);

// Hyphens and dashes, U+2010 to U+2015, which unaccent turns into -.
const isDash = (codePoint: number): boolean => codePoint >= 0x2010 && codePoint <= 0x2015;

export function foldForSearch(text: string | null | undefined): string {
  if (!text) return '';

  let stripped = '';
  let keepMarks = false;
  for (const ch of text.normalize('NFD')) {
    if (!NON_SPACING_MARK.test(ch)) {
      // unaccent only strips the accents of Latin and Greek letters: Cyrillic й, ї and ў stay
      // letters of their own, and other scripts keep their marks.
      keepMarks = !isLatinOrGreek(ch.codePointAt(0)!);
    } else if (!keepMarks) {
      continue;
    }
    stripped += ch;
  }

  // Lowercased after the accents are gone, so "İ" becomes "i".
  let folded = '';
  for (const ch of stripped.normalize('NFC').toLowerCase()) {
    folded += SPELLED_OUT[ch] ?? (isDash(ch.codePointAt(0)!) ? '-' : ch);
  }
  return folded;
}
