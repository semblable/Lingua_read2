/**
 * Mirrored by ThaiSegmenter.cs.
 * Thai Character Cluster (TCC) constrained dictionary DP word segmentation.
 */
export const THAI_SEGMENTER_PROFILE = 'thai-dict-v1';
export const THAI_DICTIONARY_SHA256 = 'b654af583aaa269275339b3400e12a62311dd2c4d1779fb461dd9442319ff2a9';

export interface ThaiWordSpan { text: string; start: number; end: number }
export interface ThaiSegmenter {
  readonly entryCount: number;
  readonly maxWordLength: number;
  segmentThaiRun(processed: string, start: number, end: number): ThaiWordSpan[];
}

const TCC_PATTERN = new RegExp(
  '^(?:' +
  'เ[ก-ฮ]็[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ][ก-ฮ][่-๋]?าะ(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ][ก-ฮ]ี[่-๋]?ยะ(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ][ก-ฮ]ี[่-๋]?ย(?=[เ-ไก-ฮ]|$)(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ][ก-ฮ]็[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ]ิ[ก-ฮ]์[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ]ิ[่-๋]?[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ]ี[่-๋]?ยะ?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ]ื[่-๋]?อะ?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ][\u0E34\u0E35\u0E38\u0E39][่-๋]?ย(?=[เ-ไก-ฮ]|$)(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'เ[ก-ฮ][่-๋]?า?ะ?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  '[ก-ฮ]ั[่-๋]?วะ(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  '[ก-ฮ][\u0E31\u0E37][่-๋]?[ก-ฮ][\u0E38\u0E34ะ]?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  '[ก-ฮ][\u0E34\u0E38\u0E39]์|' +
  '[ก-ฮ][\u0E30-\u0E39][่-๋]?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  '[ก-ฮ]รร[ก-ฮ]์|' +
  '[ก-ฮ]็|' +
  '[ก-ฮ][่-๋]?[ะาำ]?(?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  '[ก-ฮ](?:[ก-ฮ][ก-ฮ]?[ุูิ]?[\u0E4C])?|' +
  'แ[ก-ฮ]็[ก-ฮ]|' +
  'แ[ก-ฮ][ก-ฮ]์|' +
  'แ[ก-ฮ][่-๋]?ะ|' +
  'แ[ก-ฮ][ก-ฮ]็[ก-ฮ]|' +
  'แ[ก-ฮ][ก-ฮ][ก-ฮ]์|' +
  'โ[ก-ฮ][่-๋]?ะ|' +
  '[เ-ไ][ก-ฮ][่-๋]?|' +
  'ก็|' +
  'อึ|' +
  'หึ' +
  ')'
);

export const isThaiDigit = (ch: string | undefined): boolean =>
  !!ch && ch >= '\u0E50' && ch <= '\u0E59';

export const isThaiCombiningMark = (ch: string | undefined): boolean =>
  !!ch && (ch === '\u0E31' || (ch >= '\u0E34' && ch <= '\u0E3A') || (ch >= '\u0E47' && ch <= '\u0E4E'));

/**
 * Detects whether the character at index is a Thai script character
 * (consonants, vowels, tone marks, Paiyannoi, Maiyamok, digits), excluding Thai Baht (฿ U+0E3F).
 */
export const isThaiAt = (text: string, index: number): boolean => {
  if (index < 0 || index >= text.length) return false;
  const c = text[index];
  return (c >= '\u0E01' && c <= '\u0E3A') || (c >= '\u0E40' && c <= '\u0E59');
};

export const findThaiRunEnd = (text: string, start: number): number => {
  let position = start;
  while (position < text.length && isThaiAt(text, position)) {
    position++;
  }
  return position;
};

const getTccBoundaries = (text: string, start: number, end: number): number[] => {
  const boundaries: number[] = [start];
  let p = start;
  while (p < end) {
    const sub = text.slice(p, end);
    const match = TCC_PATTERN.exec(sub);
    let len = match ? match[0].length : 1;

    // Never split leading/pre-posed vowels from consonant
    if (text[p] >= '\u0E40' && text[p] <= '\u0E44' && p + 1 < end && len < 2) {
      len = 2;
    }

    // Attach trailing Paiyannoi (ฯ) or Maiyamok (ๆ)
    while (p + len < end && (text[p + len] === '\u0E2F' || text[p + len] === '\u0E46')) {
      len++;
    }

    // Attach trailing combining vowels / tone marks
    while (p + len < end && isThaiCombiningMark(text[p + len])) {
      len++;
    }

    p += len;
    boundaries.push(p);
  }
  return boundaries;
};

/**
 * Creates a Thai segmenter from the raw dictionary text (one word per line).
 */
export const createThaiSegmenter = (dictionaryText: string): ThaiSegmenter => {
  const words = new Set<string>();
  let maxWordLength = 0;

  const lines = dictionaryText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const word = lines[i].trim();
    if (word.length === 0) continue;
    words.add(word);
    if (word.length > maxWordLength) {
      maxWordLength = word.length;
    }
  }

  if (words.size === 0) {
    throw new Error('The Thai dictionary is empty.');
  }

  const segmentThaiTextRun = (text: string, start: number, end: number): ThaiWordSpan[] => {
    const bounds = getTccBoundaries(text, start, end);
    const n = bounds.length - 1;
    if (n === 0) return [];
    if (n === 1) return [{ text: text.slice(start, end), start, end }];

    const dp = new Int32Array(n + 1).fill(0x7fffffff);
    const next = new Int32Array(n);
    const isDict = new Uint8Array(n);
    dp[n] = 0;

    for (let i = n - 1; i >= 0; i--) {
      let bestCost = 0x7fffffff;
      let bestJ = -1;
      let isDictionary = 0;

      for (let j = i + 1; j <= n; j++) {
        const len = bounds[j] - bounds[i];
        if (len > maxWordLength) break;
        const slice = text.slice(bounds[i], bounds[j]);
        if (words.has(slice) || (slice.length > 1 && (slice.endsWith('\u0E2F') || slice.endsWith('\u0E46')) && words.has(slice.slice(0, -1)))) {
          const cost = dp[j] === 0x7fffffff ? 0x7fffffff : 1 + dp[j];
          if (cost < bestCost || (cost === bestCost && len > (bestJ >= 0 ? bounds[bestJ] - bounds[i] : 0))) {
            bestCost = cost;
            bestJ = j;
            isDictionary = 1;
          }
        }
      }

      const oovCost = dp[i + 1] === 0x7fffffff ? 0x7fffffff : 1 + dp[i + 1];
      if (bestCost === 0x7fffffff || oovCost < bestCost) {
        bestCost = oovCost;
        bestJ = i + 1;
        isDictionary = 0;
      }

      dp[i] = bestCost;
      next[i] = bestJ;
      isDict[i] = isDictionary;
    }

    const spans: ThaiWordSpan[] = [];
    let curr = 0;
    while (curr < n) {
      const nxt = next[curr];
      if (isDict[curr] === 1) {
        spans.push({ text: text.slice(bounds[curr], bounds[nxt]), start: bounds[curr], end: bounds[nxt] });
        curr = nxt;
      } else {
        let endCurr = nxt;
        while (endCurr < n && isDict[endCurr] === 0) {
          endCurr = next[endCurr];
        }
        spans.push({ text: text.slice(bounds[curr], bounds[endCurr]), start: bounds[curr], end: bounds[endCurr] });
        curr = endCurr;
      }
    }
    return spans;
  };

  return {
    entryCount: words.size,
    maxWordLength,
    segmentThaiRun(processed: string, start: number, end: number): ThaiWordSpan[] {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > processed.length) {
        throw new RangeError('Invalid Thai run bounds.');
      }
      if (start === end) return [];

      const result: ThaiWordSpan[] = [];
      let cursor = start;

      while (cursor < end) {
        if (isThaiDigit(processed[cursor])) {
          let digitEnd = cursor + 1;
          while (digitEnd < end && isThaiDigit(processed[digitEnd])) digitEnd++;
          result.push({ text: processed.slice(cursor, digitEnd), start: cursor, end: digitEnd });
          cursor = digitEnd;
        } else {
          let textEnd = cursor + 1;
          while (textEnd < end && !isThaiDigit(processed[textEnd])) textEnd++;
          result.push(...segmentThaiTextRun(processed, cursor, textEnd));
          cursor = textEnd;
        }
      }
      return result;
    }
  };
};
