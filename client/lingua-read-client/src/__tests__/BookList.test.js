import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import BookList from '../pages/BookList';
import { getBooks } from '../utils/api';

vi.mock('../utils/api', () => ({
  getBooks: vi.fn()
}));

const renderBookList = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <BookList />
    </MemoryRouter>
  );

const sampleBooks = [
  {
    bookId: 1,
    title: 'Book One',
    description: 'First book',
    languageName: 'French',
    completionPercentage: 50,
    partCount: 3,
    knownWords: 100,
    learningWords: 50,
    totalWords: 500,
    unknownWordPercentage: 70,
    createdAt: '2026-01-01T00:00:00Z',
    lastReadAt: '2026-04-01T00:00:00Z',
    lastReadTextId: 10,
    coverImagePath: null,
    parts: [{ textId: 10 }]
  },
  {
    bookId: 2,
    title: 'Book Two',
    description: 'Second book',
    languageName: 'Spanish',
    completionPercentage: 0,
    partCount: 1,
    knownWords: 0,
    learningWords: 0,
    totalWords: 0,
    unknownWordPercentage: null,
    createdAt: '2026-02-01T00:00:00Z',
    lastReadAt: null,
    lastReadTextId: null,
    coverImagePath: null,
    parts: [{ textId: 20 }]
  }
];

describe('BookList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  test('renders a spinner while loading', () => {
    getBooks.mockReturnValue(new Promise(() => {}));
    const { container } = renderBookList();
    expect(container.querySelector('.spinner-border')).toBeInTheDocument();
  });

  test('renders the empty state when no books are returned', async () => {
    getBooks.mockResolvedValue([]);
    renderBookList();
    expect(
      await screen.findByText(/You haven't added any books yet/i)
    ).toBeInTheDocument();
  });

  test('renders all book cards when data is present', async () => {
    getBooks.mockResolvedValue(sampleBooks);
    renderBookList();
    expect(await screen.findByText('Book One')).toBeInTheDocument();
    expect(screen.getByText('Book Two')).toBeInTheDocument();
  });

  test('filters by language when a non-empty language filter is selected', async () => {
    getBooks.mockResolvedValue(sampleBooks);
    renderBookList();
    await screen.findByText('Book One');

    const selects = screen.getAllByRole('combobox');
    // Language filter is the first combobox in the toolbar; the comprehension
    // filter (added by Feature 2) is the second.
    fireEvent.change(selects[0], { target: { value: 'French' } });

    await waitFor(() => {
      expect(screen.queryByText('Book Two')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Book One')).toBeInTheDocument();
  });

  test('renders an error alert when getBooks rejects', async () => {
    getBooks.mockRejectedValue(new Error('boom'));
    renderBookList();
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  describe('comprehensibility filter', () => {
    const booksWithComprehension = [
      {
        bookId: 30, title: 'Brutal Russian Novel', languageName: 'Russian',
        completionPercentage: 0, partCount: 1, knownWords: 30, learningWords: 0,
        totalWords: 100, unknownWordPercentage: 70, createdAt: '2026-01-01T00:00:00Z',
        lastReadAt: null, lastReadTextId: null, coverImagePath: null, parts: [{ textId: 31 }]
      },
      {
        bookId: 40, title: 'Decent French Story', languageName: 'French',
        completionPercentage: 0, partCount: 1, knownWords: 85, learningWords: 0,
        totalWords: 100, unknownWordPercentage: 15, createdAt: '2026-01-02T00:00:00Z',
        lastReadAt: null, lastReadTextId: null, coverImagePath: null, parts: [{ textId: 41 }]
      },
      {
        bookId: 50, title: 'Perfect Spanish Story', languageName: 'Spanish',
        completionPercentage: 0, partCount: 1, knownWords: 95, learningWords: 0,
        totalWords: 100, unknownWordPercentage: 5, createdAt: '2026-01-03T00:00:00Z',
        lastReadAt: null, lastReadTextId: null, coverImagePath: null, parts: [{ textId: 51 }]
      },
    ];

    test('renders comprehensibility badges for books with known/total stats', async () => {
      getBooks.mockResolvedValue(booksWithComprehension);
      renderBookList();
      await screen.findByText('Brutal Russian Novel');
      const badges = screen.getAllByTestId('comprehensibility-badge');
      expect(badges).toHaveLength(3);
    });

    test('filter to sweet-spot hides too-hard and challenging books', async () => {
      getBooks.mockResolvedValue(booksWithComprehension);
      renderBookList();
      await screen.findByText('Brutal Russian Novel');

      const filter = screen.getByTestId('comprehensibility-filter');
      fireEvent.change(filter, { target: { value: 'sweet-spot' } });

      await waitFor(() => {
        expect(screen.queryByText('Brutal Russian Novel')).not.toBeInTheDocument();
      });
      expect(screen.queryByText('Decent French Story')).not.toBeInTheDocument();
      expect(screen.getByText('Perfect Spanish Story')).toBeInTheDocument();
    });

    test('default ("all") filter shows every book', async () => {
      getBooks.mockResolvedValue(booksWithComprehension);
      renderBookList();
      expect(await screen.findByText('Brutal Russian Novel')).toBeInTheDocument();
      expect(screen.getByText('Decent French Story')).toBeInTheDocument();
      expect(screen.getByText('Perfect Spanish Story')).toBeInTheDocument();
    });

    test('honors comp= URL search param on first render', async () => {
      getBooks.mockResolvedValue(booksWithComprehension);
      render(
        <MemoryRouter
          initialEntries={['/books?comp=challenging']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <BookList />
        </MemoryRouter>
      );
      await screen.findByText('Decent French Story');
      expect(screen.queryByText('Brutal Russian Novel')).not.toBeInTheDocument();
      expect(screen.queryByText('Perfect Spanish Story')).not.toBeInTheDocument();
    });
  });
});
