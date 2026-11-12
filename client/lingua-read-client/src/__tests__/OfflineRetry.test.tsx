import { act, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import OfflineIndicator from '../components/offline/OfflineIndicator';
import { drain, pending, type SyncHandlers } from '../utils/offline/syncQueue';

vi.mock('../utils/offline/syncQueue', () => ({ drain: vi.fn(), pending: vi.fn() }));
vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
afterEach(() => vi.useRealTimers());

test('backs off background retries after repeated failures', async () => {
  // This test checks exact deadlines. The suite default advances fake time
  // with wall time, which can cross those deadlines on a busy worker.
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.mocked(drain).mockReset();
  vi.mocked(pending).mockReset();
  vi.mocked(pending).mockResolvedValue(1);
  vi.mocked(drain).mockResolvedValue({ attempted: 1, succeeded: 0, failed: 1 });
  const view = render(<OfflineIndicator handlers={{} as SyncHandlers} />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(drain).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(drain).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
  expect(drain).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(drain).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
