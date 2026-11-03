import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  THAI_DICTIONARY_SHA256,
  THAI_SEGMENTER_PROFILE,
  createThaiSegmenter,
  findThaiRunEnd,
  isThaiAt,
  isThaiDigit,
  type ThaiSegmenter,
  type ThaiWordSpan
} from '../utils/thaiSegmenter';

const resource = resolve(process.cwd(), '../../server/LinguaReadApi/Resources/Segmentation/words_th.txt');
const fixtures = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../verification/language-support/thai-cases.json'), 'utf8')
) as {
  profile: string;
  dictionarySha256: string;
  cases: Array<{ id: string; text: string; thaiSpans: ThaiWordSpan[] }>;
};

const segmentRuns = (segmenter: ThaiSegmenter, text: string): ThaiWordSpan[] => {
  const result: ThaiWordSpan[] = [];
  for (let position = 0; position < text.length;) {
    if (!isThaiAt(text, position)) {
      position++;
      continue;
    }
    const end = findThaiRunEnd(text, position);
    result.push(...segmenter.segmentThaiRun(text, position, end));
    position = end;
  }
  return result;
};

describe('versioned dictionary Thai segmentation', () => {
  test('full pinned raw dictionary matches shared UTF-16 spans', () => {
    const dictionary = readFileSync(resource, 'utf8');
    expect(createHash('sha256').update(dictionary).digest('hex')).toBe(THAI_DICTIONARY_SHA256);

    const segmenter = createThaiSegmenter(dictionary);
    expect(segmenter.entryCount).toBe(62107);
    expect(segmenter.maxWordLength).toBe(81);
    expect(fixtures.profile).toBe(THAI_SEGMENTER_PROFILE);
    expect(fixtures.dictionarySha256).toBe(THAI_DICTIONARY_SHA256);

    for (const fixture of fixtures.cases) {
      const actual = segmentRuns(segmenter, fixture.text);
      expect(actual, fixture.id).toEqual(fixture.thaiSpans);
      for (const span of actual) {
        expect(fixture.text.slice(span.start, span.end)).toBe(span.text);
      }
    }
  });

  test('Paiyannoi (ฯ) and Maiyamok (ๆ) stay attached to preceding cluster/word', () => {
    const dictionary = readFileSync(resource, 'utf8');
    const segmenter = createThaiSegmenter(dictionary);

    // Paiyannoi in Bangkok: กรุงเทพฯ
    const bangkok = 'กรุงเทพฯ';
    expect(segmenter.segmentThaiRun(bangkok, 0, bangkok.length)).toEqual([
      { text: 'กรุงเทพฯ', start: 0, end: 8 }
    ]);

    // Maiyamok in quickly: เร็วๆ (เร็ว in dict, ๆ attached)
    const quickly = 'เร็วๆ';
    expect(segmenter.segmentThaiRun(quickly, 0, quickly.length)).toEqual([
      { text: 'เร็วๆ', start: 0, end: 5 }
    ]);
  });

  test('Thai digits are tokenized as number tokens', () => {
    const dictionary = readFileSync(resource, 'utf8');
    const segmenter = createThaiSegmenter(dictionary);

    expect(isThaiDigit('๐')).toBe(true);
    expect(isThaiDigit('๒')).toBe(true);
    expect(isThaiDigit('๙')).toBe(true);
    expect(isThaiDigit('A')).toBe(false);

    const digitRun = 'ชั้น ๒';
    const spans = segmentRuns(segmenter, digitRun);
    expect(spans).toEqual([
      { text: 'ชั้น', start: 0, end: 4 },
      { text: '๒', start: 5, end: 6 }
    ]);

    const multiDigit = 'วันที่ ๑๕';
    const multiSpans = segmentRuns(segmenter, multiDigit);
    expect(multiSpans).toEqual([
      { text: 'วันที่', start: 0, end: 6 },
      { text: '๑๕', start: 7, end: 9 }
    ]);
  });

  test('merges contiguous unmatched OOV clusters into single tokens', () => {
    const dictionary = readFileSync(resource, 'utf8');
    const segmenter = createThaiSegmenter(dictionary);

    // 'ปปปปป' has no subwords in dictionary; should coalesce into one OOV token
    const text = 'ฉันชอบปปปปป';
    const spans = segmenter.segmentThaiRun(text, 0, text.length);
    expect(spans).toEqual([
      { text: 'ฉัน', start: 0, end: 3 },
      { text: 'ชอบ', start: 3, end: 6 },
      { text: 'ปปปปป', start: 6, end: 11 }
    ]);
  });
});
