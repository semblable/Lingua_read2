import { WORD_PATTERN } from '../utils/readerText';

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

  test('matches all three apostrophe variants (ASCII, U+2019, U+02BC)', () => {
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
