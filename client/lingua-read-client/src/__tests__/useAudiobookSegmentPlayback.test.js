import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';

import { useAudiobookSegmentPlayback } from '../hooks/audio/useAudiobookSegmentPlayback';

// A single audio element + shared spies so subsequent renders don't replace
// the references that the segment-apply effect captured.
const setup = () => {
  const audio = { paused: false, currentTime: 0, pause: vi.fn(), play: vi.fn() };
  const requestAudioPlay = vi.fn();

  const renderWithProps = (initial = {}) => {
    const ctx = {};
    const { result, rerender } = renderHook(
      ({ contentKey, request }) => {
        const audioRef = useRef(audio);
        const userPositionIntentContentKeyRef = useRef('');
        ctx.userPositionIntentContentKeyRef = userPositionIntentContentKeyRef;
        const [, setCurrentTime] = useState(0);
        return useAudiobookSegmentPlayback({
          audioRef,
          contentKey,
          segmentPlaybackRequest: request,
          requestAudioPlay,
          userPositionIntentContentKeyRef,
          setCurrentTime
        });
      },
      { initialProps: { contentKey: 'lesson:1', request: null, ...initial } }
    );
    return { result, rerender, ctx };
  };

  return { audio, requestAudioPlay, renderWithProps };
};

describe('useAudiobookSegmentPlayback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('handleSegmentBoundary returns continue when no segment is active', () => {
    const { renderWithProps } = setup();
    const { result } = renderWithProps();
    expect(result.current.handleSegmentBoundary(5)).toEqual({ action: 'continue' });
  });

  test('applying a new segment seeks and asks audio to play', () => {
    const { audio, requestAudioPlay, renderWithProps } = setup();
    const { rerender, ctx } = renderWithProps();

    act(() => {
      rerender({
        contentKey: 'lesson:1',
        request: { requestId: 'r1', startTime: 5, endTime: 10, repeatCount: 1, forcePlay: true }
      });
    });

    expect(audio.currentTime).toBe(5);
    expect(requestAudioPlay).toHaveBeenCalledWith('Segment playback failed', { forceIntent: true });
    expect(ctx.userPositionIntentContentKeyRef.current).toBe('lesson:1');
  });

  test('handleSegmentBoundary returns stop at endTime with repeatCount=1', () => {
    const { renderWithProps } = setup();
    const { result, rerender } = renderWithProps();

    act(() => {
      rerender({
        contentKey: 'lesson:1',
        request: { requestId: 'r2', startTime: 2, endTime: 4, repeatCount: 1, forcePlay: false }
      });
    });

    // Boundary slack of 0.05s in evaluateSegmentBoundary means time >= 3.95 triggers stop.
    expect(result.current.handleSegmentBoundary(4)).toEqual({ action: 'stop', seekTo: 4 });
    // After stop, the ref is reset so subsequent calls return continue.
    expect(result.current.handleSegmentBoundary(4)).toEqual({ action: 'continue' });
  });
});
