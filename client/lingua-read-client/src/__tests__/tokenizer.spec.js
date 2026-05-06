import {
  tokenizeContent,
  parseCharacterSubstitutions,
  applyCharacterSubstitutions,
  buildCoreWordRegex
} from '../utils/readerText';

// Seeded language configs (mirror of DbInitializer.cs).
const LANG = {
  en: {
    code: 'en',
    wordCharacters: 'a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ',
    characterSubstitutions: "´='|`='|’='|‘='|...=…|..=‥"
  },
  fr: {
    code: 'fr',
    wordCharacters: 'a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ',
    characterSubstitutions: "´='|`='|’='|‘='|...=…|..=‥"
  },
  it: {
    code: 'it',
    wordCharacters: 'a-zA-ZÀàÉéÈèÌìÎîÓóÒòÙù',
    characterSubstitutions: "´='|`='|’='|‘='|...=…|..=‥"
  },
  pt: {
    code: 'pt',
    wordCharacters: 'a-zA-ZÀÁÂÃÇÉÊÍÓÔÕÚÜàáâãçéêíóôõúü',
    characterSubstitutions: "´='|`='|’='|‘='|...=…|..=‥"
  },
  de: {
    code: 'de',
    wordCharacters: 'a-zA-ZÀ-ÖØ-öø-ȳáéíóúÁÉÍÓÚñÑ\\u200C\\u200D',
    characterSubstitutions: "´='|`='|’='|‘='|...=…|..=‥"
  },
  ru: {
    code: 'ru',
    wordCharacters: "\\p{L}\\p{M}'-",
    characterSubstitutions: "’='|‘='|...=…"
  }
};

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

describe('tokenizeContent — French elisions stay glued', () => {
  test("l'eau coule", () => {
    expect(wordTexts("l'eau coule", LANG.fr)).toEqual(["l'eau", 'coule']);
  });

  test("qu'il vienne", () => {
    expect(wordTexts("qu'il vienne", LANG.fr)).toEqual(["qu'il", 'vienne']);
  });

  test("curly apostrophe normalized then glued", () => {
    expect(wordTexts('l’eau coule', LANG.fr)).toEqual(["l'eau", 'coule']);
  });

  test("c'est-à-dire stays as one token", () => {
    expect(wordTexts("c'est-à-dire", LANG.fr)).toEqual(["c'est-à-dire"]);
  });

  test("M. Dupont — period splits, M alone", () => {
    expect(wordTexts('M. Dupont arriva.', LANG.fr)).toEqual(['M', 'Dupont', 'arriva']);
  });
});

describe('tokenizeContent — Italian elisions', () => {
  test("dell'acqua fresca", () => {
    expect(wordTexts("dell'acqua fresca", LANG.it)).toEqual(["dell'acqua", 'fresca']);
  });

  test("un'altra volta", () => {
    expect(wordTexts("un'altra volta", LANG.it)).toEqual(["un'altra", 'volta']);
  });
});

describe('tokenizeContent — Portuguese clitics & hyphenated forms', () => {
  test('interrompo-a agora', () => {
    expect(wordTexts('interrompo-a agora', LANG.pt)).toEqual(['interrompo-a', 'agora']);
  });

  test('beijá-lo gentilmente', () => {
    expect(wordTexts('beijá-lo gentilmente', LANG.pt)).toEqual(['beijá-lo', 'gentilmente']);
  });

  test('dá-me um café', () => {
    expect(wordTexts('dá-me um café', LANG.pt)).toEqual(['dá-me', 'um', 'café']);
  });
});

describe('tokenizeContent — English', () => {
  test("don't worry — apostrophe glues", () => {
    expect(wordTexts("don't worry", LANG.en)).toEqual(["don't", 'worry']);
  });

  test('well-known stays glued', () => {
    expect(wordTexts('well-known', LANG.en)).toEqual(['well-known']);
  });

  test("'hello' — bare quotes do not eat the word", () => {
    expect(wordTexts("'hello'", LANG.en)).toEqual(['hello']);
  });

  test("standalone -- splits", () => {
    expect(wordTexts('a -- b', LANG.en)).toEqual(['a', 'b']);
  });

  test("trailing apostrophe in dogs' is dropped", () => {
    expect(wordTexts("the dogs' tails", LANG.en)).toEqual(['the', 'dogs', 'tails']);
  });
});

describe('tokenizeContent — German', () => {
  test('Schöne Grüße', () => {
    expect(wordTexts('Schöne Grüße', LANG.de)).toEqual(['Schöne', 'Grüße']);
  });
});

describe('tokenizeContent — Russian (apostrophe & hyphen are core chars in the seed)', () => {
  test('multi-letter Cyrillic runs split on whitespace', () => {
    expect(wordTexts('Привет мир', LANG.ru)).toEqual(['Привет', 'мир']);
  });

  test("inter-letter hyphen still glues (e.g. кое-что)", () => {
    expect(wordTexts('кое-что', LANG.ru)).toEqual(['кое-что']);
  });
});

describe('tokenizeContent — fallback / no language config', () => {
  test('with null config, behaves like Unicode-letter default', () => {
    expect(wordTexts("l'eau coule", null)).toEqual(["l'eau", 'coule']);
    expect(wordTexts("interrompo-a agora", null)).toEqual(['interrompo-a', 'agora']);
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
