import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { enqueueIfOffline, isOfflineQueued } from '../utils/offline/enqueueIfOffline';
import { pending, _resetForTests } from '../utils/offline/syncQueue';
import { ApiError } from '../utils/api/client';

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
};

describe('enqueueIfOffline', () => {
  beforeEach(async () => {
    setOnline(true);
    try { await _resetForTests(); } catch { /* ignore */ }
  });

  test('runs the call and returns its result when online and successful', async () => {
    const run = vi.fn(async () => ({ ok: true, id: 99 }));
    const result = await enqueueIfOffline(
      { type: 'srsReview', payload: { cardId: 1, grade: 2 } },
      run
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, id: 99 });
    expect(isOfflineQueued(result)).toBe(false);
    expect(await pending()).toBe(0);
  });

  test('enqueues without running when navigator.onLine is false', async () => {
    setOnline(false);
    const run = vi.fn(async () => ({ ok: true }));
    const result = await enqueueIfOffline(
      { type: 'srsReview', payload: { cardId: 1, grade: 2 } },
      run
    );
    expect(run).not.toHaveBeenCalled();
    expect(isOfflineQueued(result)).toBe(true);
    expect(await pending()).toBe(1);
  });

  test('enqueues when fetch throws TypeError (network unreachable)', async () => {
    setOnline(true);
    const run = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const result = await enqueueIfOffline(
      { type: 'srsReview', payload: { cardId: 1, grade: 2 } },
      run
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(isOfflineQueued(result)).toBe(true);
    expect(await pending()).toBe(1);
  });

  test('does NOT enqueue on ApiError (application errors propagate)', async () => {
    setOnline(true);
    const run = vi.fn(async () => { throw new ApiError('forbidden', 403); });
    await expect(
      enqueueIfOffline({ type: 'srsReview', payload: { cardId: 1, grade: 2 } }, run)
    ).rejects.toThrow('forbidden');
    expect(await pending()).toBe(0);
  });

  test('does NOT enqueue on generic Error (lets the caller see it)', async () => {
    setOnline(true);
    const run = vi.fn(async () => { throw new Error('payload too large'); });
    await expect(
      enqueueIfOffline({ type: 'srsReview', payload: { cardId: 1, grade: 2 } }, run)
    ).rejects.toThrow('payload too large');
    expect(await pending()).toBe(0);
  });
});
