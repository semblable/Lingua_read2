import { describe, test, expect } from 'vitest';
import { foldForSearch } from '../utils/searchText';

// Same cases as the server's SearchTextTests: what Postgres's unaccent(lower(x)) returns, so the
// Library's in-folder filter and its cross-folder search agree.
describe('foldForSearch', () => {
  test.each([
    ['Sob SANÇÃO', 'sob sancao'],
    ['être', 'etre'],
    ["Ça va, Noël à l'école", "ca va, noel a l'ecole"],
    ['Músicas', 'musicas'],
    ['Łódź Źdźbło żółć', 'lodz zdzblo zolc'],
    ['Ærø', 'aero'],
    ['œuvre', 'oeuvre'],
    ['Ørsted', 'orsted'],
    ['Đakovo, Ðóra', 'dakovo, dora'],
    ['Þór', 'thor'],
    ['Straße', 'strasse'],
    ['İstanbul ılık', 'istanbul ilik'],
    ['1ª edição, nº 2', '1a edicao, no 2'],
    ['L’Étranger — Camus', "l'etranger - camus"],
    ['Άλφα', 'αλφα'],
  ])('%s -> %s', (text, expected) => {
    expect(foldForSearch(text)).toBe(expected);
  });

  test('folds decomposed input like the precomposed form', () => {
    const decomposed = 'sanc' + String.fromCharCode(0x0327) + 'a' + String.fromCharCode(0x0303) + 'o';
    expect(foldForSearch(decomposed)).toBe('sancao');
  });

  test('keeps Cyrillic letters apart except ё', () => {
    expect(foldForSearch('Йод')).toBe('йод');
    expect(foldForSearch('йод')).not.toBe(foldForSearch('иод'));
    expect(foldForSearch('ЁЛКА')).toBe(foldForSearch('елка'));
  });

  test('null, undefined and empty fold to an empty string', () => {
    expect(foldForSearch(null)).toBe('');
    expect(foldForSearch(undefined)).toBe('');
    expect(foldForSearch('')).toBe('');
  });
});
