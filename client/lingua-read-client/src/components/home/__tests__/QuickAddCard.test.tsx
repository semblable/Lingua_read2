import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuickAddCard from '../QuickAddCard';
afterEach(cleanup);

describe('QuickAddCard', () => {
  test('reveals all three import routes through one menu', async () => {
    render(<MemoryRouter><QuickAddCard /></MemoryRouter>);
    const toggle = screen.getByRole('button', { name: '+ Add content' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /Add book/ })).toHaveAttribute('href', '/books/create');
    expect(screen.getByRole('link', { name: /Add text/ })).toHaveAttribute('href', '/texts/create');
    expect(screen.getByRole('link', { name: /Add audio/ })).toHaveAttribute('href', '/texts/create-audio');
  });
});
