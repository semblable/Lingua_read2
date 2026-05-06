import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import BookDetail from '../pages/BookDetail';
import {
  getBook,
  finishBook,
  updateBook,
  deleteBook,
  getText,
  updateText,
  deleteText,
  uploadAudiobookTracks,
  matchHardcoverBook,
  importHardcoverMetadata,
  syncHardcoverProgress
} from '../utils/api';

jest.mock('../utils/api', () => ({
  getBook: jest.fn(),
  finishBook: jest.fn(),
  updateBook: jest.fn(),
  deleteBook: jest.fn(),
  getText: jest.fn(),
  updateText: jest.fn(),
  deleteText: jest.fn(),
  uploadAudiobookTracks: jest.fn(),
  matchHardcoverBook: jest.fn(),
  importHardcoverMetadata: jest.fn(),
  syncHardcoverProgress: jest.fn()
}));

const defaultBook = {
  bookId: 7,
  title: 'Local Book',
  description: 'Local description',
  author: null,
  isbn13: null,
  publisher: null,
  pageCount: null,
  languageName: 'Spanish',
  createdAt: '2026-01-01T00:00:00Z',
  lastReadTextId: null,
  coverImagePath: null,
  hardcoverBookId: null,
  hardcoverEditionId: null,
  hardcoverUserBookId: null,
  hardcoverMatchedAt: null,
  hardcoverLastSyncedAt: null,
  isFinished: false,
  tags: [],
  audiobookTracks: [],
  parts: [
    { textId: 1, title: 'Part 1', partNumber: 1, createdAt: '2026-01-01T00:00:00Z', isFinished: true },
    { textId: 2, title: 'Part 2', partNumber: 2, createdAt: '2026-01-02T00:00:00Z', isFinished: false }
  ]
};

const renderBookDetail = () => render(
  <MemoryRouter
    initialEntries={['/books/7']}
    future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
  >
    <Routes>
      <Route path="/books/:bookId" element={<BookDetail />} />
    </Routes>
  </MemoryRouter>
);

describe('BookDetail Hardcover integration', () => {
  beforeEach(() => {
    getBook.mockReset();
    getBook.mockResolvedValue(defaultBook);
    finishBook.mockReset();
    updateBook.mockReset();
    deleteBook.mockReset();
    getText.mockReset();
    updateText.mockReset();
    deleteText.mockReset();
    uploadAudiobookTracks.mockReset();
    matchHardcoverBook.mockReset();
    importHardcoverMetadata.mockReset();
    syncHardcoverProgress.mockReset();
  });

  test('shows unlinked Hardcover state and can review/apply match candidate', async () => {
    matchHardcoverBook
      .mockResolvedValueOnce({
        applied: false,
        message: 'No high-confidence match found. Please review candidates.',
        candidates: [
          {
            bookId: 55,
            editionId: 66,
            title: 'Remote Book',
            author: 'Remote Author',
            pages: 321,
            isbn13: '9780000000000',
            score: 0.71
          }
        ]
      })
      .mockResolvedValueOnce({
        applied: true,
        message: 'Matched Hardcover book.',
        appliedCandidate: { bookId: 55, title: 'Remote Book', score: 1 },
        candidates: []
      });

    renderBookDetail();

    expect(await screen.findByText('This book is not linked to Hardcover yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^match$/i }));

    expect(await screen.findByText('Review Hardcover Matches')).toBeInTheDocument();
    expect(screen.getByText('Remote Book')).toBeInTheDocument();
    expect(screen.getByText(/Confidence: 71%/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /use this match/i }));

    await waitFor(() => expect(matchHardcoverBook).toHaveBeenNthCalledWith(1, '7'));
    await waitFor(() => expect(matchHardcoverBook).toHaveBeenNthCalledWith(2, '7', 55));
    expect(await screen.findByText('Matched Hardcover book.')).toBeInTheDocument();
  });

  test('imports missing metadata and refreshes book details', async () => {
    importHardcoverMetadata.mockResolvedValue({
      success: true,
      message: 'Imported Hardcover metadata.',
      updatedFields: ['author', 'coverImage'],
      candidates: []
    });

    renderBookDetail();

    await screen.findByText('This book is not linked to Hardcover yet.');
    fireEvent.click(screen.getByRole('button', { name: /import missing metadata/i }));

    await waitFor(() => expect(importHardcoverMetadata).toHaveBeenCalledWith('7'));
    expect(await screen.findByText('Imported Hardcover metadata.')).toBeInTheDocument();
    expect(getBook).toHaveBeenCalledTimes(2);
  });

  test('renders "View on Hardcover" link when slug is present', async () => {
    getBook.mockResolvedValue({
      ...defaultBook,
      hardcoverBookId: 55,
      hardcoverSlug: 'remote-book'
    });

    renderBookDetail();

    const link = await screen.findByRole('link', { name: /view on hardcover/i });
    expect(link).toHaveAttribute('href', 'https://hardcover.app/books/remote-book');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  test('finish book without rating calls API with null rating and shows Completed badge', async () => {
    finishBook.mockResolvedValue({ message: 'No Content' });

    renderBookDetail();

    await screen.findByText('Local Book');
    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));

    // Modal opens with title "Finish book"
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Mark/i)).toBeInTheDocument();
    expect(screen.getByText('No rating')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /finish without rating/i }));

    await waitFor(() => expect(finishBook).toHaveBeenCalledWith('7', null));

    // Completed badge is rendered after success
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    // Finish Book button no longer offered
    expect(screen.queryByRole('button', { name: /^finish book$/i })).not.toBeInTheDocument();
  });

  test('finish book with rating sends selected half-star rating', async () => {
    finishBook.mockResolvedValue({ message: 'No Content' });

    renderBookDetail();

    await screen.findByText('Local Book');
    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));

    // Pick 4.5 stars: click the left half of star 5
    fireEvent.click(await screen.findByRole('button', { name: /rate 4\.5 of 5/i }));
    expect(screen.getByText('4.5 / 5')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /finish with rating/i }));

    await waitFor(() => expect(finishBook).toHaveBeenCalledWith('7', 4.5));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
  });

  test('cancel finish modal does not call API', async () => {
    renderBookDetail();

    await screen.findByText('Local Book');
    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(finishBook).not.toHaveBeenCalled();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  test('syncs Hardcover progress and surfaces result', async () => {
    getBook.mockResolvedValue({
      ...defaultBook,
      hardcoverBookId: 55,
      hardcoverLastSyncedAt: '2026-01-03T00:00:00Z',
      author: 'Remote Author',
      publisher: 'Remote Publisher',
      isbn13: '9780000000000',
      pageCount: 321
    });
    syncHardcoverProgress.mockResolvedValue({
      success: true,
      message: 'Synced progress to Hardcover.',
      completionPercentage: 50,
      statusId: 2,
      progressPages: 160
    });

    renderBookDetail();

    expect(await screen.findByText(/Linked to Hardcover book #55/)).toBeInTheDocument();
    expect(screen.getByText(/Author: Remote Author/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sync progress/i }));

    await waitFor(() => expect(syncHardcoverProgress).toHaveBeenCalledWith('7'));
    expect(await screen.findByText('Synced progress to Hardcover.')).toBeInTheDocument();
  });
});
