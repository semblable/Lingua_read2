import {
  createListeningActivityTracker,
  LISTENING_ACTIVITY_FLUSH_SECONDS
} from '../audio/listeningActivity';

describe('listeningActivity', () => {
  test('LISTENING_ACTIVITY_FLUSH_SECONDS is 10', () => {
    expect(LISTENING_ACTIVITY_FLUSH_SECONDS).toBe(10);
  });

  test('prepareFlush returns null when no language is set', () => {
    const t = createListeningActivityTracker();
    t.startCheckpoint(1000);
    expect(t.prepareFlush(11000, false, true)).toBeNull();
  });

  test('periodic flush requires >= 10 accrued seconds (floor)', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    t.startCheckpoint(1000);
    // 9 seconds accrued — below threshold, periodic flush returns null
    expect(t.prepareFlush(10000, false, true)).toBeNull();
    // After advancing to 11000 we have 10 elapsed total
    expect(t.prepareFlush(11000, false, true)).toEqual({ languageId: 5, durationSeconds: 10 });
  });

  test('force flush rounds the sub-second remainder', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    t.startCheckpoint(0);
    // 3.4 accrued — periodic would floor to 3 (below threshold anyway), force rounds to 3
    expect(t.prepareFlush(3400, true, true)).toEqual({ languageId: 5, durationSeconds: 3 });

    // Fresh tracker for clean rounding check: 4.6 → 5 (round up), 4.4 → 4 (round down).
    const t2 = createListeningActivityTracker();
    t2.setLanguageId(5);
    t2.startCheckpoint(0);
    expect(t2.prepareFlush(4600, true, true)).toEqual({ languageId: 5, durationSeconds: 5 });

    const t3 = createListeningActivityTracker();
    t3.setLanguageId(5);
    t3.startCheckpoint(0);
    expect(t3.prepareFlush(4400, true, true)).toEqual({ languageId: 5, durationSeconds: 4 });
  });

  test('preserves sub-second remainder across pause/resume', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);

    // Play 3.4s — force flush rounds to 3, leaves 0.4s residual.
    t.startCheckpoint(0);
    expect(t.prepareFlush(3400, true, true)).toEqual({ languageId: 5, durationSeconds: 3 });
    expect(t.getPendingSeconds()).toBeCloseTo(0.4, 5);

    // Resume + play 4.4s more — total pending = 0.4 + 4.4 = 4.8 → rounds to 5.
    t.clearCheckpoint();
    t.startCheckpoint(0);
    expect(t.prepareFlush(4400, true, true)).toEqual({ languageId: 5, durationSeconds: 5 });
  });

  test('clearCheckpoint stops further accrual until next start', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    t.startCheckpoint(1000);
    t.clearCheckpoint();
    // No checkpoint, not playing → no accrual, no flush
    expect(t.prepareFlush(11000, false, false)).toBeNull();
  });

  test('prepareFlush re-arms checkpoint when missing while playing', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    // No checkpoint, but isPlaying=true → tracker should restore checkpoint to `now`
    expect(t.prepareFlush(1000, false, true)).toBeNull();
    // Now elapsed=10 from re-armed checkpoint
    expect(t.prepareFlush(11000, false, true)).toEqual({ languageId: 5, durationSeconds: 10 });
  });

  test('does not re-arm checkpoint while stalling', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    t.markStalling();
    // No checkpoint + stalling → no re-arm, no accrual
    expect(t.prepareFlush(1000, false, true)).toBeNull();
    expect(t.prepareFlush(20000, false, true)).toBeNull();
  });

  test('markPlaying clears stall state', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    t.markStalling();
    t.markPlaying();
    // Now re-arm should work
    expect(t.prepareFlush(1000, false, true)).toBeNull();
    expect(t.prepareFlush(11000, false, true)).toEqual({ languageId: 5, durationSeconds: 10 });
  });

  test('restorePending re-credits seconds (for fetch-failure retry)', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    t.startCheckpoint(0);
    expect(t.prepareFlush(10000, false, true)).toEqual({ languageId: 5, durationSeconds: 10 });
    // After "fetch failed" we re-credit the 10 seconds.
    t.restorePending(10);
    // Next force flush sees them back in pending.
    expect(t.prepareFlush(10000, true, true)).toEqual({ languageId: 5, durationSeconds: 10 });
  });

  test('returns null when pending seconds < 1 even on force', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    t.startCheckpoint(0);
    // Only 0.4s accrued, rounds to 0 — no flush
    expect(t.prepareFlush(400, true, true)).toBeNull();
  });

  test('ensureCheckpoint only sets when missing', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    t.startCheckpoint(1000);
    // ensureCheckpoint at a later time should NOT overwrite — accrual continues from 1000.
    t.ensureCheckpoint(5000);
    expect(t.prepareFlush(11000, false, true)).toEqual({ languageId: 5, durationSeconds: 10 });

    // After clearing, ensureCheckpoint should arm a fresh checkpoint at the given time.
    t.clearCheckpoint();
    t.ensureCheckpoint(15000);
    expect(t.prepareFlush(25000, false, true)).toEqual({ languageId: 5, durationSeconds: 10 });
  });

  test('setLanguageId accepts null/undefined to clear', () => {
    const t = createListeningActivityTracker();
    t.setLanguageId(5);
    expect(t.getLanguageId()).toBe(5);
    t.setLanguageId(null);
    expect(t.getLanguageId()).toBeNull();
    t.setLanguageId(undefined);
    expect(t.getLanguageId()).toBeNull();
  });

  test('hasPending reflects accrued state', () => {
    const t = createListeningActivityTracker();
    expect(t.hasPending()).toBe(false);
    t.setLanguageId(5);
    t.startCheckpoint(0);
    t.prepareFlush(500, false, true); // accrues 0.5s but doesn't flush
    expect(t.hasPending()).toBe(true);
  });
});
