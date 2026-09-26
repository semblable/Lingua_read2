// Pure helpers behind the Library grid: filtering, filter options, and turning a dnd-kit drag
// into either "move into a folder" or "reorder within a section". Kept out of Library.tsx so the
// rules can be unit-tested without staging pointer drags.
import { closestCenter, pointerWithin, type CollisionDetection } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { comprehensionBand, comprehensionPercent, type ComprehensionBand } from './comprehensibility';
import type { LibraryBook, LibraryFolder, LibraryText, SelectableType, SelectedItem } from './store';

export type LibraryItems = {
  folders: LibraryFolder[];
  books: LibraryBook[];
  texts: LibraryText[];
};

export type LibraryFilters = {
  search: string;
  language: string;
  tag: string;
  comprehension: ComprehensionBand | 'all';
};

export const EMPTY_FILTERS: LibraryFilters = {
  search: '',
  language: '',
  tag: '',
  comprehension: 'all',
};

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.language !== '' ||
    filters.tag !== '' ||
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

  // Folders carry no language, tag or stats, so only the search applies to them.
  const folders = query
    ? items.folders.filter((f) => includesQuery(query, f.name))
    : items.folders;

  const books = items.books.filter((b) =>
    (!filters.language || b.languageName === filters.language) &&
    (!filters.tag || (b.tags ?? []).includes(filters.tag)) &&
    (!query || includesQuery(query, b.title)) &&
    inBand(b)
  );

  const texts = items.texts.filter((t) =>
    (!filters.language || t.languageName === filters.language) &&
    (!filters.tag || t.tag === filters.tag) &&
    (!query || includesQuery(query, t.title)) &&
    inBand(t)
  );

  return { folders, books, texts };
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

export type DragEndpoint = { type: SelectableType; id: number };

export type DragIntent =
  | { kind: 'move'; targetFolderId: number; items: SelectedItem[] }
  | { kind: 'reorder'; type: SelectableType; activeId: number; overId: number }
  | null;

// Books and texts dropped on a folder go into it, together with the rest of the selection when
// the dragged card is part of it. Everything else is a reorder within the dragged item's own
// section, and only when reordering is allowed (manual order, no filters hiding items).
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

export function dragCount(active: DragEndpoint, selectedItems: SelectedItem[]): number {
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
