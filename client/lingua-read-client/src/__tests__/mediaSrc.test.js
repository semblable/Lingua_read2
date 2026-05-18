import {
  normalizeMediaSrc,
  isAbortLikeError,
  isLifecycleNetworkError,
  setAudioPlaybackIntent,
  getAudioPlaybackIntent,
  getTrackDisplayName,
  createEmptySourceSwap,
  isSourceSwapAbort
} from '../audio/mediaSrc';

describe('mediaSrc', () => {
  describe('normalizeMediaSrc', () => {
    test('returns empty string for null/undefined/empty', () => {
      expect(normalizeMediaSrc(null)).toBe('');
      expect(normalizeMediaSrc(undefined)).toBe('');
      expect(normalizeMediaSrc('')).toBe('');
    });

    test('passes blob: URLs through unchanged', () => {
      expect(normalizeMediaSrc('blob:https://example.com/abc-123')).toBe('blob:https://example.com/abc-123');
    });

    test('resolves relative paths against window.location', () => {
      const result = normalizeMediaSrc('/lesson.mp3');
      expect(result).toBe(`${window.location.origin}/lesson.mp3`);
    });

    test('passes absolute URLs through unchanged', () => {
      expect(normalizeMediaSrc('https://example.com/lesson.mp3')).toBe('https://example.com/lesson.mp3');
    });
  });

  describe('isAbortLikeError', () => {
    test('detects AbortError by name', () => {
      expect(isAbortLikeError({ name: 'AbortError' })).toBe(true);
    });

    test('detects MediaError code 1 (MEDIA_ERR_ABORTED)', () => {
      expect(isAbortLikeError({ code: 1 })).toBe(true);
    });

    test('detects "abort" in message', () => {
      expect(isAbortLikeError({ message: 'The fetching process was aborted.' })).toBe(true);
      expect(isAbortLikeError({ message: 'request aborted' })).toBe(true);
    });

    test('returns false for unrelated errors', () => {
      expect(isAbortLikeError({ name: 'TypeError', message: 'Bad input' })).toBe(false);
      expect(isAbortLikeError({ code: 4 })).toBe(false);
      expect(isAbortLikeError(null)).toBe(false);
      expect(isAbortLikeError(undefined)).toBe(false);
    });
  });

  describe('isLifecycleNetworkError', () => {
    test('detects TypeError + NetworkError', () => {
      expect(isLifecycleNetworkError({ name: 'TypeError', message: 'NetworkError when attempting fetch' })).toBe(true);
    });

    test('detects TypeError + "failed to fetch"', () => {
      expect(isLifecycleNetworkError({ name: 'TypeError', message: 'Failed to fetch' })).toBe(true);
    });

    test('rejects TypeError with unrelated message', () => {
      expect(isLifecycleNetworkError({ name: 'TypeError', message: 'oops' })).toBe(false);
    });

    test('rejects non-TypeError errors', () => {
      expect(isLifecycleNetworkError({ name: 'AbortError', message: 'Failed to fetch' })).toBe(false);
      expect(isLifecycleNetworkError(null)).toBe(false);
    });
  });

  describe('setAudioPlaybackIntent / getAudioPlaybackIntent', () => {
    test('sets and reads the __lrAllowPlayback flag', () => {
      const audio = {};
      setAudioPlaybackIntent(audio, true);
      expect(getAudioPlaybackIntent(audio)).toBe(true);

      setAudioPlaybackIntent(audio, false);
      expect(getAudioPlaybackIntent(audio)).toBe(false);
    });

    test('no-ops on null/undefined audio', () => {
      expect(() => setAudioPlaybackIntent(null, true)).not.toThrow();
      expect(() => setAudioPlaybackIntent(undefined, true)).not.toThrow();
      expect(getAudioPlaybackIntent(null)).toBe(false);
      expect(getAudioPlaybackIntent(undefined)).toBe(false);
    });
  });

  describe('getTrackDisplayName', () => {
    test('returns title when present', () => {
      expect(getTrackDisplayName({ title: 'Chapter 1', filePath: 'foo.mp3' })).toBe('Chapter 1');
    });

    test('falls back to filename from filePath', () => {
      expect(getTrackDisplayName({ filePath: 'audio/track-01.mp3' })).toBe('track-01');
    });

    test('falls back to filename from url when filePath missing', () => {
      expect(getTrackDisplayName({ url: 'https://example.com/audio/song.ogg' })).toBe('song');
    });

    test('returns "Untitled track" when no name can be derived', () => {
      expect(getTrackDisplayName({ filePath: '' })).toBe('Untitled track');
    });

    test('returns empty string for null/undefined track', () => {
      expect(getTrackDisplayName(null)).toBe('');
      expect(getTrackDisplayName(undefined)).toBe('');
    });
  });

  describe('createEmptySourceSwap', () => {
    test('returns a fresh empty state', () => {
      expect(createEmptySourceSwap()).toEqual({ previousSrc: '', nextSrc: '' });
    });

    test('returns a new object each call (not shared reference)', () => {
      const a = createEmptySourceSwap();
      const b = createEmptySourceSwap();
      expect(a).not.toBe(b);
    });
  });

  describe('isSourceSwapAbort', () => {
    test('returns true for abort error during active swap on the new src', () => {
      const swap = { previousSrc: 'https://example.com/lesson.mp3', nextSrc: 'https://example.com/lesson-2.mp3' };
      const err = { code: 1, message: 'aborted by user agent' };
      expect(isSourceSwapAbort(swap, 'https://example.com/lesson-2.mp3', err)).toBe(true);
    });

    test('returns true for AbortError name during swap', () => {
      const swap = { previousSrc: 'a.mp3', nextSrc: 'b.mp3' };
      const err = { name: 'AbortError', message: '' };
      expect(isSourceSwapAbort(swap, 'b.mp3', err)).toBe(true);
    });

    test('returns false when no swap is in-flight', () => {
      const swap = createEmptySourceSwap();
      const err = { code: 1 };
      expect(isSourceSwapAbort(swap, 'b.mp3', err)).toBe(false);
    });

    test('returns false when the error is on a different src', () => {
      const swap = { previousSrc: 'a.mp3', nextSrc: 'b.mp3' };
      const err = { code: 1 };
      expect(isSourceSwapAbort(swap, 'c.mp3', err)).toBe(false);
      expect(isSourceSwapAbort(swap, 'a.mp3', err)).toBe(false);
    });

    test('returns false for non-abort errors during swap', () => {
      const swap = { previousSrc: 'a.mp3', nextSrc: 'b.mp3' };
      const err = { code: 4, message: 'The media resource could not be loaded.' };
      expect(isSourceSwapAbort(swap, 'b.mp3', err)).toBe(false);
    });

    test('returns false when error is null', () => {
      const swap = { previousSrc: 'a.mp3', nextSrc: 'b.mp3' };
      expect(isSourceSwapAbort(swap, 'b.mp3', null)).toBe(false);
    });
  });
});
