import { describe, expect, test } from 'vitest';
import cases from '../../../../verification/language-support/korean-cases.json';
import {
  analyzeKoreanToken,
  composeKoreanLookupText,
  createKoreanLookup,
  deconjugateKoreanVerb,
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
    // Deconjugation handles verb honorific past polite
    expect(analyzeKoreanToken('주셨습니다')).toEqual({
      lemma: '주다',
      particle: '셨습니다',
      particleType: 'Honorific Past Polite'
    });
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
    // Adjective modifier form deconjugates to dictionary form
    expect(analyzeKoreanToken('값비싼')).toEqual({
      lemma: '값비싸다',
      particle: 'ㄴ',
      particleType: 'Modifier Form'
    });
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

  test('verb deconjugation - honorific endings', () => {
    expect(analyzeKoreanToken('주셨습니다')).toEqual({
      lemma: '주다',
      particle: '셨습니다',
      particleType: 'Honorific Past Polite'
    });
    expect(analyzeKoreanToken('하셨습니다')).toEqual({
      lemma: '하다',
      particle: '셨습니다',
      particleType: 'Honorific Past Polite'
    });
    expect(analyzeKoreanToken('가셨습니다')).toEqual({
      lemma: '가다',
      particle: '셨습니다',
      particleType: 'Honorific Past Polite'
    });
    expect(analyzeKoreanToken('보셨습니다')).toEqual({
      lemma: '보다',
      particle: '셨습니다',
      particleType: 'Honorific Past Polite'
    });
    expect(analyzeKoreanToken('하시었습니다')).toEqual({
      lemma: '하다',
      particle: '시었습니다',
      particleType: 'Honorific Past Polite'
    });
    expect(analyzeKoreanToken('주셨어요')).toEqual({
      lemma: '주다',
      particle: '셨어요',
      particleType: 'Honorific Past Polite'
    });
    expect(analyzeKoreanToken('가세요')).toEqual({
      lemma: '가다',
      particle: '세요',
      particleType: 'Honorific Polite'
    });
    expect(analyzeKoreanToken('주세요')).toEqual({
      lemma: '주다',
      particle: '세요',
      particleType: 'Honorific Polite'
    });
    expect(analyzeKoreanToken('먹으세요')).toEqual({
      lemma: '먹다',
      particle: '으세요',
      particleType: 'Honorific Polite'
    });
    expect(analyzeKoreanToken('가셔요')).toEqual({
      lemma: '가다',
      particle: '셔요',
      particleType: 'Honorific Polite'
    });
    expect(analyzeKoreanToken('가시지요')).toEqual({
      lemma: '가다',
      particle: '시지요',
      particleType: 'Honorific Polite'
    });
    expect(analyzeKoreanToken('가시죠')).toEqual({
      lemma: '가다',
      particle: '시죠',
      particleType: 'Honorific Polite'
    });
    expect(analyzeKoreanToken('가시어')).toEqual({
      lemma: '가다',
      particle: '시어',
      particleType: 'Honorific'
    });
  });

  test('verb deconjugation - formal polite endings', () => {
    expect(analyzeKoreanToken('먹습니다')).toEqual({
      lemma: '먹다',
      particle: '습니다',
      particleType: 'Formal Polite'
    });
    expect(analyzeKoreanToken('있습니다')).toEqual({
      lemma: '있다',
      particle: '습니다',
      particleType: 'Formal Polite'
    });
    expect(analyzeKoreanToken('없습니다')).toEqual({
      lemma: '없다',
      particle: '습니다',
      particleType: 'Formal Polite'
    });
    expect(analyzeKoreanToken('좋습니다')).toEqual({
      lemma: '좋다',
      particle: '습니다',
      particleType: 'Formal Polite'
    });

    expect(analyzeKoreanToken('갑니다')).toEqual({
      lemma: '가다',
      particle: 'ㅂ니다',
      particleType: 'Formal Polite'
    });
    expect(analyzeKoreanToken('봅니다')).toEqual({
      lemma: '보다',
      particle: 'ㅂ니다',
      particleType: 'Formal Polite'
    });
    expect(analyzeKoreanToken('합니다')).toEqual({
      lemma: '하다',
      particle: 'ㅂ니다',
      particleType: 'Formal Polite'
    });
    expect(analyzeKoreanToken('줍니다')).toEqual({
      lemma: '주다',
      particle: 'ㅂ니다',
      particleType: 'Formal Polite'
    });
    expect(analyzeKoreanToken('값비쌉니다')).toEqual({
      lemma: '값비싸다',
      particle: 'ㅂ니다',
      particleType: 'Formal Polite'
    });

    expect(analyzeKoreanToken('먹습니까')).toEqual({
      lemma: '먹다',
      particle: '습니까',
      particleType: 'Formal Polite Question'
    });
    expect(analyzeKoreanToken('갑니까')).toEqual({
      lemma: '가다',
      particle: 'ㅂ니까',
      particleType: 'Formal Polite Question'
    });
    expect(analyzeKoreanToken('합니까')).toEqual({
      lemma: '하다',
      particle: 'ㅂ니까',
      particleType: 'Formal Polite Question'
    });
  });

  test('verb deconjugation - past tense and contractions', () => {
    expect(analyzeKoreanToken('갔어요')?.lemma).toBe('가다');
    expect(analyzeKoreanToken('갔습니다')?.lemma).toBe('가다');
    expect(analyzeKoreanToken('왔어요')?.lemma).toBe('오다');
    expect(analyzeKoreanToken('왔습니다')?.lemma).toBe('오다');
    expect(analyzeKoreanToken('봤어요')?.lemma).toBe('보다');
    expect(analyzeKoreanToken('봤습니다')?.lemma).toBe('보다');
    expect(analyzeKoreanToken('줬어요')?.lemma).toBe('주다');
    expect(analyzeKoreanToken('줬습니다')?.lemma).toBe('주다');
    expect(analyzeKoreanToken('했어요')?.lemma).toBe('하다');
    expect(analyzeKoreanToken('했습니다')?.lemma).toBe('하다');
    expect(analyzeKoreanToken('먹었어요')?.lemma).toBe('먹다');
    expect(analyzeKoreanToken('먹었습니다')?.lemma).toBe('먹다');
    expect(analyzeKoreanToken('예뻤어요')?.lemma).toBe('예쁘다');
    expect(analyzeKoreanToken('예뻤습니다')?.lemma).toBe('예쁘다');
    expect(analyzeKoreanToken('바빴어요')?.lemma).toBe('바쁘다');
    expect(analyzeKoreanToken('바빴습니다')?.lemma).toBe('바쁘다');
  });

  test('verb deconjugation - present tense polite', () => {
    expect(analyzeKoreanToken('가요')?.lemma).toBe('가다');
    expect(analyzeKoreanToken('봐요')?.lemma).toBe('보다');
    expect(analyzeKoreanToken('와요')?.lemma).toBe('오다');
    expect(analyzeKoreanToken('줘요')?.lemma).toBe('주다');
    expect(analyzeKoreanToken('해요')?.lemma).toBe('하다');
    expect(analyzeKoreanToken('먹어요')?.lemma).toBe('먹다');
    expect(analyzeKoreanToken('예뻐요')?.lemma).toBe('예쁘다');
    expect(analyzeKoreanToken('바빠요')?.lemma).toBe('바쁘다');
    expect(analyzeKoreanToken('마셔요')?.lemma).toBe('마시다');
    expect(analyzeKoreanToken('써요')?.lemma).toBe('쓰다');
    expect(analyzeKoreanToken('커요')?.lemma).toBe('크다');
  });

  test('verb deconjugation - connective and conditional', () => {
    expect(analyzeKoreanToken('먹고')).toEqual({ lemma: '먹다', particle: '고', particleType: 'Connective' });
    expect(analyzeKoreanToken('가고')).toEqual({ lemma: '가다', particle: '고', particleType: 'Connective' });
    expect(analyzeKoreanToken('하고')).toEqual({ lemma: '하다', particle: '고', particleType: 'Connective' });

    expect(analyzeKoreanToken('먹지만')).toEqual({ lemma: '먹다', particle: '지만', particleType: 'Contrastive' });
    expect(analyzeKoreanToken('하지만')).toEqual({ lemma: '하다', particle: '지만', particleType: 'Contrastive' });
    expect(analyzeKoreanToken('있지만')).toEqual({ lemma: '있다', particle: '지만', particleType: 'Contrastive' });

    expect(analyzeKoreanToken('가서')).toEqual({ lemma: '가다', particle: '아서', particleType: 'Causal/Sequential' });
    expect(analyzeKoreanToken('와서')).toEqual({ lemma: '오다', particle: '아서', particleType: 'Causal/Sequential' });
    expect(analyzeKoreanToken('봐서')).toEqual({ lemma: '보다', particle: '아서', particleType: 'Causal/Sequential' });
    expect(analyzeKoreanToken('먹어서')).toEqual({ lemma: '먹다', particle: '어서', particleType: 'Causal/Sequential' });
    expect(analyzeKoreanToken('해서')).toEqual({ lemma: '하다', particle: '해서', particleType: 'Causal/Sequential' });

    expect(analyzeKoreanToken('먹으면')).toEqual({ lemma: '먹다', particle: '으면', particleType: 'Conditional' });
    expect(analyzeKoreanToken('가면')).toEqual({ lemma: '가다', particle: '면', particleType: 'Conditional' });
    expect(analyzeKoreanToken('하면')).toEqual({ lemma: '하다', particle: '면', particleType: 'Conditional' });

    expect(analyzeKoreanToken('가는데')).toEqual({ lemma: '가다', particle: '는데', particleType: 'Connective/Background' });
    expect(analyzeKoreanToken('먹는데')).toEqual({ lemma: '먹다', particle: '는데', particleType: 'Connective/Background' });
    expect(analyzeKoreanToken('예쁜데')).toEqual({ lemma: '예쁘다', particle: 'ㄴ데', particleType: 'Connective/Background' });

    expect(analyzeKoreanToken('가니까')).toEqual({ lemma: '가다', particle: '니까', particleType: 'Causal' });
    expect(analyzeKoreanToken('먹으니까')).toEqual({ lemma: '먹다', particle: '으니까', particleType: 'Causal' });

    expect(analyzeKoreanToken('가려고')).toEqual({ lemma: '가다', particle: '려고', particleType: 'Intentional' });
    expect(analyzeKoreanToken('먹으려고')).toEqual({ lemma: '먹다', particle: '으려고', particleType: 'Intentional' });
  });

  test('verb deconjugation - adnominal modifier forms', () => {
    expect(analyzeKoreanToken('값비싼')).toEqual({ lemma: '값비싸다', particle: 'ㄴ', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('예쁜')).toEqual({ lemma: '예쁘다', particle: 'ㄴ', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('빠른')).toEqual({ lemma: '빠르다', particle: 'ㄴ', particleType: 'Modifier Form' });

    expect(analyzeKoreanToken('먹은')).toEqual({ lemma: '먹다', particle: '은', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('좋은')).toEqual({ lemma: '좋다', particle: '은', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('작은')).toEqual({ lemma: '작다', particle: '은', particleType: 'Modifier Form' });

    expect(analyzeKoreanToken('가는')).toEqual({ lemma: '가다', particle: '는', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('먹는')).toEqual({ lemma: '먹다', particle: '는', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('보는')).toEqual({ lemma: '보다', particle: '는', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('하는')).toEqual({ lemma: '하다', particle: '는', particleType: 'Modifier Form' });

    expect(analyzeKoreanToken('먹을')).toEqual({ lemma: '먹다', particle: '을', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('값비쌀')).toEqual({ lemma: '값비싸다', particle: 'ㄹ', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('예쁠')).toEqual({ lemma: '예쁘다', particle: 'ㄹ', particleType: 'Modifier Form' });

    expect(analyzeKoreanToken('가던')).toEqual({ lemma: '가다', particle: '던', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('먹던')).toEqual({ lemma: '먹다', particle: '던', particleType: 'Modifier Form' });
    expect(analyzeKoreanToken('했던')).toEqual({ lemma: '하다', particle: '던', particleType: 'Modifier Form' });
  });

  test('verb deconjugation - common irregulars', () => {
    // ㄷ irregular
    expect(analyzeKoreanToken('들어요')?.lemma).toBe('듣다');
    expect(analyzeKoreanToken('들은')?.lemma).toBe('듣다');
    expect(analyzeKoreanToken('들으면')?.lemma).toBe('듣다');

    // ㅂ irregular
    expect(analyzeKoreanToken('도와요')?.lemma).toBe('돕다');
    expect(analyzeKoreanToken('도운')?.lemma).toBe('돕다');
    expect(analyzeKoreanToken('어려워요')?.lemma).toBe('어렵다');
    expect(analyzeKoreanToken('어려운')?.lemma).toBe('어렵다');
    expect(analyzeKoreanToken('추워요')?.lemma).toBe('춥다');
    expect(analyzeKoreanToken('추운')?.lemma).toBe('춥다');
    expect(analyzeKoreanToken('고마워요')?.lemma).toBe('고맙다');
    expect(analyzeKoreanToken('고마운')?.lemma).toBe('고맙다');

    // ㅅ irregular
    expect(analyzeKoreanToken('나아요')?.lemma).toBe('낫다');
    expect(analyzeKoreanToken('나은')?.lemma).toBe('낫다');
    expect(analyzeKoreanToken('지어요')?.lemma).toBe('짓다');
    expect(analyzeKoreanToken('지은')?.lemma).toBe('짓다');

    // 르 irregular
    expect(analyzeKoreanToken('몰라요')?.lemma).toBe('모르다');
    expect(analyzeKoreanToken('몰랐어요')?.lemma).toBe('모르다');
    expect(analyzeKoreanToken('빨라요')?.lemma).toBe('빠르다');
    expect(analyzeKoreanToken('빨랐어요')?.lemma).toBe('빠르다');
    expect(analyzeKoreanToken('불러요')?.lemma).toBe('부르다');
    expect(analyzeKoreanToken('불렀어요')?.lemma).toBe('부르다');

    // ㅎ irregular
    expect(analyzeKoreanToken('하얘요')?.lemma).toBe('하얗다');
    expect(analyzeKoreanToken('하얀')?.lemma).toBe('하얗다');
    expect(analyzeKoreanToken('그래요')?.lemma).toBe('그렇다');
    expect(analyzeKoreanToken('그런')?.lemma).toBe('그렇다');
  });

  test('direct deconjugateKoreanVerb API', () => {
    const analysis1 = deconjugateKoreanVerb('주셨습니다');
    expect(analysis1).toEqual({ lemma: '주다', particle: '셨습니다', particleType: 'Honorific Past Polite' });

    const analysis2 = deconjugateKoreanVerb('간');
    expect(analysis2).toEqual({ lemma: '가다', particle: 'ㄴ', particleType: 'Modifier Form' });

    const analysis3 = deconjugateKoreanVerb('본');
    expect(analysis3).toEqual({ lemma: '보다', particle: 'ㄴ', particleType: 'Modifier Form' });

    const analysis4 = deconjugateKoreanVerb('한');
    expect(analysis4).toEqual({ lemma: '하다', particle: 'ㄴ', particleType: 'Modifier Form' });

    const analysis5 = deconjugateKoreanVerb('갈');
    expect(analysis5).toEqual({ lemma: '가다', particle: 'ㄹ', particleType: 'Modifier Form' });

    const analysis6 = deconjugateKoreanVerb('볼');
    expect(analysis6).toEqual({ lemma: '보다', particle: 'ㄹ', particleType: 'Modifier Form' });

    const analysis7 = deconjugateKoreanVerb('할');
    expect(analysis7).toEqual({ lemma: '하다', particle: 'ㄹ', particleType: 'Modifier Form' });

    expect(deconjugateKoreanVerb('오이')).toBeNull();
    expect(deconjugateKoreanVerb('포도')).toBeNull();
    expect(deconjugateKoreanVerb('한국어')).toBeNull();
  });
});
