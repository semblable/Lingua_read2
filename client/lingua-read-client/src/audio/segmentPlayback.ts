// Sentence-segment playback state machine for the audiobook player. Pure
// data + transitions; the hook applies the resulting seek/play side effects
// to the audio element.

export type SegmentPlaybackRequest = {
  requestId: string;
  startTime: number;
  endTime: number;
  repeatCount: number;
  forcePlay: boolean;
};

export type SegmentPlaybackState = {
  active: boolean;
  requestId: string | number | null;
  startTime: number;
  endTime: number;
  remainingRepeats: number;
};

export const createSegmentPlaybackState = (): SegmentPlaybackState => ({
  active: false,
  requestId: null,
  startTime: 0,
  endTime: 0,
  remainingRepeats: 0
});

// cancelSegmentPlayback is an alias for the empty state, named for call-site
// clarity (we mean "stop, not just reset to defaults").
export const cancelSegmentPlayback = (): SegmentPlaybackState =>
  createSegmentPlaybackState();

// Apply a new segment request, producing the active state to seek/play from.
// Normalizes start/end ordering and clamps repeatCount to at least 1.
export const applySegmentRequest = (request: SegmentPlaybackRequest): SegmentPlaybackState => {
  const startTime = Math.max(0, request.startTime || 0);
  const endTime = Math.max(startTime, request.endTime || startTime);
  const repeatCount = Math.max(1, request.repeatCount || 1);

  return {
    active: true,
    requestId: request.requestId,
    startTime,
    endTime,
    remainingRepeats: repeatCount
  };
};

export type SegmentBoundaryAction =
  | { action: 'continue'; nextState: SegmentPlaybackState }
  | { action: 'replay'; nextState: SegmentPlaybackState; seekTo: number }
  | { action: 'stop'; nextState: SegmentPlaybackState; seekTo: number };

// Evaluate whether the current playback time has reached the segment boundary
// and return the next transition. The 0.05s slack mirrors the pre-extraction
// behavior so very short segments (< 0.1s) reach their end on the first tick.
export const evaluateSegmentBoundary = (
  state: SegmentPlaybackState,
  currentTime: number
): SegmentBoundaryAction => {
  if (!state.active) {
    return { action: 'continue', nextState: state };
  }

  const boundary = Math.max(state.endTime - 0.05, state.startTime);
  if (currentTime < boundary) {
    return { action: 'continue', nextState: state };
  }

  if (state.remainingRepeats > 1) {
    return {
      action: 'replay',
      nextState: {
        ...state,
        remainingRepeats: state.remainingRepeats - 1
      },
      seekTo: state.startTime
    };
  }

  return {
    action: 'stop',
    nextState: createSegmentPlaybackState(),
    seekTo: state.endTime
  };
};

// True when an incoming segment request introduces a new requestId distinct
// from whatever the player is currently honoring. Used by the source-swap
// effect to decide whether to reset segment state on track change.
export const isStaleSegmentRequest = (
  state: SegmentPlaybackState,
  request: SegmentPlaybackRequest | null | undefined
): boolean => {
  if (!request?.requestId) return true;
  return state.requestId !== request.requestId;
};
