import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SrsDueWidget from '../SrsDueWidget';

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

// LinkContainer wraps Bootstrap Button as an <a> with role="button" — query by
// that role and check href on the element to confirm both the label and route.

afterEach(() => cleanup());

describe('SrsDueWidget', () => {
  test('shows the "all caught up" state when count is 0', () => {
    renderInRouter(<SrsDueWidget count={0} />);
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    const link = screen.getByRole('button', { name: /Open SRS/i });
    expect(link).toHaveAttribute('href', '/srs');
  });

  test('renders the count and a singular CTA when one card is due', () => {
    renderInRouter(<SrsDueWidget count={1} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('card due for review')).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /Review card now/i });
    expect(cta).toHaveAttribute('href', '/srs');
  });

  test('uses warning urgency (btn-warning) for 1-10 cards due', () => {
    renderInRouter(<SrsDueWidget count={7} />);
    const btn = screen.getByRole('button', { name: /Review 7 cards now/i });
    expect(btn.className).toMatch(/btn-warning/);
  });

  test('uses danger urgency (btn-danger) when more than 10 cards are due', () => {
    renderInRouter(<SrsDueWidget count={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Review 42 cards now/i });
    expect(btn.className).toMatch(/btn-danger/);
  });

  test('uses outline-secondary for the zero state (no urgency)', () => {
    renderInRouter(<SrsDueWidget count={0} />);
    const btn = screen.getByRole('button', { name: /Open SRS/i });
    expect(btn.className).toMatch(/btn-outline-secondary/);
  });

  test('renders a spinner while loading', () => {
    const { container } = renderInRouter(<SrsDueWidget loading />);
    expect(container.querySelector('.spinner-border')).toBeTruthy();
  });
});
