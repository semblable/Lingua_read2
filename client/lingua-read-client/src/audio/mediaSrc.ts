// Pure URL/error helpers for the audiobook player. No React, no DOM mutation
// (apart from reading attributes off an HTMLAudioElement). Safe to unit-test
// without a render harness.

export const normalizeMediaSrc = (src: string | null | undefined): string => {
  if (!src) return '';
  if (src.startsWith('blob:')) return src;

  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
};

type ErrorLike = {
  name?: string;
  message?: string;
  code?: number;
} | null | undefined;

export const isAbortLikeError = (errorLike: unknown): boolean => {
  const err = errorLike as ErrorLike;
  const name = err?.name || '';
  const message = err?.message || '';
  const code = err?.code;

  return name === 'AbortError' || code === 1 || /abort(ed)?/i.test(message);
};

export const isLifecycleNetworkError = (errorLike: unknown): boolean => {
  const err = errorLike as ErrorLike;
  const name = err?.name || '';
  const message = err?.message || '';

  return name === 'TypeError' && /networkerror|failed to fetch/i.test(message);
};

// The audio element carries an ad-hoc `__lrAllowPlayback` flag used by the
// player to distinguish user-initiated play from browser autoplay/resume.
// Typed loosely because it's a runtime augmentation on HTMLAudioElement.
type AudioWithIntent = (HTMLAudioElement & { __lrAllowPlayback?: boolean }) | null | undefined;

export const setAudioPlaybackIntent = (audio: AudioWithIntent, shouldPlay: boolean): void => {
  if (!audio) return;
  audio.__lrAllowPlayback = shouldPlay;
};

export const getAudioPlaybackIntent = (audio: AudioWithIntent): boolean =>
  Boolean(audio?.__lrAllowPlayback);

export type TrackLike = {
  title?: string | null;
  filePath?: string | null;
  url?: string | null;
} | null | undefined;

export const getTrackDisplayName = (track: TrackLike): string => {
  if (!track) return '';
  if (track.title) return track.title;

  const path = track.filePath || track.url || '';
  const fileName = path.split(/[\\/]/).pop() || '';
  return fileName.replace(/\.[^/.]+$/, '') || 'Untitled track';
};

// --- Source-swap abort detection -------------------------------------------
// When the player swaps the audio.src to a new track, browsers commonly fire
// an abort error against the *old* src while loading the new one. The player
// records the in-flight swap in a small state object so handleError can
// suppress that expected abort and only surface real load failures.
//
// Extracted into a pure predicate so the source-swap behavior can be unit-
// tested without DOM timing (happy-dom fires loadedmetadata synchronously,
// which clears the swap state before tests can fire a synthetic error event).

export type SourceSwapState = {
  previousSrc: string;
  nextSrc: string;
};

export const createEmptySourceSwap = (): SourceSwapState => ({
  previousSrc: '',
  nextSrc: ''
});

export const isSourceSwapAbort = (
  swap: SourceSwapState,
  currentSrc: string,
  err: MediaError | null | undefined
): boolean => {
  if (!swap.nextSrc) return false;
  if (currentSrc !== swap.nextSrc) return false;
  return isAbortLikeError(err);
};
