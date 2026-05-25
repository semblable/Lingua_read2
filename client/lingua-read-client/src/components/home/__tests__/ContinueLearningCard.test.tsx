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

afterEach(() => cleanup());

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
    expect(screen.getByText('Spanish')).toBeInTheDocument();

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

  test('renders a vocabulary-known progress bar from the enriched text', async () => {
    mockedGetText.mockResolvedValue(makeFullText({ totalWords: 1000, knownWords: 750 }));
    renderInRouter(<ContinueLearningCard text={makeRecent()} />);

    await waitFor(() => expect(screen.getByText('Vocabulary known')).toBeInTheDocument());
    expect(screen.getByText('75%')).toBeInTheDocument();
    // 250 words remaining at 200 wpm rounds up to ~2 min.
    expect(screen.getByText(/~2 min remaining/)).toBeInTheDocument();
  });

  test('falls back to a "no progress" hint when totalWords is missing', async () => {
    mockedGetText.mockResolvedValue(makeFullText({ totalWords: 0, knownWords: 0 }));
    renderInRouter(<ContinueLearningCard text={makeRecent()} />);
    await waitFor(() =>
      expect(screen.getByText('No progress recorded yet.')).toBeInTheDocument()
    );
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
