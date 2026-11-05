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
    ['en', "l'eau", 'eau', null], ['pt', "d'água", 'água', null],
    ['it', "l'acqua", 'acqua', 'acqua'], ['it-IT', 'd’acqua', 'acqua', 'acqua'],
    ['it', "un'occhiata", 'occhiata', 'occhiata'], ['it', "quell'albero", 'albero', 'albero'],
    ['it', "po'", 'po', 'po'], ['it', 'Po’', "po|po'", "po'"],
    ['it', "d'accordo", "accordo|d'accordo", "d'accordo"], ['it', "nell'ombra", 'ombra', null],
    ['it', "qualcos'altro", 'altro', null], ['it', "c'è", 'è|essere', null],
    ['it', "un'idea", 'acqua', null], ['it', "l'İa", 'ia', 'ia'], ['it', "l'ΟΣ", 'οσ', 'οσ'],
    ['ca', "L'home", 'home', 'home'], ['ca-ES', 'd’aigua', 'aigua', 'aigua'],
    ['ca', "d'un", 'un', 'un'], ['ca', "l'església", 'església|l’església', "l'església"],
    ['ca', "d'anar-te'n", "anar-te'n|anar", null], ['ca', "Dona'm-ho", 'dona|donar', null],
    ['ca', "l'objecte", 'aigua', null], ['ca', "l'İa", 'ia', 'ia'], ['ca', "l'ΟΣ", 'οσ', 'οσ']
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

  test('Italian trailing po and numeric/currency spans preserve boundaries', () => {
    const itResult = tokenizeContent("C'è un po' d'acqua e 'po'!", { code: 'it' });
    expect(itResult.tokens.filter(t => t.type === 'word').map(t => t.text))
      .toEqual(["C'è", 'un', "po'", "d'acqua", 'e', 'po']);

    const numResult = tokenizeContent(
      'Koszt 12,5 zł, pi 3.14. Цена 1\u00A0500,50 ₽, 12\u202F500,75 €, € 25.000,-, 10%-os, ۴۵٬۰۰۰.',
      { code: 'pl' }
    );
    expect(numResult.tokens.filter(t => t.type === 'word').map(t => t.text)).toEqual([
      'Koszt', '12,5', 'zł', 'pi', '3.14', 'Цена', '1\u00A0500,50', '₽',
      '12\u202F500,75', '€', '€', '25.000,-', '10%-os', '۴۵٬۰۰۰'
    ]);
    expect(numResult.tokens.some(t => t.type === 'separator' && t.text === '.')).toBe(true);
  });
});

test.each([
  ["af-ZA", "'n 'N 'n' 'name 's", "'n|'N|n|name|s"],
  ["nl-NL", "'s 'S 't 'T 's' 't' 'test 'n", "'s|'S|'t|'T|s|t|test|n"],
  ["en", "'hello' 'em 'tis don't dogs' rock 'n' roll", "hello|em|tis|don't|dogs|rock|n|roll"],
  ["fi", "EU:ssa EU: ssa EU:SSA EU:2 EU:! sana:ssa U.S.A.:ssa", "EU:ssa|EU|ssa|EU|SSA|EU|EU|sana:ssa|U.S.A.:ssa"],
  ["en", "EU:ssa Dr. U.S.A. A.B word. A.Beta A.", "EU|ssa|Dr.|U.S.A.|A.B|word|A|Beta|A"],
  ["fr", "M. Dupont arriva.", "M|Dupont|arriva"],
  ["uk", "1 250,00 грн. 12 345 678,90 kg 2026 2 000 грн.", "1 250,00|грн.|12 345 678,90|kg|грн."],
  ["uk", "1 250,00! 12 34,50 грн. 1 250 грн.", "250,00|34,50|грн.|грн."],
  ["uk", "€ 1 250,00. 1 250,00 %", "€|1 250,00|1 250,00"]
])('bounded spans %s: %s', (code, input, expected) => {
  const result = tokenizeContent(input, { code });
  expect(result.tokens.filter(t => t.type === 'word').map(t => t.text)).toEqual(expected.split('|'));
  for (const token of result.tokens) expect(result.processed.slice(token.start, token.end)).toBe(token.text);
});

test.each([
  ["af", "’N", "'n"],
  ["nl", "’S", "'s"],
  ["nl", "’T", "'t"],
  ["fi", "EU:ssa", "eu:ssa"],
  ["en", "U.S.A.", "u.s.a."],
  ["en", "Dr.", "dr."],
  ["uk", "грн.", "грн."],
  ["uk", "1 250,00", "1 250,00"]
])('%s bounded key %s reuses the saved headword', (code, term, expected) => {
  expect(lowercaseLookupTerm(term, code)).toBe(expected);
  expect(resolveLookupKey(term, code, [term])).toBe(expected);
  expect(resolveLookupKey(term, code, ['unrelated'])).toBeNull();
});
