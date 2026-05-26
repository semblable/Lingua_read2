import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeHero from '../HomeHero';

const mockHour = (hour: number): void => {
  // 2026-05-25 is a known date; substitute the hour to drive greeting buckets.
  const fixed = new Date(2026, 4, 25, hour, 0, 0);
  vi.setSystemTime(fixed);
};

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('HomeHero', () => {
  test('uses "Good morning" before noon and includes the username', () => {
    vi.useFakeTimers();
    mockHour(8);
    renderInRouter(<HomeHero username="Kamil" srsDue={0} streakDays={0} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Good morning, Kamil.'
    );
  });

  test('uses "Good afternoon" between 12 and 17', () => {
    vi.useFakeTimers();
    mockHour(14);
    renderInRouter(<HomeHero username="Kamil" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good afternoon');
  });

  test('uses "Good evening" between 17 and 21', () => {
    vi.useFakeTimers();
    mockHour(19);
    renderInRouter(<HomeHero username="Kamil" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good evening');
  });

  test('falls back to no-name greeting when username is empty', () => {
    vi.useFakeTimers();
    mockHour(10);
    renderInRouter(<HomeHero username="   " />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toMatch(/^Good morning\.$/);
  });

  test('renders a clickable SRS chip linking to /srs', () => {
    renderInRouter(
      <HomeHero username="K" srsDue={12} streakDays={0} />
    );
    const chip = screen.getByTestId('hero-chip-srs');
    expect(chip).toHaveTextContent(/12 SRS cards due/);
    expect(chip).toHaveAttribute('href', '/srs');
  });

  test('renders a clickable goal chip linking to /goals', () => {
    renderInRouter(
      <HomeHero
        username="K"
        srsDue={0}
        topGoalSummary="240 to go on Spanish daily"
        streakDays={0}
      />
    );
    const chip = screen.getByTestId('hero-chip-goal');
    expect(chip).toHaveTextContent('240 to go on Spanish daily');
    expect(chip).toHaveAttribute('href', '/goals');
  });

  test('renders a clickable streak chip linking to /statistics', () => {
    renderInRouter(<HomeHero username="K" srsDue={0} streakDays={5} />);
    const chip = screen.getByTestId('hero-chip-streak');
    expect(chip).toHaveTextContent('5-day streak');
    expect(chip).toHaveAttribute('href', '/statistics');
  });

  test('orders chips streak → SRS → goal when all three are present', () => {
    renderInRouter(
      <HomeHero
        username="K"
        srsDue={3}
        topGoalSummary="240 to go on Spanish daily"
        streakDays={5}
      />
    );
    const chips = screen.getAllByRole('link');
    expect(chips.map((c) => c.getAttribute('data-testid'))).toEqual([
      'hero-chip-streak',
      'hero-chip-srs',
      'hero-chip-goal',
    ]);
  });

  test('singularises "SRS card" when count is 1', () => {
    renderInRouter(<HomeHero username="K" srsDue={1} streakDays={0} />);
    expect(screen.getByTestId('hero-chip-srs')).toHaveTextContent(/^1 SRS card due$/);
  });

  test('uses danger styling when SRS due > 10', () => {
    renderInRouter(<HomeHero username="K" srsDue={42} streakDays={0} />);
    const chip = screen.getByTestId('hero-chip-srs');
    expect(chip.className).toMatch(/bg-danger/);
  });

  test('uses warning styling for 1-10 SRS due', () => {
    renderInRouter(<HomeHero username="K" srsDue={3} streakDays={0} />);
    const chip = screen.getByTestId('hero-chip-srs');
    expect(chip.className).toMatch(/bg-warning/);
  });

  test('shows a soft fallback subtitle when there is nothing to surface', () => {
    renderInRouter(<HomeHero username="K" srsDue={0} streakDays={0} />);
    expect(screen.getByText('Pick up where you left off.')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-chips')).not.toBeInTheDocument();
  });
});
