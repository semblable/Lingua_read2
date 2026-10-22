import {
  WORD_PATTERN,
  cleanSelectedReaderText,
  hasSentenceStopBetween
} from '../utils/readerText';

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

describe('cleanSelectedReaderText', () => {
  test('strips leading and trailing punctuation and whitespace', () => {
    expect(cleanSelectedReaderText('  "Hello world!"  ')).toBe('Hello world');
    expect(cleanSelectedReaderText('«bonjour le monde»')).toBe('bonjour le monde');
    expect(cleanSelectedReaderText(', hola mundo,')).toBe('hola mundo');
    expect(cleanSelectedReaderText('¿Qué tal?')).toBe('Qué tal');
  });

  test('preserves internal commas, hyphens, and apostrophes inside a phrase', () => {
    expect(cleanSelectedReaderText("c'est-à-dire, aujourd’hui")).toBe("c'est-à-dire, aujourd'hui");
  });

  test('clamps selection to a single sentence when sentence stops are crossed', () => {
    expect(cleanSelectedReaderText('Hello world. Another sentence')).toBe('Hello world');
    expect(cleanSelectedReaderText('Wait! What happened?')).toBe('What happened');
    expect(cleanSelectedReaderText(' End. Next sentence here.')).toBe('Next sentence here');
    expect(cleanSelectedReaderText('First… second third fourth')).toBe('second third fourth');
  });

  test('respects sentence split exceptions such as abbreviations', () => {
    expect(
      cleanSelectedReaderText('Dr. Smith arrived.', { sentenceSplitExceptions: ['Dr.', 'Mr.'] })
    ).toBe('Dr. Smith arrived');
  });

  test('returns empty string when selection contains only punctuation', () => {
    expect(cleanSelectedReaderText('... !? — ""')).toBe('');
  });
});

describe('hasSentenceStopBetween', () => {
  test('detects sentence-ending stops while allowing commas and spaces', () => {
    expect(hasSentenceStopBetween(' ')).toBe(false);
    expect(hasSentenceStopBetween(', ')).toBe(false);
    expect(hasSentenceStopBetween(' — ')).toBe(false);
    expect(hasSentenceStopBetween('. ')).toBe(true);
    expect(hasSentenceStopBetween('! ')).toBe(true);
    expect(hasSentenceStopBetween('? ')).toBe(true);
    expect(hasSentenceStopBetween('… ')).toBe(true);
  });
});
