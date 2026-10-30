import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createListeningActivityTracker } from '../audio/listeningActivity';

vi.mock('../utils/api/client', () => ({ fetchApi: vi.fn().mockResolvedValue({}) }));
vi.mock('../utils/offline/syncQueue', () => ({ enqueue: vi.fn().mockResolvedValue(undefined) }));
import { fetchApi } from '../utils/api/client';
import { enqueue } from '../utils/offline/syncQueue';
import { logListeningActivity } from '../utils/api/audiobook';
import { productionSyncHandlers } from '../utils/offline/handlers';

const tracker = () => {
  const t = createListeningActivityTracker();
  t.setLanguageId(1);
  return t;
};

describe('synthetic listening compatibility (candidate exposure is not production credit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchApi).mockResolvedValue({});
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  test.each([1, 1.5, 2])('actual tracker counts elapsed at speed %s; candidate alone knows source exposure', speed => {
    const t = tracker();
    t.startCheckpoint(0);
    const elapsed = 1800 / speed;
    expect(t.prepareFlush(elapsed * 1000, true, true)).toEqual({ languageId: 1, durationSeconds: elapsed });
    // Test-only known interval of a known 3600-second revision. Neither value
    // exists in the actual tracker payload, so this is not an implemented path.
    expect((elapsed * speed) / 3600).toBe(.5);
  });

  test('pause and buffering lifecycle checkpoints exclude inactive wall time; loops remain additive', () => {
    const t = tracker();
    t.startCheckpoint(0);
    expect(t.prepareFlush(10000, false, true)?.durationSeconds).toBe(10);
    t.clearCheckpoint(); // Production pause orchestration.
    expect(t.prepareFlush(70000, true, false)).toBeNull();
    t.markStalling();
    expect(t.prepareFlush(100000, true, true)).toBeNull();
    t.markPlaying();
    t.startCheckpoint(100000);
    expect(t.prepareFlush(110000, true, true)?.durationSeconds).toBe(10);
    // Loop to the same source interval: wall time still accrues, with no union.
    expect(t.prepareFlush(120000, true, true)?.durationSeconds).toBe(10);
    // An instantaneous seek has no elapsed increment and no payload credit.
    expect(t.prepareFlush(120000, true, true)).toBeNull();
  });

  test('diagnostic: stalling flag alone does not stop an existing checkpoint; caller must flush and clear', () => {
    const t = tracker();
    t.startCheckpoint(0);
    t.markStalling();
    expect(t.prepareFlush(10000, true, false)?.durationSeconds).toBe(10);
    // This documents caller responsibility, not evidence that a real browser's
    // seeking/waiting/playing event sequence always excludes seek latency.
    t.clearCheckpoint();
    expect(t.prepareFlush(20000, true, true)).toBeNull();
  });

  test('offline operation and replay preserve one ID; old queued payload has no source or retry identity', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await logListeningActivity(1, 10);
    const op = vi.mocked(enqueue).mock.calls[0][0];
    expect(op.type).toBe('logListening');
    expect(op.payload.clientEventId).toEqual(expect.any(String));
    await productionSyncHandlers.logListening(op);
    await productionSyncHandlers.logListening(op);
    const bodies = vi.mocked(fetchApi).mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies).toEqual([op.payload, op.payload]);
    expect(Object.keys(op.payload).sort()).toEqual(['clientEventId', 'durationSeconds', 'languageId']);
    await productionSyncHandlers.logListening({ type: 'logListening', payload: { languageId: 1, durationSeconds: 10 } });
    expect(JSON.parse(vi.mocked(fetchApi).mock.calls[2][1].body)).toEqual({ languageId: 1, durationSeconds: 10 });
  });

  test('network interruption queues the original ID; a newly invoked API call mints a distinct ID', async () => {
    vi.mocked(fetchApi).mockRejectedValueOnce(new TypeError('response lost'));
    const result = await logListeningActivity(1, 10);
    expect(result.offline).toBe(true);
    const firstBody = JSON.parse(vi.mocked(fetchApi).mock.calls[0][1].body);
    expect(vi.mocked(enqueue).mock.calls[0][0].payload).toEqual(firstBody);
    await logListeningActivity(1, 10);
    const secondBody = JSON.parse(vi.mocked(fetchApi).mock.calls[1][1].body);
    expect(secondBody.clientEventId).not.toBe(firstBody.clientEventId);
    // Independent calls can represent different devices/repeats. The server
    // cannot infer they were one exposure without a retained original ID.
  });
});
