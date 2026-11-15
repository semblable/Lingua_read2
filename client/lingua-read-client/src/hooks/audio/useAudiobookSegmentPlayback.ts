import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import {
  applySegmentRequest,
  cancelSegmentPlayback,
  createSegmentPlaybackState,
  evaluateSegmentBoundary,
  type SegmentPlaybackRequest,
  type SegmentPlaybackState
} from '../../audio/segmentPlayback';
import type { AudioElementRef } from '../useAudiobookPlayer';

export type SegmentBoundaryOutcome =
  | { action: 'continue' }
  | { action: 'replay'; seekTo: number }
  | { action: 'stop'; seekTo: number };

export type UseAudiobookSegmentPlaybackArgs = {
  audioRef: AudioElementRef;
  contentKey: string;
  segmentPlaybackRequest: SegmentPlaybackRequest | null | undefined;
  requestAudioPlay: (context: string, options?: { forceIntent?: boolean }) => void;
  userPositionIntentContentKeyRef: React.MutableRefObject<string>;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
};

export type UseAudiobookSegmentPlaybackResult = {
  segmentPlaybackRef: React.MutableRefObject<SegmentPlaybackState>;
  resetSegmentPlayback: () => void;
  handleSegmentBoundary: (currentTime: number) => SegmentBoundaryOutcome;
};

export const useAudiobookSegmentPlayback = ({
  audioRef,
  contentKey,
  segmentPlaybackRequest,
  requestAudioPlay,
  userPositionIntentContentKeyRef,
  setCurrentTime
}: UseAudiobookSegmentPlaybackArgs): UseAudiobookSegmentPlaybackResult => {
  const segmentPlaybackRef = useRef<SegmentPlaybackState>(createSegmentPlaybackState());
  const pendingRewindRef = useRef<{
    startTime: number;
    rewindMargin: number;
    fromTime: number;
    setAt: number;
  } | null>(null);

  const resetSegmentPlayback = useCallback(() => {
    segmentPlaybackRef.current = cancelSegmentPlayback();
    pendingRewindRef.current = null;
  }, []);

  // Reset segment state on content-key change. Registered BEFORE the apply
  // effect so it runs first when both fire (e.g. on initial mount). Mirrors
  // the pre-split source order where the orchestrator's reset effect at line
  // 419 of the legacy hook preceded the segment-apply effect at line 525.
  useEffect(() => {
    segmentPlaybackRef.current = cancelSegmentPlayback();
    pendingRewindRef.current = null;
  }, [contentKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!segmentPlaybackRequest?.requestId) {
      if (segmentPlaybackRef.current.active) {
        resetSegmentPlayback();
        audio.pause();
      }
      return;
    }

    if (segmentPlaybackRef.current.requestId === segmentPlaybackRequest.requestId) return;

    const nextState = applySegmentRequest(segmentPlaybackRequest);
    const prevTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const cueDuration = Math.max(0, nextState.endTime - nextState.startTime);
    const rewindMargin = Math.min(0.25, Math.max(0.05, cueDuration * 0.25));
    pendingRewindRef.current =
      prevTime > nextState.startTime + rewindMargin
        ? {
            startTime: nextState.startTime,
            rewindMargin,
            fromTime: prevTime,
            setAt: Date.now()
          }
        : null;
    segmentPlaybackRef.current = nextState;

    userPositionIntentContentKeyRef.current = contentKey;
    audio.currentTime = nextState.startTime;
    setCurrentTime(nextState.startTime);
    requestAudioPlay('Segment playback failed', { forceIntent: Boolean(segmentPlaybackRequest.forcePlay) });
  }, [audioRef, contentKey, requestAudioPlay, resetSegmentPlayback, segmentPlaybackRequest, setCurrentTime, userPositionIntentContentKeyRef]);

  const handleSegmentBoundary = useCallback((currentTime: number): SegmentBoundaryOutcome => {
    const pendingRewind = pendingRewindRef.current;
    if (pendingRewind) {
      if (
        currentTime <= pendingRewind.startTime + pendingRewind.rewindMargin ||
        currentTime < pendingRewind.fromTime - 0.15
      ) {
        pendingRewindRef.current = null;
      } else if (Date.now() - pendingRewind.setAt < 350) {
        return { action: 'continue' };
      } else {
        pendingRewindRef.current = null;
      }
    }

    const boundary = evaluateSegmentBoundary(segmentPlaybackRef.current, currentTime);
    if (boundary.action === 'continue') {
      return { action: 'continue' };
    }
    segmentPlaybackRef.current = boundary.nextState;
    return { action: boundary.action, seekTo: boundary.seekTo };
  }, []);

  return {
    segmentPlaybackRef,
    resetSegmentPlayback,
    handleSegmentBoundary
  };
};
