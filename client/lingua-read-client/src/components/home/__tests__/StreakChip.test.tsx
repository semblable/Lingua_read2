import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StreakChip from '../StreakChip';

afterEach(() => cleanup());

describe('StreakChip', () => {
  test('renders the streak count with pluralised label', () => {
    render(<StreakChip days={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('days in a row')).toBeInTheDocument();
  });

  test('uses singular "day" when days is 1', () => {
    render(<StreakChip days={1} />);
    expect(screen.getByText('day in a row')).toBeInTheDocument();
  });

  test('shows a "start a streak" prompt when days is 0', () => {
    render(<StreakChip days={0} />);
    expect(screen.getByText('Start a streak today')).toBeInTheDocument();
  });

  test('uses the active-streak tooltip when days > 0', () => {
    const { container } = render(<StreakChip days={3} />);
    const card = container.querySelector('[data-testid="streak-chip"]');
    expect(card?.getAttribute('title')).toMatch(/keep your streak/i);
  });

  test('uses the start-a-streak tooltip when days is zero', () => {
    const { container } = render(<StreakChip days={0} />);
    const card = container.querySelector('[data-testid="streak-chip"]');
    expect(card?.getAttribute('title')).toMatch(/start a streak/i);
  });
});
