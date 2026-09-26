import { mergeSavedWords } from '../utils/api/words';

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
