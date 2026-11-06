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
        srtLines: [],
        currentSegmentIndex: 0,
        ...overrides
      }
    }
  );
};

describe('useReaderAudioSync', () => {
  test('follows playback in sentence mode with text display selected', () => {
    const setCurrentSegmentIndex = vi.fn();
    const { result } = renderAudioSyncHook({ isAudioLesson: true, isSentenceMode: true,
      displayMode: 'text', setCurrentSegmentIndex,
      srtLines: [{ id: 1, startTime: 0, endTime: 1 }, { id: 2, startTime: 1, endTime: 2 }] });
    act(() => result.current.handleAudioTimeUpdate(1.5));
    expect(setCurrentSegmentIndex).toHaveBeenCalledWith(1);
    expect(result.current.currentSrtLineId).toBe(2);
  });
  beforeEach(() => {
    cancelSpeech.mockReset();
  });

  test('returns the documented Use<Name>Result shape', () => {
    const { result } = renderAudioSyncHook();
    expect(result.current).toEqual(
      expect.objectContaining({
        audioRef: expect.any(Object),
        audioCurrentTimeRef: expect.any(Object),
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
      srtLines: [],
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
      srtLines: [],
      currentSegmentIndex: 1
    });
    expect(cancelSpeech).toHaveBeenCalled();
    expect(result.current.isSpeakingSentence).toBe(false);
  });

  test.each([350, 480])('mobile playback centres cues outside a small middle band (top=%s)', top => {
    const cue = document.createElement('span');
    cue.id = 'srt-line-1';
    cue.scrollIntoView = vi.fn();
    document.body.appendChild(cue);
    const position = vi.spyOn(cue, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 300, 40));
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1; });
    try {
      const { result } = renderAudioSyncHook({ isAudioLesson: true, isMobile: true,
        srtLines: [{ id: 1, startTime: 0, endTime: 2, text: 'A phrase' }] });
      act(() => { result.current.handleAudioTimeUpdate(1); });
      if (top === 350) expect(cue.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
      else expect(cue.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      position.mockRestore();
      height.mockRestore();
      raf.mockRestore();
      cue.remove();
    }
  });

  test('following playback does not scroll away from an active transcript selection', () => {
    const container = document.createElement('div');
    container.className = 'audio-transcript-container';
    const cue = document.createElement('span');
    cue.id = 'srt-line-1';
    cue.textContent = 'Selected phrase';
    cue.scrollIntoView = vi.fn();
    container.appendChild(cue);
    document.body.appendChild(container);
    const selection = vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: cue.firstChild });
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1; });
    try {
      const { result } = renderAudioSyncHook({ isAudioLesson: true, isMobile: true,
        srtLines: [{ id: 1, startTime: 0, endTime: 2, text: 'Selected phrase' }] });
      act(() => { result.current.handleAudioTimeUpdate(1); });
      expect(result.current.currentSrtLineId).toBe(1);
      expect(cue.scrollIntoView).not.toHaveBeenCalled();
    } finally {
      selection.mockRestore();
      raf.mockRestore();
      container.remove();
    }
  });
});
