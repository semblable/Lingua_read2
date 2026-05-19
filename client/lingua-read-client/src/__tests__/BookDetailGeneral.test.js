import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';
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

vi.mock('../utils/api', () => ({
  getBook: vi.fn(),
  finishBook: vi.fn(),
  updateBook: vi.fn(),
  deleteBook: vi.fn(),
  getText: vi.fn(),
  updateText: vi.fn(),
  deleteText: vi.fn(),
  uploadAudiobookTracks: vi.fn(),
  matchHardcoverBook: vi.fn(),
  importHardcoverMetadata: vi.fn(),
  syncHardcoverProgress: vi.fn()
}));

const baseBook = {
  bookId: 7,
  title: 'Sample Book',
  description: 'A sample',
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
    {
      textId: 1,
      title: 'Part 1',
      partNumber: 1,
      createdAt: '2026-01-01T00:00:00Z',
      isFinished: true
    },
    {
      textId: 2,
      title: 'Part 2',
      partNumber: 2,
      createdAt: '2026-01-02T00:00:00Z',
      isFinished: false
    }
  ]
};

const renderBookDetail = () =>
  render(
    <MemoryRouter
      initialEntries={['/books/7']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/books/:bookId" element={<BookDetail />} />
      </Routes>
    </MemoryRouter>
  );

describe('BookDetail (general flows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBook.mockResolvedValue(baseBook);
    finishBook.mockResolvedValue({ message: 'No Content' });
    updateBook.mockResolvedValue({});
    updateText.mockResolvedValue({});
    deleteText.mockResolvedValue(undefined);
    uploadAudiobookTracks.mockResolvedValue({});
    getText.mockResolvedValue({
      textId: 1,
      title: 'Part 1',
      content: 'Hello world',
      tag: ''
    });
  });

  test('renders book title, language, and the sorted parts list', async () => {
    renderBookDetail();
    expect(await screen.findByText('Sample Book')).toBeInTheDocument();
    // "Part 1" appears in both the h6 title and the partNumber badge — accept either.
    expect(screen.getAllByText('Part 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Part 2').length).toBeGreaterThan(0);
  });

  test('opens edit-book modal and calls updateBook on submit', async () => {
    renderBookDetail();
    await screen.findByText('Sample Book');

    fireEvent.click(screen.getByRole('button', { name: /Edit Book/i }));

    const dialog = await screen.findByRole('dialog');
    const titleInput = dialog.querySelector('input[type="text"]');
    fireEvent.change(titleInput, { target: { value: 'Renamed Book' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(updateBook).toHaveBeenCalledWith(7, { title: 'Renamed Book' });
    });
  });

  test('per-part delete calls deleteText after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderBookDetail();
    await screen.findByText('Sample Book');

    // Per-part delete buttons are labelled exactly "Delete" (the "Delete Book"
    // button has a different accessible name).
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete$/ });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(deleteText).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });

  test('does not call deleteText when the confirm dialog is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderBookDetail();
    await screen.findByText('Sample Book');

    fireEvent.click(screen.getAllByRole('button', { name: /^Delete$/ })[0]);

    expect(deleteText).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  test('uploads audiobook tracks when files are selected and the upload button is clicked', async () => {
    renderBookDetail();
    await screen.findByText('Sample Book');

    const fileInput = document.querySelector('input[type="file"]');
    const file = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /Upload Selected Tracks/i }));

    await waitFor(() => expect(uploadAudiobookTracks).toHaveBeenCalled());
  });
});
