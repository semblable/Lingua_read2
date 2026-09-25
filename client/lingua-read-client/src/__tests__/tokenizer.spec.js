import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
  tokenizeContent,
  parseCharacterSubstitutions,
  applyCharacterSubstitutions,
  buildCoreWordRegex,
  extractWords,
  normalizeTokenizerInput,
  splitSentenceAroundTerm,
  splitTextIntoSentenceSegments,
  LATIN_WORD_CHARACTERS,
  DEFAULT_LANGUAGE_WORD_CHARACTERS
} from '../utils/readerText';

// Invisible / combining characters, spelled by code point so the test source
// stays readable (a literal soft hyphen is indistinguishable from nothing).
const SHY = String.fromCharCode(0x00ad);
const ACUTE = String.fromCharCode(0x0301);
const DIAERESIS = String.fromCharCode(0x0308);
const BACKSLASH = String.fromCharCode(92);

// Shared cross-language golden vectors (repo root). The backend
// TokenizerTests.GoldenVectorTests loads the SAME file, so the two tokenizers
// (readerText.ts and Tokenizer.cs) are pinned to identical word sequences;
// drift between them is exactly the bug this fixture guards against. The
// `languages` seeds mirror DbInitializer.cs and also serve as the language
// configs for the suite-specific tests below.
//
// Resolved by walking up from the test cwd until the file is found (the file
// lives at the monorepo root, above this package). Avoids `import.meta.url`,
// which isn't a file: URL under the happy-dom test environment.
const loadGoldenVectors = () => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    const candidate = resolve(dir, 'tokenizer-golden-vectors.json');
    if (existsSync(candidate)) return JSON.parse(readFileSync(candidate, 'utf8'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`tokenizer-golden-vectors.json not found searching up from ${process.cwd()}`);
};
const golden = loadGoldenVectors();
const LANG = golden.languages;

const wordTexts = (rawContent, langCfg) =>
  tokenizeContent(rawContent, langCfg).tokens.filter(t => t.type === 'word').map(t => t.text);

describe('parseCharacterSubstitutions', () => {
  test('parses pipe-separated old=new pairs', () => {
    expect(parseCharacterSubstitutions("’='|‘='")).toEqual([
      { old: '’', replacement: "'" },
      { old: '‘', replacement: "'" }
    ]);
  });

  test('handles `=` inside the replacement value', () => {
    expect(parseCharacterSubstitutions("a=b=c")).toEqual([{ old: 'a', replacement: 'b=c' }]);
  });

  test('rejects entries without `=` and empty olds', () => {
    expect(parseCharacterSubstitutions("garbage|=foo|x=y")).toEqual([
      { old: 'x', replacement: 'y' }
    ]);
  });

  test('returns [] for null/empty', () => {
    expect(parseCharacterSubstitutions(null)).toEqual([]);
    expect(parseCharacterSubstitutions('')).toEqual([]);
  });
});

describe('applyCharacterSubstitutions', () => {
  test('replaces curly apostrophes with ASCII', () => {
    const subs = parseCharacterSubstitutions("’='|‘='");
    expect(applyCharacterSubstitutions("l’eau", subs)).toBe("l'eau");
    expect(applyCharacterSubstitutions("‘hi’", subs)).toBe("'hi'");
  });

  test('applies substitutions in declaration order', () => {
    const subs = parseCharacterSubstitutions("...=…|..=‥");
    expect(applyCharacterSubstitutions("a...b..c", subs)).toBe("a…b‥c");
  });
});

describe('buildCoreWordRegex', () => {
  test('falls back to letters and marks when wordCharacters is empty', () => {
    const r = buildCoreWordRegex('');
    expect(r.test('a')).toBe(true);
    expect(r.test('é')).toBe(true);
    expect(r.test(ACUTE)).toBe(true);
    expect(r.test('1')).toBe(false);
    expect(r.test(' ')).toBe(false);
  });

  test('falls back to letters and marks when wordCharacters is invalid regex', () => {
    // A reversed range, rejected by JS and .NET alike.
    const r = buildCoreWordRegex('z-a');
    expect(r.test('ж')).toBe(true);
    expect(r.test(ACUTE)).toBe(true);
    expect(r.test('1')).toBe(false);
  });

  test("does not strip range hyphens from `a-z`", () => {
    // Regression: an earlier draft stripped all hyphens, collapsing
    // `a-z` to just `az`. This test guards against that.
    const r = buildCoreWordRegex('a-zA-Z');
    expect(r.test('m')).toBe(true);
    expect(r.test('Q')).toBe(true);
    expect(r.test('1')).toBe(false);
  });
});

// Cross-language word-sequence cases (French/Italian/Portuguese/English/German/
// Russian elisions, clitics, hyphenated forms, null-language fallback) live in
// the shared tokenizer-golden-vectors.json so the FE and BE suites can't drift.
describe('tokenizeContent — golden vectors (shared with backend TokenizerTests)', () => {
  test.each(golden.cases)('[$lang] $input', ({ lang, input, expectedWords }) => {
    const config = lang === null ? null : LANG[lang];
    expect(wordTexts(input, config)).toEqual(expectedWords);
  });
});

describe('tokenizeContent — built-in apostrophe normalization', () => {
  // A language with empty CharacterSubstitutions (e.g. a freshly-added
  // custom language) still normalizes curly / modifier apostrophes so
  // that elision/clitic glue continues to work.
  const emptySubs = { code: 'fr', wordCharacters: 'a-zA-Zà-ÿ', characterSubstitutions: '' };

  test('curly apostrophe glues without user subs', () => {
    expect(wordTexts('l’eau coule', emptySubs)).toEqual(["l'eau", 'coule']);
  });

  test('modifier apostrophe (U+02BC) glues without user subs', () => {
    expect(wordTexts('quʼil vienne', emptySubs)).toEqual(["qu'il", 'vienne']);
  });

  test('left single quote glues without user subs', () => {
    expect(wordTexts('l‘eau', emptySubs)).toEqual(["l'eau"]);
  });
});

describe('extractWords — bulk ops capture apostrophe words whole', () => {
  // Regression: auto-translate / mark-known previously used a raw-content
  // regex whose connector class only matched ASCII ', so curly-apostrophe
  // contractions split into fragments (`wasn` + `t`) and never translated.
  test('curly apostrophe contraction is captured as one word', () => {
    expect(extractWords('She wasn’t ready', LANG.en)).toEqual(['She', "wasn't", 'ready']);
  });

  test('ASCII apostrophe contraction still captured whole', () => {
    expect(extractWords("don't", LANG.en)).toEqual(["don't"]);
  });

  test('hyphenated word stays one token (parts split downstream by caller)', () => {
    expect(extractWords('well-known', LANG.en)).toEqual(['well-known']);
  });

  test('multiple curly contractions in a sentence', () => {
    expect(extractWords('it’d work and didn’t care', LANG.en))
      .toEqual(["it'd", 'work', 'and', "didn't", 'care']);
  });
});

describe('tokenizeContent — token start/end indices map into processed text', () => {
  test('indices reference substituted content', () => {
    const { processed, tokens } = tokenizeContent("l’eau", LANG.fr);
    expect(processed).toBe("l'eau");
    const word = tokens.find(t => t.type === 'word');
    expect(word.text).toBe("l'eau");
    expect(processed.slice(word.start, word.end)).toBe("l'eau");
  });

  test('soft hyphens are gone from processed text and token offsets', () => {
    const { processed, tokens } = tokenizeContent(`o repa${SHY}rava`, LANG.pt);
    expect(processed).toBe('o reparava');
    const word = tokens.filter(t => t.type === 'word')[1];
    expect(word).toMatchObject({ text: 'reparava', start: 2, end: 10 });
    expect(processed.slice(word.start, word.end)).toBe('reparava');
  });

  test('decomposed accents are composed in processed text', () => {
    const { processed, tokens } = tokenizeContent(`e${ACUTE}te${ACUTE}`, LANG.fr);
    expect(processed).toBe('été');
    expect(tokens).toEqual([{ type: 'word', text: 'été', start: 0, end: 3 }]);
  });
});

describe('normalizeTokenizerInput', () => {
  test('drops soft hyphens, including one after a clitic hyphen', () => {
    expect(normalizeTokenizerInput(`repa${SHY}rava`)).toBe('reparava');
    expect(normalizeTokenizerInput(`contá-${SHY}las`)).toBe('contá-las');
    expect(normalizeTokenizerInput(`${SHY}${SHY}`)).toBe('');
  });

  test('composes decomposed accents', () => {
    expect(normalizeTokenizerInput(`e${ACUTE}te${ACUTE}`)).toBe('été');
    expect(normalizeTokenizerInput(`Gru${DIAERESIS}ße`)).toBe('Grüße');
  });

  test('keeps a mark that has no precomposed form', () => {
    expect(normalizeTokenizerInput(`n${DIAERESIS}`)).toBe(`n${DIAERESIS}`);
  });

  test('leaves characters outside base+mark runs untouched (no blanket NFC)', () => {
    // NFC would turn the Angstrom sign into Å and a CJK compatibility
    // ideograph into its unified form; only runs with combining marks change.
    const angstrom = String.fromCharCode(0x212b);
    const cjkCompat = String.fromCharCode(0xf900);
    expect(normalizeTokenizerInput(angstrom)).toBe(angstrom);
    expect(normalizeTokenizerInput(`${cjkCompat} e${ACUTE}`)).toBe(`${cjkCompat} é`);
  });

  test('returns empty input unchanged', () => {
    expect(normalizeTokenizerInput('')).toBe('');
  });

  test('maps Greek oxia letters onto the tonos letters keyboards type', () => {
    // Omicron with oxia (U+1F79) and with tonos (U+03CC) look the same.
    const oxia = `κ${String.fromCharCode(0x1f79)}σμος`;
    const tonos = `κ${String.fromCharCode(0x3cc)}σμος`;
    expect(normalizeTokenizerInput(oxia)).toBe(tonos);
    expect(normalizeTokenizerInput(tonos)).toBe(tonos);
  });
});

describe('splitSentenceAroundTerm', () => {
  const highlighted = (sentence, term) =>
    splitSentenceAroundTerm(sentence, term).filter(p => p.isTerm).map(p => p.text);

  test('finds a term across a soft hyphen in the stored sentence', () => {
    // Mined sentences are raw reader text; terms are keyed from normalized tokens.
    expect(splitSentenceAroundTerm(`Fazal Elahi repa${SHY}rava no modo.`, 'reparava')).toEqual([
      { text: 'Fazal Elahi ', isTerm: false },
      { text: 'reparava', isTerm: true },
      { text: ' no modo.', isTerm: false }
    ]);
  });

  test('finds a term in a decomposed sentence, case-insensitively, every time', () => {
    expect(highlighted(`E${ACUTE}te${ACUTE} ou e${ACUTE}te${ACUTE}`, 'été')).toEqual(['Été', 'été']);
  });

  test('matches an ASCII-apostrophe term but keeps the curly apostrophe for display', () => {
    expect(highlighted('Il boit l’eau.', "l'eau")).toEqual(['l’eau']);
  });

  test('returns the whole sentence when the term is absent or empty', () => {
    expect(splitSentenceAroundTerm('Mi perro corre.', 'gato')).toEqual([{ text: 'Mi perro corre.', isTerm: false }]);
    expect(splitSentenceAroundTerm('Mi perro corre.', '')).toEqual([{ text: 'Mi perro corre.', isTerm: false }]);
  });

  test('treats regex metacharacters in the term literally', () => {
    expect(highlighted('He said e.g. that, not eXg.', 'e.g.')).toEqual(['e.g.']);
  });
});

describe('splitTextIntoSentenceSegments', () => {
  test('segment text is normalized, since it leaves the reader as mined sentences and requests', () => {
    const segments = splitTextIntoSentenceSegments(`Fazal Elahi repa${SHY}rava. Il fait e${ACUTE}te${ACUTE}.`, [], LANG.pt, 'pt');
    expect(segments.map(s => s.text)).toEqual(['Fazal Elahi reparava.', 'Il fait été.']);
  });
});

describe('word-character constants', () => {
  // The golden file's seeds are what DbInitializer / the migration store, and
  // the backend tests compare them with Language.LatinWordCharacters and
  // Language.DefaultWordCharacters, so these pin FE == BE.
  test('Latin seeds match LATIN_WORD_CHARACTERS', () => {
    for (const code of ['en', 'es', 'fr', 'it', 'pt']) {
      expect(LANG[code].wordCharacters).toBe(LATIN_WORD_CHARACTERS);
    }
    expect(LANG.de.wordCharacters)
      .toBe(`${LATIN_WORD_CHARACTERS}${BACKSLASH}u200C${BACKSLASH}u200D`);
  });

  test('Russian and form-added languages match DEFAULT_LANGUAGE_WORD_CHARACTERS', () => {
    for (const code of ['ru', 'pl', 'cs', 'ca', 'ro', 'el', 'lt', 'nl', 'hu', 'is']) {
      expect(LANG[code].wordCharacters).toBe(DEFAULT_LANGUAGE_WORD_CHARACTERS);
    }
  });

  test('the Latin class compiles as written instead of falling back to any letter', () => {
    const r = buildCoreWordRegex(LATIN_WORD_CHARACTERS);
    // The any-letter fallback would accept these; the Latin class must not.
    for (const ch of ['ª', 'º', 'α', 'ж', '×', '÷', '·']) {
      expect(r.test(ch)).toBe(false);
    }
    for (const ch of ['ñ', 'è', 'ò', 'ü', 'ẞ', 'ș', 'ł', 'ř', 'ŵ', 'ệ', ACUTE]) {
      expect(r.test(ch)).toBe(true);
    }
  });

  test('the default class accepts any letter and combining marks', () => {
    const r = buildCoreWordRegex(DEFAULT_LANGUAGE_WORD_CHARACTERS);
    for (const ch of ['a', 'ą', 'α', 'ж', 'ß', ACUTE]) {
      expect(r.test(ch)).toBe(true);
    }
    expect(r.test('1')).toBe(false);
    expect(r.test('·')).toBe(false);
  });
});

describe('extractWords — bulk ops see normalized words', () => {
  test('soft-hyphenated words are captured whole for auto-translate / mark-known', () => {
    expect(extractWords(`Verant${SHY}wortung und Schuld`, LANG.de))
      .toEqual(['Verantwortung', 'und', 'Schuld']);
  });
});
