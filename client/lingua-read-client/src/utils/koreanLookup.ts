/**
 * Korean lookup aliases only. Source spelling and vocabulary identity stay intact:
 * modern conjoining Jamo compose, compatibility Jamo (ㄱ, ㅏ, …) do not.
 * Callers supply their existing trimmed/cased keys; do not persist these aliases.
 */
export const isKoreanLanguageCode = (code?: string | null): boolean =>
  (code || '').trim().toLowerCase().replace(/_/g, '-').split('-')[0] === 'ko';

export interface KoreanLookupProjection {
  text: string;
  sourceStarts: number[];
  sourceEnds: number[];
}

/** Map each composed UTF-16 unit back to its complete original source span. */
export const projectKoreanLookupText = (source: string): KoreanLookupProjection => {
  let text = '';
  const sourceStarts: number[] = [];
  const sourceEnds: number[] = [];
  for (let start = 0; start < source.length;) {
    let code = source.charCodeAt(start);
    let end = start + 1;
    const vowel = source.charCodeAt(end);
    if (code >= 0x1100 && code <= 0x1112 && vowel >= 0x1161 && vowel <= 0x1175) {
      code = 0xac00 + ((code - 0x1100) * 21 + vowel - 0x1161) * 28;
      end++;
    }
    const final = source.charCodeAt(end);
    if (code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 0
      && final >= 0x11a8 && final <= 0x11c2) {
      code += final - 0x11a7;
      end++;
    }
    text += String.fromCharCode(code);
    sourceStarts.push(start);
    sourceEnds.push(end);
    start = end;
  }
  return { text, sourceStarts, sourceEnds };
};

export const composeKoreanLookupText = (source: string): string => projectKoreanLookupText(source).text;

export interface KoreanLookupIndex<T> {
  exact: ReadonlyMap<string, T | null>;
  canonical: ReadonlyMap<string, T | null>;
}

/**
 * Keep every row. An alias with multiple candidates deliberately has no winner,
 * even if one row has a newer status, translation, or a lower database ID.
 */
export const createKoreanLookup = <T>(rows: Iterable<T>, exactKey: (row: T) => string): KoreanLookupIndex<T> => {
  const exact = new Map<string, T | null>();
  const canonical = new Map<string, T | null>();
  for (const row of rows) {
    const key = exactKey(row);
    exact.set(key, exact.has(key) ? null : row);
    const alias = composeKoreanLookupText(key);
    canonical.set(alias, canonical.has(alias) ? null : row);
  }
  return { exact, canonical };
};

/** Exact legacy spelling wins; use a canonical alias only when it is unique. */
export const resolveKoreanLookup = <T>(index: KoreanLookupIndex<T>, exactKey: string): T | null =>
  index.exact.has(exactKey)
    ? index.exact.get(exactKey) ?? null
    : index.canonical.get(composeKoreanLookupText(exactKey)) ?? null;

export interface KoreanSourceSpan { start: number; end: number }

/** Canonical matches with offsets in the unmodified source, including phrases. */
export const findKoreanLookupMatches = (source: string, term: string): KoreanSourceSpan[] => {
  const projection = projectKoreanLookupText(source);
  const needle = composeKoreanLookupText(term);
  if (!needle) return [];
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(projection.text.matchAll(new RegExp(escaped, 'giu')), match => {
    const start = match.index;
    return {
      start: projection.sourceStarts[start],
      end: projection.sourceEnds[start + match[0].length - 1]
    };
  });
};
