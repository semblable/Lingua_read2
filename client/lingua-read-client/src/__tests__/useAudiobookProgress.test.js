import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';

vi.mock('../utils/api', () => ({
  getAudiobookProgress: vi.fn(),
  updateAudiobookProgress: vi.fn(),
  getAudioLessonProgress: vi.fn(),
  updateAudioLessonProgress: vi.fn()
}));

import {
  getAudiobookProgress,
  getAudioLessonProgress,
  updateAudioLessonProgress
} from '../utils/api';
import { useAudiobookProgress } from '../hooks/audio/useAudiobookProgress';
import { createListeningActivityTracker } from '../audio/listeningActivity';

const baseTrack = { trackId: 'lesson-audio', title: 'Lesson Audio', url: 'https://example.com/x.mp3', isLesson: true };

const renderProgress = (overrides = {}) => {
  const ctx = {};
  const { result } = renderHook(() => {
    const fakeAudio = useRef({ currentTime: 0, paused: false, readyState: 0 });
    const audioRef = fakeAudio;
    const latestAudioElementRef = useRef(fakeAudio.current);
    const lifecycleSaveRef = useRef(false);
    const flushListeningActivityRef = useRef(null);
    const listeningTrackerRef = useRef(createListeningActivityTracker());

    const initial = {
      isBookMode: false,
      book: null,
      textId: 42,
      contentKey: 'lesson:42:https://example.com/x.mp3',
      positionStorageKey: 'audioPos:lesson:42',
      sourceTracks: [baseTrack],
      currentTrackIndex: 0,
      isPlaying: false,
      isInitialized: true,
      ...overrides
    };

    const [currentTrackIndex, setCurrentTrackIndex] = useState(initial.currentTrackIndex);
    const [, setCurrentTime] = useState(0);
    const [isInitialized, setIsInitialized] = useState(initial.isInitialized);
    const [, setIsLoading] = useState(false);

    const latestPlaybackStateRef = useRef({
      isBookMode: initial.isBookMode,
      bookId: initial.book?.bookId ?? null,
      textId: initial.textId,
      currentTrackIndex,
      playlist: initial.sourceTracks,
      isInitialized,
      isPlaying: initial.isPlaying
    });

    ctx.audioRef = audioRef;
    ctx.lifecycleSaveRef = lifecycleSaveRef;
    ctx.latestPlaybackStateRef = latestPlaybackStateRef;

    return useAudiobookProgress({
      isBookMode: initial.isBookMode,
      book: initial.book,
      textId: initial.textId,
      contentKey: initial.contentKey,
      positionStorageKey: initial.positionStorageKey,
      sourceTracks: initial.sourceTracks,
      audioRef,
      latestAudioElementRef,
      latestPlaybackStateRef,
      lifecycleSaveRef,
      isPlaying: initial.isPlaying,
      isInitialized,
      currentTrackIndex,
      flushListeningActivityRef,
      listeningTrackerRef,
      setCurrentTrackIndex,
      setCurrentTime,
      setIsInitialized,
      setIsLoading
    });
  });
  return { result, ctx };
};

describe('useAudiobookProgress', () => {
  beforeEach(() => {
    getAudiobookProgress.mockReset().mockResolvedValue(null);
    getAudioLessonProgress.mockReset().mockResolvedValue(null);
    updateAudioLessonProgress.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test('exposes saveProgress, queueInitialSeek, and content-key tracking refs', () => {
    const { result } = renderProgress();
    expect(typeof result.current.saveProgress).toBe('function');
    expect(typeof result.current.queueInitialSeek).toBe('function');
    expect(typeof result.current.applyInitialSeekIfReady).toBe('function');
    expect(result.current.restoredContentKeyRef).toBeDefined();
    expect(result.current.playbackStartedContentKeyRef).toBeDefined();
    expect(result.current.userPositionIntentContentKeyRef).toBeDefined();
  });

  test('initial-progress load calls the lesson API when isBookMode=false', async () => {
    getAudioLessonProgress.mockResolvedValue({ currentPosition: 42, updatedAt: new Date().toISOString() });
    renderProgress();
    await waitFor(() => expect(getAudioLessonProgress).toHaveBeenCalledWith(42));
    expect(getAudiobookProgress).not.toHaveBeenCalled();
  });

  test('saveProgress(true) writes to localStorage and calls update API', async () => {
    const { result, ctx } = renderProgress();
    ctx.audioRef.current.currentTime = 25;
    ctx.audioRef.current.paused = false;
    ctx.latestPlaybackStateRef.current.isPlaying = true;

    await act(async () => {
      await result.current.saveProgress(true);
    });

    expect(updateAudioLessonProgress).toHaveBeenCalledWith(
      42,
      { currentPosition: 25 },
      expect.objectContaining({ keepalive: false })
    );
    const stored = JSON.parse(localStorage.getItem('audioPos:lesson:42'));
    expect(stored).toMatchObject({ position: 25, trackId: 'lesson-audio' });
  });
});
