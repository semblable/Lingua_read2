import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import HomeHero from '../HomeHero';

const mockHour = (hour: number): void => {
  // 2026-05-25 is a known date; substitute the hour to drive greeting buckets.
  const fixed = new Date(2026, 4, 25, hour, 0, 0);
  vi.setSystemTime(fixed);
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HomeHero', () => {
  test('uses "Good morning" before noon and includes the username', () => {
    vi.useFakeTimers();
    mockHour(8);
    render(<HomeHero username="Kamil" srsDue={0} streakDays={0} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Good morning, Kamil.'
    );
  });

  test('uses "Good afternoon" between 12 and 17', () => {
    vi.useFakeTimers();
    mockHour(14);
    render(<HomeHero username="Kamil" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good afternoon');
  });

  test('uses "Good evening" between 17 and 21', () => {
    vi.useFakeTimers();
    mockHour(19);
    render(<HomeHero username="Kamil" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good evening');
  });

  test('falls back to no-name greeting when username is empty', () => {
    vi.useFakeTimers();
    mockHour(10);
    render(<HomeHero username="   " />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toMatch(/^Good morning\.$/);
  });

  test('builds the subtitle from SRS, goal, and streak in order', () => {
    render(
      <HomeHero
        username="K"
        srsDue={3}
        topGoalSummary="240 to go on Spanish daily"
        streakDays={5}
      />
    );
    expect(
      screen.getByText('3 SRS cards due · 240 to go on Spanish daily · 5-day streak')
    ).toBeInTheDocument();
  });

  test('singularises "SRS card" when count is 1', () => {
    render(<HomeHero username="K" srsDue={1} streakDays={0} />);
    expect(screen.getByText(/1 SRS card due/)).toBeInTheDocument();
    expect(screen.queryByText(/1 SRS cards due/)).not.toBeInTheDocument();
  });

  test('shows a soft fallback subtitle when there is nothing to surface', () => {
    render(<HomeHero username="K" srsDue={0} streakDays={0} />);
    expect(screen.getByText('Pick up where you left off.')).toBeInTheDocument();
  });
});
