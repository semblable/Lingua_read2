import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SrsDueWidget from '../SrsDueWidget';

const renderWidget = (props: React.ComponentProps<typeof SrsDueWidget> = {}) =>
  render(<MemoryRouter><SrsDueWidget {...props} /></MemoryRouter>);
afterEach(cleanup);

describe('SrsDueWidget', () => {
  test('offers a bounded session instead of exposing the entire backlog', () => {
    renderWidget({ count: 12_345 });
    const button = screen.getByRole('button', { name: /Review 50 cards/ });
    expect(button).toHaveAttribute('href', '/srs?limit=50');
    expect(button).toHaveClass('btn-primary');
    expect(screen.queryByRole('button', { name: /12345|12,345/ })).not.toBeInTheDocument();
    expect(screen.getByText('12,345 due')).toBeVisible();
    expect(screen.getAllByRole('combobox')).toEqual([screen.getByLabelText('Session size')]);
    expect(screen.getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['10', '25', '50', '100', '200']);
  });

  test('caps the session at the actual due count, including the singular case', () => {
    renderWidget({ count: 1 });
    expect(screen.getByRole('button', { name: /Review 1 card/ })).toHaveAttribute('href', '/srs?limit=1');
  });

  test('offers only twelve cards when twelve are due, even after selecting a larger session', () => {
    renderWidget({ count: 12 });
    fireEvent.change(screen.getByLabelText('Session size'), { target: { value: '200' } });
    expect(screen.getByRole('button', { name: /Review 12 cards/ })).toHaveAttribute('href', '/srs?limit=12');
    expect(screen.getByText('12 due')).toBeVisible();
  });

  test('changes the actual session route when choosing a different size', () => {
    renderWidget({ count: 2679 });
    fireEvent.change(screen.getByLabelText('Session size'), { target: { value: '100' } });
    expect(screen.getByRole('button', { name: /Review 100 cards/ })).toHaveAttribute('href', '/srs?limit=100');
  });

  test('distinguishes unavailable stats from having no reviews due', () => {
    renderWidget({ unavailable: true });
    expect(screen.getByRole('heading', { name: 'Review count unavailable' })).toBeInTheDocument();
    expect(screen.queryByText('No reviews due')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open SRS' })).toHaveAttribute('href', '/srs');
  });

  test('shows the zero and loading states', () => {
    const { rerender } = renderWidget();
    expect(screen.getByRole('heading', { name: 'No reviews due' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    rerender(<MemoryRouter><SrsDueWidget loading /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading reviews');
  });

  test('renders today breakdown and review-limit pause note when provided', () => {
    renderWidget({
      count: 200,
      reviewsToday: 200,
      newToday: 0,
      backlogNewCount: 2350,
      deferredReviewsCount: 50,
      newCardsPausedByReviewLimit: true,
    });
    expect(screen.getByText('200 due')).toBeVisible();
    expect(screen.getByTestId('srs-due-breakdown')).toHaveTextContent(
      '200 reviews today · 50 more reviews queued · 2,350 saved for later'
    );
    expect(screen.getByTestId('srs-review-limit-note')).toHaveTextContent(
      "New cards paused while reviews fill today's limit."
    );
  });

  test('lists learning cards separately from scheduled reviews in the breakdown', () => {
    renderWidget({
      count: 10,
      learningToday: 2,
      reviewsToday: 5,
      newToday: 3,
      backlogNewCount: 100,
    });
    expect(screen.getByTestId('srs-due-breakdown')).toHaveTextContent(
      '2 learning · 5 reviews today · 3 new today · 100 saved for later'
    );
  });

  test('explains deferred reviews and saved backlog when today count reaches zero', () => {
    renderWidget({ count: 0, backlogNewCount: 120, deferredReviewsCount: 15 });
    expect(screen.getByRole('heading', { name: 'No reviews due' })).toBeInTheDocument();
    expect(screen.getByTestId('srs-due-backlog')).toHaveTextContent(
      "Today's limit is complete. 15 more reviews and 120 saved words wait for future sessions."
    );
  });

  test('explains review-limit pause in the zero-due state when untouched words remain', () => {
    renderWidget({
      count: 0,
      backlogNewCount: 45,
      deferredReviewsCount: 0,
      newCardsPausedByReviewLimit: true,
    });
    expect(screen.getByRole('heading', { name: 'No reviews due' })).toBeInTheDocument();
    expect(screen.getByTestId('srs-due-backlog')).toHaveTextContent(
      "New cards paused while reviews fill today's limit. 45 saved words waiting for future sessions."
    );
  });
});
