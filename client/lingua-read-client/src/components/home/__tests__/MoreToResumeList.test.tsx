import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MoreToResumeList from '../MoreToResumeList';
import type { RecentTexts } from '../../../utils/api/texts';

type RecentText = RecentTexts[number];

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const makeText = (overrides: Partial<RecentText> = {}): RecentText => ({
  textId: 1,
  title: 'Some text',
  languageName: 'Spanish',
  isAudioLesson: false,
  ...overrides,
} as RecentText);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MoreToResumeList', () => {
  test('renders nothing when no texts are supplied', () => {
    const { container } = renderInRouter(<MoreToResumeList texts={[]} />);
    expect(container.querySelector('[data-testid=more-to-resume]')).toBeNull();
  });

  test('renders one row per text, each linking to /texts/{id}', () => {
    const texts = [
      makeText({ textId: 1, title: 'Alpha' }),
      makeText({ textId: 2, title: 'Beta' }),
      makeText({ textId: 3, title: 'Gamma' }),
    ];
    renderInRouter(<MoreToResumeList texts={texts as RecentTexts} />);

    const items = screen.getAllByTestId('more-to-resume-item');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute('href', '/texts/1');
    expect(items[1]).toHaveAttribute('href', '/texts/2');
    expect(items[2]).toHaveAttribute('href', '/texts/3');
    expect(items[0]).toHaveTextContent('Alpha');
    expect(items[2]).toHaveTextContent('Gamma');
  });

  test('renders the book title with part number when set', () => {
    renderInRouter(
      <MoreToResumeList
        texts={[
          makeText({ textId: 5, title: 'Chapter 2', bookTitle: 'War and Peace', partNumber: 2 }),
        ] as RecentTexts}
      />
    );
    expect(screen.getByTestId('more-to-resume-item')).toHaveTextContent('War and Peace · Part 2');
  });

  test('shows the Audio pill on audio lessons', () => {
    renderInRouter(
      <MoreToResumeList
        texts={[makeText({ textId: 9, isAudioLesson: true })] as RecentTexts}
      />
    );
    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  test('formats lastAccessedAt as a relative time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 26, 12, 0, 0));
    const twoDaysAgo = new Date(2026, 4, 24, 12, 0, 0).toISOString();
    renderInRouter(
      <MoreToResumeList
        texts={[
          { ...makeText({ textId: 11 }), lastAccessedAt: twoDaysAgo } as RecentText,
        ] as RecentTexts}
      />
    );
    expect(screen.getByTestId('more-to-resume-item')).toHaveTextContent(/2d ago/);
  });
});
