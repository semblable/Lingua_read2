import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Container, Row, Col, Button, Spinner, Alert, Breadcrumb, Form, Badge, Dropdown, ListGroup } from 'react-bootstrap';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { LinkContainer } from 'react-router-bootstrap';
import ComprehensibilityFilter, {
  type ComprehensibilityFilterValue,
} from '../components/shared/ComprehensibilityFilter';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import { useLibraryStore } from '../utils/store';
import type { LibraryFolder, SelectableType, SelectedItem } from '../utils/store';
import {
  getLibraryContents,
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder as deleteFolderApi,
  moveLibraryItems,
  reorderLibraryItems,
  deleteLibraryItems,
  searchLibrary
} from '../utils/api';
import type { LibrarySearchResult } from '../utils/api/folders';
import { libraryPath, parseFolderIdParam } from '../utils/helpers';
import {
  LIBRARY_SORTS,
  countItems,
  createLibraryCollisionDetection,
  dragCount,
  elsewhereRows,
  filterLibrary,
  hasActiveFilters,
  isLibrarySort,
  languageOptions,
  reorderSection,
  resolveDragIntent,
  sortLibrary,
  sortableId,
  tagOptions,
  type DragEndpoint,
  type LibraryFilters,
  type LibrarySort,
  type LibraryStatusFilter,
  type LibraryTypeFilter
} from '../utils/libraryView';
import FolderCard from '../components/library/FolderCard';
import LibraryBookCard from '../components/library/LibraryBookCard';
import LibraryTextCard from '../components/library/LibraryTextCard';
import CreateFolderModal from '../components/library/CreateFolderModal';
import MoveToFolderModal from '../components/library/MoveToFolderModal';
import RenameFolderModal from '../components/library/RenameFolderModal';
import SelectionRectangle from '../components/library/SelectionRectangle';
import { useDragSelect } from '../hooks/useDragSelect';

// IDs of one type from a mixed selection, or null when there are none (the API's "not given").
const idsOf = (items: SelectedItem[], type: SelectableType): number[] | null => {
  const ids = items.filter(i => i.type === type).map(i => i.id);
  return ids.length > 0 ? ids : null;
};

// The cross-folder search waits for this many characters and a short pause in typing.
const MIN_SEARCH_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;

const ELSEWHERE_ICONS: Record<SelectableType, string> = {
  folder: 'bi-folder',
  book: 'bi-book',
  text: 'bi-file-text',
};

// dnd-kit data set by the cards: { type, id, item }.
const toDragEndpoint = (data: Record<string, unknown> | undefined): DragEndpoint | null => {
  const type = data?.type as SelectableType | undefined;
  const id = data?.id;
  return type && typeof id === 'number' ? { type, id } : null;
};

const Library = () => {
  const { folderId } = useParams();
  const navigate = useNavigate();
  // A malformed id (/library/abc) shows the root, as before; it must not become NaN, which never
  // matches the loaded folder and would leave the page loading forever.
  const currentFolderId = parseFolderIdParam(folderId ?? null);

  const {
    contentsFolderId, currentFolder, breadcrumbs, folders, books, texts,
    allFolders, error, selectedItems, lastClickedItem,
    setContents, setSectionOrder, setAllFolders, setLoading, setError,
    setSelectedItems, setLastClickedItem, toggleSelectItem, clearSelection
  } = useLibraryStore();

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameFolder, setRenameFolder] = useState<LibraryFolder | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDrag, setActiveDrag] = useState<DragEndpoint | null>(null);

  // Persistent language filter
  const [languageFilter, setLanguageFilter] = useState(() => {
    return localStorage.getItem('libraryLanguageFilter') || '';
  });
  const [tagFilter, setTagFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<LibraryTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>('all');

  // Persistent sort
  const [sort, setSort] = useState<LibrarySort>(() => {
    const saved = localStorage.getItem('librarySort');
    return isLibrarySort(saved) ? saved : 'manual';
  });

  useEffect(() => {
    localStorage.setItem('libraryLanguageFilter', languageFilter);
  }, [languageFilter]);

  useEffect(() => {
    localStorage.setItem('librarySort', sort);
  }, [sort]);

  // Comprehension band filter — persisted to URL ?comp=…
  const [searchParams, setSearchParams] = useSearchParams();
  const comprehensionFilter = (searchParams.get('comp') ?? 'all') as ComprehensibilityFilterValue;
  const setComprehensionFilter = (next: ComprehensibilityFilterValue) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'all') params.delete('comp');
      else params.set('comp', next);
      return params;
    });
  };

  const filters: LibraryFilters = useMemo(() => ({
    search: searchQuery,
    language: languageFilter,
    tag: tagFilter,
    type: typeFilter,
    status: statusFilter,
    comprehension: comprehensionFilter,
  }), [searchQuery, languageFilter, tagFilter, typeFilter, statusFilter, comprehensionFilter]);
  const filtersActive = hasActiveFilters(filters);

  const clearFilters = () => {
    setSearchQuery('');
    setLanguageFilter('');
    setTagFilter('');
    setTypeFilter('all');
    setStatusFilter('all');
    setComprehensionFilter('all');
  };

  // Reordering edits the manual order, so it needs that order on screen with every item of a
  // section visible; with a filter active the new positions would collide with hidden items' ones.
  const canReorder = sort === 'manual' && !filtersActive;
  const collisionDetection = useMemo(() => createLibraryCollisionDetection(canReorder), [canReorder]);

  // Drag-select
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { selectionRect, isDragSelecting } = useDragSelect({
    containerRef,
    enabled: !activeDrag
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: isDragSelecting ? 99999 : 8 }
    }),
    // Focus a card's grip, then Space to pick it up, arrows to move, Space to drop.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Only the newest request may write the store: when the user switches folders quickly, an older
  // response arriving last would otherwise replace the new folder's contents.
  const requestSeq = useRef(0);
  const fetchContents = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getLibraryContents(currentFolderId);
      if (seq !== requestSeq.current) return;
      setContents({
        folderId: currentFolderId,
        currentFolder: data.currentFolder ?? null,
        breadcrumbs: data.breadcrumbs ?? [],
        folders: data.folders ?? [],
        books: data.books ?? [],
        texts: data.texts ?? [],
      });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const message = err instanceof Error ? err.message : '';
      setError(message || 'Failed to load library');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [currentFolderId, setContents, setLoading, setError]);

  const fetchAllFolders = useCallback(async () => {
    try {
      const data = await getFolders();
      setAllFolders(data as LibraryFolder[]);
    } catch (err) {
      // non-critical
    }
  }, [setAllFolders]);

  useEffect(() => {
    fetchContents();
    fetchAllFolders();
    clearSelection();
  }, [fetchContents, fetchAllFolders, clearSelection]);

  // Re-fetch when the page becomes visible again (e.g. returning from TextDisplay/BookDetail)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchContents();
        fetchAllFolders();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchContents, fetchAllFolders]);

  // The store still holds the previous folder's items until this folder's response lands.
  const contentsReady = contentsFolderId === currentFolderId;

  const items = useMemo(() => ({ folders, books, texts }), [folders, books, texts]);
  const visible = useMemo(() => sortLibrary(filterLibrary(items, filters), sort), [items, filters, sort]);
  const { folders: filteredFolders, books: filteredBooks, texts: filteredTexts } = visible;
  const totalItems = countItems(visible);
  const unfilteredTotal = countItems(items);

  // Cross-folder search. Results are kept with the query they answer, so a stale response (or
  // one for text since edited) is never shown.
  const trimmedSearch = searchQuery.trim();
  const [searchResult, setSearchResult] = useState<{ query: string; result: LibrarySearchResult } | null>(null);
  const searchSeq = useRef(0);
  useEffect(() => {
    if (trimmedSearch.length < MIN_SEARCH_LENGTH) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const result = await searchLibrary(trimmedSearch);
        if (seq === searchSeq.current) setSearchResult({ query: trimmedSearch, result });
      } catch {
        // Best effort: the current folder's own filtering still works without it.
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmedSearch]);
  const elsewhere = useMemo(
    () => searchResult && searchResult.query === trimmedSearch
      ? elsewhereRows(searchResult.result, currentFolderId)
      : [],
    [searchResult, trimmedSearch, currentFolderId]
  );

  const languages = useMemo(() => languageOptions(items, languageFilter), [items, languageFilter]);
  const tags = useMemo(() => tagOptions(items, tagFilter), [items, tagFilter]);

  // Flat list of all visible items for shift-click range selection
  const flatItems = useMemo<SelectedItem[]>(() => [
    ...filteredFolders.map(f => ({ id: f.folderId!, type: 'folder' as SelectableType })),
    ...filteredBooks.map(b => ({ id: b.bookId!, type: 'book' as SelectableType })),
    ...filteredTexts.map(t => ({ id: t.textId!, type: 'text' as SelectableType })),
  ], [filteredFolders, filteredBooks, filteredTexts]);

  // A filter change must not leave hidden items selected: Delete and Move act on the selection.
  useEffect(() => {
    const visibleKeys = new Set(flatItems.map(i => sortableId(i.type, i.id)));
    const current = useLibraryStore.getState().selectedItems;
    const kept = current.filter(i => visibleKeys.has(sortableId(i.type, i.id)));
    if (kept.length !== current.length) setSelectedItems(kept);
  }, [flatItems, setSelectedItems]);

  const selectedKeys = useMemo(
    () => new Set(selectedItems.map(i => sortableId(i.type, i.id))),
    [selectedItems]
  );

  const folderSortIds = useMemo(() => filteredFolders.map(f => sortableId('folder', f.folderId!)), [filteredFolders]);
  const bookSortIds = useMemo(() => filteredBooks.map(b => sortableId('book', b.bookId!)), [filteredBooks]);
  const textSortIds = useMemo(() => filteredTexts.map(t => sortableId('text', t.textId!)), [filteredTexts]);

  // Handlers
  const handleCreateFolder = async (name: string, parentId: number | null, color: string | null) => {
    await createFolder(name, parentId, color);
    await fetchContents();
    await fetchAllFolders();
    // errors propagate to modal for display
  };

  const handleRenameFolder = async (folderId: number, data: { name: string; color: string }) => {
    await updateFolder(folderId, data);
    await fetchContents();
    await fetchAllFolders();
    // errors propagate to modal for display
  };

  const handleDeleteFolder = async (folder: LibraryFolder) => {
    if (!window.confirm(`Delete folder "${folder.name}"? Items inside will be moved to the parent folder.`)) return;
    try {
      await deleteFolderApi(folder.folderId as number);
      await fetchContents();
      await fetchAllFolders();
    } catch (err: unknown) {
      setError(`Failed to delete folder: ${(err as Error)?.message}`);
    }
  };

  const handleChangeColor = async (folderId: number, color: string) => {
    await updateFolder(folderId, { color });
    await fetchContents();
    await fetchAllFolders();
  };

  const handleMoveFolderTo = (folder: LibraryFolder) => {
    setSelectedItems([{ id: folder.folderId!, type: 'folder' }]);
    setShowMoveModal(true);
  };

  const handleMoveSelected = async (targetFolderId: number | null) => {
    try {
      await moveLibraryItems(
        idsOf(selectedItems, 'text'),
        idsOf(selectedItems, 'book'),
        idsOf(selectedItems, 'folder'),
        targetFolderId
      );
      clearSelection();
      await fetchContents();
      await fetchAllFolders();
    } catch (err: unknown) {
      setError(`Failed to move items: ${(err as Error)?.message}`);
    }
  };

  const handleDeleteSelected = useCallback(async () => {
    const count = selectedItems.length;
    const hasBooks = selectedItems.some(i => i.type === 'book');
    const hasFolders = selectedItems.some(i => i.type === 'folder');
    let msg = `Delete ${count} selected item${count !== 1 ? 's' : ''}?`;
    if (hasBooks) msg += '\n\nBooks and all their parts will be permanently deleted.';
    if (hasFolders) msg += '\n\nFolder contents will be moved to the parent folder.';
    msg += '\n\nThis cannot be undone.';

    if (!window.confirm(msg)) return;

    try {
      await deleteLibraryItems(
        idsOf(selectedItems, 'text'),
        idsOf(selectedItems, 'book'),
        idsOf(selectedItems, 'folder')
      );
      clearSelection();
      await fetchContents();
      await fetchAllFolders();
    } catch (err: unknown) {
      setError(`Failed to delete items: ${(err as Error)?.message}`);
    }
  }, [selectedItems, clearSelection, fetchContents, fetchAllFolders, setError]);

  // "Add Content" from inside a folder files the new item in that folder. LinkContainer needs the
  // query in `search`; it rejects a '?' inside the pathname.
  const withFolder = (pathname: string) => ({
    pathname,
    search: currentFolderId ? `?folderId=${currentFolderId}` : ''
  });

  const handleNavigateFolder = (id: number | null | undefined) => {
    if (id) {
      navigate(`/library/${id}`);
    } else {
      navigate('/library');
    }
  };

  // Ctrl+click / Shift+click handler for cards
  const handleItemClick = useCallback((id: number, type: SelectableType, event: React.MouseEvent) => {
    if (event.shiftKey && lastClickedItem) {
      // Range selection
      const lastIdx = flatItems.findIndex(i => i.id === lastClickedItem.id && i.type === lastClickedItem.type);
      const curIdx = flatItems.findIndex(i => i.id === id && i.type === type);
      if (lastIdx !== -1 && curIdx !== -1) {
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        const range = flatItems.slice(start, end + 1);
        if (event.ctrlKey || event.metaKey) {
          // Additive range: merge with existing
          const merged = [...selectedItems];
          range.forEach(item => {
            if (!merged.find(m => m.id === item.id && m.type === item.type)) {
              merged.push(item);
            }
          });
          setSelectedItems(merged);
        } else {
          setSelectedItems(range);
        }
      }
    } else if (event.ctrlKey || event.metaKey) {
      toggleSelectItem(id, type);
      setLastClickedItem({ id, type });
    } else {
      setSelectedItems([{ id, type }]);
      setLastClickedItem({ id, type });
    }
  }, [lastClickedItem, flatItems, selectedItems, setSelectedItems, toggleSelectItem, setLastClickedItem]);

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDrag(toDragEndpoint(event.active.data.current));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDrag(null);
    const active = toDragEndpoint(event.active.data.current);
    if (!active) return;
    const intent = resolveDragIntent(active, toDragEndpoint(event.over?.data.current), selectedItems, canReorder);
    if (!intent) return;

    if (intent.kind === 'move') {
      try {
        await moveLibraryItems(
          idsOf(intent.items, 'text'),
          idsOf(intent.items, 'book'),
          idsOf(intent.items, 'folder'),
          intent.targetFolderId
        );
        clearSelection();
      } catch (err: unknown) {
        setError(`Failed to move items: ${(err as Error)?.message}`);
      }
      await fetchContents();
      await fetchAllFolders();
      return;
    }

    const sectionIds = intent.type === 'folder'
      ? filteredFolders.map(f => f.folderId!)
      : intent.type === 'book'
        ? filteredBooks.map(b => b.bookId!)
        : filteredTexts.map(t => t.textId!);
    const order = reorderSection(sectionIds, intent.type, intent.activeId, intent.overId);
    if (!order) return;

    setSectionOrder(intent.type, order.map(o => o.id));
    try {
      await reorderLibraryItems(currentFolderId, order);
    } catch (err: unknown) {
      setError(`Failed to reorder items: ${(err as Error)?.message}`);
      await fetchContents();
    }
  };

  const draggedCount = activeDrag ? dragCount(activeDrag, selectedItems) : 0;

  // Keyboard shortcuts for the selection: Esc clears it, Ctrl/Cmd+A selects everything shown,
  // Delete (or Cmd+Backspace) deletes it. Not while typing, dragging or in a dialog.
  const modalOpen = showCreateFolder || showMoveModal || showRenameModal;
  useEffect(() => {
    if (!contentsReady || modalOpen || activeDrag) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape' && selectedItems.length > 0) {
        clearSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && flatItems.length > 0) {
        e.preventDefault();
        setSelectedItems(flatItems);
      } else if ((e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) && selectedItems.length > 0) {
        e.preventDefault();
        handleDeleteSelected();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [contentsReady, modalOpen, activeDrag, selectedItems, flatItems, clearSelection, setSelectedItems, handleDeleteSelected]);

  return (
    <Container className="py-4 main-content-padding">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2 className="mb-0 d-flex align-items-center gap-2">
          <i className="bi bi-collection"></i>
          Library
          {contentsReady && currentFolder && (
            <Button
              size="sm"
              variant="outline-secondary"
              onClick={() => { setRenameFolder(currentFolder); setShowRenameModal(true); }}
              title="Edit folder"
            >
              <i className="bi bi-pencil me-1"></i>Edit Folder
            </Button>
          )}
        </h2>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Actions */}
          <Button size="sm" variant="outline-primary" onClick={() => setShowCreateFolder(true)}>
            <i className="bi bi-folder-plus me-1"></i>New Folder
          </Button>
          <Dropdown>
            <Dropdown.Toggle size="sm" variant="success" id="library-add-content-dropdown">
              <i className="bi bi-plus-lg me-1"></i>Add Content
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <LinkContainer to={withFolder('/books/create')}><Dropdown.Item>Add Book</Dropdown.Item></LinkContainer>
              <LinkContainer to={withFolder('/texts/create')}><Dropdown.Item>Add Text</Dropdown.Item></LinkContainer>
              <LinkContainer to={withFolder('/texts/create-audio')}><Dropdown.Item>Add Audio Lesson</Dropdown.Item></LinkContainer>
              <LinkContainer to={withFolder('/texts/create-batch-audio')}><Dropdown.Item>Batch Audio</Dropdown.Item></LinkContainer>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>

      {/* Search, sort and filters */}
      <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
        <Form.Control
          type="search"
          placeholder="Search library..."
          size="sm"
          style={{ width: '200px' }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search library"
        />
        <Form.Select
          size="sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as LibrarySort)}
          style={{ width: '160px' }}
          aria-label="Sort"
        >
          {LIBRARY_SORTS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Form.Select>
        {/* Language filter */}
        <Form.Select
          size="sm"
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          style={{ width: '150px' }}
          aria-label="Language filter"
        >
          <option value="">All Languages</option>
          {languages.map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </Form.Select>
        {/* Tag filter */}
        {tags.length > 0 && (
          <Form.Select
            size="sm"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            style={{ width: '150px' }}
            aria-label="Tag filter"
          >
            <option value="">All Tags</option>
            {tags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </Form.Select>
        )}
        <Form.Select
          size="sm"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as LibraryTypeFilter)}
          style={{ width: '140px' }}
          aria-label="Type filter"
        >
          <option value="all">All types</option>
          <option value="books">Books</option>
          <option value="texts">Texts</option>
          <option value="audio">Audio lessons</option>
        </Form.Select>
        <Form.Select
          size="sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LibraryStatusFilter)}
          style={{ width: '140px' }}
          aria-label="Status filter"
        >
          <option value="all">Any status</option>
          <option value="unfinished">Not finished</option>
          <option value="finished">Finished</option>
        </Form.Select>
        {/* Comprehension band filter */}
        <ComprehensibilityFilter
          value={comprehensionFilter}
          onChange={setComprehensionFilter}
        />
        {filtersActive && (
          <Button size="sm" variant="link" className="px-1" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Breadcrumbs */}
      {contentsReady && (breadcrumbs.length > 0 || currentFolder) && (
        <Breadcrumb className="mb-3">
          <Breadcrumb.Item onClick={() => handleNavigateFolder(null)} active={!currentFolder}>
            <i className="bi bi-house me-1"></i>Library
          </Breadcrumb.Item>
          {breadcrumbs.map((crumb, idx) => (
            <Breadcrumb.Item
              key={crumb.folderId}
              onClick={() => handleNavigateFolder(crumb.folderId)}
              active={idx === breadcrumbs.length - 1}
            >
              {crumb.name}
            </Breadcrumb.Item>
          ))}
        </Breadcrumb>
      )}

      {/* Selection toolbar */}
      {contentsReady && selectedItems.length > 0 && (
        <Alert variant="info" className="d-flex align-items-center justify-content-between py-2">
          <span>
            <Badge bg="primary" className="me-2">{selectedItems.length}</Badge>
            item{selectedItems.length !== 1 ? 's' : ''} selected
          </span>
          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-primary" onClick={() => setShowMoveModal(true)}>
              <i className="bi bi-folder-symlink me-1"></i>Move to Folder
            </Button>
            {currentFolderId && (
              <Button size="sm" variant="outline-secondary" onClick={() => handleMoveSelected(null)}>
                <i className="bi bi-box-arrow-up me-1"></i>Move to Root
              </Button>
            )}
            <Button size="sm" variant="outline-danger" onClick={handleDeleteSelected}>
              <i className="bi bi-trash me-1"></i>Delete
            </Button>
            <Button size="sm" variant="outline-secondary" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </Alert>
      )}

      {/* Selection shortcuts hint */}
      {contentsReady && selectedItems.length === 0 && totalItems > 0 && (
        <div className="text-muted small mb-2" style={{ opacity: 0.7 }}>
          <i className="bi bi-info-circle me-1"></i>
          <kbd>Ctrl</kbd>+click to multi-select &middot; <kbd>Shift</kbd>+click for range &middot; <kbd>Ctrl</kbd>+<kbd>A</kbd> for all &middot; Drag empty space to lasso-select
          {!canReorder && (
            <> &middot; {sort !== 'manual' ? 'Switch to Manual order to reorder' : 'Clear filters to reorder'}</>
          )}
        </div>
      )}

      {/* Items hidden by filters */}
      {contentsReady && filtersActive && totalItems > 0 && totalItems < unfilteredTotal && (
        <div className="text-muted small mb-2" data-testid="library-filter-summary">
          Showing {totalItems} of {unfilteredTotal} items
          <Button size="sm" variant="link" className="p-0 ms-2 align-baseline" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}

      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      {/* Content. The container stays mounted: useDragSelect attaches its listener to it once. */}
      <div ref={containerRef} className="library-grid-container">
        {!contentsReady ? (
          !error && (
            <div className="py-5 text-center">
              <Spinner animation="border" role="status">
                <span className="visually-hidden">Loading...</span>
              </Spinner>
            </div>
          )
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDrag(null)}
          >
            {/* Folders section */}
            {filteredFolders.length > 0 && (
              <SortableContext items={folderSortIds} strategy={rectSortingStrategy}>
                <h6 className="text-muted text-uppercase small mb-2 mt-3">
                  <i className="bi bi-folder me-1"></i>Folders
                </h6>
                <Row xs={1} md={2} lg={3} className="g-3 mb-3">
                  {filteredFolders.map(folder => (
                    <Col key={folder.folderId}>
                      <FolderCard
                        folder={folder}
                        onClick={handleNavigateFolder}
                        onRename={(f) => { setRenameFolder(f); setShowRenameModal(true); }}
                        onDelete={handleDeleteFolder}
                        onChangeColor={handleChangeColor}
                        onMoveTo={handleMoveFolderTo}
                        isSelected={selectedKeys.has(sortableId('folder', folder.folderId!))}
                        onSelect={toggleSelectItem}
                        onItemClick={handleItemClick}
                      />
                    </Col>
                  ))}
                </Row>
              </SortableContext>
            )}

            {/* Books section */}
            {filteredBooks.length > 0 && (
              <SortableContext items={bookSortIds} strategy={rectSortingStrategy}>
                <h6 className="text-muted text-uppercase small mb-2 mt-3">
                  <i className="bi bi-book me-1"></i>Books
                </h6>
                <Row xs={1} sm={2} md={3} lg={4} className="g-3 mb-3">
                  {filteredBooks.map(book => (
                    <Col key={book.bookId}>
                      <LibraryBookCard
                        book={book}
                        isSelected={selectedKeys.has(sortableId('book', book.bookId!))}
                        onSelect={toggleSelectItem}
                        onItemClick={handleItemClick}
                      />
                    </Col>
                  ))}
                </Row>
              </SortableContext>
            )}

            {/* Texts section */}
            {filteredTexts.length > 0 && (
              <SortableContext items={textSortIds} strategy={rectSortingStrategy}>
                <h6 className="text-muted text-uppercase small mb-2 mt-3">
                  <i className="bi bi-file-text me-1"></i>Texts
                </h6>
                <Row xs={1} sm={2} md={3} lg={4} className="g-3 mb-3">
                  {filteredTexts.map(text => (
                    <Col key={text.textId}>
                      <LibraryTextCard
                        text={text}
                        isSelected={selectedKeys.has(sortableId('text', text.textId!))}
                        onSelect={toggleSelectItem}
                        onItemClick={handleItemClick}
                      />
                    </Col>
                  ))}
                </Row>
              </SortableContext>
            )}

            <DragOverlay>
              {activeDrag ? (
                <div className="card shadow p-2" style={{ opacity: 0.9 }}>
                  <span>
                    <i className="bi bi-arrows-move me-2"></i>
                    {draggedCount > 1 ? `Moving ${draggedCount} items` : 'Moving item'}
                  </span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {/* Empty states */}
        {contentsReady && totalItems === 0 && (
          unfilteredTotal > 0 ? (
            <div className="text-center py-5">
              <i className="bi bi-funnel text-muted" style={{ fontSize: '3rem', opacity: 0.5 }}></i>
              <h4 className="mt-3 text-muted">No items match the current filters</h4>
              <p className="text-muted">
                {unfilteredTotal} item{unfilteredTotal !== 1 ? 's are' : ' is'} hidden in this folder.
              </p>
              <Button variant="outline-secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="text-center py-5">
              <i className="bi bi-collection text-muted" style={{ fontSize: '3rem', opacity: 0.5 }}></i>
              <h4 className="mt-3 text-muted">
                {currentFolderId ? 'This folder is empty' : 'Your library is empty'}
              </h4>
              <p className="text-muted">
                {!currentFolderId && 'Start by adding a book, text, or creating a folder to organize your content.'}
              </p>
              <div className="d-flex gap-2 justify-content-center mt-3">
                <Button variant="outline-primary" onClick={() => setShowCreateFolder(true)}>
                  <i className="bi bi-folder-plus me-1"></i>Create Folder
                </Button>
                <LinkContainer to={withFolder('/books/create')}>
                  <Button variant="primary"><i className="bi bi-plus-lg me-1"></i>Add Book</Button>
                </LinkContainer>
                <LinkContainer to={withFolder('/texts/create')}>
                  <Button variant="outline-success"><i className="bi bi-plus-lg me-1"></i>Add Text</Button>
                </LinkContainer>
              </div>
            </div>
          )
        )}
      </div>
      <SelectionRectangle rect={selectionRect} />

      {/* Search matches in other folders */}
      {contentsReady && elsewhere.length > 0 && (
        <div className="mt-4" data-testid="library-search-elsewhere">
          <h6 className="text-muted text-uppercase small mb-2">
            <i className="bi bi-search me-1"></i>Elsewhere in your library
          </h6>
          <ListGroup>
            {elsewhere.map(row => (
              <ListGroup.Item key={row.key} className="d-flex align-items-center gap-2">
                <i className={`bi ${row.isAudioLesson ? 'bi-headphones' : ELSEWHERE_ICONS[row.type]}`}></i>
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  <Link to={row.href} className="d-block text-truncate">{row.title}</Link>
                  <small className="text-muted">
                    {row.detail && <>{row.detail} &middot; </>}
                    in <Link to={libraryPath(row.folderId)}>{row.folderPath || 'Library'}</Link>
                  </small>
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        </div>
      )}

      {/* Modals */}
      <CreateFolderModal
        show={showCreateFolder}
        onHide={() => setShowCreateFolder(false)}
        onSubmit={handleCreateFolder}
        parentFolderId={currentFolderId}
      />
      <MoveToFolderModal
        show={showMoveModal}
        onHide={() => setShowMoveModal(false)}
        folders={allFolders}
        onMove={handleMoveSelected}
        itemCount={selectedItems.length}
        excludeFolderIds={idsOf(selectedItems, 'folder') ?? []}
      />
      <RenameFolderModal
        show={showRenameModal}
        onHide={() => { setShowRenameModal(false); setRenameFolder(null); }}
        folder={renameFolder}
        onSubmit={handleRenameFolder}
      />
    </Container>
  );
};

export default Library;
