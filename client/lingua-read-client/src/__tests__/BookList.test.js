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

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'French' } });

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
});
