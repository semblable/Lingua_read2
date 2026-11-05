import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { tokenizeContent, lowercaseLookupTerm, resolveLookupKey, type LanguageConfig } from '../utils/readerText';
import { initializeThaiSegmentation } from '../utils/thaiRuntime';
import { initializeChineseSegmentation } from '../utils/chineseRuntime';
import { analyzeKoreanCandidates, rankKoreanCandidates } from '../utils/koreanLookup';

type GoldenToken = { surface_span: string; start: number; end: number; lookup_key: string };
type GoldenCase = {
  id: string;
  language: LanguageConfig;
  input: string;
  sentence: string;
  tokens: GoldenToken[];
  provenance: { differences?: string[] };
};
const root = resolve(process.cwd(), '../..');
const goldenSuite = JSON.parse(readFileSync(resolve(root, 'tests/golden/multilingual_tokenizer_and_lemmatizer_test_suite_v4.json'), 'utf8')) as {
  offset_unit: string; cases: GoldenCase[];
  reference_suite: { languages: Array<{ code: string; tests: Array<{ id: string }> }> };
  reference_gap_summary: {
    runtime_cases: number;
    cases_with_runtime_span_or_key_differences: number;
    cases_with_reference_semantic_lemmas: number;
  };
  normalization_cases: Array<{ id: string; lang: string; term: string; expected: string }>;
  lookup_cases: Array<{ id: string; lang: string; term: string; vocabulary: string[]; expected: string | null }>;
  korean_candidate_cases: Array<{ id: string; surface: string; expected_lemmas: string[] }>;
  korean_ranking_cases: Array<{ id: string; lemmas: string[]; headwords: string[]; frequencies: Record<string, number>;
    expected_lemmas: string[]; expected_validated: boolean; expected_rank: number }>;
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
    const spanDiffs = goldenSuite.cases.filter(fixture => fixture.provenance.differences?.includes('runtime_token_spans_or_keys')).length;
    const semanticDiffs = goldenSuite.cases.filter(fixture => fixture.provenance.differences?.includes('reference_semantic_lemmas')).length;
    expect(goldenSuite.reference_gap_summary.runtime_cases).toBe(goldenSuite.cases.length);
    expect(spanDiffs).toBe(11);
    expect(goldenSuite.reference_gap_summary.cases_with_runtime_span_or_key_differences).toBe(spanDiffs);
    expect(semanticDiffs).toBe(86);
    expect(goldenSuite.reference_gap_summary.cases_with_reference_semantic_lemmas).toBe(semanticDiffs);
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
  test.each(goldenSuite.korean_candidate_cases)('$id', fixture => {
    expect(analyzeKoreanCandidates(fixture.surface).map(candidate => candidate.lemma)).toEqual(fixture.expected_lemmas);
  });
  test.each(goldenSuite.korean_ranking_cases)('$id', fixture => {
    for (const lemmas of [fixture.lemmas, [...fixture.lemmas].reverse()]) {
      const actual = rankKoreanCandidates(lemmas.map(lemma => ({ lemma, particle: '', particleType: '' })),
        new Set(fixture.headwords), new Map(Object.entries(fixture.frequencies)));
      expect(actual.map(candidate => candidate.lemma)).toEqual(fixture.expected_lemmas);
      expect(actual.every(candidate => candidate.dictionaryValidated === fixture.expected_validated && candidate.rank === fixture.expected_rank)).toBe(true);
    }
  });
});
