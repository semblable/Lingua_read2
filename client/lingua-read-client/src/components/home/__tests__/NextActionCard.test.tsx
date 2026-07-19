import { describe, test, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NextActionCard from '../NextActionCard';
import { pickAction } from '../nextAction';
import type { RecentTexts } from '../../../utils/api/texts';

type RecentText = RecentTexts[number];

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const makeText = (overrides: Partial<RecentText> = {}): RecentText => ({
  textId: 42,
  title: 'Una historia',
  languageName: 'Spanish',
  isAudioLesson: false,
  ...overrides,
} as RecentText);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('pickAction (pure)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26, 12, 0, 0));
  });

  test('srs-heavy fires when more than 10 cards are due, regardless of recent activity', () => {
    const action = pickAction(47, makeText(), '2026-05-26T08:00:00Z');
    expect(action.kind).toBe('srs-heavy');
    expect(action.variant).toBe('danger');
    expect(action.ctaTo).toBe('/srs');
    expect(action.title).toMatch(/Review 47 cards/);
  });

  test('stalled book fires when last activity > 3 days ago and SRS is light', () => {
    const tenDaysAgo = new Date(2026, 4, 16, 12, 0, 0).toISOString();
    const action = pickAction(0, makeText({ textId: 7, title: 'Stalled book' }), tenDaysAgo);
    expect(action.kind).toBe('stalled');
    expect(action.ctaTo).toBe('/texts/7');
    expect(action.subtitle).toMatch(/10 days/);
  });

  test('stalled does not fire within 3 days', () => {
    const oneDayAgo = new Date(2026, 4, 25, 12, 0, 0).toISOString();
    const action = pickAction(0, makeText({ textId: 7 }), oneDayAgo);
    expect(action.kind).toBe('continue');
  });

  test('stalled subtitle rounds days to the nearest whole day (not floor)', () => {
    // 3.6 days ago — used to floor to 3 days, which then collided with the
    // threshold (> 3 days) and confused users ("3 days" displayed even though
    // the action only fires past 3 days). Round to 4 to match user intuition.
    const threePointSixDaysAgo = new Date(
      2026,
      4,
      26,
      12,
      0,
      0,
    ).getTime() - 3.6 * 24 * 60 * 60 * 1000;
    const action = pickAction(
      0,
      makeText({ textId: 7, title: 'Stalled book' }),
      new Date(threePointSixDaysAgo).toISOString(),
    );
    expect(action.kind).toBe('stalled');
    expect(action.subtitle).toMatch(/4 days/);
  });

  test('stalled does not fire when rounding pulls below the threshold', () => {
    // 3.4 days ago rounds to 3, which is NOT > 3. Should fall through.
    const threePointFourDaysAgo = new Date(
      2026,
      4,
      26,
      12,
      0,
      0,
    ).getTime() - 3.4 * 24 * 60 * 60 * 1000;
    const action = pickAction(
      0,
      makeText({ textId: 7 }),
      new Date(threePointFourDaysAgo).toISOString(),
    );
    expect(action.kind).toBe('continue');
  });

  test('srs-some fires when 1-10 cards are due and no stalled book', () => {
    const action = pickAction(5, makeText(), null);
    expect(action.kind).toBe('srs-some');
    expect(action.variant).toBe('warning');
    expect(action.ctaTo).toBe('/srs');
    expect(action.title).toMatch(/Quick review: 5 cards/);
  });

  test('srs-some uses singular wording when count is 1', () => {
    const action = pickAction(1, null, null);
    expect(action.title).toMatch(/Quick review: 1 card$/);
  });

  test('continue fires when there is a recent text and no SRS due', () => {
    const action = pickAction(0, makeText({ textId: 9, title: 'Mi libro' }), null);
    expect(action.kind).toBe('continue');
    expect(action.ctaTo).toBe('/texts/9');
    expect(action.title).toMatch(/Mi libro/);
  });

  test('continue uses bookTitle when present', () => {
    const action = pickAction(
      0,
      makeText({ textId: 9, bookTitle: 'War and Peace', partNumber: 3 }),
      null,
    );
    expect(action.title).toMatch(/War and Peace · Part 3/);
  });

  test('fallback fires when there is nothing to do', () => {
    const action = pickAction(0, null, null);
    expect(action.kind).toBe('fallback');
    expect(action.ctaTo).toBe('/library');
    expect(action.title).toMatch(/Browse your library/);
  });
});

describe('NextActionCard (render)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26, 12, 0, 0));
  });

  test('renders a spinner while loading', () => {
    const { container } = renderInRouter(
      <NextActionCard srsDue={0} recentText={null} lastActivityAt={null} loading />
    );
    expect(container.querySelector('.spinner-border')).toBeTruthy();
  });

  test('renders danger-variant CTA when SRS-heavy', () => {
    renderInRouter(
      <NextActionCard srsDue={47} recentText={makeText()} lastActivityAt={null} />
    );
    const cta = screen.getByRole('button', { name: /Start reviewing/i });
    expect(cta).toHaveAttribute('href', '/srs');
    expect(cta.className).toMatch(/btn-danger/);
    expect(screen.getByTestId('next-action-card')).toHaveAttribute(
      'data-action-kind',
      'srs-heavy'
    );
  });

  test('renders the library fallback when nothing is urgent', () => {
    renderInRouter(
      <NextActionCard srsDue={0} recentText={null} lastActivityAt={null} />
    );
    const cta = screen.getByRole('button', { name: /Open library/i });
    expect(cta).toHaveAttribute('href', '/library');
    expect(screen.getByTestId('next-action-card')).toHaveAttribute(
      'data-action-kind',
      'fallback'
    );
  });

  test('renders a "Continue" CTA to the recent text when nothing else is urgent', () => {
    renderInRouter(
      <NextActionCard
        srsDue={0}
        recentText={makeText({ textId: 42, title: 'Mi libro' })}
        lastActivityAt={null}
      />
    );
    const cta = screen.getByRole('button', { name: /Resume/i });
    expect(cta).toHaveAttribute('href', '/texts/42');
  });
});
