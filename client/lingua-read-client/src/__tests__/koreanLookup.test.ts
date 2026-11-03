import { describe, expect, test } from 'vitest';
import cases from '../../../../verification/language-support/korean-cases.json';
import {
  analyzeKoreanToken,
  composeKoreanLookupText,
  createKoreanLookup,
  findKoreanLookupMatches,
  getBatchim,
  hasBatchim,
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

describe('Korean Josa particle decomposition & lemma analysis', () => {
  test('batchim detection identifies presence, absence, and rieul', () => {
    expect(hasBatchim('책')).toBe(true);
    expect(getBatchim('책')).toBe(1); // ㄱ
    expect(hasBatchim('가')).toBe(false);
    expect(getBatchim('가')).toBe(0);
    expect(hasBatchim('물')).toBe(true);
    expect(getBatchim('물')).toBe(8); // ㄹ
    expect(hasBatchim('A')).toBe(false);
    expect(getBatchim('A')).toBe(0);
  });

  test('ko-01 decomposition decomposes josa particles and leaves verbs intact', () => {
    expect(analyzeKoreanToken('선생님께서')).toEqual({
      lemma: '선생님',
      particle: '께서',
      particleType: 'Honorific Subject Marker'
    });
    expect(analyzeKoreanToken('학생들에게')).toEqual({
      lemma: '학생',
      particle: '들에게',
      particleType: 'Plural + Dative Marker'
    });
    expect(analyzeKoreanToken('책을')).toEqual({
      lemma: '책',
      particle: '을',
      particleType: 'Object Marker'
    });
    // Non-josa verb forms return null
    expect(analyzeKoreanToken('주셨습니다')).toBeNull();
    expect(analyzeKoreanToken('한국어')).toBeNull();
  });

  test('ko-02 decomposition handles subject, topic, additive markers and copula', () => {
    expect(analyzeKoreanToken('책이')).toEqual({
      lemma: '책',
      particle: '이',
      particleType: 'Subject Marker'
    });
    expect(analyzeKoreanToken('책은')).toEqual({
      lemma: '책',
      particle: '은',
      particleType: 'Topic Marker'
    });
    expect(analyzeKoreanToken('책도')).toEqual({
      lemma: '책',
      particle: '도',
      particleType: 'Additive Marker'
    });
    expect(analyzeKoreanToken('옛글이다')).toEqual({
      lemma: '옛글',
      particle: '이다',
      particleType: 'Copula'
    });
    // Non-josa adjectives and adverbs return null
    expect(analyzeKoreanToken('값비싼')).toBeNull();
    expect(analyzeKoreanToken('다')).toBeNull();
  });

  test('strict batchim gating enforces phonotactic particle harmony', () => {
    // -을 vs -를
    expect(analyzeKoreanToken('책을')).toEqual({ lemma: '책', particle: '을', particleType: 'Object Marker' });
    expect(analyzeKoreanToken('사과를')).toEqual({ lemma: '사과', particle: '를', particleType: 'Object Marker' });
    expect(analyzeKoreanToken('책를')).toBeNull();
    expect(analyzeKoreanToken('사과을')).toBeNull();

    // -이 vs -가
    expect(analyzeKoreanToken('책이')).toEqual({ lemma: '책', particle: '이', particleType: 'Subject Marker' });
    expect(analyzeKoreanToken('사과가')).toEqual({ lemma: '사과', particle: '가', particleType: 'Subject Marker' });
    expect(analyzeKoreanToken('책가')).toBeNull();
    expect(analyzeKoreanToken('사과이')).toBeNull();

    // -은 vs -는
    expect(analyzeKoreanToken('책은')).toEqual({ lemma: '책', particle: '은', particleType: 'Topic Marker' });
    expect(analyzeKoreanToken('사과는')).toEqual({ lemma: '사과', particle: '는', particleType: 'Topic Marker' });
    expect(analyzeKoreanToken('책는')).toBeNull();
    expect(analyzeKoreanToken('사과은')).toBeNull();

    // -과 vs -와
    expect(analyzeKoreanToken('책과')).toEqual({ lemma: '책', particle: '과', particleType: 'Connective Marker' });
    expect(analyzeKoreanToken('사과와')).toEqual({ lemma: '사과', particle: '와', particleType: 'Connective Marker' });
    expect(analyzeKoreanToken('책와')).toBeNull();
    expect(analyzeKoreanToken('사과과')).toBeNull();

    // -으로 vs -로
    // non-rieul batchim -> -으로
    expect(analyzeKoreanToken('책으로')).toEqual({ lemma: '책', particle: '으로', particleType: 'Instrumental Marker' });
    expect(analyzeKoreanToken('손으로')).toEqual({ lemma: '손', particle: '으로', particleType: 'Instrumental Marker' });
    // rieul batchim or no batchim -> -로
    expect(analyzeKoreanToken('물로')).toEqual({ lemma: '물', particle: '로', particleType: 'Instrumental Marker' });
    expect(analyzeKoreanToken('사과로')).toEqual({ lemma: '사과', particle: '로', particleType: 'Instrumental Marker' });
    expect(analyzeKoreanToken('책로')).toBeNull();
    expect(analyzeKoreanToken('물으로')).toBeNull();

    // -이에요 vs -예요
    expect(analyzeKoreanToken('책이에요')).toEqual({ lemma: '책', particle: '이에요', particleType: 'Copula' });
    expect(analyzeKoreanToken('사과예요')).toEqual({ lemma: '사과', particle: '예요', particleType: 'Copula' });
    expect(analyzeKoreanToken('책예요')).toBeNull();
    expect(analyzeKoreanToken('사과이에요')).toBeNull();
  });

  test('1-syllable whitelist allows common nouns and blocks false positives', () => {
    // Whitelisted 1-syllable nouns decompose
    for (const noun of ['책', '집', '밥', '물', '눈', '손', '발', '꽃', '돈', '방', '문', '산', '강', '달', '별', '해', '돌', '새']) {
      expect(analyzeKoreanToken(`${noun}도`)).toEqual({ lemma: noun, particle: '도', particleType: 'Additive Marker' });
    }

    // Non-whitelisted 1-syllable stems are strictly protected
    expect(analyzeKoreanToken('오이')).toBeNull();
    expect(analyzeKoreanToken('포도')).toBeNull();
    expect(analyzeKoreanToken('사자')).toBeNull();
    expect(analyzeKoreanToken('지도')).toBeNull();
  });

  test('3+ syllable guards protect bound suffixes, loanwords, and agent nouns', () => {
    expect(analyzeKoreanToken('고속도로')).toBeNull();
    expect(analyzeKoreanToken('민주주의')).toBeNull();
    expect(analyzeKoreanToken('선거제도')).toBeNull();
    expect(analyzeKoreanToken('한반도')).toBeNull();
    expect(analyzeKoreanToken('바나나')).toBeNull();
    expect(analyzeKoreanToken('코로나')).toBeNull();
    expect(analyzeKoreanToken('정치가')).toBeNull();
    expect(analyzeKoreanToken('만화가')).toBeNull();

    // But inflections on these protected stems decompose correctly
    expect(analyzeKoreanToken('고속도로로')).toEqual({
      lemma: '고속도로',
      particle: '로',
      particleType: 'Instrumental Marker'
    });
    expect(analyzeKoreanToken('민주주의를')).toEqual({
      lemma: '민주주의',
      particle: '를',
      particleType: 'Object Marker'
    });
    expect(analyzeKoreanToken('정치가가')).toEqual({
      lemma: '정치가',
      particle: '가',
      particleType: 'Subject Marker'
    });
    expect(analyzeKoreanToken('바나나를')).toEqual({
      lemma: '바나나',
      particle: '를',
      particleType: 'Object Marker'
    });
  });

  test('stacked particles and copula combinations decompose right-to-left', () => {
    expect(analyzeKoreanToken('학교에서는')).toEqual({
      lemma: '학교',
      particle: '에서는',
      particleType: 'Locative + Topic Marker'
    });
    expect(analyzeKoreanToken('선생님께서는')).toEqual({
      lemma: '선생님',
      particle: '께서는',
      particleType: 'Honorific Subject + Topic Marker'
    });
    expect(analyzeKoreanToken('친구에게도')).toEqual({
      lemma: '친구',
      particle: '에게도',
      particleType: 'Dative + Additive Marker'
    });
    expect(analyzeKoreanToken('학생들입니다')).toEqual({
      lemma: '학생',
      particle: '들입니다',
      particleType: 'Plural + Copula'
    });
    expect(analyzeKoreanToken('학생들')).toEqual({
      lemma: '학생',
      particle: '들',
      particleType: 'Plural Marker'
    });
  });
});
