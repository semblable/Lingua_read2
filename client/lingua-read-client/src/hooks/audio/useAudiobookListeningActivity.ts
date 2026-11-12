import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import {
  createListeningActivityTracker,
  type ListeningActivityTracker
} from '../../audio/listeningActivity';
import { isLifecycleNetworkError } from '../../audio/mediaSrc';
import { logListeningActivity } from '../../utils/api';
import type { AudioElementRef } from '../useAudiobookPlayer';

export type UseAudiobookListeningActivityArgs = {
  effectiveLanguageId: number | string | null | undefined;
  isPlayingRef: React.MutableRefObject<boolean>;
  lifecycleSaveRef: React.MutableRefObject<boolean>;
  audioRef?: AudioElementRef;
  textId?: number | string | null;
  sourceRevision?: string;
};

export type UseAudiobookListeningActivityResult = {
  listeningTrackerRef: React.MutableRefObject<ListeningActivityTracker>;
  flushListeningActivity: (force?: boolean) => void;
  flushListeningActivityRef: React.MutableRefObject<((force?: boolean) => void) | null>;
};

export const useAudiobookListeningActivity = ({
  effectiveLanguageId,
  isPlayingRef,
  lifecycleSaveRef,
  audioRef,
  textId,
  sourceRevision
}: UseAudiobookListeningActivityArgs): UseAudiobookListeningActivityResult => {
  const listeningTrackerRef = useRef<ListeningActivityTracker>(
    createListeningActivityTracker()
  );
  const flushListeningActivityRef = useRef<((force?: boolean) => void) | null>(null);

  const flushListeningActivity = useCallback((force = false) => {
    const tracker = listeningTrackerRef.current;
    const audio = audioRef?.current;
    if (audio && !audio.seeking) tracker.samplePlayback(audio.currentTime, audio.duration);
    const payload = tracker.prepareFlush(Date.now(), force, isPlayingRef.current);
    if (!payload) return;

    const isLifecycleFlush = lifecycleSaveRef.current || (typeof document !== 'undefined' && document.hidden);
    const logPromise = payload.lesson
      ? logListeningActivity(payload.languageId, payload.durationSeconds, isLifecycleFlush ? { keepalive: true } : {}, payload.lesson)
      : isLifecycleFlush
      ? logListeningActivity(payload.languageId, payload.durationSeconds, { keepalive: true })
      : logListeningActivity(payload.languageId, payload.durationSeconds);
    Promise.resolve(logPromise).catch((e: unknown) => {
      if (isLifecycleFlush && isLifecycleNetworkError(e)) {
        console.debug('[AudioPlayer] Ignoring page-lifecycle listening flush interruption.', e);
        return;
      }
      tracker.restorePending(payload.durationSeconds);
      if (payload.lesson) tracker.restoreLesson(payload.lesson);
      console.error('Log listening activity failed', e);
    });
  }, [audioRef, isPlayingRef, lifecycleSaveRef]);

  useEffect(() => {
    const tracker = listeningTrackerRef.current;
    tracker.setLanguageId(effectiveLanguageId ?? null);
    tracker.setLesson(textId && sourceRevision ? { textId, sourceRevision } : null);
    const audio = audioRef?.current;
    // A transcript revision or lesson change can reuse the already-playing
    // audio file, so there may be no new `playing` event to arm this context.
    if (isPlayingRef.current && audio && !audio.paused && !audio.seeking && audio.readyState >= audio.HAVE_FUTURE_DATA) {
      tracker.markPlaying();
      tracker.ensureCheckpoint(Date.now());
      tracker.startPlayback(audio.currentTime);
    }
    return () => {
      flushListeningActivity(true);
      tracker.clearCheckpoint();
      tracker.stopPlayback();
    };
  }, [effectiveLanguageId, textId, sourceRevision, flushListeningActivity, audioRef, isPlayingRef]);

  useEffect(() => {
    flushListeningActivityRef.current = flushListeningActivity;
  }, [flushListeningActivity]);

  return {
    listeningTrackerRef,
    flushListeningActivity,
    flushListeningActivityRef
  };
};
