import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAudiobookPlayer } from '../hooks/useAudiobookPlayer';
import { logListeningActivity } from '../utils/api';

vi.mock('../utils/api', () => ({
  getAudiobookProgress: vi.fn().mockResolvedValue(null),
  updateAudiobookProgress: vi.fn().mockResolvedValue(undefined),
  getAudioLessonProgress: vi.fn().mockResolvedValue(null),
  updateAudioLessonProgress: vi.fn().mockResolvedValue(undefined),
  logListeningActivity: vi.fn().mockResolvedValue(undefined)
}));

const renderPlayer = async (options = {}) => {
  const audio = document.createElement('audio');
  // Media state and event delivery are independent so tests can model browser
  // sequences without happy-dom synthesizing extra play/pause/seek events.
  Object.defineProperties(audio, {
    currentTime: { configurable: true, writable: true, value: 0 },
    duration: { configurable: true, writable: true, value: 600 },
    paused: { configurable: true, writable: true, value: true },
    seeking: { configurable: true, writable: true, value: false },
    readyState: { configurable: true, writable: true, value: 4 },
    HAVE_FUTURE_DATA: { configurable: true, value: 3 }
  });
  audio.play = vi.fn().mockResolvedValue(undefined);
  audio.pause = vi.fn();
  audio.load = vi.fn();
  const audioRef = { current: audio };
  const initialProps = {
    type: 'lesson',
    audioSrc: 'https://example.com/lesson.mp3',
    ...options
  };
  const rendered = renderHook((props) => useAudiobookPlayer({
    type: props.type ?? 'lesson',
    audioSrc: props.audioSrc,
    book: props.book,
    textId: 42,
    languageId: 5,
    audioRef
  }), { initialProps });
  await act(async () => {});

  const emit = (type, state = {}) => act(() => {
    Object.assign(audio, state);
    audio.dispatchEvent(new Event(type));
  });
  const advance = (seconds, sourceSeconds = seconds * audio.playbackRate) => act(() => {
    audio.currentTime += sourceSeconds;
    vi.advanceTimersByTime(seconds * 1000);
  });
  const play = () => act(() => {
    audio.__lrAllowPlayback = true;
    audio.paused = false;
    audio.dispatchEvent(new Event('play'));
    audio.dispatchEvent(new Event('playing'));
  });
  const pause = () => emit('pause', { paused: true });
  return { ...rendered, audio, emit, advance, play, pause };
};

const loggedSeconds = () => logListeningActivity.mock.calls.reduce((sum, [, seconds]) => sum + seconds, 0);

describe('audiobook listening playback boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T12:00:00Z'));
    vi.mocked(logListeningActivity).mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  test('initial play without active playback evidence earns no startup waiting time', async () => {
    const { emit, advance, pause } = await renderPlayer();
    emit('play', { paused: false, __lrAllowPlayback: true });
    advance(10, 0);
    expect(logListeningActivity).not.toHaveBeenCalled();

    emit('playing');
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(5);
  });

  test('play after an ordinary pause waits for actual playback before earning more time', async () => {
    const { emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    pause();
    emit('play', { paused: false });
    advance(10, 0);
    expect(loggedSeconds()).toBe(5);

    emit('playing');
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(10);
  });

  test('excludes seek latency without a waiting event and resumes from a ready seeked event', async () => {
    const { result, audio, emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    act(() => result.current.seek(300));
    emit('seeking', { seeking: true });
    advance(10, 0);
    expect(logListeningActivity).not.toHaveBeenCalled();

    emit('seeked', { seeking: false });
    advance(5);
    pause();

    expect(audio.currentTime).toBe(305);
    expect(logListeningActivity).toHaveBeenCalledWith(5, 10);
    expect(loggedSeconds()).toBe(10);
  });

  test('seeked without future data does not resume waiting playback or periodic checkpoints', async () => {
    const { emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    emit('waiting', { readyState: 2 });
    advance(10, 0);
    emit('seeked', { seeking: false });
    advance(20, 0);
    expect(logListeningActivity).not.toHaveBeenCalled();

    emit('playing', { readyState: 4 });
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(10);
  });

  test.each([
    ['paused', { paused: true, seeking: false }],
    ['still seeking', { seeking: true }],
    ['without playback intent', { seeking: false, __lrAllowPlayback: false }]
  ])('seeked does not resume when %s', async (_description, state) => {
    const { emit, advance, play, unmount } = await renderPlayer();
    play();
    advance(5);
    emit('seeking', { seeking: true });
    advance(10, 0);
    emit('seeked', state);
    advance(20, 0);
    unmount();
    expect(loggedSeconds()).toBe(5);
  });

  test('excludes stalled latency when future audio is unavailable', async () => {
    const { emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    emit('stalled', { readyState: 2 });
    advance(10, 0);
    emit('playing', { readyState: 4 });
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(10);
  });

  test('keeps counting buffered playback when only network fetching has stalled', async () => {
    const { emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    emit('stalled');
    advance(10);
    pause();
    expect(loggedSeconds()).toBe(15);
  });

  test('a stall while paused does not show buffering or suspend the next play', async () => {
    const { result, emit, advance, play, pause } = await renderPlayer();
    emit('stalled', { readyState: 1 });
    expect(result.current.isBuffering).toBe(false);

    emit('canplay', { readyState: 4 });
    play();
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(5);
  });

  test('a source swap during playback does not credit the next source load time', async () => {
    const { rerender, emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    await act(async () => { rerender({ audioSrc: 'https://example.com/next.mp3' }); });
    advance(15, 0);
    expect(logListeningActivity).not.toHaveBeenCalled();

    emit('playing', { paused: false, readyState: 4 });
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(10);
  });

  test('an auto-advance track swap during playback does not credit the next track load time', async () => {
    const { emit, advance, play, pause } = await renderPlayer({
      type: 'book',
      book: {
        bookId: 10,
        audiobookTracks: [
          { trackId: 1, title: 'Track 1', filePath: 'https://example.com/t1.mp3' },
          { trackId: 2, title: 'Track 2', filePath: 'https://example.com/t2.mp3' }
        ]
      }
    });
    play();
    advance(5);
    emit('ended');
    advance(15, 0);
    expect(logListeningActivity).not.toHaveBeenCalled();

    emit('playing', { paused: false, readyState: 4 });
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(10);
  });

  test('pause during a seek prevents a late seeked or playing event from resuming credit', async () => {
    const { emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    emit('seeking', { seeking: true });
    advance(10, 0);
    pause();
    emit('seeked', { seeking: false });
    emit('playing');
    advance(20, 0);
    pause();
    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    expect(loggedSeconds()).toBe(5);
  });

  test('a new play event during suspension waits for active playback evidence', async () => {
    const { emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    emit('waiting', { readyState: 2 });
    pause();
    emit('play', { paused: false });
    advance(25, 0);
    expect(loggedSeconds()).toBe(5);

    emit('playing', { readyState: 4 });
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(10);
  });

  test('repeated seeking, waiting and stalled boundaries preserve pre-boundary time once', async () => {
    const { emit, advance, play, pause, unmount } = await renderPlayer();
    play();
    advance(5);
    emit('seeking', { seeking: true });
    advance(5, 0);
    emit('waiting', { readyState: 2 });
    advance(5, 0);
    emit('stalled');
    advance(5, 0);
    emit('seeking');
    advance(15, 0);
    pause();
    pause();
    advance(10, 0);
    unmount();
    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    expect(loggedSeconds()).toBe(5);
  });

  test('unmount during seeking flushes only the time played before the boundary', async () => {
    const { emit, advance, play, unmount } = await renderPlayer();
    play();
    advance(5);
    emit('seeking', { seeking: true });
    advance(15, 0);
    unmount();
    expect(logListeningActivity).toHaveBeenCalledTimes(1);
    expect(loggedSeconds()).toBe(5);
  });

  test('duplicate playing events do not discard time already played', async () => {
    const { emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    emit('playing');
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(10);
  });

  test('duplicate play events during active playback preserve the current checkpoint', async () => {
    const { emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    emit('play');
    advance(5);
    pause();
    expect(loggedSeconds()).toBe(10);
  });

  test('speed changes and seek jumps do not scale elapsed listening seconds', async () => {
    const { result, audio, emit, advance, play, pause } = await renderPlayer();
    play();
    advance(5);
    act(() => result.current.changeRate(1));
    expect(audio.playbackRate).toBe(2);
    advance(5);
    act(() => result.current.seek(500));
    emit('seeking', { seeking: true });
    advance(10, 0);
    emit('seeked', { seeking: false });
    act(() => result.current.changeRate(-1.5));
    expect(audio.playbackRate).toBe(0.5);
    advance(5);
    pause();
    expect(audio.currentTime).toBe(502.5);
    expect(loggedSeconds()).toBe(15);
  });
});
