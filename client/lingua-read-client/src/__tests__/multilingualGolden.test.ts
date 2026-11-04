import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { tokenizeContent, lowercaseLookupTerm, resolveLookupKey, type LanguageConfig } from '../utils/readerText';
import { initializeThaiSegmentation } from '../utils/thaiRuntime';
import { initializeChineseSegmentation } from '../utils/chineseRuntime';

type GoldenToken = { surface_span: string; start: number; end: number; lookup_key: string };
type GoldenCase = { id: string; language: LanguageConfig; input: string; sentence: string; tokens: GoldenToken[] };
const root = resolve(process.cwd(), '../..');
const goldenSuite = JSON.parse(readFileSync(resolve(root, 'tests/golden/multilingual_tokenizer_and_lemmatizer_test_suite_v4.json'), 'utf8')) as {
  offset_unit: string; cases: GoldenCase[];
  reference_suite: { languages: Array<{ code: string; tests: Array<{ id: string }> }> };
  normalization_cases: Array<{ id: string; lang: string; term: string; expected: string }>;
  lookup_cases: Array<{ id: string; lang: string; term: string; vocabulary: string[]; expected: string | null }>;
};
initializeThaiSegmentation(readFileSync(resolve(root, 'server/LinguaReadApi/Resources/Segmentation/words_th.txt'), 'utf8'));
initializeChineseSegmentation(readFileSync(resolve(root, 'server/LinguaReadApi/Resources/Segmentation/jieba-big-v1.txt'), 'utf8'));

describe('shared multilingual UTF-16 runtime contract', () => {
  test('pins the offset unit', () => expect(goldenSuite.offset_unit).toBe('UTF-16 code units'));
  test('preserves and executes every source case across all 44 languages', () => {
    const referenceIds = goldenSuite.reference_suite.languages.flatMap(language => language.tests.map(fixture => fixture.id));
    expect(goldenSuite.reference_suite.languages).toHaveLength(44);
    expect(referenceIds).toHaveLength(89);
    expect(new Set(goldenSuite.cases.map(fixture => fixture.id)).size).toBe(goldenSuite.cases.length);
    for (const id of referenceIds) expect(goldenSuite.cases.some(fixture => fixture.id === id)).toBe(true);
  });
  test('fixture bytes are UTF-8 without BOM and LF only', () => {
    const bytes = readFileSync(resolve(root, 'tests/golden/multilingual_tokenizer_and_lemmatizer_test_suite_v4.json'));
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.includes(0x0d)).toBe(false);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
  });
  test.each(goldenSuite.cases)('$id', fixture => {
    const actual = tokenizeContent(fixture.input, fixture.language);
    expect(actual.processed).toBe(fixture.sentence);
    expect(actual.tokens.filter(token => token.type === 'word').map(token => ({
      surface_span: token.text, start: token.start, end: token.end,
      lookup_key: lowercaseLookupTerm(token.text, fixture.language?.code)
    }))).toEqual(fixture.tokens.map(({ surface_span, start, end, lookup_key }) => ({ surface_span, start, end, lookup_key })));
    for (const token of actual.tokens) {
      expect(fixture.sentence.slice(token.start, token.end)).toBe(token.text);
    }
  });
  test.each(goldenSuite.normalization_cases)('$id', fixture => {
    expect(lowercaseLookupTerm(fixture.term, fixture.lang)).toBe(fixture.expected);
  });
  test.each(goldenSuite.lookup_cases)('$id', fixture => {
    expect(resolveLookupKey(fixture.term, fixture.lang, fixture.vocabulary)).toBe(fixture.expected);
    expect(resolveLookupKey(fixture.term, fixture.lang, [...fixture.vocabulary].reverse())).toBe(fixture.expected);
  });
});
