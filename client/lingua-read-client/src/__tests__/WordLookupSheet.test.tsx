import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import WordLookupSheet from '../components/reader/WordLookupSheet';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.getElementById('root')?.remove(); });

test('closed reduced-motion mount never steals focus; an opened sheet restores once and makes its background inert', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  const restore = vi.fn();
  const props = { onClose: vi.fn(), onRestoreFocus: restore, children: <p>Synthetic lookup</p> };
  const view = render(<WordLookupSheet {...props} show={false} />, { container: root });
  expect(restore).not.toHaveBeenCalled();
  view.rerender(<WordLookupSheet {...props} show />);
  await screen.findByRole('dialog', { name: 'Word information' });
  expect(root.inert).toBe(true);
  view.rerender(<WordLookupSheet {...props} show={false} />);
  await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  expect(root.inert).toBeFalsy();
  view.rerender(<WordLookupSheet {...props} show={false} />);
  expect(restore).toHaveBeenCalledTimes(1);
});
