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
});
