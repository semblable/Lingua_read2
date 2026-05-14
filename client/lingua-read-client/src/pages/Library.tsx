import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Container, Row, Col, Button, Spinner, Alert, Breadcrumb, Form, Badge, Dropdown } from 'react-bootstrap';
import { Link, useParams, useNavigate } from 'react-router-dom';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LinkAs: any = Link;
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy
} from '@dnd-kit/sortable';
import { useLibraryStore } from '../utils/store';
import {
  getLibraryContents,
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder as deleteFolderApi,
  moveLibraryItems,
  reorderLibraryItems,
  deleteLibraryItems
} from '../utils/api';
import FolderCard from '../components/library/FolderCard';
import LibraryBookCard from '../components/library/LibraryBookCard';
import LibraryTextCard from '../components/library/LibraryTextCard';
import CreateFolderModal from '../components/library/CreateFolderModal';
import MoveToFolderModal from '../components/library/MoveToFolderModal';
import RenameFolderModal from '../components/library/RenameFolderModal';
import SelectionRectangle from '../components/library/SelectionRectangle';
import { useDragSelect } from '../hooks/useDragSelect';

const Library = () => {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const currentFolderId = folderId ? parseInt(folderId) : null;

  const {
    currentFolder, breadcrumbs, folders, books, texts,
    allFolders, loading, error, selectedItems, lastClickedItem,
    setContents, setAllFolders, setLoading, setError,
    setSelectedItems, setLastClickedItem, toggleSelectItem, clearSelection
  } = useLibraryStore();

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameFolder, setRenameFolder] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeId, setActiveId] = useState(null);

  // Persistent language filter
  const [languageFilter, setLanguageFilter] = useState(() => {
    return localStorage.getItem('libraryLanguageFilter') || '';
  });
  const [tagFilter, setTagFilter] = useState('');

  useEffect(() => {
    localStorage.setItem('libraryLanguageFilter', languageFilter);
  }, [languageFilter]);

  // Drag-select
  const containerRef = useRef(null);
  const { selectionRect, isDragSelecting } = useDragSelect({
    containerRef,
    enabled: !activeId
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: isDragSelecting ? 99999 : 8 }
    })
  );

  const fetchContents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLibraryContents(currentFolderId);
      // The API returns optional fields; cast to the store payload shape and
      // let setContents normalize the missing fields.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setContents(data as any);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(message || 'Failed to load library');
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, setContents, setLoading, setError]);

  const fetchAllFolders = useCallback(async () => {
    try {
      const data = await getFolders();
      setAllFolders(data);
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

  // Get unique languages from current items
  const uniqueLanguages = useMemo(() => {
    const langs = new Set<string>();
    books.forEach(b => b.languageName && langs.add(b.languageName));
    texts.forEach(t => t.languageName && langs.add(t.languageName));
    return [...langs].sort();
  }, [books, texts]);

  // Get unique tags from current items
  const uniqueTags = useMemo(() => {
    const tags = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    books.forEach(b => b.tags?.forEach((t: any) => tags.add(t)));
    texts.forEach(t => t.tag && tags.add(t.tag));
    return [...tags].sort();
  }, [books, texts]);

  // Filter items by search query and language
  const filteredFolders = useMemo(() => {
    let result = folders;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(f => f.name.toLowerCase().includes(q));
    }
    return result;
  }, [folders, searchQuery]);

  const filteredBooks = useMemo(() => {
    let result = books;
    if (languageFilter) result = result.filter(b => b.languageName === languageFilter);
    if (tagFilter) result = result.filter(b => b.tags?.includes(tagFilter));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(b => b.title.toLowerCase().includes(q));
    }
    return result;
  }, [books, searchQuery, languageFilter, tagFilter]);

  const filteredTexts = useMemo(() => {
    let result = texts;
    if (languageFilter) result = result.filter(t => t.languageName === languageFilter);
    if (tagFilter) result = result.filter(t => t.tag === tagFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(q));
    }
    return result;
  }, [texts, searchQuery, languageFilter, tagFilter]);

  // Build sortable IDs for dnd-kit
  const sortableIds = useMemo(() => [
    ...filteredFolders.map(f => `folder-${f.folderId}`),
    ...filteredBooks.map(b => `book-${b.bookId}`),
    ...filteredTexts.map(t => `text-${t.textId}`)
  ], [filteredFolders, filteredBooks, filteredTexts]);

  const totalItems = filteredFolders.length + filteredBooks.length + filteredTexts.length;

  // Handlers
  const handleCreateFolder = async (name, parentId, color) => {
    await createFolder(name, parentId, color);
    await fetchContents();
    await fetchAllFolders();
    // errors propagate to modal for display
  };

  const handleRenameFolder = async (folderId, data) => {
    await updateFolder(folderId, data);
    await fetchContents();
    await fetchAllFolders();
    // errors propagate to modal for display
  };

  const handleDeleteFolder = async (folder) => {
    if (!window.confirm(`Delete folder "${folder.name}"? Items inside will be moved to the parent folder.`)) return;
    try {
      await deleteFolderApi(folder.folderId);
      await fetchContents();
      await fetchAllFolders();
    } catch (err) {
      setError(`Failed to delete folder: ${err.message}`);
    }
  };

  const handleChangeColor = async (folderId, color) => {
    await updateFolder(folderId, { color });
    await fetchContents();
    await fetchAllFolders();
  };

  const handleMoveSelected = async (targetFolderId) => {
    const textIds = selectedItems.filter(i => i.type === 'text').map(i => i.id);
    const bookIds = selectedItems.filter(i => i.type === 'book').map(i => i.id);
    const folderIds = selectedItems.filter(i => i.type === 'folder').map(i => i.id);
    try {
      await moveLibraryItems(
        textIds.length > 0 ? textIds : null,
        bookIds.length > 0 ? bookIds : null,
        folderIds.length > 0 ? folderIds : null,
        targetFolderId
      );
      clearSelection();
      await fetchContents();
      await fetchAllFolders();
    } catch (err) {
      setError(`Failed to move items: ${err.message}`);
    }
  };

  const handleDeleteSelected = async () => {
    const count = selectedItems.length;
    const hasBooks = selectedItems.some(i => i.type === 'book');
    const hasFolders = selectedItems.some(i => i.type === 'folder');
    let msg = `Delete ${count} selected item${count !== 1 ? 's' : ''}?`;
    if (hasBooks) msg += '\n\nBooks and all their parts will be permanently deleted.';
    if (hasFolders) msg += '\n\nFolder contents will be moved to the parent folder.';
    msg += '\n\nThis cannot be undone.';

    if (!window.confirm(msg)) return;

    const textIds = selectedItems.filter(i => i.type === 'text').map(i => i.id);
    const bookIds = selectedItems.filter(i => i.type === 'book').map(i => i.id);
    const folderIds = selectedItems.filter(i => i.type === 'folder').map(i => i.id);

    try {
      await deleteLibraryItems(
        textIds.length > 0 ? textIds : null,
        bookIds.length > 0 ? bookIds : null,
        folderIds.length > 0 ? folderIds : null
      );
      clearSelection();
      await fetchContents();
      await fetchAllFolders();
    } catch (err) {
      setError(`Failed to delete items: ${err.message}`);
    }
  };

  const handleNavigateFolder = (id) => {
    if (id) {
      navigate(`/library/${id}`);
    } else {
      navigate('/library');
    }
  };

  // Flat list of all visible items for shift-click range selection
  const flatItems = useMemo(() => [
    ...filteredFolders.map(f => ({ id: f.folderId, type: 'folder' })),
    ...filteredBooks.map(b => ({ id: b.bookId, type: 'book' })),
    ...filteredTexts.map(t => ({ id: t.textId, type: 'text' })),
  ], [filteredFolders, filteredBooks, filteredTexts]);

  // Ctrl+click / Shift+click handler for cards
  const handleItemClick = useCallback((id, type, event) => {
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
  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = async (event) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Check if dropping onto a folder
    const overData = over.data?.current;
    if (overData?.type === 'folder') {
      const targetFolderId = overData.item.folderId;
      const activeData = active.data?.current;
      if (!activeData) return;

      const { type, item } = activeData;

      // Don't drop folder into itself
      if (type === 'folder' && item.folderId === targetFolderId) return;

      if (type === 'text') {
        await moveLibraryItems([item.textId], null, null, targetFolderId);
      } else if (type === 'book') {
        await moveLibraryItems(null, [item.bookId], null, targetFolderId);
      } else if (type === 'folder') {
        await moveLibraryItems(null, null, [item.folderId], targetFolderId);
      }
      await fetchContents();
      await fetchAllFolders();
      return;
    }

    // Otherwise, reorder items within the same folder
    const oldIndex = sortableIds.indexOf(active.id);
    const newIndex = sortableIds.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Build reorder payload
    const reorderedIds = [...sortableIds];
    const [moved] = reorderedIds.splice(oldIndex, 1);
    reorderedIds.splice(newIndex, 0, moved);

    const items = reorderedIds.map((id, idx) => {
      const [type, idStr] = id.split('-');
      return { id: parseInt(idStr), type, position: idx, sortOrder: idx };
    });

    try {
      await reorderLibraryItems(currentFolderId, items);
      await fetchContents();
    } catch (err) {
      // Revert on error by refetching
      await fetchContents();
    }
  };

  if (loading && totalItems === 0) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </Container>
    );
  }

  return (
    <Container className="py-4 main-content-padding">
      {/* Header */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2 className="mb-0 d-flex align-items-center gap-2">
          <i className="bi bi-collection"></i>
          Library
          {currentFolder && (
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
          {/* Search */}
          <Form.Control
            type="search"
            placeholder="Search..."
            size="sm"
            style={{ width: '180px' }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {/* Language filter */}
          <Form.Select
            size="sm"
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            style={{ width: '150px' }}
          >
            <option value="">All Languages</option>
            {uniqueLanguages.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </Form.Select>
          {/* Tag filter */}
          {uniqueTags.length > 0 && (
            <Form.Select
              size="sm"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              style={{ width: '150px' }}
            >
              <option value="">All Tags</option>
              {uniqueTags.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </Form.Select>
          )}
          {/* Actions */}
          <Button size="sm" variant="outline-primary" onClick={() => setShowCreateFolder(true)}>
            <i className="bi bi-folder-plus me-1"></i>New Folder
          </Button>
          <Dropdown>
            <Dropdown.Toggle size="sm" variant="success" id="add-content-dropdown">
              <i className="bi bi-plus-lg me-1"></i>Add Content
            </Dropdown.Toggle>
            <Dropdown.Menu>
              <Dropdown.Item as={LinkAs} to="/books/create">Add Book</Dropdown.Item>
              <Dropdown.Item as={LinkAs} to="/texts/create">Add Text</Dropdown.Item>
              <Dropdown.Item as={LinkAs} to="/texts/create-audio">Add Audio Lesson</Dropdown.Item>
              <Dropdown.Item as={LinkAs} to="/texts/create-batch-audio">Batch Audio</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>

      {/* Breadcrumbs */}
      {(breadcrumbs.length > 0 || currentFolder) && (
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
      {selectedItems.length > 0 && (
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
      {selectedItems.length === 0 && totalItems > 0 && (
        <div className="text-muted small mb-2" style={{ opacity: 0.7 }}>
          <i className="bi bi-info-circle me-1"></i>
          <kbd>Ctrl</kbd>+click to multi-select &middot; <kbd>Shift</kbd>+click for range &middot; Drag empty space to lasso-select
        </div>
      )}

      {error && <Alert variant="danger" dismissible onClose={() => setError(null)}>{error}</Alert>}

      {/* Content */}
      <div ref={containerRef} className="library-grid-container">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            {/* Folders section */}
            {filteredFolders.length > 0 && (
              <>
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
                        isOver={activeId && activeId !== `folder-${folder.folderId}`}
                        isSelected={!!selectedItems.find(i => i.id === folder.folderId && i.type === 'folder')}
                        onSelect={toggleSelectItem}
                        onItemClick={handleItemClick}
                      />
                    </Col>
                  ))}
                </Row>
              </>
            )}

            {/* Books section */}
            {filteredBooks.length > 0 && (
              <>
                <h6 className="text-muted text-uppercase small mb-2 mt-3">
                  <i className="bi bi-book me-1"></i>Books
                </h6>
                <Row xs={1} sm={2} md={3} lg={4} className="g-3 mb-3">
                  {filteredBooks.map(book => (
                    <Col key={book.bookId}>
                      <LibraryBookCard
                        book={book}
                        isSelected={!!selectedItems.find(i => i.id === book.bookId && i.type === 'book')}
                        onSelect={toggleSelectItem}
                        onItemClick={handleItemClick}
                      />
                    </Col>
                  ))}
                </Row>
              </>
            )}

            {/* Texts section */}
            {filteredTexts.length > 0 && (
              <>
                <h6 className="text-muted text-uppercase small mb-2 mt-3">
                  <i className="bi bi-file-text me-1"></i>Texts
                </h6>
                <Row xs={1} sm={2} md={3} lg={4} className="g-3 mb-3">
                  {filteredTexts.map(text => (
                    <Col key={text.textId}>
                      <LibraryTextCard
                        text={text}
                        isSelected={!!selectedItems.find(i => i.id === text.textId && i.type === 'text')}
                        onSelect={toggleSelectItem}
                        onItemClick={handleItemClick}
                      />
                    </Col>
                  ))}
                </Row>
              </>
            )}
          </SortableContext>

          <DragOverlay>
            {activeId ? (
              <div style={{ opacity: 0.8, transform: 'scale(1.02)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                <div className="bg-white rounded p-2 border">
                  <i className="bi bi-arrows-move me-2"></i>Moving item...
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
      <SelectionRectangle rect={selectionRect} />

      {/* Empty state */}
      {!loading && totalItems === 0 && (
        <div className="text-center py-5">
          <i className="bi bi-collection" style={{ fontSize: '3rem', color: '#ccc' }}></i>
          <h4 className="mt-3 text-muted">
            {searchQuery ? 'No items match your search' : currentFolderId ? 'This folder is empty' : 'Your library is empty'}
          </h4>
          <p className="text-muted">
            {!searchQuery && !currentFolderId && 'Start by adding a book, text, or creating a folder to organize your content.'}
          </p>
          <div className="d-flex gap-2 justify-content-center mt-3">
            {!searchQuery && (
              <>
                <Button variant="outline-primary" onClick={() => setShowCreateFolder(true)}>
                  <i className="bi bi-folder-plus me-1"></i>Create Folder
                </Button>
                <Button as={LinkAs} to="/books/create" variant="primary">
                  <i className="bi bi-plus-lg me-1"></i>Add Book
                </Button>
                <Button as={LinkAs} to="/texts/create" variant="outline-success">
                  <i className="bi bi-plus-lg me-1"></i>Add Text
                </Button>
              </>
            )}
            {searchQuery && (
              <Button variant="outline-secondary" onClick={() => setSearchQuery('')}>
                Clear Search
              </Button>
            )}
          </div>
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
