import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import BookDetail from '../pages/BookDetail';
import { SettingsContext } from '../contexts/SettingsContext';
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
  unlinkHardcoverBook,
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
  unlinkHardcoverBook: vi.fn(),
  importHardcoverMetadata: vi.fn(),
  syncHardcoverProgress: vi.fn(),
  previewReSplitBook: vi.fn(),
  reSplitBook: vi.fn()
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

const renderBookDetail = ({ settingsOverride = null, initialPath = '/books/7', withNavLink = false } = {}) => {
  const router = (
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {withNavLink && <Link to="/books/8">Go to Book 8</Link>}
      <Routes>
        <Route path="/books/:bookId" element={<BookDetail />} />
      </Routes>
    </MemoryRouter>
  );

  if (!settingsOverride) {
    return render(router);
  }

  return render(
    <SettingsContext.Provider
      value={{
        settings: settingsOverride,
        loadingSettings: false,
        errorSettings: null,
        updateSetting: vi.fn(),
        refetchSettings: vi.fn()
      }}
    >
      {router}
    </SettingsContext.Provider>
  );
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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
    unlinkHardcoverBook.mockReset();
    importHardcoverMetadata.mockReset();
    syncHardcoverProgress.mockReset();
  });

  test('shows unlinked Hardcover state and passes displayed hardcoverEditionId on Use This Match without changing dropdown', async () => {
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
        appliedCandidate: { bookId: 55, editionId: 66, title: 'Remote Book', score: 1 },
        candidates: []
      });

    renderBookDetail();

    expect(await screen.findByText('This book is not linked to Hardcover yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^match$/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Review Hardcover Matches')).toBeInTheDocument();
    expect(within(dialog).getByText('No high-confidence match found. Please review candidates.')).toBeInTheDocument();
    expect(within(dialog).getByText('Remote Book')).toBeInTheDocument();
    expect(within(dialog).getByText(/Confidence: 71%/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /use this match/i }));

    await waitFor(() => expect(matchHardcoverBook).toHaveBeenNthCalledWith(1, '7'));
    await waitFor(() =>
      expect(matchHardcoverBook).toHaveBeenNthCalledWith(2, '7', {
        hardcoverBookId: 55,
        hardcoverEditionId: 66
      })
    );
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

  test('Import Missing Metadata -> selecting candidate chains importHardcoverMetadata', async () => {
    importHardcoverMetadata
      .mockResolvedValueOnce({
        success: false,
        message: 'Multiple Hardcover matches found. Please select one.',
        candidates: [
          {
            bookId: 55,
            editionId: 66,
            title: 'Remote Book',
            author: 'Remote Author',
            pages: 321,
            score: 0.8
          }
        ]
      })
      .mockResolvedValueOnce({
        success: true,
        message: 'Imported Hardcover metadata.',
        updatedFields: ['author', 'pageCount'],
        candidates: []
      });
    matchHardcoverBook.mockResolvedValueOnce({
      applied: true,
      message: 'Matched Hardcover book.',
      candidates: []
    });

    renderBookDetail();
    await screen.findByText('This book is not linked to Hardcover yet.');

    fireEvent.click(screen.getByRole('button', { name: /import missing metadata/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Multiple Hardcover matches found. Please select one.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /use this match/i }));

    await waitFor(() =>
      expect(matchHardcoverBook).toHaveBeenCalledWith('7', {
        hardcoverBookId: 55,
        hardcoverEditionId: 66
      })
    );
    await waitFor(() => expect(importHardcoverMetadata).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Imported Hardcover metadata.')).toBeInTheDocument();
  });

  test('renders durable ID-based "View on Hardcover" link and edition info', async () => {
    getBook.mockResolvedValue({
      ...defaultBook,
      hardcoverBookId: 55,
      hardcoverEditionId: 66,
      hardcoverSlug: null
    });

    renderBookDetail();

    expect(await screen.findByText(/Linked to Hardcover book #55 \(edition #66\)/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view on hardcover/i });
    expect(link).toHaveAttribute('href', 'https://hardcover.app/id/book/55');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  test('supports manual search, updates displayed edition metadata, and sends selected edition', async () => {
    matchHardcoverBook
      .mockResolvedValueOnce({
        applied: false,
        message: 'No high-confidence match found. Please review candidates.',
        candidates: []
      })
      .mockResolvedValueOnce({
        applied: false,
        message: 'Review Hardcover search results and choose a match.',
        candidates: [
          {
            bookId: 55,
            editionId: 66,
            title: 'El Quijote',
            author: 'Cervantes',
            pages: 900,
            isbn13: '9780000000001',
            score: 0.95,
            editions: [
              { editionId: 66, language: 'English', format: 'Paperback', pages: 900, isbn13: '9780000000001' },
              { editionId: 67, language: 'Spanish', format: 'Ebook', pages: 840, isbn13: '9788400000001' }
            ]
          }
        ]
      })
      .mockResolvedValueOnce({
        applied: true,
        message: 'Matched Hardcover book.',
        candidates: []
      });

    renderBookDetail();
    await screen.findByText('This book is not linked to Hardcover yet.');

    fireEvent.click(screen.getByRole('button', { name: /^match$/i }));
    const searchInput = await screen.findByLabelText('Search Hardcover');
    fireEvent.change(searchInput, { target: { value: 'El Quijote' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    const dialog = await screen.findByRole('dialog');
    const editionSelect = await within(dialog).findByLabelText('Edition for El Quijote');
    expect(within(dialog).getByText(/Pages: 900/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ISBN-13: 9780000000001/)).toBeInTheDocument();

    fireEvent.change(editionSelect, { target: { value: '67' } });
    expect(within(dialog).getByText(/Pages: 840/)).toBeInTheDocument();
    expect(within(dialog).getByText(/ISBN-13: 9788400000001/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Language: Spanish/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /use this match/i }));

    await waitFor(() =>
      expect(matchHardcoverBook).toHaveBeenNthCalledWith(2, '7', { query: 'El Quijote' })
    );
    await waitFor(() =>
      expect(matchHardcoverBook).toHaveBeenNthCalledWith(3, '7', { hardcoverBookId: 55, hardcoverEditionId: 67 })
    );
    expect(await screen.findByText('Matched Hardcover book.')).toBeInTheDocument();
  });

  test('renders modal errors and loading spinners inside modal on search and apply failures', async () => {
    const searchDeferred = deferred();
    const applyDeferred = deferred();
    matchHardcoverBook
      .mockResolvedValueOnce({
        applied: false,
        message: 'Please choose a candidate.',
        candidates: [
          {
            bookId: 55,
            editionId: 66,
            title: 'Stale Candidate',
            author: 'Old Author',
            score: 0.7
          }
        ]
      })
      .mockImplementationOnce(() => searchDeferred.promise)
      .mockResolvedValueOnce({
        applied: false,
        candidates: [
          {
            bookId: 56,
            editionId: 68,
            title: 'Fresh Candidate',
            author: 'New Author',
            score: 0.9
          }
        ]
      })
      .mockImplementationOnce(() => applyDeferred.promise);

    renderBookDetail();
    await screen.findByText('This book is not linked to Hardcover yet.');

    fireEvent.click(screen.getByRole('button', { name: /^match$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Stale Candidate')).toBeInTheDocument();

    // Trigger manual search and verify inline spinner on Search button
    fireEvent.change(within(dialog).getByLabelText('Search Hardcover'), { target: { value: 'failing query' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^search$/i }));

    const searchBtn = within(dialog).getByRole('button', { name: /search/i });
    expect(searchBtn).toBeDisabled();
    expect(searchBtn.querySelector('.spinner-border')).toBeInTheDocument();

    // Reject search: stale candidates are cleared and error renders inside modal
    searchDeferred.reject(new Error('Hardcover API rate limit exceeded.'));
    expect(await within(dialog).findByText('Hardcover API rate limit exceeded.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Stale Candidate')).not.toBeInTheDocument();

    // Search again to get a candidate, then trigger apply failure
    fireEvent.change(within(dialog).getByLabelText('Search Hardcover'), { target: { value: 'fresh query' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^search$/i }));
    expect(await within(dialog).findByText('Fresh Candidate')).toBeInTheDocument();

    const applyBtn = within(dialog).getByRole('button', { name: /use this match/i });
    fireEvent.click(applyBtn);
    expect(applyBtn).toBeDisabled();
    expect(applyBtn.querySelector('.spinner-border')).toBeInTheDocument();

    applyDeferred.reject(new Error('Failed to link selected edition.'));
    expect(await within(dialog).findByText('Failed to link selected edition.')).toBeInTheDocument();
    // Modal stays open so user can retry or pick another candidate
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('highlights current match and pre-selects linked edition in Re-match modal', async () => {
    getBook.mockResolvedValue({
      ...defaultBook,
      hardcoverBookId: 55,
      hardcoverEditionId: 67
    });
    matchHardcoverBook.mockResolvedValueOnce({
      applied: false,
      message: 'Choose a different match or edition.',
      candidates: [
        {
          bookId: 55,
          editionId: 66,
          title: 'El Quijote',
          author: 'Cervantes',
          score: 0.99,
          editions: [
            { editionId: 66, language: 'English', format: 'Paperback', pages: 900 },
            { editionId: 67, language: 'Spanish', format: 'Ebook', pages: 840 }
          ]
        }
      ]
    });

    renderBookDetail();
    await screen.findByText(/Linked to Hardcover book #55/);

    fireEvent.click(screen.getByRole('button', { name: /^re-match$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Current match')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Edition for El Quijote')).toHaveValue('67');
  });

  test('unlinks Hardcover book only after confirmation and refreshes book details', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    getBook
      .mockResolvedValueOnce({
        ...defaultBook,
        hardcoverBookId: 55
      })
      .mockResolvedValueOnce(defaultBook);
    unlinkHardcoverBook.mockResolvedValue(undefined);

    renderBookDetail();

    expect(await screen.findByText(/Linked to Hardcover book #55/)).toBeInTheDocument();

    // Cancel confirmation: unlink API is not called
    fireEvent.click(screen.getByRole('button', { name: /^unlink$/i }));
    expect(unlinkHardcoverBook).not.toHaveBeenCalled();

    // Confirm unlink: unlink API is called and book refreshes
    fireEvent.click(screen.getByRole('button', { name: /^unlink$/i }));
    await waitFor(() => expect(unlinkHardcoverBook).toHaveBeenCalledWith('7'));
    expect(await screen.findByText('Unlinked Hardcover book.')).toBeInTheDocument();
    expect(await screen.findByText('This book is not linked to Hardcover yet.')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  test('resets open Hardcover modal, candidates, and alerts when bookId route changes', async () => {
    getBook.mockImplementation(async (id) => ({
      ...defaultBook,
      bookId: Number(id),
      title: id === '8' ? 'Second Book' : 'Local Book'
    }));
    matchHardcoverBook.mockResolvedValueOnce({
      applied: false,
      message: 'Review candidates for Book 7.',
      candidates: [{ bookId: 55, editionId: 66, title: 'Book 7 Candidate', score: 0.7 }]
    });

    renderBookDetail({ withNavLink: true });
    await screen.findByText('Local Book');

    fireEvent.click(screen.getByRole('button', { name: /^match$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Book 7 Candidate')).toBeInTheDocument();

    // Navigate to another book while modal is open
    fireEvent.click(screen.getByRole('link', { name: 'Go to Book 8' }));

    expect(await screen.findByText('Second Book')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Book 7 Candidate')).not.toBeInTheDocument();
    expect(screen.queryByText('Review candidates for Book 7.')).not.toBeInTheDocument();
  });

  test('unlinked Finish Book modal hides star picker and shows single Finish book button', async () => {
    finishBook.mockResolvedValue(undefined);

    renderBookDetail();

    await screen.findByText('Local Book');
    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/not stored locally/i)).toBeInTheDocument();
    expect(within(dialog).queryByText('No rating')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /rate 4\.5 of 5/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /finish with rating/i })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^finish book$/i }));

    await waitFor(() => expect(finishBook).toHaveBeenCalledWith('7', null));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /^finish book$/i })).not.toBeInTheDocument());
  });

  test('linked Finish Book modal hides star picker when Hardcover sync is disabled in Settings', async () => {
    getBook.mockResolvedValue({
      ...defaultBook,
      hardcoverBookId: 55
    });

    renderBookDetail({
      settingsOverride: {
        hasHardcoverApiToken: true,
        hardcoverSyncEnabled: false
      }
    });

    await screen.findByText('Local Book');
    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Enable Hardcover sync in Settings/i)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /rate 4\.5 of 5/i })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^finish book$/i })).toBeInTheDocument();
  });

  test('linked Finish Book modal sends selected half-star rating', async () => {
    getBook.mockResolvedValue({
      ...defaultBook,
      hardcoverBookId: 55
    });
    finishBook.mockResolvedValue(undefined);

    renderBookDetail({
      settingsOverride: {
        hasHardcoverApiToken: true,
        hardcoverSyncEnabled: true
      }
    });

    await screen.findByText('Local Book');
    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('No rating')).toBeInTheDocument();

    // Pick 4.5 stars: click the left half of star 5
    fireEvent.click(within(dialog).getByRole('button', { name: /rate 4\.5 of 5/i }));
    expect(within(dialog).getByText('4.5 / 5')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /finish with rating/i }));

    await waitFor(() => expect(finishBook).toHaveBeenCalledWith('7', 4.5));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
  });

  test('linked Finish Book modal puts spinner on the exact clicked button when clicking Finish without rating after selecting stars', async () => {
    const finishDeferred = deferred();
    getBook.mockResolvedValue({
      ...defaultBook,
      hardcoverBookId: 55
    });
    finishBook.mockImplementationOnce(() => finishDeferred.promise);

    renderBookDetail({
      settingsOverride: {
        hasHardcoverApiToken: true,
        hardcoverSyncEnabled: true
      }
    });

    await screen.findByText('Local Book');
    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /rate 4 of 5/i }));

    const withoutRatingBtn = within(dialog).getByRole('button', { name: /finish without rating/i });
    const withRatingBtn = within(dialog).getByRole('button', { name: /finish with rating/i });

    fireEvent.click(withoutRatingBtn);

    expect(withoutRatingBtn.querySelector('.spinner-border')).toBeInTheDocument();
    expect(withRatingBtn.querySelector('.spinner-border')).not.toBeInTheDocument();

    finishDeferred.resolve(undefined);
    await waitFor(() => expect(finishBook).toHaveBeenCalledWith('7', null));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
  });

  test('cancel finish modal does not call API and clears previous error', async () => {
    finishBook.mockRejectedValueOnce(new Error('Finish failed temporarily.'));

    renderBookDetail();

    await screen.findByText('Local Book');
    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^finish book$/i }));
    expect(await within(dialog).findByText('Finish failed temporarily.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /finish book/i }));
    const reopenedDialog = await screen.findByRole('dialog');
    expect(within(reopenedDialog).queryByText('Finish failed temporarily.')).not.toBeInTheDocument();
  });

  test('syncs Hardcover progress, surfaces result, and preserves isFinished across silent refresh', async () => {
    const finishedLinkedBook = {
      ...defaultBook,
      hardcoverBookId: 55,
      hardcoverEditionId: 66,
      hardcoverLastSyncedAt: '2026-01-03T00:00:00Z',
      author: 'Remote Author',
      publisher: 'Remote Publisher',
      isbn13: '9780000000000',
      pageCount: 321,
      isFinished: true
    };
    getBook.mockResolvedValue(finishedLinkedBook);
    syncHardcoverProgress.mockResolvedValue({
      success: true,
      message: 'Synced progress to Hardcover.',
      completionPercentage: 100,
      statusId: 3,
      progressPages: 321
    });

    renderBookDetail();

    expect(await screen.findByText(/Linked to Hardcover book #55/)).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText(/Author: Remote Author/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sync progress/i }));

    await waitFor(() => expect(syncHardcoverProgress).toHaveBeenCalledWith('7'));
    expect(await screen.findByText('Synced progress to Hardcover.')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^finish book$/i })).not.toBeInTheDocument();
  });

  test('Sync Progress on unlinked skipped book opens candidate review and chains sync after match', async () => {
    syncHardcoverProgress
      .mockResolvedValueOnce({
        success: false,
        skipped: true,
        message: 'Could not find a high-confidence match.'
      })
      .mockResolvedValueOnce({
        success: true,
        skipped: false,
        message: 'Synced progress to Hardcover.'
      });
    matchHardcoverBook
      .mockResolvedValueOnce({
        applied: false,
        message: 'Select a Hardcover match.',
        candidates: [
          { bookId: 55, editionId: 66, title: 'Remote Book', author: 'Author', score: 0.75 }
        ]
      })
      .mockResolvedValueOnce({
        applied: true,
        message: 'Matched Hardcover book.',
        candidates: []
      });

    renderBookDetail();
    await screen.findByText('This book is not linked to Hardcover yet.');

    fireEvent.click(screen.getByRole('button', { name: /sync progress/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Could not find a high-confidence match.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /use this match/i }));

    await waitFor(() =>
      expect(matchHardcoverBook).toHaveBeenNthCalledWith(2, '7', {
        hardcoverBookId: 55,
        hardcoverEditionId: 66
      })
    );
    await waitFor(() => expect(syncHardcoverProgress).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Synced progress to Hardcover.')).toBeInTheDocument();
  });
});
