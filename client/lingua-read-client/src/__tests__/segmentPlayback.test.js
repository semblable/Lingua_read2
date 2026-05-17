import {
  createSegmentPlaybackState,
  cancelSegmentPlayback,
  applySegmentRequest,
  evaluateSegmentBoundary,
  isStaleSegmentRequest
} from '../audio/segmentPlayback';

describe('segmentPlayback', () => {
  describe('createSegmentPlaybackState', () => {
    test('returns an inactive baseline state', () => {
      expect(createSegmentPlaybackState()).toEqual({
        active: false,
        requestId: null,
        startTime: 0,
        endTime: 0,
        remainingRepeats: 0
      });
    });

    test('returns a new object each call', () => {
      expect(createSegmentPlaybackState()).not.toBe(createSegmentPlaybackState());
    });
  });

  describe('cancelSegmentPlayback', () => {
    test('produces the inactive baseline state', () => {
      expect(cancelSegmentPlayback()).toEqual(createSegmentPlaybackState());
    });
  });

  describe('applySegmentRequest', () => {
    test('marks state active and copies request fields', () => {
      const next = applySegmentRequest({
        requestId: 'segment-1',
        startTime: 5,
        endTime: 10,
        repeatCount: 2,
        forcePlay: true
      });
      expect(next).toEqual({
        active: true,
        requestId: 'segment-1',
        startTime: 5,
        endTime: 10,
        remainingRepeats: 2
      });
    });

    test('clamps negative startTime to 0', () => {
      const next = applySegmentRequest({
        requestId: 'r1', startTime: -3, endTime: 5, repeatCount: 1, forcePlay: false
      });
      expect(next.startTime).toBe(0);
    });

    test('clamps endTime below startTime to startTime', () => {
      const next = applySegmentRequest({
        requestId: 'r1', startTime: 10, endTime: 5, repeatCount: 1, forcePlay: false
      });
      expect(next.endTime).toBe(10);
    });

    test('clamps repeatCount to at least 1', () => {
      const next = applySegmentRequest({
        requestId: 'r1', startTime: 0, endTime: 5, repeatCount: 0, forcePlay: false
      });
      expect(next.remainingRepeats).toBe(1);
    });
  });

  describe('evaluateSegmentBoundary', () => {
    test('continue when state is inactive', () => {
      const state = createSegmentPlaybackState();
      expect(evaluateSegmentBoundary(state, 100)).toEqual({ action: 'continue', nextState: state });
    });

    test('continue when below the endTime - 0.05 boundary', () => {
      const state = applySegmentRequest({
        requestId: 'r', startTime: 5, endTime: 10, repeatCount: 1, forcePlay: false
      });
      const result = evaluateSegmentBoundary(state, 9.9);
      expect(result.action).toBe('continue');
      expect(result.nextState).toBe(state);
    });

    test('replay decrements remainingRepeats and returns seekTo=startTime', () => {
      const state = applySegmentRequest({
        requestId: 'r', startTime: 5, endTime: 10, repeatCount: 2, forcePlay: false
      });
      const result = evaluateSegmentBoundary(state, 10);
      expect(result.action).toBe('replay');
      expect(result.nextState.remainingRepeats).toBe(1);
      expect(result.nextState.active).toBe(true);
      expect(result.seekTo).toBe(5);
    });

    test('stop on the last repeat returns inactive nextState + seekTo=endTime', () => {
      const state = applySegmentRequest({
        requestId: 'r', startTime: 5, endTime: 10, repeatCount: 1, forcePlay: false
      });
      const result = evaluateSegmentBoundary(state, 10);
      expect(result.action).toBe('stop');
      expect(result.nextState).toEqual(createSegmentPlaybackState());
      expect(result.seekTo).toBe(10);
    });

    test('very short segment (< 0.1s) ends on first tick at startTime', () => {
      // startTime=5, endTime=5.05. Boundary = max(5.05 - 0.05, 5) = 5. So time=5 triggers end.
      const state = applySegmentRequest({
        requestId: 'short', startTime: 5, endTime: 5.05, repeatCount: 1, forcePlay: false
      });
      const result = evaluateSegmentBoundary(state, 5);
      expect(result.action).toBe('stop');
      expect(result.seekTo).toBe(5.05);
    });

    test('repeatCount=2 transitions: replay then stop', () => {
      let state = applySegmentRequest({
        requestId: 'r', startTime: 0, endTime: 4, repeatCount: 2, forcePlay: false
      });

      const first = evaluateSegmentBoundary(state, 4);
      expect(first.action).toBe('replay');
      state = first.nextState;

      const second = evaluateSegmentBoundary(state, 4);
      expect(second.action).toBe('stop');
    });
  });

  describe('isStaleSegmentRequest', () => {
    test('treats no incoming request as stale', () => {
      const state = createSegmentPlaybackState();
      expect(isStaleSegmentRequest(state, null)).toBe(true);
      expect(isStaleSegmentRequest(state, undefined)).toBe(true);
    });

    test('treats request without requestId as stale', () => {
      const state = createSegmentPlaybackState();
      expect(isStaleSegmentRequest(state, { startTime: 0, endTime: 5, repeatCount: 1, forcePlay: false })).toBe(true);
    });

    test('returns false when requestId matches current state', () => {
      const state = applySegmentRequest({
        requestId: 'match', startTime: 0, endTime: 5, repeatCount: 1, forcePlay: false
      });
      expect(isStaleSegmentRequest(state, {
        requestId: 'match', startTime: 0, endTime: 5, repeatCount: 1, forcePlay: false
      })).toBe(false);
    });

    test('returns true when requestId differs', () => {
      const state = applySegmentRequest({
        requestId: 'old', startTime: 0, endTime: 5, repeatCount: 1, forcePlay: false
      });
      expect(isStaleSegmentRequest(state, {
        requestId: 'new', startTime: 0, endTime: 5, repeatCount: 1, forcePlay: false
      })).toBe(true);
    });
  });
});
