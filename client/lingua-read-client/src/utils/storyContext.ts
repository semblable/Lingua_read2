export type ContextToken = { text: string; index: number; isWord: boolean };

/** Preserve every display character while exposing word boundaries for lookup. */
export function segmentContext(text: string, languageCode?: string): ContextToken[] {
  try {
    const segmenter = new Intl.Segmenter(languageCode || undefined, { granularity: 'word' });
    return Array.from(segmenter.segment(text), part => ({ text: part.segment, index: part.index, isWord: !!part.isWordLike }));
  } catch {
    return Array.from(text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’ʼ][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}]+/gu), match => ({
      text: match[0], index: match.index!, isWord: /^[\p{L}\p{M}\p{N}]/u.test(match[0]),
    }));
  }
}

/** Locate the target form at complete word boundaries, including CJK/Thai words. */
export function findContextTarget(context: string, needle: string, languageCode?: string): { start: number; end: number } | null {
  if (!needle) return null;
  const tokens = segmentContext(context, languageCode);
  const starts = new Set(tokens.filter(t => t.isWord).map(t => t.index));
  const ends = new Set(tokens.filter(t => t.isWord).map(t => t.index + t.text.length));
  // Escape literal target forms; /iu preserves source offsets (lowercasing can
  // change UTF-16 length, e.g. dotted I).
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  for (const match of context.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (starts.has(start) && ends.has(end)) return { start, end };
  }
  return null;
}
