import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import BatchAudioCreate from '../pages/BatchAudioCreate';
import { getAllLanguages, createAudioLessonsBatch } from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext';

vi.mock('../utils/api', () => ({
  getAllLanguages: vi.fn(),
  createAudioLessonsBatch: vi.fn()
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
        <BatchAudioCreate />
      </MemoryRouter>
    </SettingsContext.Provider>
  );

describe('BatchAudioCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllLanguages.mockResolvedValue(mockLanguages);
    createAudioLessonsBatch.mockResolvedValue({ createdCount: 2, skippedFiles: [] });
  });

  test('renders the form with the language dropdown populated', async () => {
    renderPage();
    await screen.findByText('Spanish');
    expect(screen.getByText(/Batch Create Audio Lessons/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Language/i)).toBeInTheDocument();
  });

  test('disables the submit button until files are selected', async () => {
    renderPage();
    await screen.findByText('Spanish');
    const submitBtn = screen.getByRole('button', { name: /Create Batch Lessons/i });
    expect(submitBtn).toBeDisabled();
  });

  test('shows a validation error when paired files are mismatched', async () => {
    renderPage();
    await screen.findByText('Spanish');

    const fileInput = document.getElementById('formFileMultiple');
    // Just an MP3 with no SRT — fuzzy pairing flags it as missing matching SRT.
    const mp3 = new File(['audio'], 'lesson1.mp3', { type: 'audio/mpeg' });
    fireEvent.change(fileInput, { target: { files: [mp3] } });

    fireEvent.submit(fileInput.closest('form'));

    expect(
      await screen.findByText(/Missing Matching SRT/i)
    ).toBeInTheDocument();
    expect(createAudioLessonsBatch).not.toHaveBeenCalled();
  });

  test('submits paired files via createAudioLessonsBatch', async () => {
    renderPage();
    await screen.findByText('Spanish');

    const fileInput = document.getElementById('formFileMultiple');
    const mp3 = new File(['audio'], 'lesson1.mp3', { type: 'audio/mpeg' });
    const srt = new File(['subs'], 'lesson1__es.srt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [mp3, srt] } });

    fireEvent.submit(fileInput.closest('form'));

    await waitFor(() => {
      expect(createAudioLessonsBatch).toHaveBeenCalled();
    });
  });

  test('shows an alert when getAllLanguages fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getAllLanguages.mockRejectedValue(new Error('offline'));
    renderPage();
    expect(await screen.findByText(/Failed to load languages/i)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});
