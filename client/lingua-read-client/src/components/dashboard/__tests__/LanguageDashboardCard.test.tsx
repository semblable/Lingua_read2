import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LanguageDashboardCard from '../LanguageDashboardCard';

// The card is mocked out in the Home and LanguagesStrip suites so those stay focused on
// ordering, so this is the only place the real card renders — including its sparkline.

interface CardLang {
  languageId: number;
  languageName: string;
  knownWords: number;
  totalWords: number;
  knownWordsToNextLevel: number;
  todayWordsRead: number;
  currentReadingStreakDays: number;
  last14DaysWords?: { date: string; count: number }[];
  todayListeningSeconds?: number;
  continueReadingTextId?: number | null;
  cefrLevel?: string | null;
  nextCefrLevel?: string | null;
}

const makeLang = (overrides: Partial<CardLang> = {}): CardLang => ({
  languageId: 3,
  languageName: 'Polish',
  knownWords: 1200,
  totalWords: 4800,
  knownWordsToNextLevel: 300,
  todayWordsRead: 450,
  currentReadingStreakDays: 4,
  ...overrides,
});

const days = (counts: number[]) =>
  counts.map((count, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, count }));

const renderCard = (lang: CardLang) =>
  render(
    <MemoryRouter>
      <LanguageDashboardCard lang={lang} />
    </MemoryRouter>,
  );

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe('LanguageDashboardCard', () => {
  test('labels every computed CEFR level as an estimate and distinguishes forms from lemmas', () => {
    renderCard(makeLang({ cefrLevel: 'B1', nextCefrLevel: 'B2' }));
    expect(screen.getByText('B1 · estimate')).toBeInTheDocument();
    expect(screen.getByText('known word forms')).toHaveAttribute('title', expect.stringContaining('not a lemma count'));
    expect(screen.getByText('words read today')).toBeInTheDocument();
  });

  test('can omit the duplicate daily summary and resume action while keeping the labelled chart', () => {
    render(<MemoryRouter><LanguageDashboardCard lang={makeLang({ continueReadingTextId: 77, last14DaysWords: days([20, 40, 60]) })} showActivity={false} showResume={false} /></MemoryRouter>);
    expect(screen.queryByText('words read today')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue reading/ })).not.toBeInTheDocument();
    expect(screen.getByText('Last 14 days · words read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Learning focus for Polish' })).toHaveAttribute('title', 'Set your Polish level or choose maintenance');
  });

  test('persists maintenance mode and removes the vocabulary milestone', async () => {
    const lang = makeLang({ cefrLevel: 'A1', nextCefrLevel: 'A2' });
    renderCard(lang);
    fireEvent.click(screen.getByRole('button', { name: 'Learning focus for Polish' }));
    fireEvent.change(screen.getByLabelText('How would you like to track this language?'), { target: { value: 'maintenance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preference' }));
    await waitFor(() => expect(screen.getByText('Maintenance')).toBeInTheDocument());
    expect(screen.queryByText(/forms to A2/)).not.toBeInTheDocument();
    cleanup();
    renderCard(lang);
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
  });

  test('lets the user set their own level without a vocabulary-based progress bar', async () => {
    renderCard(makeLang({ cefrLevel: 'A1', nextCefrLevel: 'A2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Learning focus for Polish' }));
    fireEvent.change(screen.getByLabelText('How would you like to track this language?'), { target: { value: 'C2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preference' }));
    await waitFor(() => expect(screen.getByText('C2 · self-set')).toBeInTheDocument());
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  test('draws the sparkline when there was activity, labelled with the day count', () => {
    const { container } = renderCard(
      makeLang({ last14DaysWords: days([0, 120, 340, 0, 80, 500, 260, 0, 90, 610, 130, 40, 0, 220]) }),
    );
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Polish: words read over the last 14 days',
    );
    // Two paths: the gradient fill and the stroked line.
    expect(container.querySelectorAll('svg path')).toHaveLength(2);
    expect(screen.queryByText(/No reading in the last 14 days/)).toBeNull();
  });

  test('shows the empty state instead of a chart when every day is zero', () => {
    renderCard(makeLang({ last14DaysWords: days(Array(14).fill(0)) }));
    expect(screen.getByText(/No reading in the last 14 days/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  test('survives a missing activity series', () => {
    renderCard(makeLang({ last14DaysWords: undefined }));
    expect(screen.getByText(/No reading in the last 14 days/)).toBeInTheDocument();
    expect(screen.getByText('Polish')).toBeInTheDocument();
  });

  // react-bootstrap renders these anchors with role="button", so they're buttons to a
  // screen reader even though they carry an href.
  test('links to the saved text when there is one, and to the library otherwise', () => {
    renderCard(makeLang({ continueReadingTextId: 77 }));
    expect(screen.getByRole('button', { name: /Continue reading/ })).toHaveAttribute(
      'href',
      '/texts/77',
    );
    cleanup();
    renderCard(makeLang({ continueReadingTextId: null }));
    expect(screen.getByRole('button', { name: /Open library/ })).toHaveAttribute(
      'href',
      '/library',
    );
  });
});
