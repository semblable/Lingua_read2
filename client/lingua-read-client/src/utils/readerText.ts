export type LanguageConfig = {
  wordCharacters?: string | null;
  characterSubstitutions?: string | null;
  parserType?: string | null;
  splitSentences?: string | null;
  sentenceSplitExceptions?: Array<string | { exceptionString?: string } | null> | null;
  languageCode?: string | null;
  code?: string | null;
} | null | undefined;

export type CharSubstitution = { old: string; replacement: string };

export type StructuredBlock = {
  type?: 'image' | 'title' | 'paragraph' | string | null;
  text?: string | null;
  imageUrl?: string | null;
  altText?: string | null;
  caption?: string | null;
  meta?: Record<string, unknown> | null;
};

export type DisplayBlock = {
  key: string;
  type?: 'image' | 'title' | 'paragraph' | string;
  text: string;
  lines: string[];
  isTitleBlock: boolean;
  imageUrl?: string | null;
  altText?: string;
  caption?: string;
  meta?: Record<string, unknown>;
};

export type ReaderToken = {
  type: 'word' | 'separator';
  text: string;
  start: number;
  end: number;
};

export type ReaderSegment = {
  index: number;
  text: string;
  type: 'sentence' | 'title';
  mediaBlocks: DisplayBlock[];
};

// SRT-derived sentence segment. Constructed in TextDisplay when an audio
// lesson supplies SRT lines; carries timing + the SRT line id so the audio
// element can seek/replay the segment. Discriminator: type === 'audio'.
export type SrtSentenceSegment = {
  index: number;
  text: string;
  type: 'audio';
  startTime: number;
  endTime: number;
  srtLineId: number;
};

export type SentenceSegment = ReaderSegment | SrtSentenceSegment;

export type TitleLineVariant =
  | 'spacer'
  | 'chapter-marker'
  | 'chapter-meta'
  | 'epigraph'
  | 'epigraph-attribution'
  | 'default';

export const normalizeAssetUrl = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }

  return `/${value.replace(/^\/+/, '')}`;
};

// Only feeds the title heuristics in buildDisplayBlocks, which decide how a
// block is split into sentence segments. Bookmarks and reading progress are
// keyed by segment index, so this must keep counting exactly as it always has:
// counting a soft-hyphenated or decomposed word as one word would turn some
// blocks into titles (or back) and shift every later index.
export const countWordsInText = (content: string | null | undefined): number => {
  if (!content) return 0;
  return (content.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
};

export const titleLineEndsLikeSentence = (line: string): boolean =>
  /[.!?…]["'”’)]?$/.test(line.trim());

export const isRomanOrNumericLine = (line: string): boolean =>
  /^\d{1,4}$/.test(line) || /^[IVXLCDM]+$/i.test(line);

export const isShortHeadingLine = (line: string): boolean => {
  const wordCount = countWordsInText(line);
  return wordCount > 0 && wordCount <= 4 && !titleLineEndsLikeSentence(line);
};

export const isChapterMarkerLine = (line: string): boolean =>
  /^(part|chapter|book|section|prologue|epilogue|cap[ií]tulo|parte|livro)\b/i.test(line.trim());

export const isChapterMetaLine = (line: string): boolean => {
  const trimmed = line.trim();
  return /^\d{1,4}$/.test(trimmed) || /^[IVXLCDM]+$/i.test(trimmed);
};

export const isQuotedEpigraphLine = (line: string): boolean =>
  /^["'“”‘’«»]/.test(line.trim()) || /["'”‘’«»]$/.test(line.trim());

export const getTitleLineVariant = (
  line: string,
  lineIndex: number,
  lines: string[]
): TitleLineVariant => {
  const trimmed = line.trim();
  if (!trimmed) return 'spacer';
  if (isChapterMarkerLine(trimmed)) return 'chapter-marker';
  if (isChapterMetaLine(trimmed)) return 'chapter-meta';
  if (isQuotedEpigraphLine(trimmed)) return 'epigraph';

  const previousNonEmpty = [...lines]
    .slice(0, lineIndex)
    .reverse()
    .find((candidate) => candidate.trim());

  if (previousNonEmpty && isQuotedEpigraphLine(previousNonEmpty) && countWordsInText(trimmed) <= 5) {
    return 'epigraph-attribution';
  }

  if (countWordsInText(trimmed) >= 8 && lineIndex > 0) {
    return 'epigraph';
  }

  return 'default';
};

export const buildDisplayBlocks = (
  content: string | null | undefined,
  structuredContent: StructuredBlock[] = []
): DisplayBlock[] => {
  if (Array.isArray(structuredContent) && structuredContent.length > 0) {
    const mapped = structuredContent
      .map((block, blockIndex): DisplayBlock | null => {
        if (block?.type === 'image' && block?.imageUrl) {
          return {
            key: `block-${blockIndex}`,
            type: 'image',
            imageUrl: normalizeAssetUrl(block.imageUrl),
            altText: block.altText || '',
            caption: block.caption || '',
            meta: block.meta || {},
            isTitleBlock: false,
            text: '',
            lines: []
          };
        }

        const normalizedText = (block?.text || '').replace(/\r\n/g, '\n').trim();
        if (!normalizedText) {
          return null;
        }

        const lines = normalizedText.split('\n').map((line) => line.trim());
        return {
          key: `block-${blockIndex}`,
          type: block?.type === 'title' ? 'title' : 'paragraph',
          text: normalizedText,
          lines,
          caption: block?.caption || '',
          meta: block?.meta || {},
          isTitleBlock: block?.type === 'title'
        };
      })
      .filter((b): b is DisplayBlock => b !== null);
    return mapped;
  }

  if (!content) return [];

  const normalizedBlocks = content
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, blockIndex) => {
      const rawLines = block.split('\n').map((line) => line.trimEnd());
      const displayLines = rawLines.map((line) => line.trim());
      const nonEmptyLines = displayLines.filter(Boolean);
      const joinedText = nonEmptyLines.join(' ').trim();
      const totalWordCount = countWordsInText(joinedText);
      const allCapsLineCount = nonEmptyLines.filter(
        (line) => /[A-Za-zÀ-ÿ]/.test(line) && line === line.toLocaleUpperCase()
      ).length;
      const romanOrNumericLineCount = nonEmptyLines.filter(isRomanOrNumericLine).length;
      const shortHeadingLineCount = nonEmptyLines.filter(isShortHeadingLine).length;
      const proseLineCount = nonEmptyLines.filter(titleLineEndsLikeSentence).length;
      const hasBlankLine = rawLines.some((line) => line.trim() === '');
      const strongTitleSignal =
        blockIndex <= 3 &&
        (romanOrNumericLineCount > 0 ||
          allCapsLineCount > 0 ||
          (nonEmptyLines.length === 1 && shortHeadingLineCount === 1));

      return {
        key: `block-${blockIndex}`,
        text: block,
        lines: displayLines,
        nonEmptyLines,
        totalWordCount,
        proseLineCount,
        hasBlankLine,
        strongTitleSignal
      };
    });

  return normalizedBlocks.map((block, blockIndex, blocks): DisplayBlock => {
    const prevStrongTitleSignal = blocks[blockIndex - 1]?.strongTitleSignal ?? false;
    const nextStrongTitleSignal = blocks[blockIndex + 1]?.strongTitleSignal ?? false;
    const contextualTitleSignal =
      blockIndex <= 3 &&
      block.totalWordCount <= 28 &&
      block.nonEmptyLines.length >= 2 &&
      (block.hasBlankLine || prevStrongTitleSignal || nextStrongTitleSignal) &&
      (prevStrongTitleSignal || nextStrongTitleSignal || block.proseLineCount === 0);

    return {
      key: block.key,
      text: block.text,
      lines: block.lines,
      isTitleBlock: block.strongTitleSignal || contextualTitleSignal
    };
  });
};

// =====================================================================
// LANGUAGE-AWARE TOKENIZATION (shared spec, mirrored on backend)
// =====================================================================
//
// Pipeline:
//   1. normalizeTokenizerInput: drop soft hyphens (U+00AD, invisible
//      hyphenation points that ebooks put inside words: `repa<U+00AD>rava`)
//      and compose decomposed accents (`e` + U+0301 -> `é`), so neither
//      splits a word. Only base+combining-mark runs and Greek letters are
//      normalized (NFC; Greek oxia letters become the tonos ones keyboards
//      type); the rest of the text is left untouched.
//   2. parseCharacterSubstitutions(language.characterSubstitutions)
//      Pipe-separated `old=new|...`. Used to normalize curly apostrophes
//      to ASCII `'`, fancy quotes, ellipsis, etc. The first `=` separates
//      old and new; later `=` chars belong to `new`.
//   3. applyCharacterSubstitutions: built-in substitutions first (curly /
//      modifier apostrophes -> `'`, Unicode hyphens U+2010/U+2011 -> `-`),
//      then the language's, each in declaration order. Users must declare
//      longer-old-first to avoid greediness issues (e.g. `...=…|..=‥`).
//   4. buildCoreWordRegex(language.wordCharacters): regex character class
//      defining the language's base alphabet, used as-is (letters plus
//      marks when empty or invalid). No seed lists `'` or `-`, so the
//      connector rule below decides glue; a class a user edits to list them
//      makes them core characters.
//   5. tokenizeContent walks the substituted text and accumulates runs
//      of core word chars **plus glued connectors**:
//        - Apostrophe `'` (after substitution): glued only when both
//          previous and next char are core. Allows `l'eau`, `qu'il`,
//          `dell'acqua`, `don't`. Stray `'word` or `word'` keep `'`
//          as separator.
//        - Hyphen `-`: glued only when both neighbours are core. Allows
//          `beijá-lo`, `interrompo-a`, `well-known`. Standalone `--`
//          and en-dashes split.
//        - Middle dot `·`: glued only when both neighbours are core, for
//          the Catalan geminated l (`col·lecció`).
//      A combining mark or format character can continue a word but not
//      start one (an emoji's variation selector is not a word).
//      Tokens preserve original casing for display; lookups normalize
//      via JS `toLowerCase()` (BE uses locale-aware `ToLower`).
//
// CJK parserType (`mecab`/`jieba`) is out of scope: tokenization falls
// back to the default spacedel algorithm.
// =====================================================================

const APOSTROPHE = "'";
const HYPHEN = '-';
const MIDDLE_DOT = '·';

// Word characters for Latin-script languages (mirrors
// Language.LatinWordCharacters on the backend). Basic Latin letters,
// Latin-1 letters (skipping × ÷ and the ordinal indicators ª º, so `1º`
// is not a word), Latin Extended-A/B, Latin Extended Additional (ẞ, ẁ,
// Vietnamese), and combining marks.
export const LATIN_WORD_CHARACTERS = 'a-zA-ZÀ-ÖØ-öø-ɏḀ-ỿ\\p{M}';

// Default for a language the user adds: any letter plus combining marks,
// so Polish, Greek, Czech, … work without editing the field. Also the
// Russian seed and the fallback for an empty or invalid class (mirrors
// Language.DefaultWordCharacters).
export const DEFAULT_LANGUAGE_WORD_CHARACTERS = '\\p{L}\\p{M}';

// Built-in normalizations applied BEFORE user-defined characterSubstitutions.
// These guarantee that apostrophe/hyphen glue works in every language —
// even custom ones with empty CharacterSubstitutions — by mapping common
// curly / modifier apostrophe and Unicode hyphen variants to ASCII. User
// subs can still override these (e.g. mapping U+2019 to a different char)
// by listing the same `old` in the language config.
const BUILT_IN_SUBSTITUTIONS: CharSubstitution[] = [
  { old: '’', replacement: APOSTROPHE },
  { old: '‘', replacement: APOSTROPHE },
  { old: 'ʼ', replacement: APOSTROPHE },
  { old: '\u2010', replacement: HYPHEN }, // hyphen
  { old: '\u2011', replacement: HYPHEN } // non-breaking hyphen
];

const SOFT_HYPHEN_PATTERN = /\u00AD/g;
// Greek and Coptic (U+0370-U+03FF) and Greek Extended (U+1F00-U+1FFF).
const NEEDS_COMPOSITION = /[\p{M}\u{370}-\u{3FF}\u{1F00}-\u{1FFF}]/u;
// A run of Greek letters (with any marks after it), or any other base
// character followed by one or more combining marks. Greek punctuation stays
// out of the letter runs: NFC turns the ano teleia (U+0387) into a middle
// dot, which glues the words around it.
const COMPOSABLE_RUNS = /(?:(?=\p{L})[\u{370}-\u{3FF}\u{1F00}-\u{1FFF}])+\p{M}*|\P{M}\p{M}+/gu;

/**
 * Remove soft hyphens and compose decomposed accents. Greek letters are
 * composed even without a mark, which maps the oxia forms of Greek Extended
 * (alpha with oxia, U+1F71) onto the tonos letters keyboards type (U+03AC):
 * they look the same but would otherwise be different words. Runs before
 * any substitution so words split by either are whole again. Mirrors
 * `Tokenizer.NormalizeInput` on the backend.
 */
export const normalizeTokenizerInput = (content: string): string => {
  if (!content) return content;
  let out = content.includes('\u00AD') ? content.replace(SOFT_HYPHEN_PATTERN, '') : content;
  if (NEEDS_COMPOSITION.test(out)) {
    out = out.replace(COMPOSABLE_RUNS, (run) => run.normalize('NFC'));
  }
  return out;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Split `display` at every case-insensitive match of `needle` in `haystack`,
// which must be `display` with same-length substitutions applied (or
// `display` itself). Null when there is no match.
const splitAtMatches = (
  display: string,
  haystack: string,
  needle: string
): { text: string; isTerm: boolean }[] | null => {
  const parts: { text: string; isTerm: boolean }[] = [];
  let last = 0;
  for (const match of haystack.matchAll(new RegExp(escapeRegExp(needle), 'giu'))) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: display.slice(last, start), isTerm: false });
    parts.push({ text: display.slice(start, start + match[0].length), isTerm: true });
    last = start + match[0].length;
  }
  if (parts.length === 0) return null;
  if (last < display.length) parts.push({ text: display.slice(last), isTerm: false });
  return parts;
};

/**
 * Split a stored sentence around every case-insensitive occurrence of a
 * stored term, for highlighting a flashcard's word in its mined sentence.
 * Mined sentences are the reader's raw segment text while terms are keyed
 * from normalized tokens, so both are normalized first: without that a soft
 * hyphen, a decomposed accent or a curly apostrophe in the sentence hides
 * the term. The returned text keeps the sentence's own apostrophes and
 * hyphens: the built-in substitutions swap one UTF-16 unit for another, so
 * offsets found after them are offsets in the displayed text.
 *
 * Terms are also keyed after the language's own substitutions (`d´África`
 * is stored as `d'áfrica`). Those can change lengths (`...=…`), so when the
 * term only matches after them, the sentence is returned the way the reader
 * shows it, with the substitutions applied.
 */
export const splitSentenceAroundTerm = (
  sentence: string,
  term: string,
  characterSubstitutions?: string | null
): { text: string; isTerm: boolean }[] => {
  const display = normalizeTokenizerInput(sentence || '');
  const needle = applyCharacterSubstitutions(normalizeTokenizerInput(term || ''), BUILT_IN_SUBSTITUTIONS).trim();
  if (!display) return [];
  if (!needle) return [{ text: display, isTerm: false }];

  const haystack = applyCharacterSubstitutions(display, BUILT_IN_SUBSTITUTIONS);
  const parts = splitAtMatches(display, haystack, needle);
  if (parts) return parts;

  const userSubs = parseCharacterSubstitutions(characterSubstitutions);
  if (userSubs.length > 0) {
    const processed = applyCharacterSubstitutions(haystack, userSubs);
    const processedNeedle = applyCharacterSubstitutions(needle, userSubs).trim();
    const processedParts = processedNeedle ? splitAtMatches(processed, processed, processedNeedle) : null;
    if (processedParts) return processedParts;
  }
  return [{ text: display, isTerm: false }];
};

/** Whether {@link splitSentenceAroundTerm} finds the term in the sentence. */
export const sentenceContainsTerm = (
  sentence: string,
  term: string,
  characterSubstitutions?: string | null
): boolean => splitSentenceAroundTerm(sentence, term, characterSubstitutions).some(part => part.isTerm);

export const parseCharacterSubstitutions = (
  str: string | null | undefined
): CharSubstitution[] => {
  if (!str || typeof str !== 'string') return [];
  return str
    .split('|')
    .map((pair): CharSubstitution | null => {
      const trimmed = pair;
      if (!trimmed.includes('=')) return null;
      const eqIndex = trimmed.indexOf('=');
      const oldStr = trimmed.slice(0, eqIndex);
      const newStr = trimmed.slice(eqIndex + 1);
      if (!oldStr) return null;
      return { old: oldStr, replacement: newStr };
    })
    .filter((sub): sub is CharSubstitution => sub !== null);
};

export const applyCharacterSubstitutions = (
  content: string,
  substitutions: CharSubstitution[]
): string => {
  if (!content || !Array.isArray(substitutions) || substitutions.length === 0) return content;
  let out = content;
  for (const sub of substitutions) {
    out = out.split(sub.old).join(sub.replacement);
  }
  return out;
};

const DEFAULT_WORD_CLASS = DEFAULT_LANGUAGE_WORD_CHARACTERS;

const wordRegexCache = new Map<string, RegExp>();

// Build a per-character matcher from the language's `wordCharacters`
// regex character-class fragment. The fragment may contain ranges
// (`a-z`), Unicode escapes (`\u200C`), and Unicode property classes
// (`\p{L}`). We use it as-is; no seed lists ASCII `'` or `-`, so the
// universal connector rule below adds glued apostrophe / hyphen /
// middle-dot behaviour on top of this regex.
export const buildCoreWordRegex = (wordCharacters: string | null | undefined): RegExp => {
  const raw = (wordCharacters || '').trim();
  const key = raw || '__default__';
  const cached = wordRegexCache.get(key);
  if (cached) return cached;

  const cls = raw || DEFAULT_WORD_CLASS;

  let regex: RegExp;
  try {
    regex = new RegExp(`^[${cls}]$`, 'u');
  } catch {
    // Invalid wordCharacters → fall back to Unicode letters and marks.
    regex = new RegExp(`^[${DEFAULT_WORD_CLASS}]$`, 'u');
  }
  wordRegexCache.set(key, regex);
  return regex;
};

const isCoreWordChar = (regex: RegExp, ch: string | undefined): boolean =>
  !!ch && regex.test(ch);

// A combining mark or format character (an emoji's variation selector, a
// zero-width joiner) may continue a word but never start one: on its own it
// would be an invisible clickable "word".
const MARK_OR_FORMAT = /[\p{M}\p{Cf}]/u;
const canStartWord = (regex: RegExp, ch: string | undefined): boolean =>
  isCoreWordChar(regex, ch) && !MARK_OR_FORMAT.test(ch as string);
const isConnector = (ch: string): boolean =>
  ch === APOSTROPHE || ch === HYPHEN || ch === MIDDLE_DOT;

/**
 * Normalize the input (soft hyphens, decomposed accents), apply
 * built-in + user character substitutions, and return the
 * processed text plus the precomputed core-word regex. Used by
 * `tokenizeContent` and by callers that walk content with their
 * own outer loop (e.g. the reader's phrase-aware renderer).
 */
export const prepareLanguageContext = (
  rawContent: string | null | undefined,
  languageConfig: LanguageConfig
): { processed: string; coreRegex: RegExp } => {
  const userSubs = parseCharacterSubstitutions(languageConfig?.characterSubstitutions);
  const processed = applyCharacterSubstitutions(
    applyCharacterSubstitutions(normalizeTokenizerInput(rawContent || ''), BUILT_IN_SUBSTITUTIONS),
    userSubs
  );
  const coreRegex = buildCoreWordRegex(languageConfig?.wordCharacters);
  return { processed, coreRegex };
};

/**
 * Try to consume a word starting at `index` in `processed`. Returns
 * `{ text, end }` if a word was consumed, otherwise `null`. Honors
 * the universal apostrophe / inter-letter hyphen connector rule.
 */
export const consumeWordAt = (
  processed: string,
  index: number,
  coreRegex: RegExp
): { text: string; end: number } | null => {
  if (!processed || index < 0 || index >= processed.length) return null;
  if (!canStartWord(coreRegex, processed[index])) return null;

  let i = index + 1;
  let word = processed[index];
  const len = processed.length;

  while (i < len) {
    const next = processed[i];
    if (isCoreWordChar(coreRegex, next)) {
      word += next;
      i++;
      continue;
    }
    if (
      isConnector(next) &&
      i + 1 < len &&
      isCoreWordChar(coreRegex, processed[i + 1])
    ) {
      word += next;
      i++;
      continue;
    }
    break;
  }
  return { text: word, end: i };
};

/**
 * Tokenize content into an ordered array of `{ type, text, start, end }`
 * segments. `start`/`end` are indices into the **substituted** text
 * (returned alongside as `processed`). Word tokens preserve casing.
 */
export const tokenizeContent = (
  rawContent: string | null | undefined,
  languageConfig: LanguageConfig = null
): { processed: string; tokens: ReaderToken[] } => {
  if (!rawContent) return { processed: '', tokens: [] };

  const { processed, coreRegex } = prepareLanguageContext(rawContent, languageConfig);
  const tokens: ReaderToken[] = [];
  let i = 0;
  const len = processed.length;

  while (i < len) {
    const word = consumeWordAt(processed, i, coreRegex);
    if (word) {
      tokens.push({ type: 'word', text: word.text, start: i, end: word.end });
      i = word.end;
    } else {
      tokens.push({ type: 'separator', text: processed[i], start: i, end: i + 1 });
      i++;
    }
  }

  return { processed, tokens };
};

/**
 * Extract just the word strings from content, using the canonical
 * language-aware tokenizer (`tokenizeContent`). This guarantees the
 * same set of words the reader renders as clickable — curly/modifier
 * apostrophes normalized to ASCII, per-language `wordCharacters`
 * honored, apostrophe/hyphen glue applied. Use this instead of an
 * ad-hoc regex so bulk operations (auto-translate, mark-known) match
 * the displayed tokens exactly.
 */
export const extractWords = (
  rawContent: string | null | undefined,
  languageConfig: LanguageConfig = null
): string[] =>
  tokenizeContent(rawContent, languageConfig).tokens
    .filter(t => t.type === 'word')
    .map(t => t.text);

// =====================================================================
// SENTENCE SPLITTING (Intl.Segmenter + sentenceSplitExceptions)
// =====================================================================

const SUPPORTED_INTL_SEGMENTER = ((): boolean => {
  try {
    return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
  } catch {
    return false;
  }
})();

const DEFAULT_SENTENCE_TERMINATORS = '.!?…';

const escapeForCharClass = (ch: string): string => ch.replace(/[\\\]^-]/g, (m) => `\\${m}`);

const fallbackRegexCache = new Map<string, RegExp>();

const buildFallbackSentenceRegex = (splitSentences: string | null | undefined): RegExp => {
  const raw = splitSentences && splitSentences.length > 0 ? splitSentences : DEFAULT_SENTENCE_TERMINATORS;
  // De-duplicate and always include `…` (single-glyph ellipsis) since
  // it doesn't appear in the canonical `.!?` config but Intl.Segmenter
  // treats it as a sentence ender.
  const chars = new Set(raw.split(''));
  chars.add('…');
  const cacheKey = [...chars].sort().join('');
  const cached = fallbackRegexCache.get(cacheKey);
  if (cached) return cached;

  const cls = [...chars].map(escapeForCharClass).join('');
  let regex: RegExp;
  try {
    regex = new RegExp(`[^${cls}]+(?:[${cls}]+(?:"|”|'|’)?|$)`, 'gu');
  } catch {
    regex = new RegExp(
      `[^${escapeForCharClass(DEFAULT_SENTENCE_TERMINATORS).split('').join('')}]+(?:[.!?…]+(?:"|”|'|’)?|$)`,
      'gu'
    );
  }
  fallbackRegexCache.set(cacheKey, regex);
  return regex;
};

const localeFromCode = (code: string | null | undefined): string | undefined => {
  if (!code || typeof code !== 'string') return undefined;
  return code.trim() || undefined;
};

const segmentSentencesIntl = (text: string, locale: string | undefined): string[] | null => {
  try {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
    const out: string[] = [];
    for (const seg of segmenter.segment(text)) {
      if (seg.segment) out.push(seg.segment);
    }
    return out;
  } catch {
    return null;
  }
};

const segmentSentencesRegex = (text: string, splitSentences: string | null | undefined): string[] => {
  const regex = buildFallbackSentenceRegex(splitSentences);
  return text.match(regex) || [text];
};

// Merge candidate sentences when a sentence ends with one of the
// language's `sentenceSplitExceptions` (e.g., "Dr.", "M."). Case-sensitive,
// matches the trailing punctuation as part of the exception string.
const applyExceptionMerging = (
  sentences: string[],
  exceptions: Array<string | { exceptionString?: string } | null> | null | undefined
): string[] => {
  if (!Array.isArray(exceptions) || exceptions.length === 0 || sentences.length < 2) {
    return sentences;
  }
  const exceptionList = exceptions
    .map((e) => (typeof e === 'string' ? e : e?.exceptionString || ''))
    .filter(Boolean);
  if (exceptionList.length === 0) return sentences;

  const merged: string[] = [];
  let i = 0;
  while (i < sentences.length) {
    let current = sentences[i];
    while (i + 1 < sentences.length) {
      const stripped = current.trimEnd();
      const matchesException = exceptionList.some((ex) => stripped.endsWith(ex));
      if (!matchesException) break;
      // Glue with next, preserving intervening whitespace as a single space.
      current = `${stripped} ${sentences[i + 1].trimStart()}`;
      i++;
    }
    merged.push(current);
    i++;
  }
  return merged;
};

const splitBlockIntoSentences = (
  blockText: string,
  languageConfig: LanguageConfig,
  languageCode: string | null | undefined
): string[] => {
  if (!blockText) return [];
  const locale = localeFromCode(languageCode);
  const intlResult = SUPPORTED_INTL_SEGMENTER ? segmentSentencesIntl(blockText, locale) : null;
  const candidates =
    intlResult && intlResult.length > 0
      ? intlResult
      : segmentSentencesRegex(blockText, languageConfig?.splitSentences);
  const merged = applyExceptionMerging(candidates, languageConfig?.sentenceSplitExceptions);
  // Segment text leaves the reader as a mined sentence, a translation or
  // explanation request and TTS input, so drop soft hyphens and compose
  // accents here too (display is unaffected: the renderer normalizes anyway).
  // Normalize after the emptiness filter: bookmarks and reading progress are
  // keyed by sentence index, so the segment count must not change.
  return merged
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(normalizeTokenizerInput);
};

export const splitTextIntoSentenceSegments = (
  content: string | null | undefined,
  structuredContent: StructuredBlock[] = [],
  languageConfig: LanguageConfig = null,
  languageCode: string | null | undefined = null
): ReaderSegment[] => {
  if (!content && (!Array.isArray(structuredContent) || structuredContent.length === 0)) return [];

  const segments: ReaderSegment[] = [];
  let pendingMediaBlocks: DisplayBlock[] = [];

  buildDisplayBlocks(content, structuredContent).forEach((block) => {
    if (block.type === 'image') {
      pendingMediaBlocks.push(block);
      return;
    }

    if (block.isTitleBlock) {
      const titleSegmentText = block.lines.join('\n').trim();
      if (titleSegmentText) {
        segments.push({
          index: segments.length,
          text: normalizeTokenizerInput(titleSegmentText),
          type: 'title',
          mediaBlocks: pendingMediaBlocks
        });
        pendingMediaBlocks = [];
      }
      return;
    }

    const sentences = splitBlockIntoSentences(block.text, languageConfig, languageCode);
    sentences.forEach((sentence, sentenceIndex) => {
      segments.push({
        index: segments.length,
        text: sentence,
        type: 'sentence',
        mediaBlocks: sentenceIndex === 0 ? pendingMediaBlocks : []
      });
    });

    pendingMediaBlocks = [];
  });

  if (pendingMediaBlocks.length > 0 && segments.length > 0) {
    const lastSegment = segments[segments.length - 1];
    lastSegment.mediaBlocks = [...(lastSegment.mediaBlocks || []), ...pendingMediaBlocks];
  }

  return segments;
};

// Word-character pattern used by the reader's tokenizer (legacy export).
// Kept for backwards compatibility with the old per-character matcher.
// New code should use `tokenizeContent(text, languageConfig)`.
// Matches Unicode letters plus ASCII apostrophe ('), typographic right single quote (U+2019),
// and modifier letter apostrophe (U+02BC) — common in copy-pasted ebook/news text.
export const WORD_PATTERN = /\p{L}|['’ʼ]/u;

// =====================================================================
// SELECTION SNAPPING, PUNCTUATION CLEANING & PHRASE EXTENSION
// =====================================================================

export type PhraseSelectionState = {
  words: string[];
  separators: string[];
  startIndex: number;
  endIndex: number;
  sentenceContext: string;
  spans?: HTMLElement[];
};

const EXTRA_SENTENCE_STOP_CHARS = '।۔。！？\n\r';

/**
 * Punctuation characters that must NEVER be considered sentence stops even if present
 * in languageConfig.splitSentences (e.g. commas, colons, semicolons, dashes, quotes).
 */
export const FORBIDDEN_SENTENCE_STOP_CHARS = new Set([
  ',', ';', ':', '-', '—', '–', '/', '\\', '(', ')', '[', ']', '{', '}',
  '"', "'", '«', '»', '“', '”', '‘', '’', '`', '*', '&', '%', '$', '@', '#'
]);

/**
 * Common abbreviations across supported European languages whose trailing period
 * should NOT be treated as a sentence boundary.
 */
export const COMMON_ABBREVIATIONS = new Set([
  // English titles & honorifics
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'rev', 'st', 'fr', 'gen', 'gov', 'sgt', 'capt', 'col', 'rep', 'sen', 'pres',
  // Common Latin / English abbreviations
  'etc', 'eg', 'e.g', 'ie', 'i.e', 'vs', 'v', 'no', 'vol', 'pp', 'p', 'al', 'approx', 'dept', 'est', 'inc', 'ltd', 'corp', 'co', 'min', 'sec', 'hr', 'hrs',
  'am', 'pm', 'a.m', 'p.m', 'bc', 'ad', 'bce', 'ce', 'phd', 'ba', 'ma', 'bs', 'ms',
  // Spanish & Portuguese
  'sra', 'srta', 'dra', 'profa', 'pag', 'pags', 'pág', 'págs', 'ej', 'num', 'núm', 'art', 'cap', 'atte', 'cia', 'dona', 'don', 'eng', 'engª',
  // French
  'm', 'mme', 'mlle', 'monsieur', 'madame', 'mademoiselle', 'ste', 'cie',
  // German
  'hr', 'fr', 'bzw', 'usw', 'ca', 'evtl', 'incl', 'inkl', 'zb', 'z.b', 'dh', 'd.h', 'ua', 'u.a', 'nr', 'abs', 'vgl', 'str',
  // Polish & Slavic
  'np', 'tzn', 'itd', 'itp', 'ul', 'godz', 'os', 'red', 'hab', 'mgr', 'inż'
]);

export const isAbbreviationOrNonSentencePeriod = (
  precedingWord: string | null | undefined,
  separatorText: string = '',
  followingWord: string = '',
  languageConfig: LanguageConfig = null
): boolean => {
  if (!precedingWord) return false;
  const wordClean = precedingWord.trim();
  if (!wordClean) return false;
  const wordLower = wordClean.toLowerCase();
  const wordWithoutDots = wordLower.replace(/\./g, '');

  // 1. Language-configured sentenceSplitExceptions
  const exceptions = languageConfig?.sentenceSplitExceptions;
  if (exceptions) {
    const rawList = typeof exceptions === 'string'
      ? (exceptions as string).split('|')
      : Array.isArray(exceptions)
        ? exceptions
        : [];
    const exceptionList = rawList
      .map((e) => (typeof e === 'string' ? e.trim() : e?.exceptionString?.trim() || ''))
      .filter(Boolean);
    if (exceptionList.length > 0) {
      const combined = `${wordClean}${separatorText.trimEnd()}`;
      if (exceptionList.some((ex) => combined.endsWith(ex) || ex.toLowerCase() === `${wordLower}.`)) {
        return true;
      }
    }
  }

  // 2. Built-in common abbreviations
  if (COMMON_ABBREVIATIONS.has(wordLower) || COMMON_ABBREVIATIONS.has(wordWithoutDots)) {
    return true;
  }

  // 3. Single-letter initial (e.g. "J." in "J. K. Rowling" or "A." in "A. Smith")
  if (/^\p{Lu}$/u.test(wordClean)) {
    // English pronoun "I" at the end of a sentence (or before a sentence-starter) is not an initial
    if (wordClean === 'I') {
      const COMMON_SENTENCE_STARTERS = new Set([
        'the', 'this', 'that', 'these', 'those', 'there', 'he', 'she', 'it', 'they', 'we', 'you',
        'then', 'when', 'what', 'where', 'why', 'how', 'who', 'but', 'and', 'so', 'if', 'as'
      ]);
      const nextLower = followingWord.trim().toLowerCase();
      if (!followingWord || COMMON_SENTENCE_STARTERS.has(nextLower)) {
        return false;
      }
    }
    return true;
  }

  // 4. Dotted acronym / abbreviation (e.g. "U.S.", "e.g.", "Ph.D.", "a.m.")
  if (/^(\p{L}\.){1,}\p{L}?$/u.test(wordClean)) {
    return true;
  }

  // 5. Number / decimal (e.g. "3.14", "1.5")
  if (/\d$/.test(wordClean) && (/^\d/.test(followingWord) || !separatorText.includes(' '))) {
    return true;
  }

  // 6. Lowercase continuation: if the following word starts with a lowercase letter,
  // it is almost certainly a continuation of the same sentence (e.g. "etc. and so on", "example.com")
  if (followingWord && /^\p{Ll}/u.test(followingWord.trim())) {
    return true;
  }

  return false;
};

const buildSentenceStopSet = (
  splitSentences: string | null | undefined,
  languageConfig?: LanguageConfig
): Set<string> => {
  const raw = splitSentences && splitSentences.length > 0 ? splitSentences : DEFAULT_SENTENCE_TERMINATORS;
  const chars = (raw + DEFAULT_SENTENCE_TERMINATORS + EXTRA_SENTENCE_STOP_CHARS).split('');
  const stopSet = new Set<string>();
  const lang = (languageConfig?.languageCode || languageConfig?.code || '').toLowerCase();
  const isGreek = lang === 'el' || lang === 'gr';
  for (const ch of chars) {
    if (isGreek && (ch === ';' || ch === '\u037E')) {
      stopSet.add(ch);
      continue;
    }
    if (!FORBIDDEN_SENTENCE_STOP_CHARS.has(ch)) {
      stopSet.add(ch);
    }
  }
  return stopSet;
};

export const hasSentenceStopBetween = (
  separatorText: string | null | undefined,
  languageConfig: LanguageConfig = null,
  precedingWord: string = '',
  followingWord: string = ''
): boolean => {
  if (!separatorText) return false;
  const stopChars = buildSentenceStopSet(languageConfig?.splitSentences, languageConfig);
  let foundStop = false;
  let hasPeriod = false;
  for (const ch of separatorText) {
    if (ch === '.') {
      hasPeriod = true;
    }
    if (stopChars.has(ch)) {
      foundStop = true;
    }
  }
  if (!foundStop) return false;

  // If a period is present, check whether it is an abbreviation, initial, or decimal rather than a sentence stop
  if (hasPeriod && precedingWord) {
    if (isAbbreviationOrNonSentencePeriod(precedingWord, separatorText, followingWord, languageConfig)) {
      // Check if there are other true sentence stops in the separator (e.g. '!' or '?')
      const hasOtherStop = separatorText.split('').some((ch) => ch !== '.' && stopChars.has(ch));
      if (!hasOtherStop) {
        return false;
      }
    }
  }

  return true;
};

/**
 * Clean a raw reader selection string:
 * - Strips leading and trailing non-word characters (punctuation, quotes, stops, whitespace).
 * - Clamps at sentence stops (`.`, `!`, `?`, `…`, etc.) so selections do not
 *   include sentence-ending stops or spill across sentence boundaries.
 * - Preserves internal word connectors (apostrophes, hyphens) and intra-sentence
 *   separators (spaces, commas, colons, semicolons, etc.) between words in the same sentence.
 */
export const cleanSelectedReaderText = (
  rawContent: string | null | undefined,
  languageConfig: LanguageConfig = null
): string => {
  if (!rawContent) return '';
  const { processed, tokens } = tokenizeContent(rawContent, languageConfig);
  const wordTokens = tokens.filter((t) => t.type === 'word');
  if (wordTokens.length === 0) return '';

  const segments: ReaderToken[][] = [[wordTokens[0]]];
  let separatorBuffer = '';
  let seenFirstWord = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === 'word') {
      if (!seenFirstWord) {
        seenFirstWord = true;
        separatorBuffer = '';
        continue;
      }
      const currentSegment = segments[segments.length - 1];
      const prevWord = currentSegment[currentSegment.length - 1];
      const followingWord = token.text;
      if (hasSentenceStopBetween(separatorBuffer, languageConfig, prevWord.text, followingWord)) {
        segments.push([token]);
      } else {
        currentSegment.push(token);
      }
      separatorBuffer = '';
    } else if (seenFirstWord) {
      separatorBuffer += token.text;
    }
  }

  let bestSegment = segments[0];
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].length > bestSegment.length) {
      bestSegment = segments[i];
    }
  }

  const firstWord = bestSegment[0];
  const lastWord = bestSegment[bestSegment.length - 1];

  return processed
    .slice(firstWord.start, lastWord.end)
    .replace(/\s+/g, ' ')
    .trim();
};

const PARAGRAPH_OR_LINE_BLOCK_SELECTOR =
  '.srt-line, .reader-title-line, .sentence-mode-text, .reading-block, .reader-paragraph, p';

export const getTextBetweenWordSpans = (
  prevSpan: HTMLElement,
  nextSpan: HTMLElement
): string => {
  try {
    const betweenRange = document.createRange();
    betweenRange.setStartAfter(prevSpan);
    betweenRange.setEndBefore(nextSpan);
    return betweenRange.toString();
  } catch {
    return ' ';
  }
};

export const areWordSpansInSameSentence = (
  prevSpan: HTMLElement,
  nextSpan: HTMLElement,
  languageConfig: LanguageConfig = null
): boolean => {
  if (!prevSpan || !nextSpan) return false;
  if (prevSpan === nextSpan) return true;
  if (prevSpan.compareDocumentPosition(nextSpan) & Node.DOCUMENT_POSITION_PRECEDING) {
    return areWordSpansInSameSentence(nextSpan, prevSpan, languageConfig);
  }
  const blockA = prevSpan.closest(PARAGRAPH_OR_LINE_BLOCK_SELECTOR);
  const blockB = nextSpan.closest(PARAGRAPH_OR_LINE_BLOCK_SELECTOR);
  if (blockA && blockB && blockA !== blockB) {
    return false;
  }
  const betweenText = getTextBetweenWordSpans(prevSpan, nextSpan);
  const prevWord = (prevSpan.textContent || '').trim();
  const nextWord = (nextSpan.textContent || '').trim();
  if (hasSentenceStopBetween(betweenText, languageConfig, prevWord, nextWord)) {
    return false;
  }
  return true;
};

export const splitWordSpansBySentence = (
  spans: HTMLElement[],
  languageConfig: LanguageConfig = null
): HTMLElement[][] => {
  if (spans.length === 0) return [];
  const groups: HTMLElement[][] = [[spans[0]]];
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const curr = spans[i];
    if (areWordSpansInSameSentence(prev, curr, languageConfig)) {
      groups[groups.length - 1].push(curr);
    } else {
      groups.push([curr]);
    }
  }
  return groups;
};

export const getOverlappedWordSpans = (
  range: Range,
  container: HTMLElement
): HTMLElement[] => {
  if (
    !range ||
    !container ||
    typeof range.compareBoundaryPoints !== 'function' ||
    !range.startContainer ||
    !range.endContainer ||
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return [];
  }

  const candidates = container.querySelectorAll<HTMLElement>('.clickable-word');
  if (candidates.length === 0) return [];

  const wordRange = document.createRange();
  const overlapped: HTMLElement[] = [];

  candidates.forEach((wordEl) => {
    try {
      wordRange.selectNodeContents(wordEl);
      if (
        range.compareBoundaryPoints(Range.END_TO_START, wordRange) < 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, wordRange) > 0
      ) {
        overlapped.push(wordEl);
      }
    } catch {
      // Ignore comparison errors for detached/unselectable nodes
    }
  });

  return overlapped;
};

export const clampWordSpansToSingleSentence = (
  overlappedSpans: HTMLElement[],
  languageConfig: LanguageConfig = null,
  options: { anchorNode?: Node | null; initialTextHint?: string } = {}
): HTMLElement[] => {
  const groups = splitWordSpansBySentence(overlappedSpans, languageConfig);
  if (groups.length <= 1) return groups[0] || [];

  const { anchorNode, initialTextHint } = options;
  const normalizedHint = cleanSelectedReaderText(initialTextHint || '', languageConfig).toLowerCase();

  if (normalizedHint) {
    const hintGroup = groups.find((group) =>
      group.some((span) => (span.textContent || '').trim().toLowerCase() === normalizedHint)
    );
    if (hintGroup) return hintGroup;
  }

  if (anchorNode) {
    const anchorGroup = groups.find((group) =>
      group.some((span) => span === anchorNode || span.contains(anchorNode))
    );
    if (anchorGroup) return anchorGroup;

    const anchorEl =
      anchorNode.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as HTMLElement)
        : anchorNode.parentElement;
    const anchorSentence = anchorEl?.closest('.sentence');
    if (anchorSentence) {
      const sentenceGroup = groups.find(
        (group) => group[0]?.closest('.sentence') === anchorSentence
      );
      if (sentenceGroup) return sentenceGroup;
    }
  }

  return groups[0];
};

export const buildPhraseSelectionFromSpans = (
  startSpan: HTMLElement,
  endSpan: HTMLElement,
  container: HTMLElement | null,
  languageConfig: LanguageConfig = null,
  sentenceContext: string = ''
): PhraseSelectionState | null => {
  const scopeEl =
    startSpan.closest(PARAGRAPH_OR_LINE_BLOCK_SELECTOR) ||
    container ||
    startSpan.parentElement;
  if (!scopeEl) return null;

  const allSpans = Array.from(scopeEl.querySelectorAll<HTMLElement>('.clickable-word'));
  if (allSpans.length === 0) return null;

  const sentenceGroups = splitWordSpansBySentence(allSpans, languageConfig);
  const sentenceSpans =
    sentenceGroups.find((group) => group.includes(startSpan)) ||
    sentenceGroups.find((group) => group.includes(endSpan));
  if (!sentenceSpans || sentenceSpans.length === 0) return null;

  const rawStartIdx = sentenceSpans.indexOf(startSpan);
  const rawEndIdx = sentenceSpans.indexOf(endSpan);
  if (rawStartIdx === -1 && rawEndIdx === -1) return null;

  const startIndex = rawStartIdx !== -1 ? rawStartIdx : rawEndIdx;
  const endIndex = rawEndIdx !== -1 ? Math.max(startIndex, rawEndIdx) : startIndex;

  const words = sentenceSpans.map((span) => (span.textContent || '').trim());
  const separators: string[] = [];
  for (let i = 0; i < sentenceSpans.length - 1; i++) {
    separators.push(getTextBetweenWordSpans(sentenceSpans[i], sentenceSpans[i + 1]));
  }

  return {
    words,
    separators,
    startIndex,
    endIndex,
    sentenceContext,
    spans: sentenceSpans
  };
};

export const buildPhraseSelectionFromText = (
  selectedText: string,
  sentenceContext: string,
  languageConfig: LanguageConfig = null
): PhraseSelectionState | null => {
  const cleanSelected = cleanSelectedReaderText(selectedText, languageConfig);
  if (!cleanSelected || !sentenceContext) return null;

  const { tokens: selectedTokens } = tokenizeContent(cleanSelected, languageConfig);
  const selectedWords = selectedTokens.filter((t) => t.type === 'word').map((t) => t.text);
  if (selectedWords.length === 0) return null;

  const { tokens: contextTokens } = tokenizeContent(sentenceContext, languageConfig);
  const sentenceWordGroups: { words: string[]; separators: string[] }[] = [];
  let currentWords: string[] = [];
  let currentSeparators: string[] = [];
  let sepBuffer = '';

  for (const token of contextTokens) {
    if (token.type === 'separator') {
      if (currentWords.length > 0) {
        sepBuffer += token.text;
      }
    } else if (token.type === 'word') {
      if (
        currentWords.length > 0 &&
        hasSentenceStopBetween(sepBuffer, languageConfig, currentWords[currentWords.length - 1], token.text)
      ) {
        sentenceWordGroups.push({ words: currentWords, separators: currentSeparators });
        currentWords = [token.text];
        currentSeparators = [];
      } else {
        if (currentWords.length > 0) {
          currentSeparators.push(sepBuffer);
        }
        currentWords.push(token.text);
      }
      sepBuffer = '';
    }
  }
  if (currentWords.length > 0) {
    sentenceWordGroups.push({ words: currentWords, separators: currentSeparators });
  }

  for (const group of sentenceWordGroups) {
    const { words, separators } = group;
    for (let i = 0; i <= words.length - selectedWords.length; i++) {
      let matches = true;
      for (let j = 0; j < selectedWords.length; j++) {
        if (words[i + j].toLowerCase() !== selectedWords[j].toLowerCase()) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return {
          words,
          separators,
          startIndex: i,
          endIndex: i + selectedWords.length - 1,
          sentenceContext
        };
      }
    }
  }

  return null;
};

export const buildPhraseSelectionText = (
  state: PhraseSelectionState,
  languageConfig: LanguageConfig = null
): string => {
  if (!state || state.words.length === 0) return '';
  const start = Math.max(0, Math.min(state.startIndex, state.words.length - 1));
  const end = Math.max(start, Math.min(state.endIndex, state.words.length - 1));
  let combined = state.words[start];
  for (let i = start; i < end; i++) {
    combined += (state.separators[i] ?? ' ') + state.words[i + 1];
  }
  return cleanSelectedReaderText(combined, languageConfig) || combined.replace(/\s+/g, ' ').trim();
};

export const styles: Record<string, React.CSSProperties> = {
  highlightedWord: {
    cursor: 'pointer',
    padding: '0 2px',
    margin: '0 1px',
    borderRadius: '3px',
    transition: 'all 0.2s ease',
    userSelect: 'text',
    WebkitUserSelect: 'text',
    WebkitTouchCallout: 'default'
  },
  wordStatus1: { color: '#000', backgroundColor: '#ff6666' },
  wordStatus2: { color: '#000', backgroundColor: '#ff9933' },
  wordStatus3: { color: '#000', backgroundColor: '#ffdd66' },
  wordStatus4: { color: '#000', backgroundColor: '#99dd66' },
  wordStatus5: { color: 'inherit', backgroundColor: 'transparent' },
  selectedSentence: {
    backgroundColor: 'rgba(0, 123, 255, 0.1)',
    padding: '0.25rem',
    borderRadius: '0.25rem',
    border: '1px dashed rgba(0, 123, 255, 0.5)'
  },
  untrackedWord: { cursor: 'pointer', color: '#007bff', textDecoration: 'underline' },
  textContainer: {
    height: 'calc(100vh - 120px)',
    overflowY: 'auto',
    padding: '15px',
    borderRight: '1px solid #eee'
  },
  translationPanel: { height: 'calc(100vh - 120px)', padding: '15px' },
  wordPanel: { marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' },
  modalHeader: { backgroundColor: '#f8f9fa', borderBottom: '1px solid #dee2e6' }
};
