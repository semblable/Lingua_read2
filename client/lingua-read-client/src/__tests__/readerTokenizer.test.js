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

  test('preserves internal commas, semicolons, colons, hyphens, and apostrophes inside a phrase', () => {
    expect(cleanSelectedReaderText("c'est-à-dire, aujourd’hui")).toBe("c'est-à-dire, aujourd'hui");
    expect(cleanSelectedReaderText('apples, oranges, and bananas')).toBe('apples, oranges, and bananas');
    expect(cleanSelectedReaderText('apples, oranges, and bananas', { splitSentences: ',.!?' })).toBe('apples, oranges, and bananas');
    expect(cleanSelectedReaderText('options: first; second, third')).toBe('options: first; second, third');
    expect(cleanSelectedReaderText('options: first; second', { splitSentences: ';:.!?' })).toBe('options: first; second');
  });

  test('recognizes abbreviations like Mr. and Dr. and does not split them', () => {
    expect(cleanSelectedReaderText('Mr. Smith arrived.')).toBe('Mr. Smith arrived');
    expect(cleanSelectedReaderText('I spoke with Dr. Watson today.')).toBe('I spoke with Dr. Watson today');
    expect(cleanSelectedReaderText('written by J. K. Rowling.')).toBe('written by J. K. Rowling');
    expect(cleanSelectedReaderText('ratio is 3.14 for pi.')).toBe('ratio is 3.14 for pi');
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
  test('detects sentence-ending stops while allowing commas, semicolons, colons, and spaces', () => {
    expect(hasSentenceStopBetween(' ')).toBe(false);
    expect(hasSentenceStopBetween(', ')).toBe(false);
    expect(hasSentenceStopBetween('; ')).toBe(false);
    expect(hasSentenceStopBetween(': ')).toBe(false);
    expect(hasSentenceStopBetween(' — ')).toBe(false);
    expect(hasSentenceStopBetween('. ')).toBe(true);
    expect(hasSentenceStopBetween('! ')).toBe(true);
    expect(hasSentenceStopBetween('? ')).toBe(true);
    expect(hasSentenceStopBetween('… ')).toBe(true);
  });

  test('does not treat commas, semicolons, or colons as stops even if configured in splitSentences', () => {
    expect(hasSentenceStopBetween(', ', { splitSentences: ',.!?' })).toBe(false);
    expect(hasSentenceStopBetween('; ', { splitSentences: ';:!?' })).toBe(false);
    expect(hasSentenceStopBetween(': ', { splitSentences: ';:!?' })).toBe(false);
  });

  test('does not treat abbreviations or initials as sentence stops when preceding a dot', () => {
    expect(hasSentenceStopBetween('. ', null, 'Mr', 'Smith')).toBe(false);
    expect(hasSentenceStopBetween('. ', null, 'Dr', 'Watson')).toBe(false);
    expect(hasSentenceStopBetween('. ', null, 'etc', 'and')).toBe(false);
    expect(hasSentenceStopBetween('. ', null, 'J', 'Rowling')).toBe(false);
    expect(hasSentenceStopBetween('. ', null, 'I', 'Newton')).toBe(false);
    expect(hasSentenceStopBetween('. ', null, 'I', 'The')).toBe(true);
    expect(hasSentenceStopBetween('. ', null, 'I', '')).toBe(true);
    expect(hasSentenceStopBetween('. ', null, 'world', 'Next')).toBe(true);
  });

  test('allows Greek semicolon/erotimatiko as a sentence stop when language is Greek', () => {
    expect(hasSentenceStopBetween('; ', { languageCode: 'el', splitSentences: ';.!' })).toBe(true);
    expect(hasSentenceStopBetween('; ', { languageCode: 'en', splitSentences: ';.!' })).toBe(false);
  });
});
