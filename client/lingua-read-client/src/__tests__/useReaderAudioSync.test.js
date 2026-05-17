import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';

vi.mock('../utils/browserTts', () => ({
  cancelSpeech: vi.fn()
}));

import { cancelSpeech } from '../utils/browserTts';
import { useReaderAudioSync } from '../hooks/useReaderAudioSync';

const renderAudioSyncHook = (overrides = {}) => {
  let setCurrentSegmentIndex = vi.fn();
  return renderHook(
    (props) => {
      const listRef = useRef(null);
      return useReaderAudioSync({
        listRef,
        setCurrentSegmentIndex,
        ...props
      });
    },
    {
      initialProps: {
        isAudioLesson: false,
        isSentenceMode: false,
        isMobile: false,
        displayMode: 'audio',
        currentSegmentIndex: 0,
        ...overrides
      }
    }
  );
};

describe('useReaderAudioSync', () => {
  beforeEach(() => {
    cancelSpeech.mockReset();
  });

  test('returns the documented Use<Name>Result shape', () => {
    const { result } = renderAudioSyncHook();
    expect(result.current).toEqual(
      expect.objectContaining({
        audioRef: expect.any(Object),
        audioCurrentTimeRef: expect.any(Object),
        audioSrc: null,
        setAudioSrc: expect.any(Function),
        srtLines: [],
        setSrtLines: expect.any(Function),
        currentSrtLineId: null,
        setCurrentSrtLineId: expect.any(Function),
        isAudioPlaying: false,
        setIsAudioPlaying: expect.any(Function),
        isSpeakingSentence: false,
        setIsSpeakingSentence: expect.any(Function),
        isSpeakingWord: false,
        setIsSpeakingWord: expect.any(Function),
        segmentPlaybackRequest: null,
        setSegmentPlaybackRequest: expect.any(Function),
        audioDrivenSentenceSyncRef: expect.any(Object),
        lastAutoSegmentPlaybackKeyRef: expect.any(Object),
        skipInitialAudioLessonSegmentPlaybackRef: expect.any(Object),
        pendingSentenceCreditRef: expect.any(Object),
        setAudioPlaybackIntent: expect.any(Function),
        toggleAudioPlayback: expect.any(Function),
        pauseAudioPlayback: expect.any(Function),
        handleAudioPlaybackStateChange: expect.any(Function),
        handleLineClick: expect.any(Function),
        handleAudioTimeUpdate: expect.any(Function)
      })
    );
  });

  test('handleAudioPlaybackStateChange cancels speech when audio starts playing', () => {
    const { result } = renderAudioSyncHook();
    act(() => {
      result.current.setIsSpeakingSentence(true);
      result.current.setIsSpeakingWord(true);
    });
    act(() => {
      result.current.handleAudioPlaybackStateChange(true);
    });
    expect(cancelSpeech).toHaveBeenCalled();
    expect(result.current.isSpeakingSentence).toBe(false);
    expect(result.current.isSpeakingWord).toBe(false);
    expect(result.current.isAudioPlaying).toBe(true);
  });

  test('handleAudioPlaybackStateChange does NOT cancel speech when audio is pausing', () => {
    const { result } = renderAudioSyncHook();
    cancelSpeech.mockClear();
    act(() => {
      result.current.handleAudioPlaybackStateChange(false);
    });
    expect(cancelSpeech).not.toHaveBeenCalled();
    expect(result.current.isAudioPlaying).toBe(false);
  });

  test('toggleAudioPlayback plays a paused audio element and sets intent', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const { result } = renderAudioSyncHook();
    result.current.audioRef.current = { paused: true, play, pause };
    act(() => {
      result.current.toggleAudioPlayback();
    });
    expect(play).toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(result.current.audioRef.current.__lrAllowPlayback).toBe(true);
  });

  test('toggleAudioPlayback pauses a playing audio element', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const { result } = renderAudioSyncHook();
    result.current.audioRef.current = { paused: false, play, pause };
    act(() => {
      result.current.toggleAudioPlayback();
    });
    expect(pause).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(result.current.audioRef.current.__lrAllowPlayback).toBe(false);
  });

  test('pauseAudioPlayback is a no-op when already paused', () => {
    const pause = vi.fn();
    const { result } = renderAudioSyncHook();
    result.current.audioRef.current = { paused: true, pause };
    act(() => {
      result.current.pauseAudioPlayback();
    });
    expect(pause).not.toHaveBeenCalled();
  });

  test('cancels speech when sentence mode is exited', () => {
    const { result, rerender } = renderAudioSyncHook({ isSentenceMode: true });
    act(() => {
      result.current.setIsSpeakingSentence(true);
      result.current.setSegmentPlaybackRequest({ requestId: 'x', startTime: 0, endTime: 1, repeatCount: 1, forcePlay: true });
    });
    rerender({
      isAudioLesson: false,
      isSentenceMode: false,
      isMobile: false,
      displayMode: 'audio',
      currentSegmentIndex: 0
    });
    expect(cancelSpeech).toHaveBeenCalled();
    expect(result.current.isSpeakingSentence).toBe(false);
    expect(result.current.segmentPlaybackRequest).toBeNull();
  });

  test('cancels speech when currentSegmentIndex changes', () => {
    const { result, rerender } = renderAudioSyncHook({ currentSegmentIndex: 0 });
    act(() => {
      result.current.setIsSpeakingSentence(true);
    });
    cancelSpeech.mockClear();
    rerender({
      isAudioLesson: false,
      isSentenceMode: false,
      isMobile: false,
      displayMode: 'audio',
      currentSegmentIndex: 1
    });
    expect(cancelSpeech).toHaveBeenCalled();
    expect(result.current.isSpeakingSentence).toBe(false);
  });
});
