import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import {
  createListeningActivityTracker,
  type ListeningActivityTracker
} from '../../audio/listeningActivity';
import { isLifecycleNetworkError } from '../../audio/mediaSrc';
import { logListeningActivity } from '../../utils/api';

export type UseAudiobookListeningActivityArgs = {
  effectiveLanguageId: number | string | null | undefined;
  isPlayingRef: React.MutableRefObject<boolean>;
  lifecycleSaveRef: React.MutableRefObject<boolean>;
};

export type UseAudiobookListeningActivityResult = {
  listeningTrackerRef: React.MutableRefObject<ListeningActivityTracker>;
  flushListeningActivity: (force?: boolean) => void;
  flushListeningActivityRef: React.MutableRefObject<((force?: boolean) => void) | null>;
};

export const useAudiobookListeningActivity = ({
  effectiveLanguageId,
  isPlayingRef,
  lifecycleSaveRef
}: UseAudiobookListeningActivityArgs): UseAudiobookListeningActivityResult => {
  const listeningTrackerRef = useRef<ListeningActivityTracker>(
    createListeningActivityTracker()
  );
  const flushListeningActivityRef = useRef<((force?: boolean) => void) | null>(null);

  useEffect(() => {
    listeningTrackerRef.current.setLanguageId(effectiveLanguageId ?? null);
  }, [effectiveLanguageId]);

  const flushListeningActivity = useCallback((force = false) => {
    const tracker = listeningTrackerRef.current;
    const payload = tracker.prepareFlush(Date.now(), force, isPlayingRef.current);
    if (!payload) return;

    const isLifecycleFlush = lifecycleSaveRef.current || (typeof document !== 'undefined' && document.hidden);
    const logPromise = isLifecycleFlush
      ? logListeningActivity(payload.languageId, payload.durationSeconds, { keepalive: true })
      : logListeningActivity(payload.languageId, payload.durationSeconds);
    Promise.resolve(logPromise).catch((e: unknown) => {
      if (isLifecycleFlush && isLifecycleNetworkError(e)) {
        console.debug('[AudioPlayer] Ignoring page-lifecycle listening flush interruption.', e);
        return;
      }
      tracker.restorePending(payload.durationSeconds);
      console.error('Log listening activity failed', e);
    });
  }, [isPlayingRef, lifecycleSaveRef]);

  useEffect(() => {
    flushListeningActivityRef.current = flushListeningActivity;
  }, [flushListeningActivity]);

  return {
    listeningTrackerRef,
    flushListeningActivity,
    flushListeningActivityRef
  };
};
