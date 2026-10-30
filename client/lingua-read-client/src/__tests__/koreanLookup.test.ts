import { describe, expect, test } from 'vitest';
import cases from '../../../../verification/language-support/korean-cases.json';
import {
  composeKoreanLookupText,
  createKoreanLookup,
  findKoreanLookupMatches,
  isKoreanLanguageCode,
  projectKoreanLookupText,
  resolveKoreanLookup
} from '../utils/koreanLookup';
import { cleanSelectedReaderText, lowercaseLookupTerm, tokenizeContent } from '../utils/readerText';

const korean = { languageCode: 'ko', wordCharacters: '\\p{L}\\p{M}', characterSubstitutions: '', parserType: 'spacedel' };

describe('Korean lookup aliases retain source and vocabulary identity', () => {
  test.each(cases.canonical)('$id', ({ source, key }) => {
    expect(composeKoreanLookupText(source)).toBe(key);
    expect(composeKoreanLookupText(key)).toBe(key);
  });

  test('all modern syllables compose from canonical Jamo and LV plus final', () => {
    for (let code = 0xac00; code <= 0xd7a3; code++) {
      const syllable = String.fromCharCode(code);
      expect(composeKoreanLookupText(syllable.normalize('NFD'))).toBe(syllable);
      if ((code - 0xac00) % 28) {
        const lv = String.fromCharCode(code - (code - 0xac00) % 28);
        const final = String.fromCharCode(0x11a7 + (code - 0xac00) % 28);
        expect(composeKoreanLookupText(lv + final)).toBe(syllable);
      }
    }
  });

  test.each(cases.surfaces)('$id keeps display spelling and UTF-16 spans', ({ text, words }) => {
    const result = tokenizeContent(text, korean);
    expect(result.processed).toBe(text);
    expect(result.tokens.map(t => t.text).join('')).toBe(text);
    expect(result.tokens.filter(t => t.type === 'word').map(t => ({
      text: t.text, start: t.start, end: t.end,
      key: composeKoreanLookupText(lowercaseLookupTerm(t.text, 'ko'))
    }))).toEqual(words);
    result.tokens.forEach(token => expect(text.slice(token.start, token.end)).toBe(token.text));
  });

  test.each(cases.matches)('$id maps canonical matches to original source', ({ source, term, spans }) => {
    const found = findKoreanLookupMatches(source, term);
    expect(found).toEqual(spans);
    found.forEach(({ start, end }) => expect(composeKoreanLookupText(source.slice(start, end)))
      .toBe(composeKoreanLookupText(term)));
  });

  test('projection has one complete raw span per canonical UTF-16 unit', () => {
    expect(projectKoreanLookupText('🙂각각')).toEqual({
      text: '🙂각각', sourceStarts: [0, 1, 2, 5], sourceEnds: [1, 2, 5, 7]
    });
  });

  test('a unique legacy row resolves in either canonical direction without changing it', () => {
    for (const term of ['한글', '한글']) {
      const row = Object.freeze({ wordId: 41, term, status: 4, translation: 'saved meaning', cardId: 17 });
      const index = createKoreanLookup([row], row => row.term);
      expect(resolveKoreanLookup(index, '한글')).toBe(row);
      expect(resolveKoreanLookup(index, '한글')).toBe(row);
      expect(row.term).toBe(term);
    }
  });

  test('conflicting saved rows keep exact meanings and refuse an ambiguous alias', () => {
    const composed = Object.freeze({ wordId: 41, term: '각', status: 5, translation: 'first', cardId: 17 });
    const decomposed = Object.freeze({ wordId: 42, term: '각', status: 2, translation: 'second', cardId: 18 });
    for (const rows of [[composed, decomposed], [decomposed, composed]]) {
      const index = createKoreanLookup(rows, row => row.term);
      expect(resolveKoreanLookup(index, '각')).toBe(composed);
      expect(resolveKoreanLookup(index, '각')).toBe(decomposed);
      expect(resolveKoreanLookup(index, '각')).toBeNull();
      expect(rows).toHaveLength(2);
    }
  });

  test('a saved selected phrase reloads with its own identity and raw context', () => {
    const source = '“한글 테스트!”';
    const term = cleanSelectedReaderText(source, korean);
    expect(term).toBe('한글 테스트');
    const saved = { wordId: 71, term, status: 3, translation: 'phrase meaning', minedSentence: source, cardId: 91 };
    const reloaded = JSON.parse(JSON.stringify(saved)) as typeof saved;
    const index = createKoreanLookup([reloaded], row => row.term);
    expect(resolveKoreanLookup(index, '한글 테스트')).toBe(reloaded);
    expect(findKoreanLookupMatches(reloaded.minedSentence, '한글 테스트')).toEqual([{ start: 1, end: 14 }]);
    expect(reloaded).toEqual(saved);
  });

  test('duplicate exact keys and compatibility Jamo do not pick an unrelated row', () => {
    const rows = [{ term: '가' }, { term: '가' }, { term: 'ㄱㅏ' }];
    const index = createKoreanLookup(rows, row => row.term);
    expect(resolveKoreanLookup(index, '가')).toBeNull();
    expect(resolveKoreanLookup(index, '가')).toBeNull();
    expect(resolveKoreanLookup(index, 'ㄱㅏ')).toBe(rows[2]);
  });

  test('language gate accepts Korean regional/custom tags only', () => {
    ['ko', 'KO', ' ko-KR ', 'ko_KP'].forEach(code => expect(isKoreanLanguageCode(code)).toBe(true));
    [null, '', 'en', 'kok', 'zh-ko'].forEach(code => expect(isKoreanLanguageCode(code)).toBe(false));
  });
});
