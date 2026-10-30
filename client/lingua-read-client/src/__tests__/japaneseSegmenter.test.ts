import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  JAPANESE_SEGMENTER_PROFILE,
  findJapaneseRunEnd,
  isJapaneseScriptAt,
  segmentJapaneseRun,
  type JapaneseWordSpan
} from '../utils/japaneseSegmenter';

const fixtures = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../verification/language-support/japanese-cases.json'), 'utf8')
) as {
  profile: string;
  cases: Array<{ id: string; text: string; japaneseSpans: JapaneseWordSpan[] }>;
};

const segmentRuns = (text: string): JapaneseWordSpan[] => {
  const result: JapaneseWordSpan[] = [];
  for (let position = 0; position < text.length;) {
    if (!isJapaneseScriptAt(text, position)) {
      const cp = text.codePointAt(position) ?? 0;
      position += cp > 0xffff ? 2 : 1;
      continue;
    }
    const end = findJapaneseRunEnd(text, position);
    result.push(...segmentJapaneseRun(text, position, end));
    position = end;
  }
  return result;
};

describe('versioned TinySegmenter Japanese segmentation', () => {
  test('matches shared UTF-16 fixture spans across all verification cases', () => {
    expect(fixtures.profile).toBe(JAPANESE_SEGMENTER_PROFILE);
    for (const fixture of fixtures.cases) {
      const actual = segmentRuns(fixture.text);
      expect(actual, fixture.id).toEqual(fixture.japaneseSpans);
      for (const span of actual) {
        expect(fixture.text.slice(span.start, span.end)).toBe(span.text);
      }
    }
  });

  test('preserves surrogate pairs, BMP/IVS variation selectors, and combining kana voicing marks', () => {
    const surrogateText = '𠮷野家で食べる。';
    expect(isJapaneseScriptAt(surrogateText, 0)).toBe(true);
    expect(isJapaneseScriptAt(surrogateText, 1)).toBe(false);
    const surrogateEnd = findJapaneseRunEnd(surrogateText, 0);
    expect(surrogateEnd).toBe(8);
    expect(segmentJapaneseRun(surrogateText, 0, surrogateEnd)).toEqual([
      { text: '𠮷野家', start: 0, end: 4 },
      { text: 'で', start: 4, end: 5 },
      { text: '食べる', start: 5, end: 8 }
    ]);

    const ivsText = '葛󠄀城市と神︀戸';
    expect(findJapaneseRunEnd(ivsText, 0)).toBe(ivsText.length);
    const ivsSpans = segmentJapaneseRun(ivsText, 0, ivsText.length);
    expect(ivsSpans.map(s => s.text).join('')).toBe(ivsText);
    expect(ivsSpans[0]).toEqual({ text: '葛󠄀城', start: 0, end: 4 });

    const voicingText = 'ゔぁいおりん';
    expect(findJapaneseRunEnd(voicingText, 0)).toBe(voicingText.length);
    expect(segmentJapaneseRun(voicingText, 0, voicingText.length)).toEqual([
      { text: 'ゔぁい', start: 0, end: 4 },
      { text: 'おりん', start: 4, end: 7 }
    ]);
  });

  test('rejects out-of-range bounds and invalid UTF-16 surrogate boundaries', () => {
    expect(segmentJapaneseRun('猫', 0, 0)).toEqual([]);
    expect(() => segmentJapaneseRun('猫', -1, 1)).toThrow(RangeError);
    expect(() => segmentJapaneseRun('猫', 2, 1)).toThrow(RangeError);
    expect(() => segmentJapaneseRun('猫', 0, 5)).toThrow(RangeError);
    expect(() => segmentJapaneseRun('𠮷野家', 1, 4)).toThrow(RangeError);
    expect(() => segmentJapaneseRun('\ud842', 0, 1)).toThrow(RangeError);
  });
});
