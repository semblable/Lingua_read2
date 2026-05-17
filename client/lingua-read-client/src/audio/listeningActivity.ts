// Listening-time tracker: accrues seconds of audio playback for the
// learning-activity API. The tracker is a pure data object; the orchestrating
// hook is responsible for the actual `logListeningActivity` call so it can
// thread keepalive / lifecycle hints + retry-on-failure restoration.

export const LISTENING_ACTIVITY_FLUSH_SECONDS = 10;

export type FlushPayload = {
  languageId: number | string;
  durationSeconds: number;
};

export type ListeningActivityTracker = {
  /** Set/clear the language id used for the next flush. */
  setLanguageId(id: number | string | null | undefined): void;
  getLanguageId(): number | string | null;
  /** Start (or reset) the accrual checkpoint to `now`. */
  startCheckpoint(now: number): void;
  /** Set the checkpoint to `now` only if there isn't one. Used on play
   *  transitions where the `playing` event may have already set one. */
  ensureCheckpoint(now: number): void;
  /** Forget the current checkpoint without flushing. Used on pause. */
  clearCheckpoint(): void;
  /** Mark audio as buffering/stalled — stops accrual until `markPlaying`. */
  markStalling(): void;
  /** Mark audio as actively playing again. */
  markPlaying(): void;
  /**
   * Compute what (if anything) should be flushed to the activity log,
   * advancing the checkpoint and decrementing pending seconds by the
   * returned amount. Returns null when there's nothing eligible.
   *
   * - `force=false` floors the pending remainder and requires >= 10s.
   * - `force=true`  rounds the remainder so sub-second residue isn't lost
   *   across pause/unmount/lifecycle flushes.
   *
   * Caller passes the current `isPlaying` so the tracker can re-checkpoint
   * if a stale clear left it without one while accrual should be active.
   */
  prepareFlush(now: number, force: boolean, isPlaying: boolean): FlushPayload | null;
  /** Re-credit seconds that a failed (non-lifecycle) fetch couldn't log. */
  restorePending(seconds: number): void;
  hasPending(): boolean;
  getPendingSeconds(): number;
};

export const createListeningActivityTracker = (): ListeningActivityTracker => {
  let languageId: number | string | null = null;
  let lastCheckpointAt: number | null = null;
  let pendingSeconds = 0;
  let isStalling = false;

  const accrueUpTo = (now: number): void => {
    if (lastCheckpointAt == null) return;
    const elapsed = (now - lastCheckpointAt) / 1000;
    if (elapsed > 0) {
      pendingSeconds += elapsed;
    }
    lastCheckpointAt = now;
  };

  return {
    setLanguageId(id) {
      languageId = id ?? null;
    },
    getLanguageId() {
      return languageId;
    },
    startCheckpoint(now) {
      lastCheckpointAt = now;
    },
    ensureCheckpoint(now) {
      if (lastCheckpointAt == null) {
        lastCheckpointAt = now;
      }
    },
    clearCheckpoint() {
      lastCheckpointAt = null;
    },
    markStalling() {
      isStalling = true;
    },
    markPlaying() {
      isStalling = false;
    },
    prepareFlush(now, force, isPlaying) {
      if (lastCheckpointAt != null) {
        accrueUpTo(now);
      } else if (isPlaying && !isStalling) {
        // No checkpoint but we ought to be accruing — restore it so the next
        // flush has somewhere to count from. Don't credit elapsed time here.
        lastCheckpointAt = now;
      }

      const secondsToLog = force
        ? Math.round(pendingSeconds)
        : Math.floor(pendingSeconds);

      if (secondsToLog <= 0) return null;
      if (!force && secondsToLog < LISTENING_ACTIVITY_FLUSH_SECONDS) return null;
      if (!languageId) return null;

      pendingSeconds -= secondsToLog;
      return { languageId, durationSeconds: secondsToLog };
    },
    restorePending(seconds) {
      if (seconds > 0) {
        pendingSeconds += seconds;
      }
    },
    hasPending() {
      return pendingSeconds > 0;
    },
    getPendingSeconds() {
      return pendingSeconds;
    }
  };
};
