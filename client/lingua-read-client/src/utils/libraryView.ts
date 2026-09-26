// Pure helpers behind the Library grid: filtering, filter options, and turning a dnd-kit drag
// into either "move into a folder" or "reorder within a section". Kept out of Library.tsx so the
// rules can be unit-tested without staging pointer drags.
import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { comprehensionBand, comprehensionPercent, type ComprehensionBand } from './comprehensibility';
import { libraryPath } from './helpers';
import type { LibrarySearchResult } from './api/folders';
import type { LibraryBook, LibraryFolder, LibraryText, SelectableType, SelectedItem } from './store';

export type LibraryItems = {
  folders: LibraryFolder[];
  books: LibraryBook[];
  texts: LibraryText[];
};

export type LibraryTypeFilter = 'all' | 'books' | 'texts' | 'audio';
export type LibraryStatusFilter = 'all' | 'finished' | 'unfinished';

export type LibraryFilters = {
  search: string;
  language: string;
  tag: string;
  type: LibraryTypeFilter;
  status: LibraryStatusFilter;
  comprehension: ComprehensionBand | 'all';
};

export const EMPTY_FILTERS: LibraryFilters = {
  search: '',
  language: '',
  tag: '',
  type: 'all',
  status: 'all',
  comprehension: 'all',
};

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.language !== '' ||
    filters.tag !== '' ||
    filters.type !== 'all' ||
    filters.status !== 'all' ||
    filters.comprehension !== 'all'
  );
}

const includesQuery = (query: string, ...fields: Array<string | null | undefined>): boolean =>
  fields.some((field) => (field ?? '').toLowerCase().includes(query));

export function filterLibrary(items: LibraryItems, filters: LibraryFilters): LibraryItems {
  const query = filters.search.trim().toLowerCase();
  const inBand = (item: LibraryBook | LibraryText) =>
    filters.comprehension === 'all' ||
    comprehensionBand(comprehensionPercent(item)) === filters.comprehension;
  const hasStatus = (item: LibraryBook | LibraryText) =>
    filters.status === 'all' || (filters.status === 'finished') === !!item.isFinished;
  const textTypeMatches = (t: LibraryText) =>
    filters.type === 'all' ||
    (filters.type === 'texts' && !t.isAudioLesson) ||
    (filters.type === 'audio' && !!t.isAudioLesson);

  // Folders carry no language, tag, type or stats, so only the search applies to them; they stay
  // visible for navigation.
  const folders = query
    ? items.folders.filter((f) => includesQuery(query, f.name))
    : items.folders;

  const books = filters.type !== 'all' && filters.type !== 'books' ? [] : items.books.filter((b) =>
    (!filters.language || b.languageName === filters.language) &&
    (!filters.tag || (b.tags ?? []).includes(filters.tag)) &&
    (!query || includesQuery(query, b.title, b.author)) &&
    hasStatus(b) &&
    inBand(b)
  );

  const texts = filters.type === 'books' ? [] : items.texts.filter((t) =>
    textTypeMatches(t) &&
    (!filters.language || t.languageName === filters.language) &&
    (!filters.tag || t.tag === filters.tag) &&
    (!query || includesQuery(query, t.title)) &&
    hasStatus(t) &&
    inBand(t)
  );

  return { folders, books, texts };
}

// ---- sorting ----

export type LibrarySort = 'manual' | 'recent' | 'title' | 'added' | 'comprehension';

export const LIBRARY_SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'manual', label: 'Manual order' },
  { value: 'recent', label: 'Recently read' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'added', label: 'Date added' },
  { value: 'comprehension', label: 'Easiest first' },
];

export const isLibrarySort = (value: string | null): value is LibrarySort =>
  LIBRARY_SORTS.some((s) => s.value === value);

const byTitle = (a: string | null | undefined, b: string | null | undefined): number =>
  (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' });

// Newest first; items without a date go last and keep their manual order among themselves.
const byNewest = (a: string | null | undefined, b: string | null | undefined): number => {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.isNaN(ta) ? (Number.isNaN(tb) ? 0 : 1) : -1;
  return tb - ta;
};

// Highest known-word share first; unknown stats last.
const byEasiest = (a: LibraryBook | LibraryText, b: LibraryBook | LibraryText): number =>
  (comprehensionPercent(b) ?? -1) - (comprehensionPercent(a) ?? -1);

// 'manual' keeps the server's SortOrder. Folders only have a name, so they follow the title sort
// and otherwise keep their manual order.
export function sortLibrary(items: LibraryItems, sort: LibrarySort): LibraryItems {
  const sorted = <T>(list: T[], compare: (a: T, b: T) => number) => [...list].sort(compare);
  switch (sort) {
    case 'title':
      return {
        folders: sorted(items.folders, (a, b) => byTitle(a.name, b.name)),
        books: sorted(items.books, (a, b) => byTitle(a.title, b.title)),
        texts: sorted(items.texts, (a, b) => byTitle(a.title, b.title)),
      };
    case 'recent':
      return {
        folders: items.folders,
        books: sorted(items.books, (a, b) => byNewest(a.lastReadAt, b.lastReadAt)),
        texts: sorted(items.texts, (a, b) => byNewest(a.lastAccessedAt, b.lastAccessedAt)),
      };
    case 'added':
      return {
        folders: items.folders,
        books: sorted(items.books, (a, b) => byNewest(a.createdAt, b.createdAt)),
        texts: sorted(items.texts, (a, b) => byNewest(a.createdAt, b.createdAt)),
      };
    case 'comprehension':
      return {
        folders: items.folders,
        books: sorted(items.books, byEasiest),
        texts: sorted(items.texts, byEasiest),
      };
    default:
      return items;
  }
}

// ---- search results outside the current folder ----

export type ElsewhereRow = {
  key: string;
  type: SelectableType;
  title: string;
  detail: string;
  href: string;
  isAudioLesson: boolean;
  folderId: number | null;
  folderPath: string;
};

// Matches from the whole library, minus the ones already on screen in this folder.
export function elsewhereRows(result: LibrarySearchResult, currentFolderId: number | null): ElsewhereRow[] {
  const isHere = (folderId: number | null | undefined) => (folderId ?? null) === currentFolderId;
  const rows: ElsewhereRow[] = [];
  for (const f of result.folders ?? []) {
    if (f.folderId == null || isHere(f.parentFolderId)) continue;
    rows.push({
      key: sortableId('folder', f.folderId), type: 'folder', title: f.name ?? '', detail: '',
      href: libraryPath(f.folderId), isAudioLesson: false,
      folderId: f.parentFolderId ?? null, folderPath: f.folderPath ?? '',
    });
  }
  for (const b of result.books ?? []) {
    if (b.bookId == null || isHere(b.folderId)) continue;
    rows.push({
      key: sortableId('book', b.bookId), type: 'book', title: b.title ?? '',
      detail: [b.author, b.languageName].filter(Boolean).join(' · '),
      href: `/books/${b.bookId}`, isAudioLesson: false,
      folderId: b.folderId ?? null, folderPath: b.folderPath ?? '',
    });
  }
  for (const t of result.texts ?? []) {
    if (t.textId == null || isHere(t.folderId)) continue;
    rows.push({
      key: sortableId('text', t.textId), type: 'text', title: t.title ?? '',
      detail: t.languageName ?? '',
      href: `/texts/${t.textId}`, isAudioLesson: !!t.isAudioLesson,
      folderId: t.folderId ?? null, folderPath: t.folderPath ?? '',
    });
  }
  return rows;
}

export function countItems(items: LibraryItems): number {
  return items.folders.length + items.books.length + items.texts.length;
}

// The active value is always offered, even when nothing in the current folder has it; otherwise a
// select shows its first option ("All …") while the filter keeps hiding everything.
function optionsWithActive(values: Iterable<string>, active: string): string[] {
  const set = new Set(values);
  if (active) set.add(active);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function languageOptions(items: LibraryItems, active: string): string[] {
  const languages: string[] = [];
  items.books.forEach((b) => { if (b.languageName) languages.push(b.languageName); });
  items.texts.forEach((t) => { if (t.languageName) languages.push(t.languageName); });
  return optionsWithActive(languages, active);
}

export function tagOptions(items: LibraryItems, active: string): string[] {
  const tags: string[] = [];
  items.books.forEach((b) => b.tags?.forEach((tag) => tags.push(tag)));
  items.texts.forEach((t) => { if (t.tag) tags.push(t.tag); });
  return optionsWithActive(tags, active);
}

// ---- drag and drop ----

export const sortableId = (type: SelectableType, id: number): string => `${type}-${id}`;

export type ReorderEntry = { id: number; type: SelectableType; sortOrder: number };

// New order for one section (folders, books or texts) after dragging activeId onto overId.
// Returns null when nothing moves.
export function reorderSection(
  ids: number[],
  type: SelectableType,
  activeId: number,
  overId: number
): ReorderEntry[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  return arrayMove(ids, from, to).map((id, sortOrder) => ({ id, type, sortOrder }));
}

// reorderSection over the whole section in manual order, including items a filter hides. Moving
// the dragged item next to the one it was dropped on keeps every hidden item where it was, so
// reordering works while the list is filtered.
export function reorderInSection(
  items: LibraryItems,
  type: SelectableType,
  activeId: number,
  overId: number
): ReorderEntry[] | null {
  const ids = type === 'folder'
    ? items.folders.map((f) => f.folderId!)
    : type === 'book'
      ? items.books.map((b) => b.bookId!)
      : items.texts.map((t) => t.textId!);
  return reorderSection(ids, type, activeId, overId);
}

export type DragEndpoint = { type: SelectableType; id: number };

export type DragIntent =
  | { kind: 'move'; targetFolderId: number; items: SelectedItem[] }
  | { kind: 'reorder'; type: SelectableType; activeId: number; overId: number }
  | null;

// Books and texts dropped on a folder go into it, together with the rest of the selection when
// the dragged card is part of it. Everything else is a reorder within the dragged item's own
// section, and only when reordering is allowed (manual order on screen).
export function resolveDragIntent(
  active: DragEndpoint,
  over: DragEndpoint | null,
  selectedItems: SelectedItem[],
  canReorder: boolean
): DragIntent {
  if (!over) return null;

  if (over.type === 'folder' && active.type !== 'folder') {
    const isSelected = selectedItems.some((i) => i.type === active.type && i.id === active.id);
    const items = (isSelected ? selectedItems : [active])
      .filter((i) => !(i.type === 'folder' && i.id === over.id));
    return items.length > 0 ? { kind: 'move', targetFolderId: over.id, items } : null;
  }

  if (!canReorder || over.type !== active.type || over.id === active.id) return null;
  return { kind: 'reorder', type: active.type, activeId: active.id, overId: over.id };
}

// A folder drag only reorders that folder, so it never carries the selection along.
export function dragCount(active: DragEndpoint, selectedItems: SelectedItem[]): number {
  if (active.type === 'folder') return 1;
  const isSelected = selectedItems.some((i) => i.type === active.type && i.id === active.id);
  return isSelected ? selectedItems.length : 1;
}

// Collision rules matching resolveDragIntent: a book or text under the pointer of a folder card
// targets that folder; otherwise only cards of the dragged item's own type are candidates, so a
// drag never "lands" in another section.
export const createLibraryCollisionDetection = (canReorder: boolean): CollisionDetection => (args) => {
  const activeType = args.active.data.current?.type as SelectableType | undefined;
  const ofType = (type: SelectableType) =>
    args.droppableContainers.filter((c) => c.data.current?.type === type);

  if (activeType !== 'folder') {
    const folderHits = pointerWithin({ ...args, droppableContainers: ofType('folder') });
    if (folderHits.length > 0) return folderHits;
  }

  if (!canReorder || !activeType) return [];
  return closestCenter({ ...args, droppableContainers: ofType(activeType) });
};
