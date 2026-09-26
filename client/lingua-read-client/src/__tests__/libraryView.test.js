import {
  EMPTY_FILTERS,
  createLibraryCollisionDetection,
  dragCount,
  filterLibrary,
  hasActiveFilters,
  languageOptions,
  reorderSection,
  resolveDragIntent,
  tagOptions,
} from '../utils/libraryView';

const items = {
  folders: [
    { folderId: 1, name: 'Spanish shelf' },
    { folderId: 2, name: 'Podcasts' },
  ],
  books: [
    { bookId: 10, title: 'Cien años', languageName: 'Spanish', tags: ['novel'], totalWords: 100, knownWords: 95 },
    { bookId: 11, title: 'Der Prozess', languageName: 'German', tags: [], totalWords: 100, knownWords: 40 },
  ],
  texts: [
    { textId: 20, title: 'Noticias', languageName: 'Spanish', tag: 'news', totalWords: 100, knownWords: 85 },
    { textId: 21, title: 'Nachrichten', languageName: 'German', tag: null, totalWords: 0, knownWords: 0 },
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
