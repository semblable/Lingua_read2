import { splitTextIntoSentenceSegments } from '../utils/readerText';

const englishCfg = (exceptions = []) => ({
  code: 'en',
  splitSentences: '.!?',
  sentenceSplitExceptions: exceptions
});

const frenchCfg = (exceptions = []) => ({
  code: 'fr',
  splitSentences: '.!?',
  sentenceSplitExceptions: exceptions
});

const sentenceTexts = (segments) => segments.filter(s => s.type === 'sentence').map(s => s.text);

describe('splitTextIntoSentenceSegments — basic', () => {
  test('splits simple two-sentence paragraph', () => {
    const segs = splitTextIntoSentenceSegments('He arrived. She left.', [], englishCfg(), 'en');
    expect(sentenceTexts(segs)).toEqual(['He arrived.', 'She left.']);
  });

  test('handles question and exclamation', () => {
    const segs = splitTextIntoSentenceSegments('What now? Go away! Now.', [], englishCfg(), 'en');
    expect(sentenceTexts(segs)).toEqual(['What now?', 'Go away!', 'Now.']);
  });

  test('returns [] for empty content', () => {
    expect(splitTextIntoSentenceSegments('', [], englishCfg(), 'en')).toEqual([]);
  });
});

describe('splitTextIntoSentenceSegments — exception merging', () => {
  test('Dr. Smith does not break', () => {
    const segs = splitTextIntoSentenceSegments(
      'Dr. Smith arrived. He spoke.',
      [],
      englishCfg(['Dr.', 'Mr.', 'Mrs.', 'Ms.']),
      'en'
    );
    expect(sentenceTexts(segs)).toEqual(['Dr. Smith arrived.', 'He spoke.']);
  });

  test('M. Dupont est là (French abbreviation)', () => {
    const segs = splitTextIntoSentenceSegments(
      'M. Dupont est là. Il parle.',
      [],
      frenchCfg(['M.', 'Mme.', 'Mlle.']),
      'fr'
    );
    expect(sentenceTexts(segs)).toEqual(['M. Dupont est là.', 'Il parle.']);
  });

  test('exceptions accept the {exceptionString} object form (server payload)', () => {
    const segs = splitTextIntoSentenceSegments(
      'Sr. García llegó. Habló.',
      [],
      { code: 'es', sentenceSplitExceptions: [{ exceptionString: 'Sr.' }] },
      'es'
    );
    expect(sentenceTexts(segs)).toEqual(['Sr. García llegó.', 'Habló.']);
  });

  test('chained exceptions: "Dr. Mr. Smith left."', () => {
    const segs = splitTextIntoSentenceSegments(
      'Dr. Mr. Smith left.',
      [],
      englishCfg(['Dr.', 'Mr.']),
      'en'
    );
    expect(sentenceTexts(segs)).toEqual(['Dr. Mr. Smith left.']);
  });

  test('without exceptions, Dr. would split', () => {
    const segs = splitTextIntoSentenceSegments(
      'Dr. Smith arrived. He spoke.',
      [],
      englishCfg([]),
      'en'
    );
    // We don't assert exact split count — Intl.Segmenter and the regex
    // fallback may differ — but it should not be the merged form.
    expect(segs.length).toBeGreaterThan(1);
    expect(sentenceTexts(segs)[0]).not.toBe('Dr. Smith arrived.');
  });
});

describe('splitTextIntoSentenceSegments — paragraphs and titles', () => {
  test('separates paragraphs with blank lines', () => {
    const segs = splitTextIntoSentenceSegments(
      'First sentence. Second one.\n\nNew paragraph here.',
      [],
      englishCfg(),
      'en'
    );
    expect(sentenceTexts(segs)).toEqual([
      'First sentence.',
      'Second one.',
      'New paragraph here.'
    ]);
  });
});

describe('splitTextIntoSentenceSegments — a news article with a lead photo', () => {
  // The news import keeps content as the paragraphs joined by blank lines and stores
  // [image, paragraph, …] as structuredContent. Bookmarks and reading progress are keyed by
  // segment index, so the photo must not take one.
  const portugueseCfg = { code: 'pt', splitSentences: '.!?', sentenceSplitExceptions: [] };
  const content = 'O governo anunciou medidas. A oposição criticou.\n\nOs moradores esperam respostas.';
  const blocks = [
    { type: 'image', imageUrl: 'epub_assets/u/news/7.jpg', altText: null, caption: 'Moradores em frente à câmara', meta: null },
    { type: 'paragraph', text: 'O governo anunciou medidas. A oposição criticou.' },
    { type: 'paragraph', text: 'Os moradores esperam respostas.' }
  ];

  test('numbers the sentences exactly as without the photo', () => {
    const withPhoto = splitTextIntoSentenceSegments(content, blocks, portugueseCfg, 'pt');
    const withoutPhoto = splitTextIntoSentenceSegments(content, [], portugueseCfg, 'pt');

    const shape = (segments) => segments.map(s => [s.index, s.type, s.text]);
    expect(shape(withPhoto)).toEqual(shape(withoutPhoto));
    expect(sentenceTexts(withPhoto)).toEqual([
      'O governo anunciou medidas.',
      'A oposição criticou.',
      'Os moradores esperam respostas.'
    ]);
  });

  test('shows the photo with the first sentence (sentence mode)', () => {
    const segments = splitTextIntoSentenceSegments(content, blocks, portugueseCfg, 'pt');

    expect(segments[0].mediaBlocks).toEqual([
      expect.objectContaining({ type: 'image', imageUrl: '/epub_assets/u/news/7.jpg', caption: 'Moradores em frente à câmara' })
    ]);
    expect(segments.slice(1).every(s => s.mediaBlocks.length === 0)).toBe(true);
  });
});

describe('splitTextIntoSentenceSegments — backwards compatible call shape', () => {
  test('works with no language config (legacy callers)', () => {
    const segs = splitTextIntoSentenceSegments('Hello. World.');
    expect(sentenceTexts(segs)).toEqual(['Hello.', 'World.']);
  });
});
