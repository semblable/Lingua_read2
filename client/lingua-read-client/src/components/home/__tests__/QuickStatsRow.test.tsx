import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import QuickStatsRow from '../QuickStatsRow';

afterEach(() => cleanup());

describe('QuickStatsRow', () => {
  test('renders all three stats with thousands separators', () => {
    render(
      <QuickStatsRow
        totalKnownWords={12345}
        totalWordsReadWeek={6789}
        totalListeningSecondsWeek={3660}
      />
    );
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('6,789')).toBeInTheDocument();
    expect(screen.getByText('Total Known Words')).toBeInTheDocument();
    expect(screen.getByText('Words Read (7d)')).toBeInTheDocument();
    expect(screen.getByText('Listened (7d)')).toBeInTheDocument();
  });

  test('formats listened seconds as "Xh Ym" when over an hour', () => {
    render(<QuickStatsRow totalListeningSecondsWeek={3900} />);
    expect(screen.getByText('1h 5m')).toBeInTheDocument();
  });

  test('formats sub-hour seconds as "N min"', () => {
    render(<QuickStatsRow totalListeningSecondsWeek={300} />);
    expect(screen.getByText('5 min')).toBeInTheDocument();
  });

  test('renders zeros (not blanks) when values are missing', () => {
    render(<QuickStatsRow />);
    // Two of the three cards display "0" for missing numeric stats.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('0 min')).toBeInTheDocument();
  });

  test('shows spinners in place of values while loading', () => {
    const { container } = render(<QuickStatsRow loading />);
    // Bootstrap Spinner adds .spinner-border (or .spinner-border-sm). One per card.
    expect(container.querySelectorAll('.spinner-border').length).toBe(3);
  });
});
