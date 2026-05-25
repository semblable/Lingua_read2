import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// LanguageDashboardCard internally renders a Recharts AreaChart, which needs
// ResizeObserver. Mock it with a minimal stand-in so LanguagesStrip tests
// stay focused on this component's own responsibilities (sort + cap + link).
vi.mock('../../dashboard/LanguageDashboardCard', () => ({
  default: ({ lang }: { lang: { languageId: number; languageName: string } }) => (
    <div data-testid={`lang-card-${lang.languageId}`}>{lang.languageName}</div>
  ),
}));

import LanguagesStrip from '../LanguagesStrip';

interface StripLang {
  languageId: number;
  languageName: string;
  knownWords: number;
  totalWords: number;
  knownWordsToNextLevel: number;
  todayWordsRead: number;
  currentReadingStreakDays: number;
  lastActivityAt?: string | null;
}

const makeLang = (overrides: Partial<StripLang> & { languageId: number; languageName: string }): StripLang => ({
  knownWords: 0,
  totalWords: 0,
  knownWordsToNextLevel: 0,
  todayWordsRead: 0,
  currentReadingStreakDays: 0,
  ...overrides,
});

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => cleanup());

describe('LanguagesStrip', () => {
  test('renders nothing when there are no languages', () => {
    const { container } = renderInRouter(<LanguagesStrip languages={[]} />);
    expect(container.querySelector('[data-testid="languages-strip"]')).toBeNull();
  });

  test('sorts languages by lastActivityAt descending', () => {
    const languages = [
      makeLang({ languageId: 1, languageName: 'Russian', lastActivityAt: '2026-05-01' }),
      makeLang({ languageId: 2, languageName: 'Spanish', lastActivityAt: '2026-05-20' }),
      makeLang({ languageId: 3, languageName: 'Japanese', lastActivityAt: '2026-05-10' }),
    ];
    renderInRouter(<LanguagesStrip languages={languages} />);
    const cards = screen.getAllByTestId(/lang-card-/);
    expect(cards.map((c) => c.textContent)).toEqual(['Spanish', 'Japanese', 'Russian']);
  });

  test('caps the visible cards at maxVisible', () => {
    const languages = Array.from({ length: 6 }, (_, i) =>
      makeLang({
        languageId: i + 1,
        languageName: `Lang${i + 1}`,
        lastActivityAt: `2026-05-${String(20 - i).padStart(2, '0')}`,
      })
    );
    renderInRouter(<LanguagesStrip languages={languages} maxVisible={3} />);
    expect(screen.getAllByTestId(/lang-card-/).length).toBe(3);
  });

  test('shows the total count in the "See all" link when languages exceed maxVisible', () => {
    const languages = Array.from({ length: 5 }, (_, i) =>
      makeLang({ languageId: i + 1, languageName: `L${i}` })
    );
    renderInRouter(<LanguagesStrip languages={languages} maxVisible={2} />);
    expect(screen.getByRole('link', { name: /See all \(5\)/ })).toHaveAttribute(
      'href',
      '/dashboard'
    );
  });

  test('omits the count when nothing is hidden', () => {
    const languages = [
      makeLang({ languageId: 1, languageName: 'Spanish' }),
      makeLang({ languageId: 2, languageName: 'Russian' }),
    ];
    renderInRouter(<LanguagesStrip languages={languages} maxVisible={3} />);
    const link = screen.getByRole('link', { name: /See all/ });
    expect(link.textContent).not.toMatch(/\(\d+\)/);
  });

  test('uses knownWords as a tie-breaker when lastActivityAt is equal', () => {
    const languages = [
      makeLang({ languageId: 1, languageName: 'A', knownWords: 100 }),
      makeLang({ languageId: 2, languageName: 'B', knownWords: 500 }),
      makeLang({ languageId: 3, languageName: 'C', knownWords: 200 }),
    ];
    renderInRouter(<LanguagesStrip languages={languages} />);
    const cards = screen.getAllByTestId(/lang-card-/);
    expect(cards.map((c) => c.textContent)).toEqual(['B', 'C', 'A']);
  });
});
