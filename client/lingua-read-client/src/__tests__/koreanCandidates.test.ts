import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeKoreanCandidates, rankKoreanCandidates } from '../utils/koreanLookup';

describe('Korean dictionary candidates', () => {
  test('independent build contexts embed the pinned canonical KRDICT data', () => {
    for (const path of [
      'resources/krdict_lemmas.txt',
      'client/lingua-read-client/src/resources/krdict_lemmas.txt',
      'server/LinguaReadApi/Resources/Korean/krdict_lemmas.txt'
    ]) {
      const bytes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../', path));
      expect(createHash('sha256').update(bytes).digest('hex'))
        .toBe('0a9969de8b86597f947128ddb72fc7e17e686adc1e064ddb3fbf9ccde802e1e5');
    }
  });
  test.each([
    ['길이', ['길이', '길']], ['먹이', ['먹이', '먹']],
    ['놀이', ['놀이', '놀다']], ['높이', ['높이', '높다']],
    ['산다', ['사다', '살다']], ['간다', ['가다', '갈다']],
    ['사는데', ['사다', '살다']], ['아는데', ['알다']], ['만드는데', ['만들다']],
    ['사네', ['사다', '살다']], ['아네', ['알다']],
    ['삽니다', ['사다', '살다']], ['사십니까', ['사다', '살다']],
    ['사는', ['사다', '살다']], ['아는', ['알다']],
    ['만든', ['만들다']], ['산', ['산', '사다', '살다']],
    ['간', ['간', '가다', '갈다']], ['살', ['살', '사다', '살다']],
    ['갈', ['가다', '갈다']], ['알', ['알', '알다']],
    ['사세요', ['사다', '살다']], ['아십니다', ['알다']]
  ])('%s retains all validated readings', (surface, lemmas) => {
    expect(analyzeKoreanCandidates(surface).map(candidate => candidate.lemma)).toEqual(expect.arrayContaining(lemmas));
  });

  test('unvalidated alternatives drop only when another alternative validates', () => {
    const candidates = [
      { lemma: '가다', particle: 'ㄴ', particleType: 'Modifier Form' },
      { lemma: '갈다', particle: 'ㄴ', particleType: 'Modifier Form' }
    ];
    expect(rankKoreanCandidates(candidates, new Set(['갈다'])).map(c => c.lemma)).toEqual(['갈다']);
    expect(rankKoreanCandidates(candidates, new Set()).map(c => c.lemma)).toEqual(['가다', '갈다']);
    expect(rankKoreanCandidates(candidates, new Set()).every(c => !c.dictionaryValidated)).toBe(true);
  });

  test('frequency ties use UTF-16 ordinal order independent of fixture insertion', () => {
    const candidates = ['살다', '사다', '가다'].map(lemma => ({ lemma, particle: '', particleType: '' }));
    expect(rankKoreanCandidates(candidates, new Set(candidates.map(c => c.lemma))).map(c => c.lemma))
      .toEqual(['가다', '사다', '살다']);
    expect(rankKoreanCandidates(candidates, new Set(candidates.map(c => c.lemma)), new Map([['살다', 20], ['사다', 10]]))
      .map(c => c.lemma)).toEqual(['살다', '사다', '가다']);
  });
});
