import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import TextList from '../pages/TextList';
import { getTexts, deleteText } from '../utils/api';
import { useTextsStore } from '../utils/store';

vi.mock('../utils/api', () => ({
  getTexts: vi.fn(),
  deleteText: vi.fn()
}));

const sampleTexts = [
  {
    textId: 1,
    title: 'Hello World',
    languageName: 'French',
    isAudioLesson: false,
    isFinished: false,
    createdAt: '2026-01-01T00:00:00Z',
    tag: 'fiction'
  },
  {
    textId: 2,
    title: 'Audio Lesson 1',
    languageName: 'Spanish',
    isAudioLesson: true,
    isFinished: true,
    createdAt: '2026-02-01T00:00:00Z',
    tag: null
  }
];

const renderPage = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <TextList />
    </MemoryRouter>
  );

describe('TextList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset zustand store
    useTextsStore.setState({ texts: [], loading: false, error: null });
    localStorage.clear();
  });

  test('renders all text cards after fetch resolves', async () => {
    getTexts.mockResolvedValue(sampleTexts);
    renderPage();
    expect(await screen.findByText('Hello World')).toBeInTheDocument();
    expect(screen.getByText('Audio Lesson 1')).toBeInTheDocument();
  });

  test('renders the empty state when no texts exist', async () => {
    getTexts.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText(/You don't have any texts yet/i)
    ).toBeInTheDocument();
  });

  test('confirms and calls deleteText, then refetches', async () => {
    getTexts.mockResolvedValue(sampleTexts);
    deleteText.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('Hello World');

    const deleteButtons = screen.getAllByTitle('Delete Text');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(deleteText).toHaveBeenCalledTimes(1);
    });
    // First fetch + refetch after delete
    expect(getTexts).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });

  test('does not call deleteText when the confirm dialog is cancelled', async () => {
    getTexts.mockResolvedValue(sampleTexts);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await screen.findByText('Hello World');

    fireEvent.click(screen.getAllByTitle('Delete Text')[0]);

    expect(deleteText).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  test('shows an error alert when getTexts rejects', async () => {
    getTexts.mockRejectedValue(new Error('network'));
    renderPage();
    expect(await screen.findByText('network')).toBeInTheDocument();
  });
});
