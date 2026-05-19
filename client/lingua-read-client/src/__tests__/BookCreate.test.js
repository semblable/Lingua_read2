import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import BookCreate from '../pages/BookCreate';
import {
  createBook,
  uploadBook,
  getAllLanguages,
  uploadAudiobookTracks
} from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext';

vi.mock('../utils/api', () => ({
  createBook: vi.fn(),
  uploadBook: vi.fn(),
  getAllLanguages: vi.fn(),
  uploadAudiobookTracks: vi.fn()
}));

const mockSettings = { defaultLanguageId: 1 };
const mockLanguages = [
  { languageId: 1, name: 'Spanish' },
  { languageId: 2, name: 'French' }
];

const renderPage = () =>
  render(
    <SettingsContext.Provider
      value={{ settings: mockSettings, loadingSettings: false }}
    >
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <BookCreate />
      </MemoryRouter>
    </SettingsContext.Provider>
  );

describe('BookCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllLanguages.mockResolvedValue(mockLanguages);
    createBook.mockResolvedValue({ bookId: 99 });
    uploadBook.mockResolvedValue({ bookId: 99 });
    uploadAudiobookTracks.mockResolvedValue({});
  });

  test('renders the form with the language dropdown populated', async () => {
    renderPage();
    expect(await screen.findByText(/Create New Book/i)).toBeInTheDocument();
    expect(await screen.findByText('Spanish')).toBeInTheDocument();
  });

  test('rejects submission with a whitespace-only title and surfaces a validation error', async () => {
    renderPage();
    await screen.findByText('Spanish');
    // A non-empty value satisfies HTML5 required; the JS validation still
    // catches the trimmed-empty case.
    fireEvent.change(screen.getByLabelText(/Book Title/i), {
      target: { value: '   ' }
    });
    fireEvent.change(screen.getByLabelText(/Book Content/i), {
      target: { value: 'Some content' }
    });
    const form = screen.getByLabelText(/Book Title/i).closest('form');
    fireEvent.submit(form);

    expect(await screen.findByText(/Please enter a title/i)).toBeInTheDocument();
    expect(createBook).not.toHaveBeenCalled();
  });

  test('submits the manual-entry form by calling createBook', async () => {
    renderPage();
    await screen.findByText('Spanish');

    fireEvent.change(screen.getByLabelText(/Book Title/i), {
      target: { value: 'My Book' }
    });
    fireEvent.change(screen.getByLabelText(/Book Content/i), {
      target: { value: 'The quick brown fox' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Create Book from Text/i }));

    await waitFor(() => {
      expect(createBook).toHaveBeenCalledWith(
        'My Book',
        '',
        1,
        'The quick brown fox',
        'paragraph',
        3000,
        []
      );
    });
  });

  test('switches to the upload tab and uses uploadBook on submit', async () => {
    renderPage();
    await screen.findByText('Spanish');

    fireEvent.click(screen.getByRole('tab', { name: /Upload File/i }));
    fireEvent.change(screen.getByLabelText(/Book Title/i), {
      target: { value: 'Uploaded Book' }
    });

    const fileInput = document.getElementById('formFile');
    const file = new File(['hello'], 'sample.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Submit the form directly to sidestep happy-dom's HTML5 required-file
    // validation; the JS submit handler still performs its own validation.
    fireEvent.submit(fileInput.closest('form'));

    await waitFor(() => {
      expect(uploadBook).toHaveBeenCalled();
    });
    expect(createBook).not.toHaveBeenCalled();
  });

  test('surfaces an error when createBook rejects', async () => {
    createBook.mockRejectedValue(new Error('server unavailable'));
    renderPage();
    await screen.findByText('Spanish');

    fireEvent.change(screen.getByLabelText(/Book Title/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/Book Content/i), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Book from Text/i }));

    expect(await screen.findByText(/server unavailable/)).toBeInTheDocument();
  });
});
