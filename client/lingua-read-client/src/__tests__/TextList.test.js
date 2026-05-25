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

  describe('comprehensibility filter', () => {
    const textsWithComprehension = [
      // 30% known — too-hard
      {
        textId: 10, title: 'Brutal Russian Text', languageName: 'Russian',
        bookId: null, totalWords: 100, knownWords: 30, unknownWordPercentage: 70,
        createdAt: '2026-01-01T00:00:00Z',
      },
      // 85% known — challenging
      {
        textId: 11, title: 'Decent French Article', languageName: 'French',
        bookId: null, totalWords: 100, knownWords: 85, unknownWordPercentage: 15,
        createdAt: '2026-01-02T00:00:00Z',
      },
      // 95% known — sweet-spot
      {
        textId: 12, title: 'Perfect Spanish Story', languageName: 'Spanish',
        bookId: null, totalWords: 100, knownWords: 95, unknownWordPercentage: 5,
        createdAt: '2026-01-03T00:00:00Z',
      },
    ];

    test('renders all comprehensibility badges with correct percentages', async () => {
      getTexts.mockResolvedValue(textsWithComprehension);
      renderPage();
      await screen.findByText('Brutal Russian Text');
      const badges = screen.getAllByTestId('comprehensibility-badge');
      expect(badges).toHaveLength(3);
      const bands = badges.map((b) => b.getAttribute('data-band'));
      expect(bands).toContain('too-hard');
      expect(bands).toContain('challenging');
      expect(bands).toContain('sweet-spot');
    });

    test('sweet-spot filter hides too-hard and challenging texts', async () => {
      getTexts.mockResolvedValue(textsWithComprehension);
      renderPage();
      await screen.findByText('Brutal Russian Text');

      const filter = screen.getByTestId('comprehensibility-filter');
      fireEvent.change(filter, { target: { value: 'sweet-spot' } });

      await waitFor(() => {
        expect(screen.queryByText('Brutal Russian Text')).not.toBeInTheDocument();
      });
      expect(screen.queryByText('Decent French Article')).not.toBeInTheDocument();
      expect(screen.getByText('Perfect Spanish Story')).toBeInTheDocument();
    });

    test('default filter ("all") shows every text', async () => {
      getTexts.mockResolvedValue(textsWithComprehension);
      renderPage();
      await screen.findByText('Brutal Russian Text');
      expect(screen.getByText('Decent French Article')).toBeInTheDocument();
      expect(screen.getByText('Perfect Spanish Story')).toBeInTheDocument();
    });

    test('filter value is read from the URL search params on first render', async () => {
      getTexts.mockResolvedValue(textsWithComprehension);
      render(
        <MemoryRouter
          initialEntries={['/texts?comp=too-hard']}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <TextList />
        </MemoryRouter>
      );
      await screen.findByText('Brutal Russian Text');
      expect(screen.queryByText('Decent French Article')).not.toBeInTheDocument();
      expect(screen.queryByText('Perfect Spanish Story')).not.toBeInTheDocument();
    });
  });
});
