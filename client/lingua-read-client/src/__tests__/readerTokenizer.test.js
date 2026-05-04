import { WORD_PATTERN, ELISION_PREFIXES, splitElision } from '../utils/readerText';

describe('WORD_PATTERN', () => {
  test('matches Unicode letters across European scripts', () => {
    expect(WORD_PATTERN.test('a')).toBe(true);
    expect(WORD_PATTERN.test('é')).toBe(true);
    expect(WORD_PATTERN.test('ñ')).toBe(true);
    expect(WORD_PATTERN.test('ü')).toBe(true);
    expect(WORD_PATTERN.test('ß')).toBe(true);
    expect(WORD_PATTERN.test('ł')).toBe(true);
    expect(WORD_PATTERN.test('ж')).toBe(true);
    expect(WORD_PATTERN.test('α')).toBe(true);
  });

  test('matches all three apostrophe variants', () => {
    expect(WORD_PATTERN.test("'")).toBe(true);
    expect(WORD_PATTERN.test('’')).toBe(true);
    expect(WORD_PATTERN.test('ʼ')).toBe(true);
  });

  test('does not match digits, whitespace, or punctuation', () => {
    expect(WORD_PATTERN.test('1')).toBe(false);
    expect(WORD_PATTERN.test(' ')).toBe(false);
    expect(WORD_PATTERN.test('.')).toBe(false);
    expect(WORD_PATTERN.test('-')).toBe(false);
    expect(WORD_PATTERN.test('«')).toBe(false);
  });
});

describe('splitElision', () => {
  describe('French', () => {
    test('splits l\'eau into article + noun', () => {
      expect(splitElision("l'eau", 'fr')).toEqual(["l'", 'eau']);
    });

    test('splits the curly-apostrophe form l’eau', () => {
      expect(splitElision('l’eau', 'fr')).toEqual(['l’', 'eau']);
    });

    test('splits j\'ai, qu\'il, jusqu\'à', () => {
      expect(splitElision("j'ai", 'fr')).toEqual(["j'", 'ai']);
      expect(splitElision("qu'il", 'fr')).toEqual(["qu'", 'il']);
      expect(splitElision("jusqu'à", 'fr')).toEqual(["jusqu'", 'à']);
    });

    test('splits multi-letter elision lorsqu\'il', () => {
      expect(splitElision("lorsqu'il", 'fr')).toEqual(["lorsqu'", 'il']);
    });

    test('preserves capital-letter sentence-initial L\'eau', () => {
      expect(splitElision("L'eau", 'fr')).toEqual(["L'", 'eau']);
    });

    test('does NOT split aujourd\'hui (single lexeme, not in prefix list)', () => {
      expect(splitElision("aujourd'hui", 'fr')).toEqual(["aujourd'hui"]);
    });

    test('does not split a plain word with no apostrophe', () => {
      expect(splitElision('maison', 'fr')).toEqual(['maison']);
    });
  });

  describe('Italian', () => {
    test('splits dell\'acqua, un\'amica, sull\'isola', () => {
      expect(splitElision("dell'acqua", 'it')).toEqual(["dell'", 'acqua']);
      expect(splitElision("un'amica", 'it')).toEqual(["un'", 'amica']);
      expect(splitElision("sull'isola", 'it')).toEqual(["sull'", 'isola']);
    });
  });

  describe('Other languages — no split', () => {
    test('English contractions are left intact', () => {
      expect(splitElision("don't", 'en')).toEqual(["don't"]);
      expect(splitElision("it's", 'en')).toEqual(["it's"]);
      expect(splitElision("'tis", 'en')).toEqual(["'tis"]);
    });

    test('German, Spanish, Portuguese, Russian — no elision rules registered', () => {
      expect(splitElision("foo'bar", 'de')).toEqual(["foo'bar"]);
      expect(splitElision("foo'bar", 'es')).toEqual(["foo'bar"]);
      expect(splitElision("foo'bar", 'pt')).toEqual(["foo'bar"]);
      expect(splitElision("foo'bar", 'ru')).toEqual(["foo'bar"]);
    });

    test('unknown / missing language code is a no-op', () => {
      expect(splitElision("l'eau", undefined)).toEqual(["l'eau"]);
      expect(splitElision("l'eau", '')).toEqual(["l'eau"]);
      expect(splitElision("l'eau", 'xx')).toEqual(["l'eau"]);
    });
  });

  describe('Backward compatibility', () => {
    test('preserves a glued form the user explicitly saved as a known word', () => {
      const isKnown = (w) => w === "l'eau";
      expect(splitElision("l'eau", 'fr', isKnown)).toEqual(["l'eau"]);
    });

    test('still splits glued forms the user has NOT saved', () => {
      const isKnown = (w) => w === 'autre';
      expect(splitElision("l'eau", 'fr', isKnown)).toEqual(["l'", 'eau']);
    });
  });

  describe('Edge cases', () => {
    test('language code is case-insensitive (FR / Fr / fr all work)', () => {
      expect(splitElision("l'eau", 'FR')).toEqual(["l'", 'eau']);
      expect(splitElision("l'eau", 'Fr')).toEqual(["l'", 'eau']);
      expect(splitElision("l'eau", 'fr')).toEqual(["l'", 'eau']);
    });

    test('no split when prefix is not in the language\'s list', () => {
      // 'xyz' is not a French elision particle
      expect(splitElision("xyz'word", 'fr')).toEqual(["xyz'word"]);
    });

    test('splits on the first apostrophe only', () => {
      // After the elision split, downstream tokens are not re-split.
      expect(splitElision("l'eau'truc", 'fr')).toEqual(["l'", "eau'truc"]);
    });
  });
});

describe('ELISION_PREFIXES exports', () => {
  test('covers fr, it, ca, oc', () => {
    expect(Object.keys(ELISION_PREFIXES).sort()).toEqual(['ca', 'fr', 'it', 'oc']);
  });

  test('French prefixes include the common monosyllables and qu-words', () => {
    expect(ELISION_PREFIXES.fr).toEqual(
      expect.arrayContaining(['l', 'd', 'qu', 'jusqu', 'lorsqu'])
    );
  });
});
