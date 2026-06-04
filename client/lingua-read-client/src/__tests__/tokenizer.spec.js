import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
  tokenizeContent,
  parseCharacterSubstitutions,
  applyCharacterSubstitutions,
  buildCoreWordRegex,
  extractWords
} from '../utils/readerText';

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
  test('falls back to \\p{L} when wordCharacters is empty', () => {
    const r = buildCoreWordRegex('');
    expect(r.test('a')).toBe(true);
    expect(r.test('é')).toBe(true);
    expect(r.test('1')).toBe(false);
    expect(r.test(' ')).toBe(false);
  });

  test('falls back when wordCharacters is invalid regex', () => {
    const r = buildCoreWordRegex('a-z[unbalanced');
    expect(r.test('a')).toBe(true);
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
});
