import 'fake-indexeddb/auto';
import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfflineIndicator from '../components/offline/OfflineIndicator';
import { enqueue, drain, clearAll, listWordConflicts } from '../utils/offline/syncQueue';
import { authLogin } from '../utils/api/auth';
vi.mock('../utils/api/auth', async importOriginal => ({ ...await importOriginal(), authLogin: vi.fn() }));

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
};

const noopHandlers = {
  srsReview: vi.fn(async () => {}),
  wordStatusUpdate: vi.fn(async () => {}),
  wordCreate: vi.fn(async () => {}),
};

describe('OfflineIndicator', () => {
  test('opens a stored vocabulary conflict and keeps the saved version on request', async () => {
    await enqueue({ type: 'wordStatusUpdate', payload: { wordId: 42, status: 3, translation: 'queued gloss' } });
    const handlers = {
      ...noopHandlers,
      wordStatusUpdate: vi.fn().mockRejectedValue({
        status: 409, body: { word: { wordId: 42, term: 'chat', status: 5, translation: 'saved gloss' } },
      }),
    };
    await drain(handlers);
    render(<OfflineIndicator handlers={handlers} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review offline edits (1)' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByText(/queued gloss/)).toBeVisible();
    expect(screen.getByText(/saved gloss/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Keep saved version' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Review offline edits/ })).not.toBeInTheDocument());
    expect(await listWordConflicts()).toEqual([]);
    expect(handlers.wordStatusUpdate).toHaveBeenCalledOnce();
  });

  test('applying a draft refreshes an unversioned snapshot before overwriting a later change', async () => {
    await enqueue({ type: 'wordStatusUpdate', payload: { wordId: 42, status: 3, translation: 'queued gloss' } });
    const saved = { wordId: 42, term: 'chat', status: 5, translation: 'first gloss' };
    const write = vi.fn()
      .mockRejectedValueOnce({ status: 409, body: { word: saved } })
      .mockRejectedValueOnce({ status: 409, body: { word: { ...saved, translation: 'intervening gloss' }, revision: 'updated' } })
      .mockResolvedValue(undefined);
    const handlers = { ...noopHandlers, wordStatusUpdate: write };
    await drain(handlers);
    render(<OfflineIndicator handlers={handlers} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review offline edits (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply offline edit' }));
    expect(await screen.findByText(/intervening gloss/)).toBeVisible();
    expect(screen.getByText(/queued gloss/)).toBeVisible();
    expect(write.mock.lastCall[0].payload.expectedRevision).toBe('unknown');
    const apply = screen.getByRole('button', { name: 'Apply offline edit' });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Review offline edits/ })).not.toBeInTheDocument());
    expect(write.mock.lastCall[0].payload.expectedRevision).toBe('updated');
    expect(await listWordConflicts()).toEqual([]);
  });

  test('signs back in and syncs without replacing the active reader', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 9, grade: 2 } });
    const review = vi.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValue(undefined);
    authLogin.mockResolvedValue(new Response('{}'));
    render(<><textarea aria-label="Reader note" defaultValue="unsaved note" />
      <OfflineIndicator handlers={{ ...noopHandlers, srsReview: review }} /></>);
    fireEvent.click(await screen.findByTestId('offline-indicator'));
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Reader note')).toHaveValue('unsaved note');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    expect(authLogin).toHaveBeenCalledWith('secret');
    expect(screen.getByLabelText('Reader note')).toHaveValue('unsaved note');
  });

  test('accepts an owner recovery code in the sync dialog during lockout', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 9, grade: 2 } });
    const review = vi.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValue(undefined);
    authLogin.mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'Sign-in is temporarily locked.', recoveryAvailable: true,
    }), { status: 401 })).mockResolvedValueOnce(new Response('{}'));
    render(<OfflineIndicator handlers={{ ...noopHandlers, srsReview: review }} />);
    fireEvent.click(await screen.findByTestId('offline-indicator'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'owner-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    fireEvent.change(await screen.findByLabelText(/owner recovery code/i), { target: { value: 'owner-code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(review).toHaveBeenCalledTimes(2));
    expect(authLogin).toHaveBeenLastCalledWith('owner-password', 'owner-code');
  });
  beforeEach(async () => {
    setOnline(true);
    vi.clearAllMocks();
    try {
      await clearAll();
    } catch {
      // Ignore.
    }
  });

  test('renders nothing when online and the queue is empty', async () => {
    setOnline(true);
    const { container } = render(<OfflineIndicator handlers={noopHandlers} />);
    // Allow effect-triggered pending() to settle.
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  test('shows the offline badge when navigator is offline', async () => {
    setOnline(false);
    render(<OfflineIndicator handlers={noopHandlers} />);
    await act(async () => { window.dispatchEvent(new Event('offline')); });
    const indicator = await screen.findByTestId('offline-indicator');
    expect(indicator).toHaveAttribute('data-online', 'false');
    expect(indicator).toHaveTextContent(/Offline/);
  });

  test('shows the pending count when there are queued ops while online', async () => {
    setOnline(true);
    await enqueue({ type: 'srsReview', payload: { cardId: 1, grade: 2 } });
    await enqueue({ type: 'srsReview', payload: { cardId: 2, grade: 2 } });

    render(<OfflineIndicator handlers={noopHandlers} pollIntervalMs={50} />);
    const indicator = await screen.findByTestId('offline-indicator');
    await waitFor(() => {
      expect(indicator).toHaveAttribute('data-pending-count', '2');
    });
    expect(indicator).toHaveTextContent(/2 changes pending sync/);
  });

  test('clicking the badge while online triggers drain()', async () => {
    setOnline(true);
    await enqueue({ type: 'srsReview', payload: { cardId: 9, grade: 2 } });

    render(<OfflineIndicator handlers={noopHandlers} pollIntervalMs={50} />);
    const indicator = await screen.findByTestId('offline-indicator');

    fireEvent.click(indicator);

    await waitFor(() => {
      expect(noopHandlers.srsReview).toHaveBeenCalledTimes(1);
    });
  });

  test('reconnect (offline → online) auto-drains the queue', async () => {
    setOnline(false);
    await enqueue({ type: 'srsReview', payload: { cardId: 50, grade: 3 } });

    render(<OfflineIndicator handlers={noopHandlers} pollIntervalMs={50} />);
    await act(async () => { window.dispatchEvent(new Event('offline')); });

    setOnline(true);
    await act(async () => { window.dispatchEvent(new Event('online')); });

    await waitFor(() => {
      expect(noopHandlers.srsReview).toHaveBeenCalledTimes(1);
    });
  });
});
