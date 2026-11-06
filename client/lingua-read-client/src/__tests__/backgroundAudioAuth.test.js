import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useAudiobookProgress } from '../hooks/audio/useAudiobookProgress';

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual('../utils/api/audiobook');
  return { getAudiobookProgress: actual.getAudiobookProgress, getAudioLessonProgress: actual.getAudioLessonProgress,
    updateAudiobookProgress: vi.fn(), updateAudioLessonProgress: vi.fn() };
});

test('an expired background progress poll must not replace an active reader', async () => {
  vi.useFakeTimers();
  const originalLocation = window.location;
  const redirect = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: {
    pathname: '/texts/1', search: '', hash: '', set href(value) { redirect(value); }
  } });
  let expired = false;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => expired
    ? new Response('', { status: 401 })
    : new Response('{}', { headers: { 'content-type': 'application/json' } }));
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const args = { isBookMode: true, book: { bookId: 17 }, textId: null, contentKey: 'book:17', positionStorageKey: null,
    sourceTracks: [{ trackId: 1 }], audioRef: { current: null }, latestAudioElementRef: { current: null },
    latestPlaybackStateRef: { current: {} }, lifecycleSaveRef: { current: false }, isPlaying: false,
    isInitialized: true, currentTrackIndex: 0, setCurrentTrackIndex: vi.fn(), setCurrentTime: vi.fn(),
    setIsInitialized: vi.fn(), setIsLoading: vi.fn() };
  let view;
  try {
    await act(async () => { view = renderHook(() => useAudiobookProgress(args)); });
    expect(redirect).not.toHaveBeenCalled();
    expired = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(redirect).not.toHaveBeenCalled();
  } finally {
    view?.unmount(); fetch.mockRestore(); errors.mockRestore(); vi.useRealTimers();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  }
});
