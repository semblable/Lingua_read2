/** Mirrored by ChineseSegmenter.cs. No HMM, script conversion, or vocabulary normalization. */
export const CHINESE_SEGMENTER_PROFILE = 'jieba-v1';
export const CHINESE_DICTIONARY_SHA256 = 'b16011275c42955ccd81fc1adecc93a59dbb7926af69d93fc95d4943d40f6aad';

export interface ChineseWordSpan { text: string; start: number; end: number }
export interface ChineseSegmenter {
  readonly entryCount: number;
  readonly totalFrequency: number;
  readonly maxWordLength: number;
  segmentHanRun(processed: string, start: number, end: number): ChineseWordSpan[];
}

const scalarWidth = (text: string, index: number): number =>
  (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
const isVariationSelectorAt = (text: string, index: number): boolean => {
  const scalar = text.codePointAt(index) ?? -1;
  return (scalar >= 0xfe00 && scalar <= 0xfe0f) || (scalar >= 0xe0100 && scalar <= 0xe01ef);
};

export const isChineseHanAt = (text: string, index: number): boolean => {
  const scalar = text.codePointAt(index) ?? -1;
  return scalar === 0x3005 || scalar === 0x3007 ||
    (scalar >= 0x3400 && scalar <= 0x4dbf) || (scalar >= 0x4e00 && scalar <= 0x9fff) ||
    (scalar >= 0xf900 && scalar <= 0xfaff) || (scalar >= 0x20000 && scalar <= 0x2fa1f) ||
    (scalar >= 0x30000 && scalar <= 0x3347f);
};

export const findChineseHanRunEnd = (text: string, start: number): number => {
  let position = start;
  while (isChineseHanAt(text, position)) {
    position += scalarWidth(text, position);
    while (position < text.length && isVariationSelectorAt(text, position)) position += scalarWidth(text, position);
  }
  return position;
};

/**
 * Parse the original jieba word/frequency/POS format once, after download/cache initialization.
 * Compact sorted offsets retain no per-entry strings or prefix trie. Duplicate frequencies are
 * last-row-wins; total frequency includes all source rows, matching upstream jieba's denominator.
 * The returned segmenter is synchronous and uses offsets in the caller's unchanged UTF-16 text.
 */
export const createChineseSegmenter = (dictionaryText: string): ChineseSegmenter => {
  let rowCount = 0;
  for (let i = 0; i < dictionaryText.length; i++) if (dictionaryText.charCodeAt(i) === 10) rowCount++;
  if (dictionaryText.length > 0 && !dictionaryText.endsWith('\n')) rowCount++;
  const starts = new Uint32Array(rowCount);
  const ends = new Uint32Array(rowCount);
  const frequencies = new Uint32Array(rowCount);
  let count = 0;
  let totalFrequency = 0;
  let maxWordLength = 0;
  for (let start = 0; start < dictionaryText.length;) {
    const newline = dictionaryText.indexOf('\n', start);
    let end = newline < 0 ? dictionaryText.length : newline;
    if (end > start && dictionaryText.charCodeAt(end - 1) === 13) end--;
    if (end > start) {
      const space = dictionaryText.indexOf(' ', start);
      let frequencyEnd = space < 0 ? -1 : dictionaryText.indexOf(' ', space + 1);
      if (frequencyEnd < 0 || frequencyEnd > end) frequencyEnd = end;
      const frequencyText = dictionaryText.slice(space + 1, frequencyEnd);
      const frequency = Number(frequencyText);
      if (space <= start || space >= end || !/^\d+$/.test(frequencyText) ||
          !Number.isSafeInteger(frequency) || frequency < 0 || frequency > 0x7fffffff) {
        throw new Error('Invalid Chinese dictionary row.');
      }
      starts[count] = start;
      ends[count] = space;
      frequencies[count] = frequency;
      count++;
      totalFrequency += frequency;
      maxWordLength = Math.max(maxWordLength, space - start);
    }
    start = newline < 0 ? dictionaryText.length : newline + 1;
  }
  if (!count || totalFrequency <= 0 || !Number.isSafeInteger(totalFrequency)) throw new Error('The Chinese dictionary is empty or invalid.');
  const order = new Uint32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  const compareWords = (a: number, b: number): number => {
    const aLength = ends[a] - starts[a];
    const bLength = ends[b] - starts[b];
    for (let i = 0; i < Math.min(aLength, bLength); i++) {
      const difference = dictionaryText.charCodeAt(starts[a] + i) - dictionaryText.charCodeAt(starts[b] + i);
      if (difference) return difference;
    }
    return aLength - bLength;
  };
  order.sort((a, b) => compareWords(a, b) || a - b);
  // Deduplicate in place: the latest source row supplies the frequency.
  let entryCount = 0;
  for (let i = 0; i < count; i++) {
    const row = order[i];
    if (entryCount > 0 && compareWords(row, order[entryCount - 1]) === 0) order[entryCount - 1] = row;
    else order[entryCount++] = row;
  }
  const logTotal = Math.log(totalFrequency);
  const bound = (lower: number, upper: number, depth: number, value: number, inclusive: boolean): number => {
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      const row = order[middle];
      const actual = starts[row] + depth < ends[row] ? dictionaryText.charCodeAt(starts[row] + depth) : -1;
      if (actual < value || (inclusive && actual === value)) lower = middle + 1;
      else upper = middle;
    }
    return lower;
  };
  return {
    entryCount, totalFrequency, maxWordLength,
    segmentHanRun(processed, start, end) {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > processed.length) {
        throw new RangeError('Invalid Chinese run bounds.');
      }
      const offsets = [start];
      for (let position = start; position < end;) {
        if (!isChineseHanAt(processed, position)) throw new Error('Expected a contiguous Han run.');
        position += scalarWidth(processed, position);
        while (position < end && isVariationSelectorAt(processed, position)) position += scalarWidth(processed, position);
        if (position > end) throw new Error('A Han run cannot split a Unicode scalar.');
        offsets.push(position);
      }
      const length = offsets.length - 1;
      const scores = new Float64Array(length + 1);
      const next = new Uint32Array(length);
      for (let i = length - 1; i >= 0; i--) {
        let best = -Infinity;
        let chosen = i + 1;
        let lower = 0;
        let upper = entryCount;
        for (let j = i; j < length && offsets[j + 1] - offsets[i] <= maxWordLength && lower < upper; j++) {
          for (let position = offsets[j]; position < offsets[j + 1] && lower < upper; position++) {
            const depth = position - offsets[i];
            const value = processed.charCodeAt(position);
            const rangeEnd = upper;
            lower = bound(lower, upper, depth, value, false);
            upper = bound(lower, rangeEnd, depth, value, true);
          }
          if (lower === upper) break;
          const row = order[lower];
          if (ends[row] - starts[row] !== offsets[j + 1] - offsets[i] || frequencies[row] === 0) continue;
          const candidate = Math.log(frequencies[row]) - logTotal + scores[j + 1];
          // Exact ties choose the longer candidate, matching upstream Python jieba.
          if (candidate >= best) { best = candidate; chosen = j + 1; }
        }
        scores[i] = best === -Infinity ? -logTotal + scores[i + 1] : best;
        next[i] = chosen;
      }
      const words: ChineseWordSpan[] = [];
      for (let i = 0; i < length;) {
        const endIndex = next[i];
        words.push({ text: processed.slice(offsets[i], offsets[endIndex]), start: offsets[i], end: offsets[endIndex] });
        i = endIndex;
      }
      return words;
    }
  };
};
