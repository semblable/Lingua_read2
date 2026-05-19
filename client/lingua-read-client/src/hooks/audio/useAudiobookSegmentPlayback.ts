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

  const resetSegmentPlayback = useCallback(() => {
    segmentPlaybackRef.current = cancelSegmentPlayback();
  }, []);

  // Reset segment state on content-key change. Registered BEFORE the apply
  // effect so it runs first when both fire (e.g. on initial mount). Mirrors
  // the pre-split source order where the orchestrator's reset effect at line
  // 419 of the legacy hook preceded the segment-apply effect at line 525.
  useEffect(() => {
    segmentPlaybackRef.current = cancelSegmentPlayback();
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
    segmentPlaybackRef.current = nextState;

    userPositionIntentContentKeyRef.current = contentKey;
    audio.currentTime = nextState.startTime;
    setCurrentTime(nextState.startTime);
    requestAudioPlay('Segment playback failed', { forceIntent: Boolean(segmentPlaybackRequest.forcePlay) });
  }, [audioRef, contentKey, requestAudioPlay, resetSegmentPlayback, segmentPlaybackRequest, setCurrentTime, userPositionIntentContentKeyRef]);

  const handleSegmentBoundary = useCallback((currentTime: number): SegmentBoundaryOutcome => {
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
