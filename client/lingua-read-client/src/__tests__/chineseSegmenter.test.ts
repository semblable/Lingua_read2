import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  CHINESE_DICTIONARY_SHA256,
  CHINESE_SEGMENTER_PROFILE,
  createChineseSegmenter,
  findChineseHanRunEnd,
  isChineseHanAt,
  type ChineseSegmenter,
  type ChineseWordSpan
} from '../utils/chineseSegmenter';

const resource = resolve(process.cwd(), '../../server/LinguaReadApi/Resources/Segmentation/jieba-big-v1.txt');
const fixtures = JSON.parse(readFileSync(resolve(process.cwd(), '../../verification/language-support/chinese-cases.json'), 'utf8'));

const segmentRuns = (segmenter: ChineseSegmenter, text: string): ChineseWordSpan[] => {
  const result: ChineseWordSpan[] = [];
  for (let position = 0; position < text.length;) {
    if (!isChineseHanAt(text, position)) { position++; continue; }
    const end = findChineseHanRunEnd(text, position);
    result.push(...segmenter.segmentHanRun(text, position, end));
    position = end;
  }
  return result;
};

describe('versioned dictionary Chinese segmentation', () => {
  test('full pinned raw dictionary matches shared UTF-16 spans', () => {
    const dictionary = readFileSync(resource, 'utf8');
    expect(createHash('sha256').update(dictionary).digest('hex')).toBe(CHINESE_DICTIONARY_SHA256);
    const parseStart = performance.now();
    const segmenter = createChineseSegmenter(dictionary);
    const parseMilliseconds = performance.now() - parseStart;
    expect(segmenter.entryCount).toBe(583280);
    expect(segmenter.totalFrequency).toBe(87043992);
    expect(segmenter.maxWordLength).toBe(16);
    expect(fixtures.profile).toBe(CHINESE_SEGMENTER_PROFILE);
    expect(fixtures.dictionarySha256).toBe(CHINESE_DICTIONARY_SHA256);
    for (const fixture of fixtures.cases) {
      const actual = segmentRuns(segmenter, fixture.text);
      expect(actual, fixture.id).toEqual(fixture.hanSpans);
      for (const span of actual) expect(fixture.text.slice(span.start, span.end)).toBe(span.text);
    }
    const repeated = '图书馆的学生今天正在阅读中文小说'.repeat(400);
    const start = performance.now();
    const words = segmenter.segmentHanRun(repeated, 0, repeated.length);
    console.info(`Pinned raw dictionary: ${Buffer.byteLength(dictionary)} bytes; parse ${parseMilliseconds.toFixed(1)} ms; ` +
      `segment ${repeated.length} UTF-16 units/${words.length} words ${(performance.now() - start).toFixed(1)} ms. Diagnostic measurements only.`);
    expect(words.map(word => word.text).join('')).toBe(repeated);
  });

  test('last duplicate wins while the total includes all original rows', () => {
    const segmenter = createChineseSegmenter('中 1 n\r\n中文 10 n\r\n中 2 n\r\n文 0 n');
    expect(segmenter.entryCount).toBe(3);
    expect(segmenter.totalFrequency).toBe(13);
    expect(segmenter.segmentHanRun('🙂中文', 2, 4)).toEqual([{ text: '中文', start: 2, end: 4 }]);
  });

  test('supplementary dictionary words, unknown Han and variation selectors preserve source spans', () => {
    const segmenter = createChineseSegmenter('𠀀讀者 100 n\n讀者 10 n\n');
    const text = 'a𠀀讀者𠀁\u{E0100}';
    expect(findChineseHanRunEnd(text, 1)).toBe(text.length);
    expect(segmenter.segmentHanRun(text, 1, text.length)).toEqual([
      { text: '𠀀讀者', start: 1, end: 5 },
      { text: '𠀁\u{E0100}', start: 5, end: 9 }
    ]);
    expect(isChineseHanAt(text, 2)).toBe(false);
    expect(() => segmenter.segmentHanRun(text, 1, 2)).toThrow();
    expect(() => segmenter.segmentHanRun('中文A', 0, 3)).toThrow();
  });

  test.each(['', '中文', '中文 -1 n', '中文 1.5 n', '中文 0 n'])('rejects invalid or empty dictionary %s', dictionary => {
    expect(() => createChineseSegmenter(dictionary)).toThrow();
  });
});
