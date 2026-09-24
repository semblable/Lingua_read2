import { useCallback, useEffect, useRef, useState } from 'react';

export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface UseAutoSaveOptions<T extends object> {
  initialValues: T;
  /** Keys the form edits. Any other key is display-only and changes via applyServerValues. */
  editableKeys: readonly (keyof T)[];
  /** Persists the edited keys that differ from what was last saved. A rejection keeps them unsaved. */
  save: (patch: Partial<T>) => Promise<unknown>;
  /** Runs once a patch is persisted, with whatever `save` resolved to. */
  onSaved?: (patch: Partial<T>, result: unknown) => void;
  /** How long the "saved" status stays before going back to idle. */
  savedNoticeMs?: number;
}

export interface UseAutoSaveResult<T extends object> {
  values: T;
  status: AutoSaveStatus;
  error: string | null;
  /** Sets one field. An edited field is saved once `delayMs` pass without another change. */
  setField: <K extends keyof T>(key: K, value: T[K], delayMs?: number) => void;
  /** Replaces every value, e.g. after loading from the server. Saves nothing. */
  reset: (values: T) => void;
  /** Takes values the server already holds (a secret's "configured" flag, a cleared token). Saves nothing. */
  applyServerValues: (partial: Partial<T>) => void;
  /** Saves any waiting change now. Resolves true when nothing is left unsaved. */
  flush: () => Promise<boolean>;
  /** Whether a change is waiting, being saved, or failed to save. */
  hasUnsavedChanges: () => boolean;
}

const DEFAULT_DELAY_MS = 150;

/**
 * Form state that saves itself. Each save sends only the edited keys that changed since the last
 * successful save, one request at a time: a change made while a save is running goes out right
 * after it, so responses can't land out of order. Waiting changes are also saved when the page is
 * hidden or the component unmounts, and the browser asks before closing a tab with unsaved ones.
 */
export function useAutoSave<T extends object>({
  initialValues,
  editableKeys,
  save,
  onSaved,
  savedNoticeMs = 2000
}: UseAutoSaveOptions<T>): UseAutoSaveResult<T> {
  const [values, setValues] = useState<T>(initialValues);
  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // The save loop runs outside render, so it works from refs: the current values and the values
  // the server was last known to hold.
  const valuesRef = useRef<T>(initialValues);
  const savedRef = useRef<T>(initialValues);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef<Promise<boolean> | null>(null);
  const failedRef = useRef(false);

  const saveRef = useRef(save);
  const onSavedRef = useRef(onSaved);
  const keysRef = useRef(editableKeys);
  useEffect(() => {
    saveRef.current = save;
    onSavedRef.current = onSaved;
    keysRef.current = editableKeys;
  });

  const pendingPatch = useCallback((): Partial<T> | null => {
    const patch: Partial<T> = {};
    let changed = false;
    for (const key of keysRef.current) {
      if (!Object.is(valuesRef.current[key], savedRef.current[key])) {
        patch[key] = valuesRef.current[key];
        changed = true;
      }
    }
    return changed ? patch : null;
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearNotice = useCallback(() => {
    if (noticeTimerRef.current !== null) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  const flush = useCallback((): Promise<boolean> => {
    clearTimer();
    // A save is already running; its loop picks this change up when it finishes.
    if (runningRef.current) return runningRef.current;

    let finished = false;
    const run = (async (): Promise<boolean> => {
      let savedAny = false;
      try {
        for (;;) {
          const patch = pendingPatch();
          if (!patch) {
            if (failedRef.current) {
              // Everything that failed was changed back, so there is nothing left to retry.
              failedRef.current = false;
              setError(null);
            }
            if (savedAny) {
              setStatus('saved');
              clearNotice();
              noticeTimerRef.current = setTimeout(() => {
                noticeTimerRef.current = null;
                setStatus((current) => (current === 'saved' ? 'idle' : current));
              }, savedNoticeMs);
            } else {
              // Nothing to send (e.g. a blur with no edit): keep whatever the user last saw.
              setStatus((current) => (current === 'pending' || current === 'error' ? 'idle' : current));
            }
            return true;
          }

          clearNotice();
          setStatus('saving');
          let result: unknown;
          try {
            result = await saveRef.current(patch);
          } catch (e: unknown) {
            failedRef.current = true;
            setError(e instanceof Error && e.message ? e.message : 'Please try again.');
            setStatus('error');
            return false;
          }
          savedRef.current = { ...savedRef.current, ...patch };
          savedAny = true;
          failedRef.current = false;
          setError(null);
          onSavedRef.current?.(patch, result);

          // Still typing: the debounce timer saves the rest once the user pauses.
          if (timerRef.current !== null) {
            setStatus('pending');
            return false;
          }
        }
      } finally {
        finished = true;
        runningRef.current = null;
      }
    })();

    // With nothing to send, the body above never awaits: it has already finished (finally
    // included) by this line, and marking it as running would block every later save.
    if (!finished) runningRef.current = run;
    return run;
  }, [clearNotice, clearTimer, pendingPatch, savedNoticeMs]);

  const schedule = useCallback((delayMs: number) => {
    clearTimer();
    if (!pendingPatch()) {
      // Changed back to what is saved. A running save settles the status itself.
      if (!runningRef.current) {
        failedRef.current = false;
        setError(null);
        setStatus((current) => (current === 'pending' || current === 'error' ? 'idle' : current));
      }
      return;
    }
    clearNotice();
    if (!runningRef.current) setStatus('pending');
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, delayMs);
  }, [clearNotice, clearTimer, flush, pendingPatch]);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K], delayMs: number = DEFAULT_DELAY_MS) => {
    valuesRef.current = { ...valuesRef.current, [key]: value };
    setValues(valuesRef.current);
    if (keysRef.current.includes(key)) schedule(delayMs);
  }, [schedule]);

  const reset = useCallback((next: T) => {
    clearTimer();
    clearNotice();
    valuesRef.current = next;
    savedRef.current = next;
    failedRef.current = false;
    setValues(next);
    setStatus('idle');
    setError(null);
  }, [clearNotice, clearTimer]);

  const applyServerValues = useCallback((partial: Partial<T>) => {
    valuesRef.current = { ...valuesRef.current, ...partial };
    savedRef.current = { ...savedRef.current, ...partial };
    setValues(valuesRef.current);
  }, []);

  const hasUnsavedChanges = useCallback(
    () => timerRef.current !== null || runningRef.current !== null || pendingPatch() !== null,
    [pendingPatch]
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      void flush();
      event.preventDefault();
      // Older browsers only show the prompt when returnValue is set.
      event.returnValue = '';
    };
    // Switching apps on a phone often ends in the tab being discarded, with no beforeunload.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && hasUnsavedChanges()) void flush();
    };
    const handleOnline = () => {
      if (failedRef.current) void flush();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [flush, hasUnsavedChanges]);

  // Leaving the page within the debounce window must not drop the change.
  useEffect(() => () => {
    clearNotice();
    if (hasUnsavedChanges()) void flush();
  }, [clearNotice, flush, hasUnsavedChanges]);

  return { values, status, error, setField, reset, applyServerValues, flush, hasUnsavedChanges };
}
