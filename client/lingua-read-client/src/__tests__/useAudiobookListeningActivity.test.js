import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';

vi.mock('../utils/api', () => ({
  logListeningActivity: vi.fn().mockResolvedValue(undefined)
}));

import { logListeningActivity } from '../utils/api';
import { useAudiobookListeningActivity } from '../hooks/audio/useAudiobookListeningActivity';

const renderWithRefs = ({ effectiveLanguageId = 7, isPlayingValue = false, lifecycleSaveValue = false } = {}) => {
  const refs = { isPlayingRef: { current: isPlayingValue }, lifecycleSaveRef: { current: lifecycleSaveValue } };
  const { result, rerender } = renderHook(
    ({ langId, playing, lifecycle }) => {
      const isPlayingRef = useRef(playing);
      isPlayingRef.current = playing;
      const lifecycleSaveRef = useRef(lifecycle);
      lifecycleSaveRef.current = lifecycle;
      refs.isPlayingRef = isPlayingRef;
      refs.lifecycleSaveRef = lifecycleSaveRef;
      return useAudiobookListeningActivity({
        effectiveLanguageId: langId,
        isPlayingRef,
        lifecycleSaveRef
      });
    },
    { initialProps: { langId: effectiveLanguageId, playing: isPlayingValue, lifecycle: lifecycleSaveValue } }
  );
  return { result, rerender, refs };
};

describe('useAudiobookListeningActivity', () => {
  beforeEach(() => {
    logListeningActivity.mockReset().mockResolvedValue(undefined);
  });

  test('returns tracker ref, flush callback, and ref-to-callback', () => {
    const { result } = renderWithRefs();
    expect(result.current.listeningTrackerRef.current).toBeDefined();
    expect(typeof result.current.flushListeningActivity).toBe('function');
    expect(typeof result.current.flushListeningActivityRef.current).toBe('function');
  });

  test('setLanguageId effect propagates language id to tracker', () => {
    const { result, rerender } = renderWithRefs({ effectiveLanguageId: 1 });
    expect(result.current.listeningTrackerRef.current.getLanguageId()).toBe(1);

    rerender({ langId: 99, playing: false, lifecycle: false });
    expect(result.current.listeningTrackerRef.current.getLanguageId()).toBe(99);
  });

  test('flushListeningActivity with accrued seconds calls logListeningActivity', async () => {
    const { result } = renderWithRefs({ effectiveLanguageId: 5 });
    const tracker = result.current.listeningTrackerRef.current;

    // Inject 15 pending seconds directly without setting a checkpoint, so
    // prepareFlush doesn't accrue any wall-clock elapsed time.
    tracker.restorePending(15);

    await act(async () => {
      result.current.flushListeningActivity(true);
    });

    expect(logListeningActivity).toHaveBeenCalledWith(5, 15);
  });
});
