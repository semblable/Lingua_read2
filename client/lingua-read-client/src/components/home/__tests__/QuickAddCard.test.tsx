import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuickAddCard from '../QuickAddCard';

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => cleanup());

describe('QuickAddCard', () => {
  test('exposes the three add-content CTAs', () => {
    renderInRouter(<QuickAddCard />);
    expect(screen.getByRole('button', { name: /Add book/i })).toHaveAttribute(
      'href',
      '/books/create'
    );
    expect(screen.getByRole('button', { name: /Add text/i })).toHaveAttribute(
      'href',
      '/texts/create'
    );
    expect(screen.getByRole('button', { name: /Add audio/i })).toHaveAttribute(
      'href',
      '/texts/create-audio'
    );
  });

  test('does not render an "Open dashboard" link (already in the navbar)', () => {
    renderInRouter(<QuickAddCard />);
    expect(screen.queryByRole('button', { name: /dashboard/i })).toBeNull();
  });
});
