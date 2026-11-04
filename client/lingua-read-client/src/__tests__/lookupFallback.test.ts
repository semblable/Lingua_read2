import { describe, expect, test } from 'vitest';
import { lowercaseLookupTerm, resolveLookupKey, tokenizeContent } from '../utils/readerText';

describe('language-gated normalized lookup and validated fallback', () => {
  test.each([
    ['fr', "l'eau", 'eau', 'eau'], ['fr-CA', 'D’Anne', 'Anne', 'anne'],
    ['fr_FR', 'lʼeau', 'eau', 'eau'], ['fr', "l'eau", 'eau|l’eau', "l'eau"],
    ['fr', "d'accord", "accord|d'accord", "d'accord"], ['fr', "aujourd'hui", 'hui', null],
    ['fr', "qu'il", 'il', null], ['fr', "l'a", 'a', null],
    ['fr', "l'ami fidèle", 'ami fidèle', null], ['fr', "d'l'eau", "l'eau|eau", null],
    ['fr', "l'arc-en-ciel", 'arc-en-ciel', null], ['fr', "l'123", '123', null],
    ['fr', "l'inconnu", 'eau', null], ['fr', "l'𐐨a", '𐐨a', '𐐨a'],
    ['fr', "l'İa", 'ia', 'ia'], ['fr', "l'ΟΣ", 'οσ', 'οσ'], ['fr', "l'âme", 'âme', 'âme'],
    ['fr', "l'ax́e", 'ax́e', 'ax́e'],
    ['fr', "l'á", 'á', null], ['fr', "l'́a", '́a', null], ['fr', "l'́ab", '́ab', null],
    ['en', "l'eau", 'eau', null], ['pt', "d'água", 'água', null]
  ])('%s bounded elision %s preserves exact precedence', (code, term, fixture, expected) =>
    expect(resolveLookupKey(term!, code, fixture!.split('|'))).toBe(expected));

  test.each([
    ['he', '"צה"ל"', 'צה״ל'], ['he', "'מס'", 'מס׳'], ['he', 'וכו׳', 'וכו׳'],
    ['ar', 'کِتاب يی أإآٱ ةه', 'كتاب يي اااا ةه'],
    ['fa', 'كِتاب يی أإآٱ ةه', 'کتاب یی اااا ةه'],
    ['tr', 'İI', 'iı'], ['az-Latn', 'İI', 'iı'],
    ['el', 'λόγος', 'λογοσ'], ['el', 'ΛΟΓΟΣ', 'λογοσ'], ['en', 'I', 'i'], ['en', 'ς', 'ς']
  ])('%s normalizes %s', (code, term, expected) => expect(lowercaseLookupTerm(term, code)).toBe(expected));

  test.each([
    ['he', 'וכו׳', 'וכו׳|וכו', 'וכו׳'], ['he', 'מס׳', 'מס', 'מס'],
    ['he', 'והספר', 'ספר', 'ספר'], ['he', 'ובספר', 'בספר|ספר', 'בספר'],
    ['he', 'ושמהספר', 'ספר', 'ספר'], ['ar', 'والكتاب', 'كتاب', 'كتاب'],
    ['ar', 'للكتاب', 'كتاب', 'كتاب'], ['ar', 'فبالكتاب', 'كتاب', 'كتاب'],
    ['ar', 'والكتاب', 'والكتاب|كتاب', 'والكتاب'], ['ar', 'بكتاب', 'کِتاب', 'كتاب'],
    ['en', 'והספר', 'ספר', null], ['he', 'ומסתורין', 'ספר', null]
  ])('%s resolves %s only to fixture headwords', (code, term, fixture, expected) =>
    expect(resolveLookupKey(term!, code, fixture!.split('|'))).toBe(expected));

  test('Hebrew trailing geresh remains in clickable spans', () => {
    const result = tokenizeContent("מס׳ וכו'", { code: 'he' });
    expect(result.tokens.filter(t => t.type === 'word').map(t => t.text)).toEqual(['מס׳', "וכו'"]);
  });

  test('Greek accent folding preserves malformed UTF16 and folds valid runs', () => {
    expect(lowercaseLookupTerm('Ά\uD800 Ώ\uDC00', 'el')).toBe('α\uD800 ω\uDC00');
  });
});
