import 'fake-indexeddb/auto';
import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfflineIndicator from '../components/offline/OfflineIndicator';
import { enqueue, clearAll } from '../utils/offline/syncQueue';

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
