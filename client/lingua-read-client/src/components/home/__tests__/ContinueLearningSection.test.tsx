import { describe, test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RecentTexts } from '../../../utils/api/texts';

// Stub the heavy ContinueLearningCard (it fetches text detail). The wrapper's
// own behaviour is independent of how the primary card renders.
vi.mock('../ContinueLearningCard', () => ({
  default: ({ text }: { text: RecentTexts[number] | null }) => (
    <div data-testid="primary-card">{text ? text.title : 'empty'}</div>
  ),
}));

import ContinueLearningSection from '../ContinueLearningSection';

type RecentText = RecentTexts[number];

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

const makeText = (overrides: Partial<RecentText>): RecentText =>
  ({ textId: 1, title: 't', languageName: 'Spanish', isAudioLesson: false, ...overrides } as RecentText);

afterEach(() => cleanup());

describe('ContinueLearningSection', () => {
  test('renders only the primary card (no secondary list) when given a single text', () => {
    renderInRouter(
      <ContinueLearningSection
        texts={[makeText({ textId: 1, title: 'Only' })] as RecentTexts}
      />
    );
    expect(screen.getByTestId('primary-card')).toHaveTextContent('Only');
    expect(screen.queryByTestId('more-to-resume')).toBeNull();
  });

  test('shows up to 5 secondary entries (excluding the primary)', () => {
    const texts = Array.from({ length: 8 }, (_, i) =>
      makeText({ textId: i + 1, title: `Text ${i + 1}` })
    );
    renderInRouter(<ContinueLearningSection texts={texts as RecentTexts} />);

    expect(screen.getByTestId('primary-card')).toHaveTextContent('Text 1');
    const items = screen.getAllByTestId('more-to-resume-item');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Text 2');
    expect(items[4]).toHaveTextContent('Text 6');
  });

  test('respects a smaller maxSecondary override', () => {
    const texts = Array.from({ length: 5 }, (_, i) =>
      makeText({ textId: i + 1, title: `T${i + 1}` })
    );
    renderInRouter(
      <ContinueLearningSection texts={texts as RecentTexts} maxSecondary={2} />
    );
    expect(screen.getAllByTestId('more-to-resume-item')).toHaveLength(2);
  });

  test('renders the primary card in empty state when no texts are supplied', () => {
    renderInRouter(<ContinueLearningSection texts={[] as RecentTexts} />);
    expect(screen.getByTestId('primary-card')).toHaveTextContent('empty');
    expect(screen.queryByTestId('more-to-resume')).toBeNull();
  });
});
