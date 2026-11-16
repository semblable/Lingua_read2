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

  test('ignores pre-seek and quantization timestamps during manual Next navigation at higher playback speeds', () => {
    const setCurrentSegmentIndex = vi.fn();
    const srtLines = [
      { id: 1, startTime: 0, endTime: 2.5, text: 'First' },
      { id: 2, startTime: 2.5, endTime: 5.0, text: 'Second' },
      { id: 3, startTime: 5.0, endTime: 7.5, text: 'Third' },
    ];
    const { result, rerender } = renderHook(
      (props) => {
        const listRef = useRef(null);
        return useReaderAudioSync({ listRef, setCurrentSegmentIndex, ...props });
      },
      {
        initialProps: {
          isAudioLesson: true,
          isSentenceMode: true,
          isMobile: false,
          displayMode: 'audio',
          srtLines,
          currentSegmentIndex: 0
        }
      }
    );

    result.current.audioRef.current = { paused: false, seeking: false, currentTime: 2.0 };
    act(() => {
      result.current.handleAudioPlaybackStateChange(true);
      result.current.skipInitialAudioLessonSegmentPlaybackRef.current = false;
    });

    // User clicks Next: index advances 0 -> 1 before seek to 2.5s finishes.
    rerender({
      isAudioLesson: true,
      isSentenceMode: true,
      isMobile: false,
      displayMode: 'audio',
      srtLines,
      currentSegmentIndex: 1
    });

    // Stale pre-seek timeupdate inside cue 0 must NOT yank index back to 0.
    act(() => {
      result.current.handleAudioTimeUpdate(2.1);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();

    // MP3 frame quantization slightly before 2.5s must keep focus on cue 1.
    act(() => {
      result.current.handleAudioTimeUpdate(2.45);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();
    expect(result.current.currentSrtLineId).toBe(2);
  });

  test('ignores pre-seek timestamp from next cue when navigating Previous', () => {
    const setCurrentSegmentIndex = vi.fn();
    const srtLines = [
      { id: 1, startTime: 0, endTime: 2.5, text: 'First' },
      { id: 2, startTime: 2.5, endTime: 5.0, text: 'Second' },
    ];
    const { result, rerender } = renderHook(
      (props) => {
        const listRef = useRef(null);
        return useReaderAudioSync({ listRef, setCurrentSegmentIndex, ...props });
      },
      {
        initialProps: {
          isAudioLesson: true,
          isSentenceMode: true,
          isMobile: false,
          displayMode: 'audio',
          srtLines,
          currentSegmentIndex: 1
        }
      }
    );

    result.current.audioRef.current = { paused: false, seeking: false, currentTime: 2.54 };
    act(() => {
      result.current.handleAudioPlaybackStateChange(true);
      result.current.skipInitialAudioLessonSegmentPlaybackRef.current = false;
    });

    // User clicks Previous: 1 -> 0 while player is still at 2.54s in cue 1.
    rerender({
      isAudioLesson: true,
      isSentenceMode: true,
      isMobile: false,
      displayMode: 'audio',
      srtLines,
      currentSegmentIndex: 0
    });

    act(() => {
      result.current.handleAudioTimeUpdate(2.54);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();

    // Once seek settles inside cue 0, SRT highlight updates cleanly without yanking.
    act(() => {
      result.current.handleAudioTimeUpdate(0.1);
    });
    expect(result.current.currentSrtLineId).toBe(1);
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();
  });

  test('keeps segment focus when bounded segment playback stops at touching endTime boundary', () => {
    const setCurrentSegmentIndex = vi.fn();
    const srtLines = [
      { id: 1, startTime: 0, endTime: 2.5, text: 'First' },
      { id: 2, startTime: 2.5, endTime: 5.0, text: 'Second' },
    ];
    const { result, rerender } = renderHook(
      (props) => {
        const listRef = useRef(null);
        return useReaderAudioSync({ listRef, setCurrentSegmentIndex, ...props });
      },
      {
        initialProps: {
          isAudioLesson: true,
          isSentenceMode: true,
          isMobile: false,
          displayMode: 'audio',
          srtLines,
          currentSegmentIndex: 0
        }
      }
    );

    result.current.audioRef.current = { paused: false, seeking: false, currentTime: 0 };
    act(() => {
      result.current.skipInitialAudioLessonSegmentPlaybackRef.current = false;
      result.current.setSegmentPlaybackRequest({
        requestId: 'seg-0',
        startTime: 0,
        endTime: 2.5,
        repeatCount: 1,
        forcePlay: true
      });
    });

    rerender({
      isAudioLesson: true,
      isSentenceMode: true,
      isMobile: false,
      displayMode: 'audio',
      srtLines,
      currentSegmentIndex: 0
    });

    act(() => {
      result.current.handleAudioPlaybackStateChange(true);
      result.current.handleAudioTimeUpdate(1.2);
    });

    // Simulate bounded stop: player pauses and emits endTime = 2.5 (= line[1].startTime).
    result.current.audioRef.current.paused = true;
    act(() => {
      result.current.handleAudioTimeUpdate(2.5);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();
    expect(result.current.currentSrtLineId).toBe(1);
  });

  test('handleLineClick updates currentSegmentIndex even outside sentence mode', () => {
    const setCurrentSegmentIndex = vi.fn();
    const srtLines = [
      { id: 1, startTime: 0, endTime: 2.5, text: 'First' },
      { id: 2, startTime: 2.5, endTime: 5.0, text: 'Second' },
    ];
    const { result } = renderHook(() => {
      const listRef = useRef(null);
      return useReaderAudioSync({
        isAudioLesson: true,
        isSentenceMode: false,
        isMobile: false,
        displayMode: 'audio',
        srtLines,
        currentSegmentIndex: 0,
        setCurrentSegmentIndex,
        listRef
      });
    });

    result.current.audioRef.current = { currentTime: 0 };
    act(() => {
      result.current.handleLineClick(2.5);
    });

    expect(result.current.currentSrtLineId).toBe(2);
    expect(setCurrentSegmentIndex).toHaveBeenCalledWith(1);
  });

  test('replay audio ignores pre-seek end timestamps and early MP3 keyframe seeks without flashing previous cue', () => {
    const setCurrentSegmentIndex = vi.fn();
    const srtLines = [
      { id: 1, startTime: 0, endTime: 2.5, text: 'First' },
      { id: 2, startTime: 2.5, endTime: 5.0, text: 'Second' },
      { id: 3, startTime: 5.0, endTime: 7.5, text: 'Third' },
    ];
    const { result } = renderHook(() => {
      const listRef = useRef(null);
      return useReaderAudioSync({
        isAudioLesson: true,
        isSentenceMode: true,
        isMobile: false,
        displayMode: 'audio',
        srtLines,
        currentSegmentIndex: 1,
        setCurrentSegmentIndex,
        listRef
      });
    });

    result.current.audioRef.current = { paused: false, seeking: false, currentTime: 4.95 };
    act(() => {
      result.current.handleAudioPlaybackStateChange(true);
      result.current.handleAudioTimeUpdate(4.95);
    });
    setCurrentSegmentIndex.mockClear();

    // User clicks Replay Audio near the end of cue 1 (4.95s):
    // synchronous wrapper tracks target cue 1 before child effects run.
    act(() => {
      result.current.setSegmentPlaybackRequest({
        requestId: 'replay-1-test',
        startTime: 2.5,
        endTime: 5.0,
        repeatCount: 1,
        forcePlay: true
      });
      // Stale pre-seek ticks before rewind seek lands must neither revert nor skip ahead.
      result.current.handleAudioTimeUpdate(4.95);
      result.current.handleAudioTimeUpdate(5.02);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();

    // VBR MP3 keyframe seek landing up to 0.5s before cue start (2.20s < 2.50s) must NOT switch to cue 0.
    act(() => {
      result.current.handleAudioTimeUpdate(2.2);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();
    expect(result.current.currentSrtLineId).toBe(2);

    // Settling inside cue 1 keeps cue 1 active.
    act(() => {
      result.current.handleAudioTimeUpdate(2.6);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();
    expect(result.current.currentSrtLineId).toBe(2);

    // Once playback entered cue 1 (2.6s) without repeats, scrubbing backward below 2.5s switches cleanly to cue 0.
    act(() => {
      result.current.handleAudioTimeUpdate(2.2);
    });
    expect(setCurrentSegmentIndex).toHaveBeenCalledWith(0);
    expect(result.current.currentSrtLineId).toBe(1);
  });

  test('a paused backward scrub after the final repeat follows the preceding cue', () => {
    const setCurrentSegmentIndex = vi.fn();
    const { result } = renderAudioSyncHook({ isAudioLesson: true, isSentenceMode: true,
      currentSegmentIndex: 1, setCurrentSegmentIndex,
      srtLines: [{ id: 1, startTime: 0, endTime: 2.5 }, { id: 2, startTime: 2.5, endTime: 5 }] });
    const audio = { paused: false, seeking: false, currentTime: 4.8 };
    result.current.audioRef.current = audio;
    act(() => {
      result.current.handleAudioPlaybackStateChange(true);
      result.current.setSegmentPlaybackRequest({ requestId: 'replay-repeated', startTime: 2.5,
        endTime: 5, repeatCount: 2, forcePlay: true });
      result.current.handleAudioTimeUpdate(2.6);
      result.current.handleAudioTimeUpdate(4.85);
    });
    act(() => { result.current.handleAudioTimeUpdate(2.25); });
    expect(result.current.currentSrtLineId).toBe(2);
    act(() => {
      result.current.handleAudioTimeUpdate(2.6);
      result.current.handleAudioTimeUpdate(4.85);
    });
    audio.paused = true;
    act(() => { result.current.handleAudioPlaybackStateChange(false); });
    act(() => { result.current.handleAudioTimeUpdate(5); });
    expect(result.current.currentSrtLineId).toBe(2);
    setCurrentSegmentIndex.mockClear();
    audio.currentTime = 2.25;
    act(() => { result.current.handleAudioTimeUpdate(2.25); });
    expect(setCurrentSegmentIndex).toHaveBeenCalledWith(0);
    expect(result.current.currentSrtLineId).toBe(1);
  });

  test('replay audio supports repeatCount=2 loop-backs, short <=0.25s cues, and lesson switches clear manual target', () => {
    const setCurrentSegmentIndex = vi.fn();
    const srtLines = [
      { id: 1, startTime: 0, endTime: 2.5, text: 'First' },
      { id: 2, startTime: 2.5, endTime: 5.0, text: 'Second' },
    ];
    const { result, rerender } = renderHook(
      (props) => {
        const listRef = useRef(null);
        return useReaderAudioSync({ listRef, setCurrentSegmentIndex, ...props });
      },
      {
        initialProps: {
          isAudioLesson: true,
          isSentenceMode: true,
          isMobile: false,
          displayMode: 'audio',
          srtLines,
          currentSegmentIndex: 1
        }
      }
    );

    result.current.audioRef.current = { paused: false, seeking: false, currentTime: 4.8 };
    act(() => {
      result.current.handleAudioPlaybackStateChange(true);
      result.current.setSegmentPlaybackRequest({
        requestId: 'replay-1-loop',
        startTime: 2.5,
        endTime: 5.0,
        repeatCount: 2,
        forcePlay: true
      });
      result.current.handleAudioTimeUpdate(2.6);
      result.current.handleAudioTimeUpdate(4.85);
    });
    setCurrentSegmentIndex.mockClear();

    // RepeatCount=2 loop-back landing slightly before cue start (2.25s) must hold cue 1.
    act(() => {
      result.current.handleAudioTimeUpdate(2.25);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();
    expect(result.current.currentSrtLineId).toBe(2);

    // Clearing srtLines (e.g., navigating to a new lesson) drops stale manual target.
    rerender({
      isAudioLesson: true,
      isSentenceMode: true,
      isMobile: false,
      displayMode: 'audio',
      srtLines: [],
      currentSegmentIndex: 0
    });
    const newLessonLines = [
      { id: 10, startTime: 0, endTime: 0.2, text: 'Short' },
      { id: 11, startTime: 0.2, endTime: 0.4, text: 'Tiny' }
    ];
    rerender({
      isAudioLesson: true,
      isSentenceMode: true,
      isMobile: false,
      displayMode: 'audio',
      srtLines: newLessonLines,
      currentSegmentIndex: 1
    });

    // Simulate restored initialSeek position on audioRef without prior timeupdate, then Replay Audio on <=0.25s cue.
    result.current.audioRef.current = { paused: false, seeking: false, currentTime: 0.38 };
    act(() => {
      result.current.setSegmentPlaybackRequest({
        requestId: 'replay-1-short',
        startTime: 0.2,
        endTime: 0.4,
        repeatCount: 1,
        forcePlay: true
      });
      result.current.handleAudioTimeUpdate(0.39);
      result.current.handleAudioTimeUpdate(0.41);
    });
    expect(setCurrentSegmentIndex).not.toHaveBeenCalled();
  });
});
