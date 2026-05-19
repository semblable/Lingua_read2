import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import TermsPage from '../pages/TermsPage';
import {
  getAllLanguages,
  getPaginatedWordsByLanguage,
  exportWordsCsv,
  addTermsBatch,
  deleteWord
} from '../utils/api';

vi.mock('../utils/api', () => ({
  getAllLanguages: vi.fn(),
  getPaginatedWordsByLanguage: vi.fn(),
  exportWordsCsv: vi.fn(),
  addTermsBatch: vi.fn(),
  deleteWord: vi.fn()
}));

vi.mock('file-saver', () => ({
  saveAs: vi.fn()
}));

const renderPage = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <TermsPage />
    </MemoryRouter>
  );

const mockLanguages = [
  { languageId: 1, name: 'Spanish' },
  { languageId: 2, name: 'French' }
];

const mockTerms = [
  {
    wordId: 11,
    term: 'gato',
    translation: 'cat',
    status: 3,
    createdAt: '2026-04-01T00:00:00Z'
  },
  {
    wordId: 12,
    term: 'perro',
    translation: 'dog',
    status: 2,
    createdAt: '2026-04-02T00:00:00Z'
  }
];

describe('TermsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getAllLanguages.mockResolvedValue(mockLanguages);
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: mockTerms,
      totalCount: mockTerms.length,
      totalPages: 1
    });
    deleteWord.mockResolvedValue(undefined);
  });

  test('renders the language dropdown after languages load', async () => {
    renderPage();
    expect(await screen.findByText('Spanish')).toBeInTheDocument();
    expect(screen.getByText('French')).toBeInTheDocument();
  });

  test('fetches and renders terms when a language is selected', async () => {
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });

    expect(await screen.findByText('gato')).toBeInTheDocument();
    expect(screen.getByText('perro')).toBeInTheDocument();
    expect(getPaginatedWordsByLanguage).toHaveBeenCalledWith(
      '1',
      1,
      20,
      [],
      'created_desc',
      ''
    );
  });

  test('renders the no-terms-found row when the response is empty', async () => {
    getPaginatedWordsByLanguage.mockResolvedValue({
      items: [],
      totalCount: 0,
      totalPages: 0
    });
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });

    expect(
      await screen.findByText(/No terms found for the selected criteria/i)
    ).toBeInTheDocument();
  });

  test('deletes a term after confirmation and refetches', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });
    await screen.findByText('gato');

    const deleteButtons = screen.getAllByRole('button', { name: /^Delete$/i });
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(deleteWord).toHaveBeenCalledWith(11));
    // Initial fetch + refetch after delete
    expect(getPaginatedWordsByLanguage).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });

  test('shows an alert when getPaginatedWordsByLanguage rejects', async () => {
    getPaginatedWordsByLanguage.mockRejectedValue(new Error('boom'));
    renderPage();
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });

    expect(
      await screen.findByText(/Failed to fetch terms: boom/)
    ).toBeInTheDocument();
  });
});
