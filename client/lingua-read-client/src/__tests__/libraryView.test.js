import {
  EMPTY_FILTERS,
  createLibraryCollisionDetection,
  dragCount,
  elsewhereRows,
  filterLibrary,
  hasActiveFilters,
  languageOptions,
  reorderSection,
  resolveDragIntent,
  sortLibrary,
  tagOptions,
} from '../utils/libraryView';

const items = {
  folders: [
    { folderId: 1, name: 'Spanish shelf' },
    { folderId: 2, name: 'Podcasts' },
  ],
  books: [
    { bookId: 10, title: 'Cien años', author: 'García Márquez', languageName: 'Spanish', tags: ['novel'], totalWords: 100, knownWords: 95, isFinished: true },
    { bookId: 11, title: 'Der Prozess', author: 'Kafka', languageName: 'German', tags: [], totalWords: 100, knownWords: 40, isFinished: false },
  ],
  texts: [
    { textId: 20, title: 'Noticias', languageName: 'Spanish', tag: 'news', totalWords: 100, knownWords: 85, isAudioLesson: true, isFinished: false },
    { textId: 21, title: 'Nachrichten', languageName: 'German', tag: null, totalWords: 0, knownWords: 0, isAudioLesson: false, isFinished: true },
  ],
};

const ids = (result) => ({
  folders: result.folders.map((f) => f.folderId),
  books: result.books.map((b) => b.bookId),
  texts: result.texts.map((t) => t.textId),
});

describe('filterLibrary', () => {
  test('no filters keeps everything', () => {
    expect(ids(filterLibrary(items, EMPTY_FILTERS))).toEqual({ folders: [1, 2], books: [10, 11], texts: [20, 21] });
  });

  test('language and tag filter books and texts but never folders', () => {
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, language: 'Spanish' })))
      .toEqual({ folders: [1, 2], books: [10], texts: [20] });
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, tag: 'news' })))
      .toEqual({ folders: [1, 2], books: [], texts: [20] });
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, tag: 'novel' })))
      .toEqual({ folders: [1, 2], books: [10], texts: [] });
  });

  test('search matches folder names and titles, case-insensitively and trimmed', () => {
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, search: '  SPANISH ' })))
      .toEqual({ folders: [1], books: [], texts: [] });
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, search: 'na' })))
      .toEqual({ folders: [], books: [], texts: [21] });
  });

  test('search also matches book authors', () => {
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, search: 'kafka' })).books).toEqual([11]);
  });

  test('type filter: books, plain texts or audio lessons (folders stay for navigation)', () => {
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, type: 'books' })))
      .toEqual({ folders: [1, 2], books: [10, 11], texts: [] });
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, type: 'texts' })))
      .toEqual({ folders: [1, 2], books: [], texts: [21] });
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, type: 'audio' })))
      .toEqual({ folders: [1, 2], books: [], texts: [20] });
  });

  test('status filter: finished or not', () => {
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, status: 'finished' })))
      .toEqual({ folders: [1, 2], books: [10], texts: [21] });
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, status: 'unfinished' })))
      .toEqual({ folders: [1, 2], books: [11], texts: [20] });
  });

  test('comprehension band uses known words; unknown stats only match "unknown"', () => {
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, comprehension: 'sweet-spot' })).books).toEqual([10]);
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, comprehension: 'challenging' })).texts).toEqual([20]);
    expect(ids(filterLibrary(items, { ...EMPTY_FILTERS, comprehension: 'unknown' })).texts).toEqual([21]);
  });
});

describe('filter options', () => {
  test('hasActiveFilters ignores a whitespace-only search', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, search: '   ' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, language: 'German' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, comprehension: 'too-hard' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, type: 'audio' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, status: 'finished' })).toBe(true);
  });

  test('options are sorted and deduplicated', () => {
    expect(languageOptions(items, '')).toEqual(['German', 'Spanish']);
    expect(tagOptions(items, '')).toEqual(['news', 'novel']);
  });

  test('an active value missing from this folder is still offered', () => {
    // Without it the select would show "All Languages" while still filtering by French.
    expect(languageOptions(items, 'French')).toEqual(['French', 'German', 'Spanish']);
    expect(tagOptions({ folders: [], books: [], texts: [] }, 'poetry')).toEqual(['poetry']);
  });
});

describe('sortLibrary', () => {
  const dated = {
    folders: [{ folderId: 1, name: 'Zeta' }, { folderId: 2, name: 'alpha' }],
    books: [
      { bookId: 1, title: 'Book 10', createdAt: '2026-01-01T00:00:00Z', lastReadAt: null, totalWords: 100, knownWords: 50 },
      { bookId: 2, title: 'book 9', createdAt: '2026-03-01T00:00:00Z', lastReadAt: '2026-09-01T00:00:00Z', totalWords: 0, knownWords: 0 },
      { bookId: 3, title: 'Book 2', createdAt: '2026-02-01T00:00:00Z', lastReadAt: '2026-09-20T00:00:00Z', totalWords: 100, knownWords: 97 },
    ],
    texts: [
      { textId: 1, title: 'B', createdAt: '2026-01-01T00:00:00Z', lastAccessedAt: '2026-09-02T00:00:00Z' },
      { textId: 2, title: 'a', createdAt: '2026-05-01T00:00:00Z', lastAccessedAt: null },
    ],
  };

  test('manual keeps the server order', () => {
    expect(sortLibrary(dated, 'manual')).toBe(dated);
  });

  test('title sorts naturally and ignores case, folders included', () => {
    expect(ids(sortLibrary(dated, 'title'))).toEqual({ folders: [2, 1], books: [3, 2, 1], texts: [2, 1] });
  });

  test('recent puts never-read items last and keeps folders in manual order', () => {
    expect(ids(sortLibrary(dated, 'recent'))).toEqual({ folders: [1, 2], books: [3, 2, 1], texts: [1, 2] });
  });

  test('added is newest first', () => {
    expect(ids(sortLibrary(dated, 'added'))).toEqual({ folders: [1, 2], books: [2, 3, 1], texts: [2, 1] });
  });

  test('easiest first puts unknown stats last', () => {
    expect(ids(sortLibrary(dated, 'comprehension')).books).toEqual([3, 1, 2]);
  });

  test('does not mutate its input', () => {
    sortLibrary(dated, 'title');
    expect(dated.books.map((b) => b.bookId)).toEqual([1, 2, 3]);
  });
});

describe('elsewhereRows', () => {
  const result = {
    folders: [
      { folderId: 5, name: 'Here', parentFolderId: 7, folderPath: 'Seven' },
      { folderId: 6, name: 'There', parentFolderId: null, folderPath: '' },
    ],
    books: [
      { bookId: 10, title: 'In seven', author: 'A', languageName: 'Spanish', folderId: 7, folderPath: 'Seven' },
      { bookId: 11, title: 'At root', author: null, languageName: 'German', folderId: null, folderPath: '' },
    ],
    texts: [
      { textId: 20, title: 'Deep', languageName: 'French', isAudioLesson: true, folderId: 8, folderPath: 'Seven / Eight' },
    ],
  };

  test('drops matches already shown in the current folder and links the rest', () => {
    const rows = elsewhereRows(result, 7);
    expect(rows.map((r) => r.key)).toEqual(['folder-6', 'book-11', 'text-20']);
    expect(rows[0]).toMatchObject({ href: '/library/6', folderPath: '' });
    expect(rows[1]).toMatchObject({ href: '/books/11', detail: 'German', folderId: null });
    expect(rows[2]).toMatchObject({ href: '/texts/20', isAudioLesson: true, folderId: 8, folderPath: 'Seven / Eight' });
  });

  test('at the root, root items are the ones already shown', () => {
    expect(elsewhereRows(result, null).map((r) => r.key)).toEqual(['folder-5', 'book-10', 'text-20']);
    expect(elsewhereRows(result, null)[1].detail).toBe('A · Spanish');
  });
});

describe('reorderSection', () => {
  test('moves the dragged item to the drop position and renumbers the section', () => {
    expect(reorderSection([1, 2, 3, 4], 'book', 4, 2)).toEqual([
      { id: 1, type: 'book', sortOrder: 0 },
      { id: 4, type: 'book', sortOrder: 1 },
      { id: 2, type: 'book', sortOrder: 2 },
      { id: 3, type: 'book', sortOrder: 3 },
    ]);
  });

  test('returns null when nothing moves or an id is unknown', () => {
    expect(reorderSection([1, 2], 'text', 1, 1)).toBeNull();
    expect(reorderSection([1, 2], 'text', 1, 9)).toBeNull();
  });
});

describe('resolveDragIntent', () => {
  const book = { type: 'book', id: 10 };
  const text = { type: 'text', id: 20 };
  const folderA = { type: 'folder', id: 1 };
  const folderB = { type: 'folder', id: 2 };

  test('a book dropped on a folder moves just that book when it is not selected', () => {
    expect(resolveDragIntent(book, folderA, [text], true))
      .toEqual({ kind: 'move', targetFolderId: 1, items: [book] });
  });

  test('a selected card takes the whole selection along, minus the target folder', () => {
    const selection = [book, text, folderA, folderB];
    expect(resolveDragIntent(book, folderA, selection, true))
      .toEqual({ kind: 'move', targetFolderId: 1, items: [book, text, folderB] });
  });

  test('moving into a folder still works while reordering is off', () => {
    expect(resolveDragIntent(text, folderB, [], false)?.kind).toBe('move');
  });

  test('a folder dropped on a folder reorders instead of nesting', () => {
    expect(resolveDragIntent(folderA, folderB, [], true))
      .toEqual({ kind: 'reorder', type: 'folder', activeId: 1, overId: 2 });
  });

  test('reorders only within the same section, and only when allowed', () => {
    expect(resolveDragIntent(book, { type: 'book', id: 11 }, [], true))
      .toEqual({ kind: 'reorder', type: 'book', activeId: 10, overId: 11 });
    expect(resolveDragIntent(book, { type: 'book', id: 11 }, [], false)).toBeNull();
    expect(resolveDragIntent(book, text, [], true)).toBeNull();
    expect(resolveDragIntent(book, book, [], true)).toBeNull();
    expect(resolveDragIntent(book, null, [], true)).toBeNull();
  });

  test('dragCount reports the selection size only for a selected card', () => {
    expect(dragCount(book, [book, text])).toBe(2);
    expect(dragCount(book, [text])).toBe(1);
  });
});

describe('createLibraryCollisionDetection', () => {
  const rect = (left, top) => ({ left, top, width: 100, height: 50, right: left + 100, bottom: top + 50 });
  const container = (id, type) => ({ id, key: id, data: { current: { type } }, disabled: false, node: { current: null }, rect: { current: null } });
  const containers = [
    container('folder-1', 'folder'),
    container('book-10', 'book'),
    container('book-11', 'book'),
    container('text-20', 'text'),
  ];
  const droppableRects = new Map([
    ['folder-1', rect(0, 0)],
    ['book-10', rect(0, 100)],
    ['book-11', rect(200, 100)],
    ['text-20', rect(0, 200)],
  ]);
  const args = (activeType, pointer) => ({
    active: { id: 'x', data: { current: { type: activeType } }, rect: { current: { initial: null, translated: null } } },
    collisionRect: { ...rect(pointer.x - 50, pointer.y - 25) },
    droppableRects,
    droppableContainers: containers,
    pointerCoordinates: pointer,
  });
  const firstId = (collisions) => collisions[0]?.id ?? null;

  test('a book under the pointer of a folder targets the folder', () => {
    expect(firstId(createLibraryCollisionDetection(true)(args('book', { x: 50, y: 25 })))).toBe('folder-1');
  });

  test('otherwise a book only collides with books, never texts', () => {
    // Pointer right on top of the text card.
    expect(firstId(createLibraryCollisionDetection(true)(args('book', { x: 50, y: 225 })))).toBe('book-10');
  });

  test('with reordering off, only folders are targets', () => {
    expect(createLibraryCollisionDetection(false)(args('book', { x: 250, y: 125 }))).toEqual([]);
    expect(firstId(createLibraryCollisionDetection(false)(args('book', { x: 50, y: 25 })))).toBe('folder-1');
  });

  test('a folder never targets another folder for nesting, it just reorders among folders', () => {
    expect(firstId(createLibraryCollisionDetection(true)(args('folder', { x: 250, y: 125 })))).toBe('folder-1');
  });
});
