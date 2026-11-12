import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeHero from '../HomeHero';

const renderHero = (props: React.ComponentProps<typeof HomeHero> = {}) =>
  render(<MemoryRouter><HomeHero {...props} /></MemoryRouter>);

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('HomeHero', () => {
  test.each([[8, 'Good morning'], [14, 'Good afternoon'], [19, 'Good evening'], [23, 'Hello']])('greets at hour %s', (hour, greeting) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 25, Number(hour)));
    renderHero({ username: 'Kamil' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${greeting}, Kamil.`);
  });

  test('shows actual activity with readable units and no duplicate review alert', () => {
    renderHero({ todayWords: 5342, todayListeningSeconds: 2220, streakDays: 5 });
    expect(screen.getByLabelText("Today's activity")).toHaveTextContent('5,342 words read today');
    expect(screen.getByLabelText("Today's activity")).toHaveTextContent('37 min listened');
    expect(screen.getByTestId('hero-chip-streak')).toHaveAttribute('href', '/statistics');
    expect(screen.queryByTestId('hero-chip-srs')).not.toBeInTheDocument();
  });

  test('keeps the goal summary linked to goals', () => {
    renderHero({ topGoalSummary: '240 to go on Spanish daily' });
    expect(screen.getByTestId('hero-chip-goal')).toHaveAttribute('href', '/goals');
  });

  test('handles a blank username and an empty day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 25, 10));
    renderHero({ username: '   ' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Good morning\.$/);
    expect(screen.getByLabelText("Today's activity")).toHaveTextContent('0 words read today');
  });
});
