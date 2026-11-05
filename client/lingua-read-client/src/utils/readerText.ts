import { findKoreanLookupMatches, isKoreanLanguageCode } from './koreanLookup';
import { CHINESE_SEGMENTER_PROFILE, isChineseHanAt, findChineseHanRunEnd } from './chineseSegmenter';
import { getChineseSegmentation } from './chineseRuntime';
import { JAPANESE_SEGMENTER_PROFILE, isJapaneseScriptAt, findJapaneseRunEnd, segmentJapaneseRun } from './japaneseSegmenter';
import { THAI_SEGMENTER_PROFILE, isThaiAt, findThaiRunEnd, isThaiDigit } from './thaiSegmenter';
import { getThaiSegmentation } from './thaiRuntime';
export type LanguageConfig = {
  wordCharacters?: string | null;
  characterSubstitutions?: string | null;
  parserType?: string | null;
  splitSentences?: string | null;
  sentenceSplitExceptions?: Array<string | { exceptionString?: string } | null> | null;
  languageCode?: string | null;
  code?: string | null;
  rightToLeft?: boolean;
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
// Legacy mecab/jieba keep their boundaries. Explicit jieba-v1 text profiles
// use the pinned Chinese dictionary after its offline-capable loader completes.
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
const NORMALIZED_SENTENCE_MATCH_LANGUAGES = new Set([
  'ar', 'fa', 'ur', 'he', 'iw', 'ru', 'uk', 'lt', 'tr', 'az', 'el', 'fr', 'it', 'ca', 'af', 'nl'
]);

const splitTokenMatches = (
  display: string,
  needle: string,
  languageCode: string
): { text: string; isTerm: boolean }[] | null => {
  const needleTokens = tokenizeContent(needle, { code: languageCode }).tokens.filter(t => t.type === 'word');
  if (needleTokens.length === 0) return null;

  const sentenceWords = tokenizeContent(display, { code: languageCode }).tokens.filter(t => t.type === 'word');
  if (sentenceWords.length === 0) return null;

  const spans: { start: number; end: number }[] = [];

  if (needleTokens.length === 1) {
    const needleKey = lowercaseLookupTerm(needle, languageCode);
    const singleTokenKey = lowercaseLookupTerm(needleTokens[0].text, languageCode);
    if (!needleKey || needleKey !== singleTokenKey) return null;
    const needleFolded = foldLookupTerm(needle, languageCode);

    for (const word of sentenceWords) {
      const candidates = getLookupCandidates(word.text, languageCode);
      if (candidates.includes(needleKey) || (needleFolded && candidates.includes(needleFolded))) {
        spans.push({ start: word.start, end: word.end });
      }
    }
  } else {
    const leadingExtra = needle.slice(0, needleTokens[0].start);
    const trailingExtra = needle.slice(needleTokens[needleTokens.length - 1].end);
    if (
      lowercaseLookupTerm(leadingExtra, languageCode) !== '' ||
      lowercaseLookupTerm(trailingExtra, languageCode) !== ''
    ) {
      return null;
    }

    const needleKeys = needleTokens.map(t => lowercaseLookupTerm(t.text, languageCode));
    const needleFoldedKeys = needleTokens.map(t => foldLookupTerm(t.text, languageCode));
    const needleSeps: string[] = [];
    for (let j = 1; j < needleTokens.length; j++) {
      needleSeps.push(needle.slice(needleTokens[j - 1].end, needleTokens[j].start));
    }

    const k = needleTokens.length;
    for (let i = 0; i <= sentenceWords.length - k; i++) {
      let matched = true;
      for (let j = 0; j < k; j++) {
        const word = sentenceWords[i + j];
        const wordKey = lowercaseLookupTerm(word.text, languageCode);
        const wordFolded = foldLookupTerm(word.text, languageCode);
        if (wordKey !== needleKeys[j] && wordFolded !== needleFoldedKeys[j]) {
          matched = false;
          break;
        }
        if (j > 0) {
          const prevWord = sentenceWords[i + j - 1];
          const displaySep = display.slice(prevWord.end, word.start);
          const expectedSep = needleSeps[j - 1];
          const bothWhitespace = displaySep.trim() === '' && expectedSep.trim() === '';
          if (
            !bothWhitespace &&
            displaySep.replace(/\s+/g, ' ').trim().toLowerCase() !==
              expectedSep.replace(/\s+/g, ' ').trim().toLowerCase()
          ) {
            matched = false;
            break;
          }
        }
      }
      if (matched) {
        spans.push({ start: sentenceWords[i].start, end: sentenceWords[i + k - 1].end });
        i += k - 1;
      }
    }
  }

  if (spans.length === 0) return null;
  const result: { text: string; isTerm: boolean }[] = [];
  let previous = 0;
  for (const span of spans) {
    if (span.start > previous) result.push({ text: display.slice(previous, span.start), isTerm: false });
    result.push({ text: display.slice(span.start, span.end), isTerm: true });
    previous = span.end;
  }
  if (previous < display.length) result.push({ text: display.slice(previous), isTerm: false });
  return result;
};

export const splitSentenceAroundTerm = (
  sentence: string,
  term: string,
  characterSubstitutions?: string | null,
  languageCode?: string | null
): { text: string; isTerm: boolean }[] => {
  const display = normalizeTokenizerInput(sentence || '');
  const needle = applyCharacterSubstitutions(normalizeTokenizerInput(term || ''), BUILT_IN_SUBSTITUTIONS).trim();
  if (!display) return [];
  if (!needle) return [{ text: display, isTerm: false }];

  const haystack = applyCharacterSubstitutions(display, BUILT_IN_SUBSTITUTIONS);
  if (isKoreanLanguageCode(languageCode)) {
    const spans = findKoreanLookupMatches(haystack, needle);
    if (spans.length) {
      const result: { text: string; isTerm: boolean }[] = [];
      let previous = 0;
      for (const span of spans) {
        if (span.start > previous) result.push({ text: display.slice(previous, span.start), isTerm: false });
        result.push({ text: display.slice(span.start, span.end), isTerm: true });
        previous = span.end;
      }
      if (previous < display.length) result.push({ text: display.slice(previous), isTerm: false });
      return result;
    }
  }

  const baseLang = (languageCode || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (languageCode && NORMALIZED_SENTENCE_MATCH_LANGUAGES.has(baseLang)) {
    const tokenParts = splitTokenMatches(display, needle, languageCode);
    if (tokenParts) return tokenParts;
  }

  const parts = splitAtMatches(display, haystack, needle);
  if (parts) return parts;
  const userSubs = parseCharacterSubstitutions(characterSubstitutions);
  if (userSubs.length > 0) {
    const processed = applyCharacterSubstitutions(haystack, userSubs);
    const processedNeedle = applyCharacterSubstitutions(needle, userSubs).trim();
    if (processedNeedle) {
      if (languageCode && NORMALIZED_SENTENCE_MATCH_LANGUAGES.has(baseLang)) {
        const processedTokenParts = splitTokenMatches(processed, processedNeedle, languageCode);
        if (processedTokenParts) return processedTokenParts;
      }
      const processedParts = splitAtMatches(processed, processed, processedNeedle);
      if (processedParts) return processedParts;
    }
  }
  return [{ text: display, isTerm: false }];
};

/** Whether {@link splitSentenceAroundTerm} finds the term in the sentence. */
export const sentenceContainsTerm = (
  sentence: string,
  term: string,
  characterSubstitutions?: string | null,
  languageCode?: string | null
): boolean => splitSentenceAroundTerm(sentence, term, characterSubstitutions, languageCode).some(part => part.isTerm);

/** Choose context for the saved selection, rather than an unrelated sentence the reader has advanced to. */
export const pickSentenceForTerm = (
  term: string,
  candidates: Array<string | null | undefined>,
  characterSubstitutions?: string | null,
  languageCode?: string | null
): string | null => candidates.find(sentence => sentence && sentenceContainsTerm(sentence, term, characterSubstitutions, languageCode)) ?? null;

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

/**
 * Match the server's existing Turkish casing for reader vocabulary probes.
 * Other languages keep their current behavior until the versioned key migration
 * exists; this is not a universal Unicode normalization/case-folding contract.
 * Both inputs are already display tokens or stored terms, so do not alter spelling.
 */
// eslint-disable-next-line no-misleading-character-class
const ARABIC_DIACRITICS_REGEX = /[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const HEBREW_DIACRITICS_REGEX = /[\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/g;
const CYRILLIC_STRESS_REGEX = /\u0301/g;
const LITHUANIAN_ACCENTS_REGEX = /[\u0300\u0301\u0303]/g;
const NORMALIZED_VOCABULARY_LANGUAGES = new Set(['tr', 'az', 'el', 'he', 'iw', 'ar', 'fa']);

/**
 * Strip language-specific diacritics, cantillation, or tatweel for dictionary lookup:
 * - Arabic (ar), Persian (fa), Urdu (ur): Tatweel (\u0640) and Tashkeel/Harakat/Quranic marks [\u064B-\u065F\u0670].
 * - Hebrew (he): Niqqud and cantillation [\u0591-\u05BD\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7].
 * - Russian (ru) and Ukrainian (uk): combining acute stress mark \u0301.
 * - Lithuanian (lt): combining accents [\u0300\u0301\u0303].
 */
export const stripLookupDiacritics = (text: string, languageCode?: string | null): string => {
  if (!text || !languageCode) return text || '';
  const base = languageCode.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  const lang = base === 'iw' ? 'he' : base;
  switch (lang) {
    case 'ar':
    case 'fa':
      return text.replace(ARABIC_DIACRITICS_REGEX, '')
        .replace(lang === 'fa' ? /ي/g : /ی/g, lang === 'fa' ? 'ی' : 'ي')
        .replace(lang === 'fa' ? /ك/g : /ک/g, lang === 'fa' ? 'ک' : 'ك');
    case 'ur':
      return text.replace(ARABIC_DIACRITICS_REGEX, '');
    case 'he':
      return text.replace(HEBREW_DIACRITICS_REGEX, '').replace(/^["'״׳]+/, '').replace(/["״]+$/, '')
        .replace(/"/g, '״').replace(/'/g, '׳');
    case 'ru':
    case 'uk':
      return text.replace(CYRILLIC_STRESS_REGEX, '');
    case 'lt':
      return text.replace(LITHUANIAN_ACCENTS_REGEX, '');
    default:
      return text;
  }
};

const GREEK_LETTER_CHECK = /\p{L}/u;

const normalizeGreekSigma = (value: string): string => {
  if (!value) return value;
  const chars = Array.from(value);
  let mutated = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === 'σ' && i > 0 && GREEK_LETTER_CHECK.test(chars[i - 1]) &&
        (i + 1 === chars.length || !GREEK_LETTER_CHECK.test(chars[i + 1]))) {
      chars[i] = 'ς';
      mutated = true;
    } else if (ch === 'ς' && i + 1 < chars.length && GREEK_LETTER_CHECK.test(chars[i + 1])) {
      chars[i] = 'σ';
      mutated = true;
    }
  }
  return mutated ? chars.join('') : value;
};

export const lowercaseLookupTerm = (term: string, languageCode?: string | null): string => {
  const base = (languageCode || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  const scoped = NORMALIZED_VOCABULARY_LANGUAGES.has(base);
  const isRomanceElision = base === 'fr' || base === 'it' || base === 'ca';
  const input = scoped || isRomanceElision || base === 'af' || base === 'nl'
    ? applyCharacterSubstitutions(normalizeTokenizerInput(term || ''), BUILT_IN_SUBSTITUTIONS)
    : term || '';
  const clean = input.trim().replace(/^[\u200C\u200D]+|[\u200C\u200D]+$/g, '');
  const stripped = stripLookupDiacritics(clean, languageCode);
  if (isRomanceElision) {
    // Match the server's existing TextInfo simple casing, including
    // dotted I and non-contextual sigma, without changing other languages.
    return Array.from(stripped, ch => ch === 'İ' ? 'i' : ch.toLowerCase()).join('');
  }
  if (scoped) {
    // Iterate Unicode scalars so supplementary letters fold without changing
    // UTF-16 indexing. Simple casing matches the backend's explicit table.
    const lowered = Array.from(stripped, ch => ch === 'İ' ? 'i'
      : ch === 'I' ? (base === 'tr' || base === 'az' ? 'ı' : 'i') : ch.toLowerCase()).join('');
    return base === 'el' ? normalizeGreekSigma(lowered) : lowered;
  }
  return stripped.toLowerCase();
};

const foldNormalizedKey = (key: string, code: string): string => {
  if (code === 'ar' || code === 'fa') {
    return key.replace(/[أإآٱ]/g, 'ا');
  }
  if (code === 'el') {
    return key.normalize('NFD').replace(/[\u0300\u0301\u0342]/g, '').normalize('NFC').replace(/ς/g, 'σ');
  }
  return key;
};

/**
 * Secondary diacritic/sigma/hamza-folded lookup key for matching legacy v4 stored
 * headwords or unaccented all-caps input against canonical v5 headwords.
 */
export const foldLookupTerm = (term: string, languageCode?: string | null): string => {
  const key = lowercaseLookupTerm(term, languageCode);
  const base = (languageCode || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  const code = base === 'iw' ? 'he' : base;
  return foldNormalizedKey(key, code);
};

/**
 * True when `term` contains at least one decimal digit and no letters
 * (e.g. "2026", "2 000", "12,5", "25.000,-", but not "2026-ban" or "10%-os").
 */
export const isPureNumericToken = (term: string | null | undefined): boolean =>
  !!term && /\p{Nd}/u.test(term) && !/\p{L}/u.test(term);

const isElisionRemainder = (remainder: string): boolean =>
  /^\p{L}[\p{L}\p{M}]*$/u.test(remainder) &&
  Array.from(remainder).filter(ch => /\p{L}/u.test(ch)).length >= 2;

const catalanEnclitics = [
  "-nos", "-vos", "-los", "-les", "-me", "-te", "-se", "-ne", "-en", "-hi", "-ho", "-li", "-la", "-el",
  "'ns", "'us", "'ls", "'m", "'t", "'s", "'l", "'n"
];

const isCatalanRemainder = (s: string): boolean => {
  const letters = Array.from(s).filter(ch => /\p{L}/u.test(ch)).length;
  return letters >= 2 && /\p{L}$/u.test(s);
};

const peelCatalanEnclitics = (start: string, seen: Set<string>, result: string[]): void => {
  let s = start;
  for (let depth = 0; depth < 3; depth++) {
    let matched = false;
    for (const suffix of catalanEnclitics) {
      if (s.endsWith(suffix) && s.length > suffix.length) {
        s = s.slice(0, -suffix.length);
        matched = true;
        if (isCatalanRemainder(s) && !seen.has(s)) {
          seen.add(s);
          result.push(s);
        }
        break;
      }
    }
    if (!matched) break;
  }
};

/** Direct key first. Fallbacks are useful only when a vocabulary/dictionary validates them. */
export const getLookupCandidates = (term: string, languageCode?: string | null): string[] => {
  const key = lowercaseLookupTerm(term, languageCode);
  const base = (languageCode || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  const code = base === 'iw' ? 'he' : base;
  const result = [key];
  const seen = new Set(result);
  const foldedKey = foldNormalizedKey(key, code);
  if (!seen.has(foldedKey)) {
    seen.add(foldedKey);
    result.push(foldedKey);
  }
  if (code === 'fr' || code === 'it' || code === 'ca' || code === 'ro' || code === 'nl') {
    if (code === 'nl') {
      if ((key.startsWith("'s ") || key.startsWith("'t ")) && key.length > 3) {
        const noun = key.slice(3);
        if (isElisionRemainder(noun) && !seen.has(noun)) {
          seen.add(noun);
          result.push(noun);
        }
      }
      return result;
    }
    // Lookup only: the reader keeps its glued elision span and exact entries win.
    if (code === 'it') {
      if (key === "po'") {
        result.push('po');
        return result;
      }
      const prefixes = ["qualcos'", "quell'", "sant'", "quest'", "dall'", "nell'", "sull'", "coll'", "bell'", "all'", "un'", "l'", "d'"];
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) {
          const remainder = key.slice(prefix.length);
          if (isElisionRemainder(remainder) && !seen.has(remainder)) {
            seen.add(remainder);
            result.push(remainder);
          }
          break;
        }
      }
      return result;
    }

    if (code === 'fr') {
      if (key.endsWith('-là') || key.endsWith('-ci')) {
        const stem = key.slice(0, -3);
        if (isElisionRemainder(stem) && !seen.has(stem)) {
          seen.add(stem);
          result.push(stem);
        }
      }
      const prefixes = ["jusqu'", "puisqu'", "lorsqu'", "qu'", "c'", "j'", "m'", "n'", "s'", "t'", "l'", "d'"];
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) {
          const remainder = key.slice(prefix.length);
          if (isElisionRemainder(remainder) && !seen.has(remainder)) {
            seen.add(remainder);
            result.push(remainder);
          } else if ((remainder.endsWith('-là') || remainder.endsWith('-ci') || remainder.endsWith('-ce')) && remainder.length > 3) {
            if (remainder.endsWith('-ce') && !seen.has(remainder)) {
              seen.add(remainder);
              result.push(remainder);
            }
            const subStem = remainder.slice(0, -3);
            if (isElisionRemainder(subStem) && !seen.has(subStem)) {
              seen.add(subStem);
              result.push(subStem);
            }
          }
          break;
        }
      }
      return result;
    }

    if (code === 'ca') {
      const prefixes = ["l'", "d'", "m'", "t'", "s'", "n'"];
      let procliticRemainder: string | null = null;
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) {
          const rem = key.slice(prefix.length);
          if (isCatalanRemainder(rem)) {
            procliticRemainder = rem;
          }
          break;
        }
      }
      if (procliticRemainder !== null) {
        if (!seen.has(procliticRemainder)) {
          seen.add(procliticRemainder);
          result.push(procliticRemainder);
        }
        peelCatalanEnclitics(procliticRemainder, seen, result);
      } else {
        peelCatalanEnclitics(key, seen, result);
      }
      return result;
    }

    if (code === 'ro') {
      const prefixes = ["și-", "te-", "ne-", "ți-", "s-", "m-", "v-", "l-", "d-", "n-"];
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) {
          const rem = key.slice(prefix.length);
          if (isElisionRemainder(rem) && !seen.has(rem)) {
            seen.add(rem);
            result.push(rem);
          }
          break;
        }
      }
      const suffixes = ["-au", "-am", "-ai", "-ați", "-ar", "-și", "-ne", "-vă", "-te", "-le", "-a", "-o", "-i", "-l"];
      for (const suffix of suffixes) {
        if (key.endsWith(suffix) && key.length > suffix.length) {
          const rem = key.slice(0, -suffix.length);
          if (isElisionRemainder(rem) && !seen.has(rem)) {
            seen.add(rem);
            result.push(rem);
          }
          break;
        }
      }
      return result;
    }
  }
  let frontier = [key];
  if (code === 'he' && key.endsWith('׳')) {
    const withoutGeresh = key.replace(/׳+$/, '');
    if (!seen.has(withoutGeresh)) { seen.add(withoutGeresh); result.push(withoutGeresh); frontier.push(withoutGeresh); }
  }
  if (code !== 'he' && code !== 'ar') return result;
  const prefixes = code === 'he' ? ['ו', 'ב', 'ל', 'כ', 'מ', 'ש', 'ה'] : ['و', 'ف', 'ب', 'ل', 'ك', 'ال'];
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const next: string[] = [];
    const add = (candidate: string) => {
      if (!seen.has(candidate)) { seen.add(candidate); next.push(candidate); }
    };
    for (const current of frontier) {
      for (const prefix of prefixes) {
        if (current.startsWith(prefix) && current.length - prefix.length >= 2) add(current.slice(prefix.length));
      }
      if (code === 'ar' && current.startsWith('لل') && current.length >= 4) add(current.slice(2));
    }
    frontier = next.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    for (const candidate of frontier) {
      result.push(candidate);
      const foldedCandidate = foldNormalizedKey(candidate, code);
      if (!seen.has(foldedCandidate)) {
        seen.add(foldedCandidate);
        result.push(foldedCandidate);
      }
    }
  }
  return result;
};

export const resolveLookupKey = (
  term: string, languageCode: string | null | undefined, headwords: Iterable<string>
): string | null => {
  const headwordList = [...headwords];
  const keys = new Set(headwordList.map(word => lowercaseLookupTerm(word, languageCode)));
  const foldedKeys = new Set(headwordList.map(word => foldLookupTerm(word, languageCode)));
  return getLookupCandidates(term, languageCode).find(key => keys.has(key) || foldedKeys.has(key)) ?? null;
};

export const resolveLookupTerm = <T>(
  term: string, languageCode: string | null | undefined, vocabulary: ReadonlyMap<string, T>
): T | null => {
  for (const key of getLookupCandidates(term, languageCode)) {
    if (vocabulary.has(key)) return vocabulary.get(key)!;
  }
  return null;
};

type TaggedWordRegex = RegExp & { lang?: string };
const wordRegexCache = new Map<string, TaggedWordRegex>();

// Build a per-character matcher from the language's `wordCharacters`
// regex character-class fragment. The fragment may contain ranges
// (`a-z`), Unicode escapes (`\u200C`), and Unicode property classes
// (`\p{L}`). We use it as-is; no seed lists ASCII `'` or `-`, so the
// universal connector rule below adds glued apostrophe / hyphen /
// middle-dot behaviour on top of this regex.
export const buildCoreWordRegex = (
  wordCharacters: string | null | undefined,
  languageCode?: string | null
): RegExp => {
  const raw = (wordCharacters || '').trim();
  const baseLang = (languageCode || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  const key = `${raw || '__default__'}::${baseLang}`;
  const cached = wordRegexCache.get(key);
  if (cached) return cached;

  const cls = raw || DEFAULT_WORD_CLASS;

  let regex: TaggedWordRegex;
  try {
    regex = new RegExp(`^[${cls}]$`, 'u');
  } catch {
    // Invalid wordCharacters → fall back to Unicode letters and marks.
    regex = new RegExp(`^[${DEFAULT_WORD_CLASS}]$`, 'u');
  }
  regex.lang = baseLang;
  wordRegexCache.set(key, regex);
  return regex;
};

const isCoreWordChar = (regex: RegExp, ch: string | undefined): boolean =>
  !!ch && (regex.test(ch) || isThaiDigit(ch) || ch === '\u200C' || ch === '\u200D');

// A combining mark or format character (an emoji's variation selector, a
// zero-width joiner) may continue a word but never start one: on its own it
// would be an invisible clickable "word".
const MARK_OR_FORMAT = /[\p{M}\p{Cf}]/u;
const canStartWord = (regex: RegExp, ch: string | undefined): boolean =>
  isCoreWordChar(regex, ch) && !MARK_OR_FORMAT.test(ch as string);
const isConnector = (ch: string): boolean =>
  ch === APOSTROPHE || ch === HYPHEN || ch === MIDDLE_DOT || ch === '\u05F4' || ch === '\u05F3' || ch === '"';

const DECIMAL_DIGIT_REGEX = /^\p{Nd}$/u;
const CURRENCY_SYMBOL_REGEX = /^\p{Sc}$/u;
const isNumericDigit = (ch: string | undefined): boolean => !!ch && DECIMAL_DIGIT_REGEX.test(ch);
const isNumericSeparator = (ch: string | undefined): boolean =>
  ch === '.' || ch === ',' || ch === '\u00A0' || ch === '\u202F' || ch === '\u066C' || ch === '\u066B';
const isHorizontalSpace = (ch: string | undefined): boolean =>
  ch === ' ' || ch === '\u00A0' || ch === '\u202F';
const isCurrencySymbol = (ch: string | undefined): boolean => !!ch && CURRENCY_SYMBOL_REGEX.test(ch);

const tryConsumeDutchProcliticNoun = (
  text: string,
  start: number,
  core: RegExp,
  code?: string
): number | null => {
  if (code !== 'nl' || text[start] !== "'" || start + 3 >= text.length) return null;
  if (start > 0 && (isCoreWordChar(core, text[start - 1]) || text[start - 1] === "'")) return null;
  const letter = text[start + 1];
  if (letter !== 's' && letter !== 'S' && letter !== 't' && letter !== 'T') return null;
  if (text[start + 2] !== ' ') return null;
  const nounStart = start + 3;
  if (!/\p{Lu}/u.test(text[nounStart]) || !canStartWord(core, text[nounStart])) return null;
  let p = nounStart + 1;
  while (p < text.length && isCoreWordChar(core, text[p])) p++;
  return p;
};

const tryConsumeEnglishIdiomContraction = (
  text: string,
  firstWordEnd: number,
  core: RegExp
): number | null => {
  const p = firstWordEnd;
  if (p + 5 >= text.length) return null;
  if (text[p] !== ' ' || text[p + 1] !== "'" || (text[p + 2] !== 'n' && text[p + 2] !== 'N') || text[p + 3] !== "'" || text[p + 4] !== ' ') {
    return null;
  }
  const secondWordStart = p + 5;
  if (!canStartWord(core, text[secondWordStart])) return null;
  let q = secondWordStart;
  while (q < text.length && isCoreWordChar(core, text[q])) q++;
  if (q === secondWordStart) return null;
  return q;
};

const tryConsumeLeadingApostrophe = (text: string, start: number, core: RegExp, code?: string): number | null => {
  const end = start + 2;
  if (text[start] !== "'" || start + 1 >= text.length ||
      (start > 0 && (isCoreWordChar(core, text[start - 1]) || text[start - 1] === "'"))) return null;
  const letter = text[start + 1].toLowerCase();
  return ((code === 'af' && letter === 'n') || (code === 'nl' && (letter === 's' || letter === 't'))) &&
    isCoreWordChar(core, text[start + 1]) &&
    (end === text.length || (text[end] !== "'" && !isCoreWordChar(core, text[end]))) ? end : null;
};

const TARGETED_COMPOUNDS: Record<string, string[]> = {
  vi: ['việt nam', 'quốc ngữ', 'đặc biệt'],
  ms: ['kuala lumpur'],
};

const tryConsumeTargetedCompound = (
  text: string,
  start: number,
  core: RegExp,
  code?: string
): number | null => {
  if (!code) return null;
  const compounds = TARGETED_COMPOUNDS[code];
  if (!compounds) return null;

  if (
    start > 0 &&
    (isCoreWordChar(core, text[start - 1]) ||
      ((text[start - 1] === '-' || text[start - 1] === "'") && start > 1 && isCoreWordChar(core, text[start - 2])))
  ) {
    return null;
  }

  for (const compound of compounds) {
    const len = compound.length;
    if (start + len > text.length) continue;

    if (text.slice(start, start + len).toLowerCase() === compound) {
      const matchEnd = start + len;
      if (
        matchEnd < text.length &&
        (isCoreWordChar(core, text[matchEnd]) ||
          ((text[matchEnd] === '-' || text[matchEnd] === "'") && matchEnd + 1 < text.length && isCoreWordChar(core, text[matchEnd + 1])))
      ) {
        continue;
      }
      return matchEnd;
    }
  }

  return null;
};

const findDottedInitialismEnd = (text: string, start: number, core: RegExp): number => {
  let end = start;
  let letters = 0;
  while (end < text.length && /\p{L}/u.test(text[end]) && isCoreWordChar(core, text[end])) {
    letters++;
    end++;
    if (end === text.length || text[end] !== '.') break;
    end++;
  }
  return letters >= 2 && (end === text.length || !isCoreWordChar(core, text[end])) ? end : start + 1;
};

// Require three-digit ASCII groups and currency/unit context (comma decimal optional).
const findSpaceGroupedDecimalEnd = (text: string, start: number, digitsEnd: number, core: RegExp): number => {
  if (digitsEnd - start > 3) return digitsEnd;
  let end = digitsEnd;
  let groups = 0;
  while (end < text.length && text[end] === ' ') {
    let next = end + 1;
    while (next < text.length && isNumericDigit(text[next])) next++;
    if (next - end !== 4) break;
    groups++;
    end = next;
  }
  if (!groups) return digitsEnd;
  if (text[end] === ',' && isNumericDigit(text[end + 1])) {
    end += 2;
    while (end < text.length && isNumericDigit(text[end])) end++;
  }
  let nextContext = end;
  while (nextContext < text.length && isHorizontalSpace(text[nextContext])) nextContext++;
  let previous = start - 1;
  while (previous >= 0 && isHorizontalSpace(text[previous])) previous--;
  const hasContext = (nextContext < text.length && (isCurrencySymbol(text[nextContext]) || text[nextContext] === '%' ||
    (/\p{L}/u.test(text[nextContext]) && isCoreWordChar(core, text[nextContext])))) ||
    (previous >= 0 && isCurrencySymbol(text[previous]));
  return hasContext ? end : digitsEnd;
};

const tryConsumeNumericOrCurrencyAt = (
  processed: string,
  start: number,
  coreRegex: RegExp,
  isSegmentedScriptAt: ((text: string, idx: number) => boolean) | null
): { text: string; end: number } | null => {
  const len = processed.length;
  if (start < 0 || start >= len) return null;
  const ch = processed[start];

  if (isCurrencySymbol(ch)) {
    let k = start + 1;
    while (k < len && isHorizontalSpace(processed[k])) k++;
    if (k < len && isNumericDigit(processed[k])) {
      return { text: ch, end: start + 1 };
    }

    let p = start - 1;
    while (p >= 0 && isHorizontalSpace(processed[p])) p--;
    if (
      p >= 0 &&
      (isNumericDigit(processed[p]) ||
        (p >= 2 && processed[p] === '-' && processed[p - 1] === ',' && isNumericDigit(processed[p - 2])))
    ) {
      return { text: ch, end: start + 1 };
    }
    return null;
  }

  if (!isNumericDigit(ch)) return null;

  let end = start + 1;
  while (end < len && isNumericDigit(processed[end])) {
    end++;
  }

  end = findSpaceGroupedDecimalEnd(processed, start, end, coreRegex);
  while (end + 1 < len && isNumericSeparator(processed[end]) && isNumericDigit(processed[end + 1])) {
    end++;
    while (end < len && isNumericDigit(processed[end])) {
      end++;
    }
  }

  if (
    end + 1 < len &&
    processed[end] === ',' &&
    processed[end + 1] === '-' &&
    (end + 2 >= len || (!isNumericDigit(processed[end + 2]) && !isCoreWordChar(coreRegex, processed[end + 2])))
  ) {
    end += 2;
  } else {
    if (end < len && processed[end] === '%') {
      end++;
    }
    if (
      end + 1 < len &&
      processed[end] === '-' &&
      isCoreWordChar(coreRegex, processed[end + 1]) &&
      !(isSegmentedScriptAt && isSegmentedScriptAt(processed, end + 1))
    ) {
      end++;
      while (end < len) {
        if (isSegmentedScriptAt && isSegmentedScriptAt(processed, end)) break;
        if (isCoreWordChar(coreRegex, processed[end])) {
          end++;
          continue;
        }
        break;
      }
      while (end > start + 1 && (processed[end - 1] === '\u200C' || processed[end - 1] === '\u200D')) {
        end--;
      }
    }
  }

  if (end < len && (processed[end] === '\u00AA' || processed[end] === '\u00BA')) {
    return null;
  }

  return { text: processed.slice(start, end), end };
};

type SegmenterWordEnds = ReadonlyMap<number, number> & { profile?: string };
type MutableSegmenterWordEnds = Map<number, number> & { profile?: string };

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
): { processed: string; coreRegex: RegExp; wordEnds?: ReadonlyMap<number, number> } => {
  const userSubs = parseCharacterSubstitutions(languageConfig?.characterSubstitutions);
  const processed = applyCharacterSubstitutions(
    applyCharacterSubstitutions(normalizeTokenizerInput(rawContent || ''), BUILT_IN_SUBSTITUTIONS),
    userSubs
  );
  const coreRegex = buildCoreWordRegex(
    languageConfig?.wordCharacters,
    languageConfig?.code || languageConfig?.languageCode
  );
  if (languageConfig?.parserType === CHINESE_SEGMENTER_PROFILE) {
    const segmenter = getChineseSegmentation();
    const wordEnds: MutableSegmenterWordEnds = new Map<number, number>();
    wordEnds.profile = CHINESE_SEGMENTER_PROFILE;
    for (let i = 0; i < processed.length;) {
      if (!isChineseHanAt(processed, i)) { i += processed.codePointAt(i)! > 0xffff ? 2 : 1; continue; }
      const end = findChineseHanRunEnd(processed, i);
      for (const span of segmenter.segmentHanRun(processed, i, end)) wordEnds.set(span.start, span.end);
      i = end;
    }
    return { processed, coreRegex, wordEnds };
  }
  if (languageConfig?.parserType === JAPANESE_SEGMENTER_PROFILE) {
    const wordEnds: MutableSegmenterWordEnds = new Map<number, number>();
    wordEnds.profile = JAPANESE_SEGMENTER_PROFILE;
    for (let i = 0; i < processed.length;) {
      if (!isJapaneseScriptAt(processed, i)) { i += processed.codePointAt(i)! > 0xffff ? 2 : 1; continue; }
      const end = findJapaneseRunEnd(processed, i);
      for (const span of segmentJapaneseRun(processed, i, end)) wordEnds.set(span.start, span.end);
      i = end;
    }
    return { processed, coreRegex, wordEnds };
  }
  if (languageConfig?.parserType === THAI_SEGMENTER_PROFILE) {
    const segmenter = getThaiSegmentation();
    const wordEnds: MutableSegmenterWordEnds = new Map<number, number>();
    wordEnds.profile = THAI_SEGMENTER_PROFILE;
    for (let i = 0; i < processed.length;) {
      if (!isThaiAt(processed, i)) { i += processed.codePointAt(i)! > 0xffff ? 2 : 1; continue; }
      const end = findThaiRunEnd(processed, i);
      for (const span of segmenter.segmentThaiRun(processed, i, end)) wordEnds.set(span.start, span.end);
      i = end;
    }
    return { processed, coreRegex, wordEnds };
  }
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
  coreRegex: RegExp,
  wordEnds?: ReadonlyMap<number, number>
): { text: string; end: number } | null => {
  if (!processed || index < 0 || index >= processed.length) return null;
  const isJapaneseProfile = (wordEnds as SegmenterWordEnds | undefined)?.profile === JAPANESE_SEGMENTER_PROFILE;
  const isThaiProfile = (wordEnds as SegmenterWordEnds | undefined)?.profile === THAI_SEGMENTER_PROFILE;
  const isSegmentedScriptAt = wordEnds
    ? (isJapaneseProfile ? isJapaneseScriptAt : isThaiProfile ? isThaiAt : isChineseHanAt)
    : null;
  if (wordEnds && isSegmentedScriptAt && isSegmentedScriptAt(processed, index)) {
    const end = wordEnds.get(index) ?? (
      isJapaneseProfile
        ? segmentJapaneseRun(processed, index, findJapaneseRunEnd(processed, index))[0].end
        : isThaiProfile
          ? getThaiSegmentation().segmentThaiRun(processed, index, findThaiRunEnd(processed, index))[0].end
          : getChineseSegmentation().segmentHanRun(processed, index, findChineseHanRunEnd(processed, index))[0].end
    );
    return { text: processed.slice(index, end), end };
  }
  const numericOrCurrency = tryConsumeNumericOrCurrencyAt(processed, index, coreRegex, isSegmentedScriptAt);
  if (numericOrCurrency) return numericOrCurrency;
  const code = (coreRegex as TaggedWordRegex).lang;
  const dutchProcliticNoun = tryConsumeDutchProcliticNoun(processed, index, coreRegex, code);
  if (dutchProcliticNoun !== null) return { text: processed.slice(index, dutchProcliticNoun), end: dutchProcliticNoun };
  const apostropheEnd = tryConsumeLeadingApostrophe(processed, index, coreRegex, code);
  if (apostropheEnd !== null) return { text: processed.slice(index, apostropheEnd), end: apostropheEnd };
  const targetedCompoundEnd = tryConsumeTargetedCompound(processed, index, coreRegex, code);
  if (targetedCompoundEnd !== null) return { text: processed.slice(index, targetedCompoundEnd), end: targetedCompoundEnd };
  if (!canStartWord(coreRegex, processed[index])) return null;

  let i = findDottedInitialismEnd(processed, index, coreRegex);
  let word = processed.slice(index, i);
  const len = processed.length;

  while (i < len) {
    const next = processed[i];
    if (isSegmentedScriptAt && isSegmentedScriptAt(processed, i)) break;
    if (isCoreWordChar(coreRegex, next)) {
      word += next;
      i++;
      continue;
    }
    if (code === 'fi' && next === ':' && i > index &&
        (/\p{L}/u.test(processed[i - 1]) || processed[i - 1] === '.') && i + 1 < len &&
        /\p{Ll}/u.test(processed[i + 1]) && isCoreWordChar(coreRegex, processed[i + 1])) {
      word += next;
      i++;
      continue;
    }
    if (
      isConnector(next) &&
      i + 1 < len &&
      isCoreWordChar(coreRegex, processed[i + 1]) &&
      !(isSegmentedScriptAt && isSegmentedScriptAt(processed, i + 1))
    ) {
      word += next;
      i++;
      continue;
    }
    break;
  }
  while (word.length > 1 && (word.endsWith('\u200C') || word.endsWith('\u200D'))) {
    word = word.slice(0, -1);
    i--;
  }
  if ((processed[i] === "'" || processed[i] === '׳') && /[א-ת]/.test(processed[i - 1])) {
    word += processed[i];
    i++;
  } else if (
    (coreRegex as TaggedWordRegex).lang === 'it' &&
    processed[i] === "'" &&
    word.length === 2 &&
    word.toLowerCase() === 'po' &&
    !(index > 0 && processed[index - 1] === "'")
  ) {
    word += processed[i];
    i++;
  }
  if (processed[i] === '.' && (i + 1 === len || !isCoreWordChar(coreRegex, processed[i + 1])) &&
      ((code === 'en' && word.toLowerCase() === 'dr') || (code === 'uk' && word.toLowerCase() === 'грн'))) {
    word += processed[i];
    i++;
  }
  if (code === 'en') {
    const idiomEnd = tryConsumeEnglishIdiomContraction(processed, i, coreRegex);
    if (idiomEnd !== null) {
      word = processed.slice(index, idiomEnd);
      i = idiomEnd;
    }
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

  const { processed, coreRegex, wordEnds } = prepareLanguageContext(rawContent, languageConfig);
  const tokens: ReaderToken[] = [];
  let i = 0;
  const len = processed.length;

  while (i < len) {
    const word = consumeWordAt(processed, i, coreRegex, wordEnds);
    if (word) {
      tokens.push({ type: 'word', text: word.text, start: i, end: word.end });
      i = word.end;
    } else {
      const width = wordEnds && processed.codePointAt(i)! > 0xffff ? 2 : 1;
      tokens.push({ type: 'separator', text: processed.slice(i, i + width), start: i, end: i + width });
      i += width;
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

const ALL_TARGETED_COMPOUND_SET = new Set<string>(
  Object.values(TARGETED_COMPOUNDS).flat()
);

const isCompoundWordPair = (
  first: string,
  second: string,
  sep: string,
  languageConfig: LanguageConfig = null
): boolean => {
  if ((sep ?? ' ').trim() !== '') return false;
  const w1 = (first || '').trim();
  const w2 = (second || '').trim();
  if (!w1 || !w2) return false;

  const combined = `${w1} ${w2}`;
  if (ALL_TARGETED_COMPOUND_SET.has(combined.toLowerCase())) {
    return true;
  }

  // Dutch proclitic compounds ('s Morgens, 't Huis)
  if (/^'[stST]$/.test(w1) && /^\p{Lu}/u.test(w2)) {
    return true;
  }

  const { tokens } = tokenizeContent(combined, languageConfig);
  const wordTokens = tokens.filter((t) => t.type === 'word');
  return wordTokens.length === 1 && wordTokens[0].text.toLowerCase() === combined.toLowerCase();
};

const isCompoundWordTriplet = (
  first: string,
  middle: string,
  third: string,
  sep1: string,
  sep2: string,
  languageConfig: LanguageConfig = null
): boolean => {
  if ((sep1 ?? ' ').trim() !== '' || (sep2 ?? ' ').trim() !== '') return false;
  const w1 = (first || '').trim();
  const w2 = (middle || '').trim();
  const w3 = (third || '').trim();
  if (!w1 || !w2 || !w3) return false;

  if (/^'[nN]'$/.test(w2)) {
    return true;
  }

  const combined = `${w1} ${w2} ${w3}`;
  const { tokens } = tokenizeContent(combined, languageConfig);
  const wordTokens = tokens.filter((t) => t.type === 'word');
  return wordTokens.length === 1 && wordTokens[0].text.toLowerCase() === combined.toLowerCase();
};

export const snapPhraseCompoundBounds = (
  words: string[],
  separators: string[],
  startIndex: number,
  endIndex: number,
  languageConfig: LanguageConfig = null
): { startIndex: number; endIndex: number } => {
  if (!words || words.length < 2) {
    return { startIndex, endIndex };
  }

  let nextStart = Math.max(0, Math.min(startIndex, words.length - 1));
  let nextEnd = Math.max(nextStart, Math.min(endIndex, words.length - 1));

  // Scan 3-word compounds first (e.g., rock 'n' roll)
  for (let i = 0; i <= words.length - 3; i++) {
    if (
      isCompoundWordTriplet(
        words[i],
        words[i + 1],
        words[i + 2],
        separators[i] ?? ' ',
        separators[i + 1] ?? ' ',
        languageConfig
      )
    ) {
      if (nextStart <= i + 2 && nextEnd >= i) {
        nextStart = Math.min(nextStart, i);
        nextEnd = Math.max(nextEnd, i + 2);
      }
    }
  }

  // Scan 2-word compounds (e.g., Việt Nam, Quốc ngữ, đặc biệt, Kuala Lumpur, 's Morgens)
  for (let i = 0; i <= words.length - 2; i++) {
    if (isCompoundWordPair(words[i], words[i + 1], separators[i] ?? ' ', languageConfig)) {
      if (nextStart <= i + 1 && nextEnd >= i) {
        nextStart = Math.min(nextStart, i);
        nextEnd = Math.max(nextEnd, i + 1);
      }
    }
  }

  return { startIndex: nextStart, endIndex: nextEnd };
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

  const rawStart = rawStartIdx !== -1 ? rawStartIdx : rawEndIdx;
  const rawEnd = rawEndIdx !== -1 ? Math.max(rawStart, rawEndIdx) : rawStart;

  const words = sentenceSpans.map((span) => (span.textContent || '').trim());
  const separators: string[] = [];
  for (let i = 0; i < sentenceSpans.length - 1; i++) {
    separators.push(getTextBetweenWordSpans(sentenceSpans[i], sentenceSpans[i + 1]));
  }

  const { startIndex, endIndex } = snapPhraseCompoundBounds(
    words,
    separators,
    rawStart,
    rawEnd,
    languageConfig
  );

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
        const snapped = snapPhraseCompoundBounds(
          words,
          separators,
          i,
          i + selectedWords.length - 1,
          languageConfig
        );
        return {
          words,
          separators,
          startIndex: snapped.startIndex,
          endIndex: snapped.endIndex,
          sentenceContext
        };
      }
    }
  }

  // Fallback for partial selections that start or end mid-compound (e.g., selecting "Việt"
  // in "Việt Nam", "Lumpur" in "Kuala Lumpur", or "Morgens" in "'s Morgens").
  const stripLeadingCliticApostrophe = (s: string) => s.replace(/^['’]/u, '').toLowerCase();
  const selectedSubWords = selectedWords
    .flatMap((w) => w.split(/\s+/))
    .map((w) => w.trim())
    .filter(Boolean);

  if (selectedSubWords.length > 0) {
    for (const group of sentenceWordGroups) {
      const { words, separators } = group;
      const subWords: { text: string; wordIndex: number }[] = [];
      words.forEach((word, wordIndex) => {
        for (const part of word.split(/\s+/)) {
          const trimmed = part.trim();
          if (trimmed) {
            subWords.push({ text: trimmed, wordIndex });
          }
        }
      });

      for (let i = 0; i <= subWords.length - selectedSubWords.length; i++) {
        let matches = true;
        for (let j = 0; j < selectedSubWords.length; j++) {
          const candidate = subWords[i + j].text.toLowerCase();
          const target = selectedSubWords[j].toLowerCase();
          if (
            candidate !== target &&
            stripLeadingCliticApostrophe(candidate) !== stripLeadingCliticApostrophe(target)
          ) {
            matches = false;
            break;
          }
        }
        if (matches) {
          const rawStart = subWords[i].wordIndex;
          const rawEnd = subWords[i + selectedSubWords.length - 1].wordIndex;
          const snapped = snapPhraseCompoundBounds(
            words,
            separators,
            rawStart,
            rawEnd,
            languageConfig
          );
          return {
            words,
            separators,
            startIndex: snapped.startIndex,
            endIndex: snapped.endIndex,
            sentenceContext
          };
        }
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
