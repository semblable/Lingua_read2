import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

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
  logListeningActivity
} from '../utils/api';
import { useAudiobookPlayer } from '../hooks/useAudiobookPlayer';

const flushEffects = async () => {
  await act(async () => {});
};

describe('useAudiobookPlayer', () => {
  beforeEach(() => {
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue();
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();

    getAudiobookProgress.mockReset().mockResolvedValue(null);
    getAudioLessonProgress.mockReset().mockResolvedValue(null);
    logListeningActivity.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  test('returns the documented Use<Name>Result shape (lesson mode)', async () => {
    const { result } = renderHook(() =>
      useAudiobookPlayer({
        type: 'lesson',
        audioSrc: 'https://example.com/lesson.mp3',
        textId: 42,
        languageId: 7
      })
    );
    await flushEffects();

    expect(result.current).toEqual(
      expect.objectContaining({
        audioRef: expect.any(Object),
        progressBarRef: expect.any(Object),
        isPlaying: false,
        isLoading: expect.any(Boolean),
        isBuffering: false,
        isBookMode: false,
        currentTime: 0,
        duration: 0,
        error: '',
        playbackRate: 1,
        volume: expect.any(Number),
        playlist: expect.any(Array),
        currentTrackIndex: 0,
        currentTrackDisplayName: expect.any(String),
        togglePlayPause: expect.any(Function),
        seek: expect.any(Function),
        goToNextTrack: expect.any(Function),
        goToPrevTrack: expect.any(Function),
        changeRate: expect.any(Function),
        handleVolumeChange: expect.any(Function)
      })
    );
  });

  test('derives a single-entry playlist from audioSrc in lesson mode', async () => {
    const { result } = renderHook(() =>
      useAudiobookPlayer({
        type: 'lesson',
        audioSrc: 'https://example.com/lesson.mp3',
        textId: 42
      })
    );
    await waitFor(() => expect(result.current.playlist.length).toBe(1));

    expect(result.current.playlist[0]).toEqual(
      expect.objectContaining({
        trackId: 'lesson-audio',
        url: 'https://example.com/lesson.mp3',
        isLesson: true
      })
    );
    expect(result.current.isBookMode).toBe(false);
  });

  test('derives a sorted playlist from book.audiobookTracks in book mode', async () => {
    const book = {
      bookId: 10,
      languageId: 3,
      audiobookTracks: [
        { trackId: 't-10', title: 'Chapter 10' },
        { trackId: 't-2', title: 'Chapter 2' },
        { trackId: 't-1', title: 'Chapter 1' }
      ]
    };
    const { result } = renderHook(() =>
      useAudiobookPlayer({ type: 'book', book })
    );
    await waitFor(() => expect(result.current.playlist.length).toBe(3));

    expect(result.current.playlist.map((t) => t.trackId)).toEqual(['t-1', 't-2', 't-10']);
    expect(result.current.isBookMode).toBe(true);
  });

  test('calls getAudioLessonProgress in lesson mode and getAudiobookProgress in book mode', async () => {
    renderHook(() =>
      useAudiobookPlayer({
        type: 'lesson',
        audioSrc: 'https://example.com/lesson.mp3',
        textId: 99
      })
    );
    await waitFor(() => expect(getAudioLessonProgress).toHaveBeenCalledWith(99));
    expect(getAudiobookProgress).not.toHaveBeenCalled();

    getAudioLessonProgress.mockClear();
    getAudiobookProgress.mockClear();

    renderHook(() =>
      useAudiobookPlayer({
        type: 'book',
        book: { bookId: 555, audiobookTracks: [{ trackId: 't-1' }] }
      })
    );
    await waitFor(() => expect(getAudiobookProgress).toHaveBeenCalledWith(555));
    expect(getAudioLessonProgress).not.toHaveBeenCalled();
  });

  test('initialises volume from localStorage when set', () => {
    localStorage.setItem('audioVolume', '0.42');
    const { result } = renderHook(() =>
      useAudiobookPlayer({
        type: 'lesson',
        audioSrc: 'https://example.com/lesson.mp3',
        textId: 1
      })
    );
    expect(result.current.volume).toBeCloseTo(0.42);
  });

  test('handleVolumeChange persists the new volume and updates state', async () => {
    const { result } = renderHook(() =>
      useAudiobookPlayer({
        type: 'lesson',
        audioSrc: 'https://example.com/lesson.mp3',
        textId: 1
      })
    );
    await flushEffects();

    act(() => {
      result.current.handleVolumeChange({ target: { value: '0.55' } });
    });

    expect(result.current.volume).toBeCloseTo(0.55);
    expect(localStorage.getItem('audioVolume')).toBe('0.55');
  });

  test('changeRate adjusts playbackRate by the requested diff and clamps to allowed range', async () => {
    const { result } = renderHook(() =>
      useAudiobookPlayer({
        type: 'lesson',
        audioSrc: 'https://example.com/lesson.mp3',
        textId: 1
      })
    );
    await flushEffects();

    expect(result.current.playbackRate).toBe(1);

    act(() => {
      result.current.changeRate(0.25);
    });
    expect(result.current.playbackRate).toBeCloseTo(1.25);

    // Drive rate back to 1 then well below 0.5 to verify the lower clamp.
    act(() => {
      result.current.changeRate(-0.25);
    });
    expect(result.current.playbackRate).toBeCloseTo(1);
    act(() => {
      result.current.changeRate(-2);
    });
    expect(result.current.playbackRate).toBeGreaterThanOrEqual(0.25);
  });

  test('accepts an external audioRef and exposes it as the returned audioRef', async () => {
    const externalRef = { current: null };
    const { result } = renderHook(() =>
      useAudiobookPlayer({
        type: 'lesson',
        audioSrc: 'https://example.com/lesson.mp3',
        textId: 1,
        audioRef: externalRef
      })
    );
    await flushEffects();

    expect(result.current.audioRef).toBe(externalRef);
  });

  test('logs no listening activity on unmount when nothing was played', async () => {
    const { unmount } = renderHook(() =>
      useAudiobookPlayer({
        type: 'lesson',
        audioSrc: 'https://example.com/lesson.mp3',
        textId: 1,
        languageId: 7
      })
    );
    await flushEffects();
    unmount();
    await flushEffects();

    expect(logListeningActivity).not.toHaveBeenCalled();
  });

  test('contentKey derivation switches APIs when textId or audioSrc changes (lesson)', async () => {
    const { rerender } = renderHook(
      ({ textId, audioSrc }) =>
        useAudiobookPlayer({ type: 'lesson', audioSrc, textId, languageId: 7 }),
      { initialProps: { textId: 1, audioSrc: 'https://example.com/a.mp3' } }
    );
    await waitFor(() => expect(getAudioLessonProgress).toHaveBeenCalledWith(1));

    getAudioLessonProgress.mockClear();

    rerender({ textId: 2, audioSrc: 'https://example.com/b.mp3' });
    await waitFor(() => expect(getAudioLessonProgress).toHaveBeenCalledWith(2));
  });
});
