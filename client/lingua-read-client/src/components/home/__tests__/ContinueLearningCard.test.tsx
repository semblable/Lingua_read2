import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../utils/api', () => ({
  getText: vi.fn(),
}));

import { getText } from '../../../utils/api';
import ContinueLearningCard from '../ContinueLearningCard';
import type { RecentTexts, Text } from '../../../utils/api/texts';

const mockedGetText = vi.mocked(getText);

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

type RecentText = RecentTexts[number];

const makeRecent = (overrides: Partial<RecentText> = {}): RecentText => ({
  textId: 42,
  title: 'Cuentos cortos',
  languageName: 'Spanish',
  isAudioLesson: false,
  ...overrides,
});

const makeFullText = (overrides: Partial<Text> = {}): Text =>
  ({
    textId: 42,
    title: 'Cuentos cortos',
    totalWords: 1000,
    knownWords: 800,
    isAudioLesson: false,
    ...overrides,
  }) as Text;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ContinueLearningCard', () => {
  test('renders the empty state with a library CTA when no text is supplied', () => {
    renderInRouter(<ContinueLearningCard text={null} />);
    expect(screen.getByTestId('continue-card-empty')).toBeInTheDocument();
    // LinkContainer + Button renders as <a role="button" href="...">
    const openLib = screen.getByRole('button', { name: /Open library/i });
    expect(openLib).toHaveAttribute('href', '/library');
    expect(mockedGetText).not.toHaveBeenCalled();
  });

  test('shows the spinner skeleton when loading', () => {
    const { container } = renderInRouter(<ContinueLearningCard text={null} loading />);
    expect(container.querySelector('.spinner-border')).toBeTruthy();
  });

  test('renders the standalone title with the Resume CTA pointing at the text', async () => {
    mockedGetText.mockResolvedValue(makeFullText());
    renderInRouter(<ContinueLearningCard text={makeRecent()} />);

    expect(screen.getByText('Cuentos cortos')).toBeInTheDocument();
    expect(screen.getAllByText('Spanish')).toHaveLength(2);

    const resume = screen.getByRole('button', { name: /^Resume$/ });
    expect(resume).toHaveAttribute('href', '/texts/42');

    await waitFor(() => expect(mockedGetText).toHaveBeenCalledWith(42));
  });

  test('composes "Book - Part N" titles when the recent text belongs to a book', () => {
    mockedGetText.mockResolvedValue(makeFullText());
    renderInRouter(
      <ContinueLearningCard
        text={makeRecent({ bookTitle: 'Don Quijote', partNumber: 4 })}
      />
    );
    expect(screen.getByText('Don Quijote · Part 4')).toBeInTheDocument();
  });

  test('shows the Audio badge when the recent text is an audio lesson', () => {
    mockedGetText.mockResolvedValue(makeFullText({ isAudioLesson: true }));
    renderInRouter(<ContinueLearningCard text={makeRecent({ isAudioLesson: true })} />);
    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  test('keeps recorded reading activity separate from vocabulary coverage', () => {
    renderInRouter(<ContinueLearningCard text={makeRecent({ totalWords: 1000, knownWords: 750, readWords: 200, preview: 'A story begins.' })} />);
    expect(screen.getByText('75% vocabulary coverage')).toBeInTheDocument();
    expect(screen.getByText('200 words read')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/min left/)).not.toBeInTheDocument();
    expect(screen.getByText('A story begins.')).toBeInTheDocument();
    expect(mockedGetText).not.toHaveBeenCalled();
  });

  test.each([
    { totalWords: 50, readWords: 50, languageName: 'Portuguese' },
    { totalWords: 1, readWords: 2, languageName: 'Japanese' },
  ])('does not infer completion from incomparable vocabulary and reading counts: $languageName', ({ totalWords, readWords, languageName }) => {
    renderInRouter(<ContinueLearningCard text={makeRecent({ totalWords, readWords, languageName, isFinished: false })} />);
    expect(screen.getByText(`${readWords} words read`)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('Ready to finish')).not.toBeInTheDocument();
    expect(screen.queryByText(/min left/)).not.toBeInTheDocument();
  });

  test('uses saved audio position and transcript duration for listening progress', () => {
    renderInRouter(<ContinueLearningCard text={makeRecent({ isAudioLesson: true, totalWords: 1000, audioPositionSeconds: 120, audioDurationSeconds: 600 })} />);
    expect(screen.getByText('2:00 into audio')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Listening position' })).toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByText('~8 min left')).toBeInTheDocument();
  });

  test('falls back to a "no progress" hint when totalWords is missing', async () => {
    mockedGetText.mockResolvedValue(makeFullText({ totalWords: 0, knownWords: 0 }));
    renderInRouter(<ContinueLearningCard text={makeRecent()} />);
    await waitFor(() =>
      expect(screen.getByText('Ready to read')).toBeInTheDocument()
    );
  });

  test('uses relative recency while making the playback timestamp explicit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T15:00:00Z'));
    renderInRouter(<ContinueLearningCard text={makeRecent({ totalWords: 1000, isAudioLesson: true, audioPositionSeconds: 516, lastAccessedAt: '2026-11-11T09:00:00Z' })} />);
    expect(screen.getByText('Opened 6h ago')).toBeInTheDocument();
    expect(screen.getByText('8:36 into audio')).toBeInTheDocument();
  });

  test('resets the enriching spinner when text transitions to null mid-fetch', async () => {
    // Hold the promise open so the fetch is still in flight when the parent
    // toggles `text` back to null. Without resetting `enriching` in that
    // branch, the empty-state card would render with a stuck spinner.
    let resolveGetText: (value: Text) => void = () => {};
    mockedGetText.mockReturnValue(
      new Promise<Text>((resolve) => {
        resolveGetText = resolve;
      })
    );

    const { rerender, container } = renderInRouter(
      <ContinueLearningCard text={makeRecent()} />
    );

    // Mid-fetch: swap to null. The empty card should render, with no spinner.
    rerender(
      <MemoryRouter>
        <ContinueLearningCard text={null} />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByTestId('continue-card-empty')).toBeInTheDocument()
    );
    expect(container.querySelector('.spinner-border')).toBeNull();

    // Let the orphaned fetch resolve so vitest doesn't warn about pending work.
    resolveGetText(makeFullText());
  });

  test('survives a getText failure by still rendering the title and Resume link', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetText.mockRejectedValue(new Error('boom'));
    renderInRouter(<ContinueLearningCard text={makeRecent()} />);

    expect(screen.getByText('Cuentos cortos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Resume$/ })).toHaveAttribute(
      'href',
      '/texts/42'
    );
    await waitFor(() => expect(mockedGetText).toHaveBeenCalledTimes(1));
    consoleErrorSpy.mockRestore();
  });
});
