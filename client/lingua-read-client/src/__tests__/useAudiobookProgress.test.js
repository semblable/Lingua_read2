import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';

vi.mock('../utils/api', () => ({
  getAudiobookProgress: vi.fn(),
  updateAudiobookProgress: vi.fn(),
  getAudioLessonProgress: vi.fn(),
  updateAudioLessonProgress: vi.fn(),
  logListeningActivity: vi.fn()
}));

import {
  getAudiobookProgress,
  getAudioLessonProgress,
  updateAudioLessonProgress,
  updateAudiobookProgress,
  logListeningActivity
} from '../utils/api';
import { useAudiobookProgress } from '../hooks/audio/useAudiobookProgress';
import { useAudiobookPlayer } from '../hooks/useAudiobookPlayer';
import { createListeningActivityTracker } from '../audio/listeningActivity';
import { setAudioPlaybackIntent } from '../audio/mediaSrc';

const baseTrack = { trackId: 'lesson-audio', title: 'Lesson Audio', url: 'https://example.com/x.mp3', isLesson: true };
const bookTracks = [
  { trackId: 71, title: 'Part 1', filePath: 'https://example.com/one.mp3' },
  { trackId: 72, title: 'Part 2', filePath: 'https://example.com/two.mp3' }
];
const modes = [
  { name: 'lesson', overrides: {}, get: getAudioLessonProgress, update: updateAudioLessonProgress,
    storageKey: 'audioPos:lesson:42', progress: (position, updatedAt) => ({ currentPosition: position, updatedAt }) },
  { name: 'book', overrides: { isBookMode: true, book: { bookId: 17, audiobookTracks: bookTracks },
    textId: null, contentKey: 'book:17', positionStorageKey: 'audioPos:book:17', sourceTracks: bookTracks },
    get: getAudiobookProgress, update: updateAudiobookProgress, storageKey: 'audioPos:book:17',
    progress: (position, updatedAt, trackId = 71) => ({ currentAudiobookTrackId: trackId, currentAudiobookPosition: position, updatedAt }) }
];

const renderProgress = (overrides = {}) => {
  const ctx = {};
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
  const view = renderHook(({ isPlaying }) => {
    const fakeAudio = useRef({ currentTime: 0, paused: false, readyState: 0 });
    const audioRef = fakeAudio;
    const latestAudioElementRef = useRef(fakeAudio.current);
    const lifecycleSaveRef = useRef(false);
    const flushListeningActivityRef = useRef(null);
    const listeningTrackerRef = useRef(createListeningActivityTracker());

    const [currentTrackIndex, setCurrentTrackIndex] = useState(initial.currentTrackIndex);
    const [currentTime, setCurrentTime] = useState(0);
    const [isInitialized, setIsInitialized] = useState(initial.isInitialized);
    const [, setIsLoading] = useState(false);

    const latestPlaybackStateRef = useRef(null);
    latestPlaybackStateRef.current = {
      isBookMode: initial.isBookMode,
      bookId: initial.book?.bookId ?? null,
      textId: initial.textId,
      currentTrackIndex,
      playlist: initial.sourceTracks,
      isInitialized,
      isPlaying
    };

    ctx.audioRef = audioRef;
    ctx.contentKey = initial.contentKey;
    ctx.lifecycleSaveRef = lifecycleSaveRef;
    ctx.latestPlaybackStateRef = latestPlaybackStateRef;
    ctx.currentTrackIndex = currentTrackIndex;
    ctx.currentTime = currentTime;

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
      isPlaying,
      isInitialized,
      currentTrackIndex,
      flushListeningActivityRef,
      listeningTrackerRef,
      setCurrentTrackIndex,
      setCurrentTime,
      setIsInitialized,
      setIsLoading
    });
  }, { initialProps: { isPlaying: initial.isPlaying } });
  return { ...view, ctx };
};

describe('useAudiobookProgress', () => {
  beforeEach(() => {
    getAudiobookProgress.mockReset().mockResolvedValue(null);
    getAudioLessonProgress.mockReset().mockResolvedValue(null);
    updateAudioLessonProgress.mockReset().mockResolvedValue(undefined);
    updateAudiobookProgress.mockReset().mockResolvedValue(undefined);
    logListeningActivity.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  test('a forced lifecycle save does not reset an untouched player to zero', async () => {
    const { result, ctx } = renderProgress();
    await act(async () => {});
    ctx.audioRef.current.paused = true;
    ctx.lifecycleSaveRef.current = true;
    // Intent from a different lesson must not authorize this player's reset.
    result.current.playbackStartedContentKeyRef.current = 'lesson:previous';
    result.current.userPositionIntentContentKeyRef.current = 'lesson:previous';

    await act(async () => { await result.current.saveProgress(true); });

    expect(updateAudioLessonProgress).not.toHaveBeenCalled();
    expect(localStorage.getItem('audioPos:lesson:42')).toBeNull();
  });

  test.each(['playbackStartedContentKeyRef', 'userPositionIntentContentKeyRef'])(
    'preserves a zero-position save authorized by %s', async intentRef => {
      const { result, ctx } = renderProgress();
      await act(async () => {});
      ctx.audioRef.current.paused = true;
      result.current[intentRef].current = ctx.contentKey;

      await act(async () => { await result.current.saveProgress(true); });

      expect(updateAudioLessonProgress).toHaveBeenCalledWith(
        42, { currentPosition: 0 }, expect.objectContaining({ keepalive: false })
      );
      expect(JSON.parse(localStorage.getItem('audioPos:lesson:42')).position).toBe(0);
    }
  );

  test.each(modes)('$name: records a local save timestamp before the PUT completes', async mode => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    const { result, ctx } = renderProgress(mode.overrides);
    await act(async () => {});
    ctx.audioRef.current.currentTime = 25;
    let resolveSave;
    mode.update.mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve; }));
    let save;
    act(() => { save = result.current.saveProgress(true); });
    expect(result.current.lastServerUpdateRef.current).toBe(Date.now());
    const startedAt = Date.now();
    vi.setSystemTime(startedAt + 1000);
    await act(async () => { resolveSave(); await save; });
    expect(result.current.lastServerUpdateRef.current).toBe(startedAt);
  });

  test.each(modes)('$name: a pause GET overtaking the PUT cannot rewind or switch the active bookmark', async mode => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    const { result, ctx, rerender } = renderProgress(mode.overrides);
    await act(async () => {});
    ctx.audioRef.current.readyState = 1;
    ctx.audioRef.current.currentTime = 10;
    await act(async () => { rerender({ isPlaying: true }); });
    vi.setSystemTime(Date.now() + 20000);
    ctx.audioRef.current.currentTime = 60;
    ctx.audioRef.current.paused = true;
    let resolvePoll;
    mode.get.mockReturnValueOnce(new Promise(resolve => { resolvePoll = resolve; }));
    await act(async () => { rerender({ isPlaying: false }); });
    let resolveSave;
    mode.update.mockClear().mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve; }));
    let save;
    act(() => { save = result.current.saveProgress(true); });
    // Even a remote clock ahead of this client must not override local playback.
    await act(async () => { resolvePoll(mode.progress(5, new Date(Date.now() + 5000).toISOString(), 72)); });
    expect(ctx.audioRef.current.currentTime).toBe(60);
    expect(ctx.currentTrackIndex).toBe(0);
    expect(result.current.initialSeekRef.current).toBeNull();
    expect(mode.update).toHaveBeenCalledTimes(1);
    expect(mode.update.mock.calls[0][1]).toEqual(mode.name === 'book'
      ? { currentAudiobookTrackId: 71, currentAudiobookPosition: 60 }
      : { currentPosition: 60 });
    await act(async () => { resolveSave(); await save; });
  });

  test.each(modes)('$name: still accepts newer remote progress before local playback or seeking', async mode => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    mode.get.mockResolvedValue(mode.progress(10, new Date().toISOString()));
    const { result, ctx } = renderProgress(mode.overrides);
    await act(async () => {});
    ctx.audioRef.current.readyState = 1;
    act(() => { result.current.applyInitialSeekIfReady(ctx.audioRef.current); });
    mode.get.mockResolvedValue(mode.progress(30, new Date(Date.now() + 10000).toISOString(), 72));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    // A track switch waits for the target track's metadata.
    act(() => { result.current.applyInitialSeekIfReady(ctx.audioRef.current); });
    expect(ctx.audioRef.current.currentTime).toBe(30);
    expect(ctx.currentTrackIndex).toBe(mode.name === 'book' ? 1 : 0);
  });

  test.each(modes)('$name: a newer server zero outranks an old nonzero local fallback', async mode => {
    const now = Date.now();
    mode.get.mockResolvedValue(mode.progress(0, new Date(now).toISOString(), 72));
    localStorage.setItem(mode.storageKey, JSON.stringify({ position: 90, trackId: 71, timestamp: now - 10000 }));
    const { result, ctx } = renderProgress(mode.overrides);
    await act(async () => {});
    expect(result.current.initialSeekRef.current).toBeNull();
    expect(ctx.currentTime).toBe(0);
    expect(ctx.currentTrackIndex).toBe(mode.name === 'book' ? 1 : 0);
  });

  test.each(modes)('$name: an intentional rewind replaces the local fallback and survives a stale server reload', async mode => {
    const now = Date.now();
    const { result, ctx, unmount } = renderProgress(mode.overrides);
    await act(async () => {});
    localStorage.setItem(mode.storageKey, JSON.stringify({ position: 90, trackId: 71, timestamp: now - 10000 }));
    result.current.userPositionIntentContentKeyRef.current = ctx.contentKey;
    ctx.audioRef.current.currentTime = 0;
    ctx.audioRef.current.paused = true;
    await act(async () => { await result.current.saveProgress(true); });
    expect(JSON.parse(localStorage.getItem(mode.storageKey))).toMatchObject({ position: 0, trackIndex: 0 });
    unmount();
    mode.get.mockResolvedValue(mode.progress(90, new Date(now - 10000).toISOString(), 72));
    const restored = renderProgress(mode.overrides);
    await act(async () => {});
    expect(restored.result.current.initialSeekRef.current).toBeNull();
    expect(restored.ctx.currentTime).toBe(0);
    expect(restored.ctx.currentTrackIndex).toBe(0);
  });

  test.each(modes)('$name: an untouched zero save preserves both the server and the local fallback', async mode => {
    const { result, ctx } = renderProgress(mode.overrides);
    await act(async () => {});
    const stored = JSON.stringify({ position: 90, trackId: 71, timestamp: Date.now() });
    localStorage.setItem(mode.storageKey, stored);
    ctx.audioRef.current.paused = true;
    await act(async () => { await result.current.saveProgress(true); });
    expect(mode.update).not.toHaveBeenCalled();
    expect(localStorage.getItem(mode.storageKey)).toBe(stored);
  });

  test.each(modes.flatMap(mode => ['transport', 'native'].map(trigger => ({ ...mode, trigger }))))(
    '$name: $trigger Play before loadedmetadata retains the queued resume seek', async mode => {
      mode.get.mockResolvedValue(mode.progress(110, new Date().toISOString()));
      const audio = document.createElement('audio');
      let paused = true;
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
      Object.defineProperty(audio, 'readyState', { configurable: true, value: 0 });
      Object.defineProperty(audio, 'duration', { configurable: true, value: 600 });
      audio.load = vi.fn();
      audio.play = vi.fn(() => { paused = false; audio.dispatchEvent(new Event('play')); return Promise.resolve(); });
      audio.pause = vi.fn(() => { paused = true; audio.dispatchEvent(new Event('pause')); });
      const args = { type: mode.name, book: mode.overrides.book, audioSrc: baseTrack.url, textId: 42, audioRef: { current: audio } };
      const { result } = renderHook(() => useAudiobookPlayer(args));
      await act(async () => {});
      expect(result.current.currentTime).toBe(110);
      expect(audio.currentTime).toBe(0);
      await act(async () => {
        if (mode.trigger === 'transport') result.current.togglePlayPause();
        else { setAudioPlaybackIntent(audio, true); await audio.play(); }
      });
      expect(mode.update).not.toHaveBeenCalled();
      act(() => {
        Object.defineProperty(audio, 'readyState', { configurable: true, value: 1 });
        audio.dispatchEvent(new Event('loadedmetadata'));
      });
      expect(audio.currentTime).toBe(110);
      act(() => { audio.currentTime = 120; audio.dispatchEvent(new Event('durationchange')); });
      expect(audio.currentTime).toBe(120);
    }
  );
});
