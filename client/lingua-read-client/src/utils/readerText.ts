export type LanguageConfig = {
  wordCharacters?: string | null;
  characterSubstitutions?: string | null;
  parserType?: string | null;
  splitSentences?: string | null;
  sentenceSplitExceptions?: Array<string | { exceptionString?: string } | null> | null;
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
//   1. parseCharacterSubstitutions(language.characterSubstitutions)
//      Pipe-separated `old=new|...`. Used to normalize curly apostrophes
//      to ASCII `'`, fancy quotes, ellipsis, etc. The first `=` separates
//      old and new; later `=` chars belong to `new`.
//   2. applyCharacterSubstitutions: replace each `old` with `new` in
//      declaration order. Users must declare longer-old-first to avoid
//      greediness issues (e.g. `...=…|..=‥`).
//   3. buildCoreWordRegex(language.wordCharacters): regex character class
//      defining the language's base alphabet. ASCII `'` and `-` are
//      stripped before building, because they're handled exclusively by
//      the universal connector rule below — this keeps glue semantics
//      consistent across languages whose seeds vary on those chars.
//   4. tokenizeContent walks the substituted text and accumulates runs
//      of core word chars **plus glued connectors**:
//        - Apostrophe `'` (after substitution): glued only when both
//          previous and next char are core. Allows `l'eau`, `qu'il`,
//          `dell'acqua`, `don't`. Stray `'word` or `word'` keep `'`
//          as separator.
//        - Hyphen `-`: glued only when both neighbours are core. Allows
//          `beijá-lo`, `interrompo-a`, `well-known`. Standalone `--`
//          and en-dashes split.
//      Tokens preserve original casing for display; lookups normalize
//      via JS `toLowerCase()` (BE uses locale-aware `ToLower`).
//
// CJK parserType (`mecab`/`jieba`) is out of scope: tokenization falls
// back to the default spacedel algorithm.
// =====================================================================

const APOSTROPHE = "'";
const HYPHEN = '-';

// Built-in normalizations applied BEFORE user-defined characterSubstitutions.
// These guarantee that apostrophe/hyphen glue works in every language —
// even custom ones with empty CharacterSubstitutions — by mapping common
// curly / modifier apostrophe variants to ASCII. User subs can still
// override these (e.g. mapping U+2019 to a different char) by listing
// the same `old` in the language config.
const BUILT_IN_SUBSTITUTIONS: CharSubstitution[] = [
  { old: '’', replacement: APOSTROPHE },
  { old: '‘', replacement: APOSTROPHE },
  { old: 'ʼ', replacement: APOSTROPHE }
];

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

const DEFAULT_WORD_CLASS = '\\p{L}';

const wordRegexCache = new Map<string, RegExp>();

// Build a per-character matcher from the language's `wordCharacters`
// regex character-class fragment. The fragment may contain ranges
// (`a-z`), Unicode escapes (`‌`), and Unicode property classes
// (`\p{L}`). We use it as-is; ASCII `'` and `-` may or may not be
// present depending on the language seed (e.g. Russian includes them,
// Latin-script languages do not). The universal connector rule below
// adds glued-apostrophe / glued-hyphen behaviour on top of this regex.
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
    // Invalid wordCharacters → fall back to Unicode letters.
    regex = new RegExp(`^[${DEFAULT_WORD_CLASS}]$`, 'u');
  }
  wordRegexCache.set(key, regex);
  return regex;
};

const isCoreWordChar = (regex: RegExp, ch: string | undefined): boolean =>
  !!ch && regex.test(ch);
const isConnector = (ch: string): boolean => ch === APOSTROPHE || ch === HYPHEN;

/**
 * Apply built-in + user character substitutions and return the
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
    applyCharacterSubstitutions(rawContent || '', BUILT_IN_SUBSTITUTIONS),
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
  if (!isCoreWordChar(coreRegex, processed[index])) return null;

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

const escapeForCharClass = (ch: string): string => ch.replace(/[\\\]\^\-]/g, (m) => `\\${m}`);

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
  return merged.map((sentence) => sentence.replace(/\s+/g, ' ').trim()).filter(Boolean);
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
          text: titleSegmentText,
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
