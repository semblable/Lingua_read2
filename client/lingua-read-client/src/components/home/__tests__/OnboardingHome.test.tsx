import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OnboardingHome from '../OnboardingHome';

const renderInRouter = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(() => cleanup());

describe('OnboardingHome', () => {
  test('greets a known user by name', () => {
    renderInRouter(<OnboardingHome username="Kamil" />);
    expect(
      screen.getByRole('heading', { name: /Welcome to LinguaRead, Kamil\./ })
    ).toBeInTheDocument();
  });

  test('falls back to a generic welcome when no username is supplied', () => {
    renderInRouter(<OnboardingHome />);
    expect(
      screen.getByRole('heading', { name: /^Welcome to LinguaRead\.$/ })
    ).toBeInTheDocument();
  });

  test('exposes the three primary CTAs to the right routes', () => {
    renderInRouter(<OnboardingHome />);
    // LinkContainer wraps Bootstrap Button as an <a role="button">, so query
    // by role="button" to capture the link.
    const addBook = screen.getByRole('button', { name: /Add a book/i });
    const addText = screen.getByRole('button', { name: /Add a text/i });
    const languages = screen.getByRole('button', { name: /Languages/i });
    expect(addBook).toHaveAttribute('href', '/books/create');
    expect(addText).toHaveAttribute('href', '/texts/create');
    expect(languages).toHaveAttribute('href', '/settings/languages');
  });

  test('renders the "Open your library" escape hatch', () => {
    renderInRouter(<OnboardingHome />);
    // This one is a plain <a>, not wrapped in a Button — role="link".
    expect(screen.getByRole('link', { name: /Open your library/i })).toHaveAttribute(
      'href',
      '/library'
    );
  });
});
