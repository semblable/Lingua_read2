import { addMissingWords, mergeSavedWords } from '../utils/api/words';

describe('mergeSavedWords', () => {
  const words = [
    { wordId: 1, term: 'gato', status: 0, translation: '' },
    { wordId: 2, term: 'Perro', status: 2, translation: 'dog' },
    { wordId: 3, term: 'casa', status: 5, translation: 'house' },
  ];

  test('replaces the saved rows, matched by id or by term, and adds new ones', () => {
    const merged = mergeSavedWords(words, [
      { wordId: 1, term: 'gato', status: 1, translation: 'cat' },
      // Same term as row 2 under another id, e.g. the row the save actually used.
      { wordId: 9, term: 'perro', status: 2, translation: 'dog' },
      { wordId: 10, term: 'sol', status: 1, translation: 'sun' },
    ]);

    expect(merged.map((w) => [w.wordId, w.term, w.status, w.translation])).toEqual([
      [3, 'casa', 5, 'house'],
      [1, 'gato', 1, 'cat'],
      [9, 'perro', 2, 'dog'],
      [10, 'sol', 1, 'sun'],
    ]);
  });

  test('returns the same list when nothing was saved', () => {
    expect(mergeSavedWords(words, [])).toBe(words);
  });
});

describe('addMissingWords', () => {
  const words = [
    { wordId: 1, term: 'Gato', status: 2, translation: 'cat' },
    { wordId: 2, term: 'buenos dias', status: 3, translation: 'good morning' },
  ];

  test('adds only the rows the list lacks, matched by id or by term, and keeps its own', () => {
    const merged = addMissingWords(words, [
      // Read before the save that set status 2: the list's row stays.
      { wordId: 1, term: 'gato', status: 0, translation: null },
      // Same term under another id.
      { wordId: 7, term: 'gato', status: 0, translation: null },
      { wordId: 8, term: 'mundo', status: 0, translation: null },
    ]);

    expect(merged.map((w) => [w.wordId, w.term, w.status])).toEqual([
      [1, 'Gato', 2],
      [2, 'buenos dias', 3],
      [8, 'mundo', 0],
    ]);
  });

  test('returns the same list when nothing is missing', () => {
    expect(addMissingWords(words, [{ wordId: 1, term: 'gato', status: 0 }])).toBe(words);
    expect(addMissingWords(words, [])).toBe(words);
  });
});
