import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import '@testing-library/jest-dom';
import Library from '../pages/Library';
import { useLibraryStore } from '../utils/store';
import {
  getLibraryContents,
  getFolders,
  createFolder,
  searchLibrary,
  deleteLibraryItems
} from '../utils/api';

vi.mock('../utils/api', () => ({
  getLibraryContents: vi.fn(),
  getFolders: vi.fn(),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  deleteFolder: vi.fn(),
  moveLibraryItems: vi.fn(),
  reorderLibraryItems: vi.fn(),
  deleteLibraryItems: vi.fn(),
  searchLibrary: vi.fn()
}));

// useDragSelect uses Pointer events; stub it to a no-op so we don't need to
// stage drag interactions in tests.
vi.mock('../hooks/useDragSelect', () => ({
  useDragSelect: () => ({ selectionRect: null, isDragSelecting: false })
}));

// Lets a test switch folders the way the app does, without remounting Library.
const GoTo = ({ path }) => {
  const navigate = useNavigate();
  return <button onClick={() => navigate(path)}>go to {path}</button>;
};

// Same routes as App.tsx.
const renderLibrary = (path = '/library', extra = null) =>
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {extra}
      <Routes>
        <Route path="/library" element={<Library />} />
        <Route path="/library/:folderId" element={<Library />} />
        <Route path="/books/:bookId" element={<div>Book page</div>} />
        <Route path="/texts/:textId" element={<div>Text page</div>} />
      </Routes>
    </MemoryRouter>
  );

const folderContents = (folderId, bookTitle) => ({
  currentFolder: { folderId, name: `Folder ${folderId}` },
  breadcrumbs: [{ folderId, name: `Folder ${folderId}` }],
  folders: [],
  books: [{ bookId: folderId * 10, title: bookTitle, languageName: 'French', tags: [] }],
  texts: []
});

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
    { bookId: 10, title: 'Sample Book', author: 'Sample Author', languageName: 'French', tags: [] }
  ],
  texts: [
    { textId: 100, title: 'Sample Text', languageName: 'French', tag: null, totalWords: 1234 }
  ]
};

describe('Library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.setState({
      contentsFolderId: undefined,
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

  test('fetches contents for a specific folder when navigating to /library/:id', async () => {
    getLibraryContents.mockResolvedValue(emptyContents);
    renderLibrary('/library/42');
    await waitFor(() => expect(getLibraryContents).toHaveBeenCalledWith(42));
  });

  test('Add Content inside a folder files new items in that folder', async () => {
    getLibraryContents.mockResolvedValue({ ...emptyContents, currentFolder: { folderId: 7, name: 'Seven' } });
    renderLibrary('/library/7');

    expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Book/ }).closest('[href]'))
      .toHaveAttribute('href', '/books/create?folderId=7');
    expect(screen.getByRole('button', { name: /Add Text/ }).closest('[href]'))
      .toHaveAttribute('href', '/texts/create?folderId=7');
  });

  test('Add Content at the root adds to the root', async () => {
    getLibraryContents.mockResolvedValue(emptyContents);
    renderLibrary();

    expect(await screen.findByText('Your library is empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Book/ }).closest('[href]'))
      .toHaveAttribute('href', '/books/create');
  });

  describe('search, sort and type', () => {
    test('search also lists matches from other folders, with where they live', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      searchLibrary.mockResolvedValue({
        folders: [],
        books: [
          // Already on screen at the root: not repeated.
          { bookId: 10, title: 'Sample Book', languageName: 'French', folderId: null, folderPath: '' },
          { bookId: 55, title: 'Sample Elsewhere', author: 'Ana', languageName: 'French', folderId: 3, folderPath: 'Novels / French' }
        ],
        texts: []
      });
      renderLibrary();
      await screen.findByText('Sample Book');

      fireEvent.change(screen.getByLabelText('Search library'), { target: { value: 'sample' } });

      const section = await screen.findByTestId('library-search-elsewhere', {}, { timeout: 2000 });
      expect(searchLibrary).toHaveBeenCalledWith('sample');
      expect(section).toHaveTextContent('Sample Elsewhere');
      expect(section).not.toHaveTextContent('Sample Book');
      expect(screen.getByRole('link', { name: 'Sample Elsewhere' })).toHaveAttribute('href', '/books/55');
      expect(screen.getByRole('link', { name: 'Novels / French' })).toHaveAttribute('href', '/library/3');
    });

    test('a one-letter search does not query the whole library', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      renderLibrary();
      await screen.findByText('Sample Book');

      fireEvent.change(screen.getByLabelText('Search library'), { target: { value: 's' } });
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(searchLibrary).not.toHaveBeenCalled();
    });

    test('the type filter narrows to audio lessons', async () => {
      getLibraryContents.mockResolvedValue({
        ...sampleContents,
        texts: [
          { textId: 100, title: 'Sample Text', languageName: 'French', tag: null },
          { textId: 101, title: 'Sample Audio', languageName: 'French', tag: null, isAudioLesson: true }
        ]
      });
      renderLibrary();
      await screen.findByText('Sample Book');

      fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'audio' } });

      expect(screen.getByText('Sample Audio')).toBeInTheDocument();
      expect(screen.queryByText('Sample Text')).not.toBeInTheDocument();
      expect(screen.queryByText('Sample Book')).not.toBeInTheDocument();
    });

    test('the sort choice is remembered', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      renderLibrary();
      await screen.findByText('Sample Book');

      fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'title' } });

      expect(localStorage.getItem('librarySort')).toBe('title');
      expect(screen.getByText(/Switch to Manual order to reorder/)).toBeInTheDocument();
    });
  });

  describe('cards', () => {
    test('a book card shows its author, and a placeholder when it has no cover', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      const { container } = renderLibrary();
      await screen.findByText('Sample Book');

      expect(screen.getByText('Sample Author')).toBeInTheDocument();
      expect(container.querySelector('.library-cover-placeholder')).not.toBeNull();
      expect(screen.getByText(/1,234 words/)).toBeInTheDocument();
    });

    test('clicking a card opens the item, clicking its checkbox only selects it', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      renderLibrary();
      await screen.findByText('Sample Book');

      fireEvent.click(screen.getByLabelText('Select Sample Text'));
      expect(screen.getByText(/item selected/)).toBeInTheDocument();
      expect(screen.queryByText('Text page')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Sample Book'));
      expect(await screen.findByText('Book page')).toBeInTheDocument();
    });

    test('a folder name is a link, so it opens from the keyboard too', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      renderLibrary();
      expect(await screen.findByRole('link', { name: 'My Folder' })).toHaveAttribute('href', '/library/1');
    });

    test('the drag handles are labelled buttons', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      renderLibrary();
      await screen.findByText('Sample Book');
      expect(screen.getByRole('button', { name: 'Move Sample Book' })).toHaveAttribute('tabindex', '0');
    });
  });

  describe('keyboard shortcuts', () => {
    const selectedCount = () => screen.queryByText(/items? selected/)?.parentElement?.textContent ?? '';

    test('Ctrl+A selects everything shown and Escape clears the selection', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      renderLibrary();
      await screen.findByText('Sample Book');

      fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
      expect(selectedCount()).toMatch(/3\s*items selected/);

      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByText(/items? selected/)).not.toBeInTheDocument();
    });

    test('Delete deletes the selection after confirming', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      deleteLibraryItems.mockResolvedValue(undefined);
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderLibrary();
      await screen.findByText('Sample Book');

      fireEvent.click(screen.getByLabelText('Select Sample Book'));
      fireEvent.keyDown(document.body, { key: 'Delete' });

      await waitFor(() => expect(deleteLibraryItems).toHaveBeenCalledWith(null, [10], null));
      expect(confirmSpy).toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    test('typing in the search box is not a shortcut', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      renderLibrary();
      await screen.findByText('Sample Book');

      fireEvent.keyDown(screen.getByLabelText('Search library'), { key: 'a', ctrlKey: true });
      expect(screen.queryByText(/items? selected/)).not.toBeInTheDocument();
    });
  });

  describe('switching folders', () => {
    const deferContents = () => {
      const pending = {};
      getLibraryContents.mockImplementation((id) => new Promise((resolve) => { pending[id] = resolve; }));
      return pending;
    };

    test('a slower response for the folder the user already left is ignored', async () => {
      const pending = deferContents();
      renderLibrary('/library/1', <GoTo path="/library/2" />);
      await waitFor(() => expect(pending[1]).toBeDefined());

      fireEvent.click(screen.getByText('go to /library/2'));
      await waitFor(() => expect(pending[2]).toBeDefined());

      await act(async () => { pending[2](folderContents(2, 'Book in two')); });
      await act(async () => { pending[1](folderContents(1, 'Book in one')); });

      expect(screen.getByText('Book in two')).toBeInTheDocument();
      expect(screen.queryByText('Book in one')).not.toBeInTheDocument();
    });

    test("the previous folder's items are not shown while the next one loads", async () => {
      const pending = deferContents();
      renderLibrary('/library/1', <GoTo path="/library/2" />);
      await waitFor(() => expect(pending[1]).toBeDefined());
      await act(async () => { pending[1](folderContents(1, 'Book in one')); });
      expect(screen.getByText('Book in one')).toBeInTheDocument();

      fireEvent.click(screen.getByText('go to /library/2'));
      await waitFor(() => expect(pending[2]).toBeDefined());

      expect(screen.queryByText('Book in one')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('filters that hide everything', () => {
    const germanOnly = {
      ...emptyContents,
      books: [{ bookId: 10, title: 'German Book', languageName: 'German', tags: [] }]
    };

    test('a saved language missing from this folder stays visible and can be cleared', async () => {
      localStorage.setItem('libraryLanguageFilter', 'Spanish');
      getLibraryContents.mockResolvedValue(germanOnly);
      renderLibrary();

      expect(await screen.findByText('No items match the current filters')).toBeInTheDocument();
      expect(screen.queryByText('Your library is empty')).not.toBeInTheDocument();
      // The select shows the filter that is really applied, not "All Languages".
      expect(screen.getByLabelText('Language filter')).toHaveValue('Spanish');

      fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

      expect(await screen.findByText('German Book')).toBeInTheDocument();
      expect(screen.getByLabelText('Language filter')).toHaveValue('');
    });

    test('a partial match says how many items are hidden', async () => {
      getLibraryContents.mockResolvedValue(sampleContents);
      renderLibrary('/library?comp=sweet-spot');
      await screen.findByText('My Folder');
      expect(screen.getByTestId('library-filter-summary')).toHaveTextContent('Showing 1 of 3 items');
    });
  });

  describe('comprehensibility filter', () => {
    const mixedContents = {
      currentFolder: null,
      breadcrumbs: [],
      folders: [],
      books: [
        // 95% known — sweet-spot
        { bookId: 200, title: 'Sweet-Spot Book', languageName: 'Spanish', tags: [],
          totalWords: 100, unknownWordPercentage: 5 },
        // 30% known — too-hard
        { bookId: 201, title: 'Too-Hard Book', languageName: 'Russian', tags: [],
          totalWords: 100, unknownWordPercentage: 70 },
      ],
      texts: [
        // 95% known — sweet-spot
        { textId: 300, title: 'Sweet-Spot Text', languageName: 'Spanish', tag: null,
          totalWords: 100, unknownWordPercentage: 5 },
        // 85% known — challenging
        { textId: 301, title: 'Challenging Text', languageName: 'French', tag: null,
          totalWords: 100, unknownWordPercentage: 15 },
      ],
    };

    test('sweet-spot filter shows only sweet-spot books and texts', async () => {
      getLibraryContents.mockResolvedValue(mixedContents);
      renderLibrary();
      await screen.findByText('Sweet-Spot Book');

      const filter = screen.getByTestId('comprehensibility-filter');
      fireEvent.change(filter, { target: { value: 'sweet-spot' } });

      await waitFor(() => {
        expect(screen.queryByText('Too-Hard Book')).not.toBeInTheDocument();
      });
      expect(screen.queryByText('Challenging Text')).not.toBeInTheDocument();
      expect(screen.getByText('Sweet-Spot Book')).toBeInTheDocument();
      expect(screen.getByText('Sweet-Spot Text')).toBeInTheDocument();
    });

    test('honors comp= URL search param on first render', async () => {
      getLibraryContents.mockResolvedValue(mixedContents);
      renderLibrary('/library?comp=challenging');
      await screen.findByText('Challenging Text');
      expect(screen.queryByText('Sweet-Spot Book')).not.toBeInTheDocument();
      expect(screen.queryByText('Sweet-Spot Text')).not.toBeInTheDocument();
      expect(screen.queryByText('Too-Hard Book')).not.toBeInTheDocument();
    });
  });
});
