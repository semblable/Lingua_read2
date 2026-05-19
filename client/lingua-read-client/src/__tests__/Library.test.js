import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import '@testing-library/jest-dom';
import Library from '../pages/Library';
import { useLibraryStore } from '../utils/store';
import {
  getLibraryContents,
  getFolders,
  createFolder
} from '../utils/api';

vi.mock('../utils/api', () => ({
  getLibraryContents: vi.fn(),
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveLibraryItems: vi.fn(),
  reorderLibraryItems: vi.fn(),
  deleteLibraryItems: vi.fn()
}));

// useDragSelect uses Pointer events; stub it to a no-op so we don't need to
// stage drag interactions in tests.
vi.mock('../hooks/useDragSelect', () => ({
  useDragSelect: () => ({ selectionRect: null, isDragSelecting: false })
}));

const renderLibrary = (path = '/library') =>
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/library" element={<Library />} />
        <Route path="/library/folder/:folderId" element={<Library />} />
      </Routes>
    </MemoryRouter>
  );

const emptyContents = {
  currentFolder: null,
  breadcrumbs: [],
  folders: [],
  books: [],
  texts: []
};

const sampleContents = {
  currentFolder: null,
  breadcrumbs: [],
  folders: [
    { folderId: 1, name: 'My Folder', color: null }
  ],
  books: [
    { bookId: 10, title: 'Sample Book', languageName: 'French', tags: [] }
  ],
  texts: [
    { textId: 100, title: 'Sample Text', languageName: 'French', tag: null }
  ]
};

describe('Library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.setState({
      currentFolder: null,
      breadcrumbs: [],
      folders: [],
      books: [],
      texts: [],
      allFolders: [],
      loading: false,
      error: null,
      selectedItems: [],
      lastClickedItem: null
    });
    localStorage.clear();
    getFolders.mockResolvedValue([]);
    createFolder.mockResolvedValue({ folderId: 99 });
  });

  test('renders folders, books, and texts loaded from the API', async () => {
    getLibraryContents.mockResolvedValue(sampleContents);
    renderLibrary();

    expect(await screen.findByText('Sample Book')).toBeInTheDocument();
    expect(screen.getByText('Sample Text')).toBeInTheDocument();
    expect(screen.getByText('My Folder')).toBeInTheDocument();
  });

  test('renders an empty state when there is nothing in the folder', async () => {
    getLibraryContents.mockResolvedValue(emptyContents);
    renderLibrary();

    // Wait for the contents fetch to settle, then assert nothing rendered for the children
    await waitFor(() => expect(getLibraryContents).toHaveBeenCalled());
    expect(screen.queryByText('Sample Book')).not.toBeInTheDocument();
    expect(screen.queryByText('My Folder')).not.toBeInTheDocument();
  });

  test('renders an error alert when getLibraryContents rejects', async () => {
    getLibraryContents.mockRejectedValue(new Error('library down'));
    renderLibrary();
    expect(await screen.findByText('library down')).toBeInTheDocument();
  });

  test('fetches contents for a specific folder when navigating to /library/folder/:id', async () => {
    getLibraryContents.mockResolvedValue(emptyContents);
    renderLibrary('/library/folder/42');
    await waitFor(() => expect(getLibraryContents).toHaveBeenCalledWith(42));
  });
});
