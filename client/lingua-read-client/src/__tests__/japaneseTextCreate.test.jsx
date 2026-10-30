import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TextCreate from '../pages/TextCreate';
import BookCreate from '../pages/BookCreate';
import CreateAudioLesson from '../pages/CreateAudioLesson';
import BatchAudioCreate from '../pages/BatchAudioCreate';
import { SettingsContext } from '../contexts/SettingsContext';
import {
  createText,
  createBook,
  uploadBook,
  createAudioLesson,
  createAudioLessonsBatch,
  getAllLanguages
} from '../utils/api';

vi.mock('../utils/api', () => ({
  createText: vi.fn(),
  createBook: vi.fn(),
  uploadBook: vi.fn(),
  createAudioLesson: vi.fn(),
  createAudioLessonsBatch: vi.fn(),
  getAllLanguages: vi.fn(),
  generateStory: vi.fn(),
  uploadAudiobookTracks: vi.fn(),
  previewBookSplit: vi.fn(),
  previewManualSplit: vi.fn()
}));

const renderWithSettings = (ui, defaultLanguageId = 1) =>
  render(
    <SettingsContext.Provider value={{ settings: { defaultLanguageId }, loadingSettings: false }}>
      <MemoryRouter>{ui}</MemoryRouter>
    </SettingsContext.Provider>
  );

beforeEach(() => {
  vi.clearAllMocks();
  getAllLanguages.mockResolvedValue([
    { languageId: 1, name: 'Japanese', code: 'ja-JP' },
    { languageId: 2, name: 'English', code: 'en' }
  ]);
  createText.mockResolvedValue({ textId: 42 });
  createBook.mockResolvedValue({ bookId: 99 });
  uploadBook.mockResolvedValue({ bookId: 99 });
  createAudioLesson.mockResolvedValue({ title: 'Audio Japanese' });
  createAudioLessonsBatch.mockResolvedValue({ createdCount: 1, skippedFiles: [] });
});

test('Japanese splitting is enabled by default for a new Japanese text', async () => {
  render(<MemoryRouter><TextCreate /></MemoryRouter>);
  const choice = await screen.findByLabelText('Japanese word segmentation (experimental)');
  expect(choice).toBeChecked();
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Synthetic Japanese' } });
  fireEvent.change(screen.getByLabelText('Text Content'), { target: { value: '猫は魚を食べます。' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Text', exact: true }));
  await waitFor(() => expect(createText).toHaveBeenCalledWith('Synthetic Japanese', '猫は魚を食べます。', 1, null, null, 'tinysegmenter-ja-v1'));
});

test('switching to another language hides Japanese option and resets to checked when switching back', async () => {
  render(<MemoryRouter><TextCreate /></MemoryRouter>);
  const choice = await screen.findByLabelText('Japanese word segmentation (experimental)');
  expect(choice).toBeChecked();
  fireEvent.click(choice);
  expect(choice).not.toBeChecked();

  fireEvent.change(screen.getByLabelText('Language'), { target: { value: '2' } });
  expect(screen.queryByLabelText('Japanese word segmentation (experimental)')).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Language'), { target: { value: '1' } });
  expect(await screen.findByLabelText('Japanese word segmentation (experimental)')).toBeChecked();
});

test('Japanese splitting can be disabled for this new text without changing the language', async () => {
  render(<MemoryRouter><TextCreate /></MemoryRouter>);
  fireEvent.click(await screen.findByLabelText('Japanese word segmentation (experimental)'));
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Legacy Japanese splitting' } });
  fireEvent.change(screen.getByLabelText('Text Content'), { target: { value: '猫は魚を食べます。' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Text', exact: true }));
  await waitFor(() => expect(createText).toHaveBeenCalledWith('Legacy Japanese splitting', '猫は魚を食べます。', 1, null, null, null));
});

describe('BookCreate Japanese segmentation', () => {
  test('defaults ON for manual Japanese book creation and allows opt-out', async () => {
    const { unmount } = renderWithSettings(<BookCreate />);
    const choice = await screen.findByLabelText('Japanese word segmentation (experimental)');
    expect(choice).toBeChecked();
    fireEvent.change(screen.getByLabelText('Book Title'), { target: { value: 'Japanese Book' } });
    fireEvent.change(screen.getByLabelText('Book Content'), { target: { value: '第一章 猫は魚を食べます。' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Book from Text' }));
    await waitFor(() =>
      expect(createBook).toHaveBeenCalledWith(
        'Japanese Book',
        '',
        1,
        '第一章 猫は魚を食べます。',
        'chapter',
        3000,
        [],
        true,
        [],
        [],
        null,
        'tinysegmenter-ja-v1'
      )
    );
    unmount();

    vi.clearAllMocks();
    getAllLanguages.mockResolvedValue([
      { languageId: 1, name: 'Japanese', code: 'ja' },
      { languageId: 2, name: 'English', code: 'en' }
    ]);
    createBook.mockResolvedValue({ bookId: 100 });
    renderWithSettings(<BookCreate />);
    fireEvent.click(await screen.findByLabelText('Japanese word segmentation (experimental)'));
    fireEvent.change(screen.getByLabelText('Book Title'), { target: { value: 'Legacy Japanese Book' } });
    fireEvent.change(screen.getByLabelText('Book Content'), { target: { value: '猫は魚を食べます。' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Book from Text' }));
    await waitFor(() => expect(createBook).toHaveBeenCalled());
    expect(createBook.mock.calls[0]).toHaveLength(11);
  });

  test('appends SegmentationProfile=tinysegmenter-ja-v1 on Japanese book file upload unless unchecked or non-Japanese', async () => {
    const { unmount } = renderWithSettings(<BookCreate />);
    expect(await screen.findByLabelText('Japanese word segmentation (experimental)')).toBeChecked();
    fireEvent.click(screen.getByRole('tab', { name: /Upload File/i }));
    const fileInput = document.getElementById('formFile');
    const epubFile = new File(['epub-bytes'], 'japanese.epub', { type: 'application/epub+zip' });
    fireEvent.change(fileInput, { target: { files: [epubFile] } });
    fireEvent.submit(fileInput.closest('form'));
    await waitFor(() => expect(uploadBook).toHaveBeenCalled());
    const uploadedForm = uploadBook.mock.calls[0][0];
    expect(uploadedForm.get('SegmentationProfile')).toBe('tinysegmenter-ja-v1');
    unmount();

    vi.clearAllMocks();
    getAllLanguages.mockResolvedValue([
      { languageId: 1, name: 'Japanese', code: 'ja' },
      { languageId: 2, name: 'English', code: 'en' }
    ]);
    uploadBook.mockResolvedValue({ bookId: 101 });
    renderWithSettings(<BookCreate />);
    await screen.findByLabelText('Japanese word segmentation (experimental)');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: '2' } });
    expect(screen.queryByLabelText('Japanese word segmentation (experimental)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Upload File/i }));
    const fileInput2 = document.getElementById('formFile');
    const txtFile = new File(['hello'], 'english.txt', { type: 'text/plain' });
    fireEvent.change(fileInput2, { target: { files: [txtFile] } });
    fireEvent.submit(fileInput2.closest('form'));
    await waitFor(() => expect(uploadBook).toHaveBeenCalled());
    expect(uploadBook.mock.calls[0][0].get('SegmentationProfile')).toBeNull();
  });
});

describe('CreateAudioLesson and BatchAudioCreate Japanese segmentation', () => {
  test('CreateAudioLesson defaults ON for Japanese, allows opt-out, and omits profile for non-Japanese', async () => {
    const { unmount } = renderWithSettings(<CreateAudioLesson />);
    const choice = await screen.findByLabelText('Japanese word segmentation (experimental)');
    expect(choice).toBeChecked();
    fireEvent.change(screen.getByLabelText(/Lesson Title/i), { target: { value: 'Japanese Lesson' } });
    const audioInput = document.getElementById('formAudioFile');
    const srtInput = document.getElementById('formSrtFile');
    const audioFile = new File(['mp3'], 'lesson.mp3', { type: 'audio/mpeg' });
    const srtFile = new File(['1\n00:00:00,000 --> 00:00:02,000\n猫は魚を食べます。\n'], 'lesson.srt', { type: 'text/plain' });
    fireEvent.change(audioInput, { target: { files: [audioFile] } });
    fireEvent.change(srtInput, { target: { files: [srtFile] } });
    fireEvent.submit(audioInput.closest('form'));
    await waitFor(() =>
      expect(createAudioLesson).toHaveBeenCalledWith(
        'Japanese Lesson',
        '1',
        audioFile,
        srtFile,
        '',
        null,
        null,
        'tinysegmenter-ja-v1'
      )
    );
    unmount();

    vi.clearAllMocks();
    getAllLanguages.mockResolvedValue([
      { languageId: 1, name: 'Japanese', code: 'ja' },
      { languageId: 2, name: 'English', code: 'en' }
    ]);
    createAudioLesson.mockResolvedValue({ title: 'Japanese Lesson' });
    renderWithSettings(<CreateAudioLesson />);
    fireEvent.click(await screen.findByLabelText('Japanese word segmentation (experimental)'));
    fireEvent.change(screen.getByLabelText(/Lesson Title/i), { target: { value: 'Opt Out Lesson' } });
    const audioInput2 = document.getElementById('formAudioFile');
    const srtInput2 = document.getElementById('formSrtFile');
    fireEvent.change(audioInput2, { target: { files: [audioFile] } });
    fireEvent.change(srtInput2, { target: { files: [srtFile] } });
    fireEvent.submit(audioInput2.closest('form'));
    await waitFor(() => expect(createAudioLesson).toHaveBeenCalled());
    expect(createAudioLesson.mock.calls[0]).toHaveLength(7);
  });

  test('BatchAudioCreate defaults ON for Japanese, allows opt-out, and omits profile for non-Japanese', async () => {
    const { unmount } = renderWithSettings(<BatchAudioCreate />);
    const choice = await screen.findByLabelText('Japanese word segmentation (experimental)');
    expect(choice).toBeChecked();
    const fileInput = document.getElementById('formFileMultiple');
    const mp3 = new File(['audio'], 'lesson1.mp3', { type: 'audio/mpeg' });
    const srt = new File(['subs'], 'lesson1__ja.srt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [mp3, srt] } });
    fireEvent.submit(fileInput.closest('form'));
    await waitFor(() => expect(createAudioLessonsBatch).toHaveBeenCalled());
    expect(createAudioLessonsBatch.mock.calls[0].at(-1)).toBe('tinysegmenter-ja-v1');
    unmount();

    vi.clearAllMocks();
    getAllLanguages.mockResolvedValue([
      { languageId: 1, name: 'Japanese', code: 'ja' },
      { languageId: 2, name: 'English', code: 'en' }
    ]);
    createAudioLessonsBatch.mockResolvedValue({ createdCount: 1, skippedFiles: [] });
    renderWithSettings(<BatchAudioCreate />);
    await screen.findByLabelText('Japanese word segmentation (experimental)');
    fireEvent.change(screen.getByLabelText(/Language/i), { target: { value: '2' } });
    expect(screen.queryByLabelText('Japanese word segmentation (experimental)')).not.toBeInTheDocument();
    const fileInput2 = document.getElementById('formFileMultiple');
    const srtEn = new File(['subs'], 'lesson1__en.srt', { type: 'text/plain' });
    fireEvent.change(fileInput2, { target: { files: [mp3, srtEn] } });
    fireEvent.submit(fileInput2.closest('form'));
    await waitFor(() => expect(createAudioLessonsBatch).toHaveBeenCalled());
    expect(createAudioLessonsBatch.mock.calls[0]).toHaveLength(5);
  });
});
