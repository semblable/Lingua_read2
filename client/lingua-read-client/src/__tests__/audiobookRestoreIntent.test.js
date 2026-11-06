import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useAudiobookPlayer } from '../hooks/useAudiobookPlayer';
import { getAudiobookProgress, updateAudiobookProgress } from '../utils/api';

vi.mock('../utils/api', () => ({ getAudiobookProgress: vi.fn(), getAudioLessonProgress: vi.fn(),
  updateAudiobookProgress: vi.fn(), updateAudioLessonProgress: vi.fn(), logListeningActivity: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

const setup = async (sameSource = false) => {
  let resolveProgress;
  getAudiobookProgress.mockReturnValue(new Promise(resolve => { resolveProgress = resolve; }));
  const audio = document.createElement('audio');
  Object.defineProperties(audio, {
    readyState: { configurable: true, writable: true, value: 0 },
    paused: { configurable: true, writable: true, value: true },
    currentTime: { configurable: true, writable: true, value: 0 },
    duration: { configurable: true, writable: true, value: 600 },
  });
  audio.load = vi.fn(() => { audio.readyState = 0; audio.currentTime = 0; });
  audio.play = vi.fn().mockResolvedValue(undefined);
  audio.pause = vi.fn();
  const audioRef = { current: audio };
  const book = { bookId: 17, audiobookTracks: [
    { trackId: 1, title: '1', filePath: 'https://example.com/one.mp3' },
    { trackId: 2, title: '2', filePath: sameSource ? 'https://example.com/one.mp3' : 'https://example.com/two.mp3' },
    { trackId: 3, title: '3', filePath: 'https://example.com/three.mp3' },
  ] };
  const rendered = renderHook(() => useAudiobookPlayer({ type: 'book', book, audioRef }));
  await act(async () => {});
  audio.readyState = 1;
  await act(async () => resolveProgress({ currentAudiobookTrackId: 2, currentAudiobookPosition: 330 }));
  return { audio, ...rendered };
};

test('restores when the next track shares the already loaded source', async () => {
  const { audio, result } = await setup(true);
  expect(result.current.currentTrackIndex).toBe(1);
  expect(audio.currentTime).toBe(330);
});

test('manual track navigation cancels a pending restore so future progress still saves', async () => {
  const { audio, result, unmount } = await setup(false);
  act(() => result.current.goToNextTrack());
  expect(result.current.currentTrackIndex).toBe(2);
  act(() => { audio.readyState = 1; audio.dispatchEvent(new Event('loadedmetadata')); });
  act(() => { result.current.togglePlayPause(); audio.paused = false; audio.dispatchEvent(new Event('play')); });
  act(() => { audio.currentTime = 42; audio.dispatchEvent(new Event('timeupdate')); });
  await act(async () => { audio.paused = true; audio.dispatchEvent(new Event('pause')); });
  await act(async () => { unmount(); });
  expect(updateAudiobookProgress).toHaveBeenCalledWith(17, expect.objectContaining({ currentAudiobookTrackId: 3, currentAudiobookPosition: 42 }), expect.anything());
});
