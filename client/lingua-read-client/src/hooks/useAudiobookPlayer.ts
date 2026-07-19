import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createEmptySourceSwap,
  getAudioPlaybackIntent,
  getTrackDisplayName,
  isAbortLikeError,
  normalizeMediaSrc,
  isSourceSwapAbort,
  setAudioPlaybackIntent
} from '../audio/mediaSrc';
import {
  isStaleSegmentRequest,
  type SegmentPlaybackRequest
} from '../audio/segmentPlayback';
import { useAudiobookListeningActivity } from './audio/useAudiobookListeningActivity';
import { useAudiobookProgress, type LatestPlaybackStateSnapshot } from './audio/useAudiobookProgress';
import { useAudiobookSegmentPlayback } from './audio/useAudiobookSegmentPlayback';

// --- Public types ----------------------------------------------------------

export type AudiobookTrackLike = {
  trackId?: number | string;
  title?: string | null;
  url?: string | null;
  filePath?: string | null;
  isLesson?: boolean;
  trackNumber?: number;
  duration?: number | null;
};

export type AudiobookBookLike = {
  bookId?: number | string | null;
  languageId?: number | string | null;
  audiobookTracks?: AudiobookTrackLike[] | null;
};

export type AudioElementRef =
  | React.RefObject<HTMLAudioElement>
  | React.MutableRefObject<HTMLAudioElement | null>;

export type UseAudiobookPlayerArgs = {
  type?: 'book' | 'lesson';
  book?: AudiobookBookLike | null;
  audioSrc?: string | null;
  textId?: number | string | null;
  languageId?: number | string | null;
  audioRef?: AudioElementRef;
  onTimeUpdate?: (newTime: number) => void;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
  segmentPlaybackRequest?: SegmentPlaybackRequest | null;
  autoAdvanceTracks?: boolean;
};

export type UseAudiobookPlayerResult = {
  audioRef: AudioElementRef;
  progressBarRef: React.MutableRefObject<HTMLDivElement | null>;
  isPlaying: boolean;
  isLoading: boolean;
  isBuffering: boolean;
  isBookMode: boolean;
  currentTime: number;
  duration: number;
  error: string;
  playbackRate: number;
  volume: number;
  playlist: AudiobookTrackLike[];
  currentTrackIndex: number;
  currentTrack: AudiobookTrackLike | undefined;
  currentTrackDisplayName: string;
  togglePlayPause: () => void;
  seek: (time: number) => void;
  goToNextTrack: () => void;
  goToPrevTrack: () => void;
  changeRate: (diff: number) => void;
  handleVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

// --- Hook -------------------------------------------------------------------
//
// HOOK ORDER MATTERS. The three sub-hooks are called in a fixed order:
//   1. useAudiobookListeningActivity (G3) — self-contained, owns tracker refs
//   2. useAudiobookProgress (G1)         — owns content-key tracking refs
//   3. useAudiobookSegmentPlayback (G2)  — needs G1.userPositionIntentContentKeyRef
// Reordering would break ref ownership and effect-ordering invariants — e.g.
// G1's progress-load effect must run before G4's audio-event-listener effect
// so initialSeekRef is populated by the time `loadedmetadata` fires.
//
// All state setters and the audio element live in this orchestrator. The
// sub-hooks own no React state — only refs and effects. This keeps render-
// batch shape identical to the pre-split implementation.

export const useAudiobookPlayer = ({
  type = 'book',
  book,
  audioSrc,
  textId,
  languageId,
  audioRef: externalAudioRef,
  onTimeUpdate,
  onPlaybackStateChange,
  segmentPlaybackRequest,
  autoAdvanceTracks
}: UseAudiobookPlayerArgs): UseAudiobookPlayerResult => {
  // --- Orchestrator refs ---
  const internalAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef: AudioElementRef = externalAudioRef ?? internalAudioRef;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const sourceSwapRef = useRef(createEmptySourceSwap());
  const lifecycleSaveRef = useRef(false);
  const latestAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const latestPlaybackStateRef = useRef<LatestPlaybackStateSnapshot>({
    isBookMode: type === 'book',
    bookId: book?.bookId ?? null,
    textId: textId ?? null,
    currentTrackIndex: 0,
    playlist: [] as AudiobookTrackLike[],
    isInitialized: false,
    isPlaying: false
  });
  const wasPlayingRef = useRef(false);
  const autoAdvanceRef = useRef(autoAdvanceTracks ?? true);
  const pendingAutoAdvanceRef = useRef(false);

  useEffect(() => {
    autoAdvanceRef.current = autoAdvanceTracks ?? true;
  }, [autoAdvanceTracks]);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onPlaybackStateChangeRef.current = onPlaybackStateChange;
  }, [onPlaybackStateChange]);

  useEffect(() => {
    if (audioRef.current) {
      latestAudioElementRef.current = audioRef.current;
    }
  });

  // --- Derivations ---
  const isBookMode = type === 'book';
  const effectiveLanguageId = languageId ?? book?.languageId ?? null;
  const contentKey = useMemo(() => {
    if (isBookMode) {
      return `book:${book?.bookId || 'none'}`;
    }
    return `lesson:${textId || 'none'}:${audioSrc || 'none'}`;
  }, [audioSrc, book?.bookId, isBookMode, textId]);

  const positionStorageKey = useMemo(() => {
    if (isBookMode && book?.bookId) return `audioPos:book:${book.bookId}`;
    if (!isBookMode && textId) return `audioPos:lesson:${textId}`;
    return null;
  }, [isBookMode, book?.bookId, textId]);

  // --- State ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('audioVolume');
    return saved ? parseFloat(saved) : 1.0;
  });

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const [playlist, setPlaylist] = useState<AudiobookTrackLike[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    latestPlaybackStateRef.current = {
      isBookMode,
      bookId: book?.bookId ?? null,
      textId: textId ?? null,
      currentTrackIndex,
      playlist,
      isInitialized,
      isPlaying
    };
  }, [book?.bookId, currentTrackIndex, isBookMode, isInitialized, isPlaying, playlist, textId]);

  // --- G3: Listening activity ---
  const {
    listeningTrackerRef,
    flushListeningActivity,
    flushListeningActivityRef
  } = useAudiobookListeningActivity({
    effectiveLanguageId,
    isPlayingRef,
    lifecycleSaveRef
  });

  // --- Source tracks + playlist sync ---
  const sourceTracks = useMemo<AudiobookTrackLike[]>(() => {
    if (isBookMode && book?.audiobookTracks) {
      return [...book.audiobookTracks].sort((a, b) => {
        const nameA = a.title || a.filePath || '';
        const nameB = b.title || b.filePath || '';
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    if (!isBookMode && audioSrc) {
      return [{
        trackId: 'lesson-audio',
        title: 'Lesson Audio',
        url: audioSrc,
        isLesson: true
      }];
    }
    return [];
  }, [isBookMode, book, audioSrc]);

  useEffect(() => {
    const newTracks = sourceTracks;
    setPlaylist(prev => {
      const tracksChanged =
        prev.length !== newTracks.length ||
        prev.some((track, index) => (
          track.trackId !== newTracks[index]?.trackId ||
          track.url !== newTracks[index]?.url ||
          track.filePath !== newTracks[index]?.filePath
        ));

      if (!tracksChanged) {
        return prev;
      }

      if (isBookMode) {
        setIsInitialized(false);
      }

      return newTracks;
    });
  }, [isBookMode, sourceTracks]);

  // --- Stable callbacks needed by G2 + audio event handlers ---
  const logPlaybackInterruption = useCallback((context: string, errorLike: unknown) => {
    if (isAbortLikeError(errorLike)) {
      console.debug(`[AudioPlayer] Ignoring interrupted playback during ${context}.`, errorLike);
      return;
    }
    console.warn(context, errorLike);
  }, []);

  const requestAudioPlay = useCallback((context: string, options: { forceIntent?: boolean } = {}) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (options.forceIntent) {
      setAudioPlaybackIntent(audio, true);
    }

    if (!getAudioPlaybackIntent(audio)) {
      console.debug(`[AudioPlayer] Skipping play for ${context} because playback is paused by intent.`);
      return;
    }

    audio.play().catch((e: unknown) => logPlaybackInterruption(context, e));
  }, [audioRef, logPlaybackInterruption]);

  // --- G1: Progress persistence + cross-device sync ---
  const {
    saveProgress,
    saveProgressRef,
    queueInitialSeek,
    applyInitialSeekIfReady,
    restoredContentKeyRef,
    playbackStartedContentKeyRef,
    userPositionIntentContentKeyRef,
    initialSeekRef,
    lastServerUpdateRef,
    justStartedPlayingRef
  } = useAudiobookProgress({
    isBookMode,
    book,
    textId,
    contentKey,
    positionStorageKey,
    sourceTracks,
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

  // --- G2: Segment playback ---
  const {
    segmentPlaybackRef,
    resetSegmentPlayback,
    handleSegmentBoundary
  } = useAudiobookSegmentPlayback({
    audioRef,
    contentKey,
    segmentPlaybackRequest,
    requestAudioPlay,
    userPositionIntentContentKeyRef,
    setCurrentTime
  });

  // --- Reset on contentKey change ---
  // Note: G2 owns its own contentKey-tied segment reset, so this effect does
  // not call resetSegmentPlayback (which would otherwise undo the segment
  // applied by G2's apply effect, since G2's hook is called before this
  // effect is registered).
  useEffect(() => {
    initialSeekRef.current = null;
    restoredContentKeyRef.current = '';
    playbackStartedContentKeyRef.current = '';
    userPositionIntentContentKeyRef.current = '';
    lastServerUpdateRef.current = null;
    justStartedPlayingRef.current = false;
    wasPlayingRef.current = false;
    pendingAutoAdvanceRef.current = false;
    setCurrentTrackIndex(0);
    setCurrentTime(0);
    setDuration(0);
    setError('');

    if (sourceTracks.length === 0) {
      setIsInitialized(false);
      setIsLoading(false);
      return;
    }

    if (isBookMode) {
      setIsInitialized(false);
      setIsLoading(true);
      return;
    }

    setIsInitialized(true);
    setIsLoading(false);
  }, [contentKey, isBookMode, sourceTracks.length, initialSeekRef, restoredContentKeyRef, playbackStartedContentKeyRef, userPositionIntentContentKeyRef, lastServerUpdateRef, justStartedPlayingRef]);

  // --- Current track derivations ---
  const currentTrack = playlist[currentTrackIndex];
  const currentTrackDisplayName = getTrackDisplayName(currentTrack);

  const buildTrackSrc = useCallback((track: AudiobookTrackLike | undefined): string => {
    let src: string | null | undefined = track?.isLesson ? track.url : track?.filePath;

    if (src && !src.startsWith('http') && !src.startsWith('blob:')) {
      src = src.startsWith('/') ? src : `/${src}`;

      const envBaseUrl = import.meta.env.VITE_API_URL;
      if (envBaseUrl && envBaseUrl.startsWith('http')) {
        src = `${envBaseUrl}${src}`;
      }
    }

    return src || '';
  }, []);

  // --- Source-swap effect ---
  // Sets audio.src as soon as we have a currentTrack. Intentionally NOT gated
  // on `isInitialized`: for book mode, isInitialized waits for loadProgress to
  // resolve, which would leave the audio element source-less for the duration
  // of the API roundtrip. That breaks the mobile floating Play/Pause FAB,
  // which shares this audioRef and fires `audio.play()` directly — a no-op
  // when no source is set. If loadProgress later resolves to a different
  // savedTrackIndex, currentTrack changes and this effect re-runs to swap.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Consume the auto-advance intent at the top so it can't leak past an
    // early-return path (e.g. two playlist tracks pointing at the same file).
    const hadPendingAutoAdvance = pendingAutoAdvanceRef.current;
    pendingAutoAdvanceRef.current = false;

    const src = buildTrackSrc(currentTrack);
    const currentSrc = normalizeMediaSrc(audio.currentSrc || audio.src);
    const nextSrc = normalizeMediaSrc(src);
    const isSameSrc = currentSrc && currentSrc === nextSrc;

    if (isSameSrc) {
      setIsBuffering(false);
      return;
    }

    if (isStaleSegmentRequest(segmentPlaybackRef.current, segmentPlaybackRequest)) {
      resetSegmentPlayback();
    }
    sourceSwapRef.current = {
      previousSrc: currentSrc,
      nextSrc
    };

    setError('');
    audio.src = src;
    audio.load();
    setIsBuffering(true);

    if (isPlayingRef.current || hadPendingAutoAdvance) {
      requestAudioPlay('Auto-play on track change failed', { forceIntent: true });
    }
  }, [currentTrack, audioRef, buildTrackSrc, requestAudioPlay, resetSegmentPlayback, segmentPlaybackRequest, segmentPlaybackRef]);

  // --- Audio event handlers ---
  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    sourceSwapRef.current = createEmptySourceSwap();
    setDuration(audio.duration);
    setIsBuffering(false);
    applyInitialSeekIfReady(audio);
  }, [applyInitialSeekIfReady, audioRef]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;
    setCurrentTime(time);

    const boundary = handleSegmentBoundary(time);
    if (boundary.action === 'replay') {
      audio.currentTime = boundary.seekTo;
      setCurrentTime(boundary.seekTo);
      requestAudioPlay('Segment replay failed');
      return;
    }
    if (boundary.action === 'stop') {
      audio.pause();
      audio.currentTime = boundary.seekTo;
      setCurrentTime(boundary.seekTo);
      if (onTimeUpdateRef.current) {
        onTimeUpdateRef.current(boundary.seekTo);
      }
      return;
    }

    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(time);
    }
  }, [audioRef, handleSegmentBoundary, requestAudioPlay]);

  const syncPlaybackState = useCallback((nextIsPlaying: boolean) => {
    setIsPlaying(nextIsPlaying);
    if (onPlaybackStateChangeRef.current) {
      onPlaybackStateChangeRef.current(nextIsPlaying);
    }
  }, []);

  const handleEnded = useCallback(() => {
    const hasNext = isBookMode && currentTrackIndex < playlist.length - 1;
    const shouldAdvance = hasNext && autoAdvanceRef.current;
    if (shouldAdvance) {
      // Some mobile browsers fire `pause` before `ended` at natural end-of-track,
      // which flips isPlayingRef to false and would skip auto-play in the
      // source-swap effect. Mark the intent here so the swap effect resumes
      // playback regardless of pause/ended ordering, and force the playback
      // intent flag in case the `pause` handler tripped autoplay restrictions.
      const audio = audioRef.current;
      if (audio) setAudioPlaybackIntent(audio, true);
      pendingAutoAdvanceRef.current = true;
      syncPlaybackState(true);
      setCurrentTrackIndex(prev => prev + 1);
    } else {
      pendingAutoAdvanceRef.current = false;
      syncPlaybackState(false);
    }
  }, [isBookMode, currentTrackIndex, playlist.length, audioRef, syncPlaybackState]);

  const handleError = useCallback((e: Event) => {
    const audio = e?.target as HTMLAudioElement | null;
    const mediaErr = audio?.error ?? null;
    const currentSrc = normalizeMediaSrc(audio?.currentSrc ?? audio?.src);

    if (isSourceSwapAbort(sourceSwapRef.current, currentSrc, mediaErr)) {
      console.debug('[AudioPlayer] Ignoring media abort during source transition.', {
        src: audio?.currentSrc ?? audio?.src,
        mediaErrorCode: mediaErr?.code,
        mediaErrorMessage: mediaErr?.message
      });
      return;
    }

    console.error('Audio Error:', {
      event: e,
      src: audio?.currentSrc ?? audio?.src,
      networkState: audio?.networkState,
      readyState: audio?.readyState,
      mediaErrorCode: mediaErr?.code,
      mediaErrorMessage: mediaErr?.message
    });
    setError('Error loading audio.');
    setIsBuffering(false);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const tracker = listeningTrackerRef.current;

    const onWaiting = () => {
      setIsBuffering(true);
      tracker.markStalling();
      flushListeningActivityRef.current?.(false);
      tracker.clearCheckpoint();
    };
    const onPlaying = () => {
      sourceSwapRef.current = createEmptySourceSwap();
      setIsBuffering(false);
      tracker.markPlaying();
      if (isPlayingRef.current) {
        tracker.startCheckpoint(Date.now());
      }
    };
    const onPlay = () => {
      if (!getAudioPlaybackIntent(audio)) {
        console.debug('[AudioPlayer] Blocking unintended resume after pause.');
        audio.pause();
        return;
      }
      playbackStartedContentKeyRef.current = contentKey;
      syncPlaybackState(true);
    };
    const onPause = () => {
      if (segmentPlaybackRef.current.active) {
        resetSegmentPlayback();
      }
      syncPlaybackState(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('playing', onPlaying);

    if (audio.readyState >= 1) {
      handleLoadedMetadata();
    }

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('playing', onPlaying);
    };
  }, [audioRef, contentKey, handleLoadedMetadata, handleTimeUpdate, handleEnded, handleError, resetSegmentPlayback, syncPlaybackState, flushListeningActivityRef, listeningTrackerRef, playbackStartedContentKeyRef, segmentPlaybackRef]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, audioRef]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioRef]);

  useEffect(() => {
    const savedCallback = localStorage.getItem('audioPlaybackRate');
    if (savedCallback) {
      const r = parseFloat(savedCallback);
      if (!isNaN(r)) setPlaybackRate(r);
    }
  }, []);

  // --- Periodic save + pause→save + lifecycle flushes ---
  useEffect(() => {
    const interval = setInterval(() => {
      if (isPlaying) {
        saveProgress();
        flushListeningActivity();
      }
    }, 10000);
    return () => {
      clearInterval(interval);
    };
  }, [isPlaying, saveProgress, flushListeningActivity]);

  useEffect(() => {
    const tracker = listeningTrackerRef.current;
    if (isPlaying) {
      tracker.ensureCheckpoint(Date.now());
      wasPlayingRef.current = true;
    } else if (wasPlayingRef.current) {
      flushListeningActivity(true);
      tracker.clearCheckpoint();
      saveProgress(true);
      wasPlayingRef.current = false;
    }
  }, [isPlaying, saveProgress, flushListeningActivity, listeningTrackerRef]);

  useEffect(() => {
    // Alias the ref OBJECTS (not `.current`) so cleanup still reads the
    // LATEST callbacks at unmount — copying `.current` here would defeat the
    // purpose. Matches pre-split source-line 832-839 of the legacy hook.
    const flushRef = flushListeningActivityRef;
    const trackerRef = listeningTrackerRef;
    const saveRef = saveProgressRef;
    return () => {
      flushRef.current?.(true);
      trackerRef.current.clearCheckpoint();
      saveRef.current?.(true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleUnload = () => {
      lifecycleSaveRef.current = true;
      flushListeningActivityRef.current?.(true);
      listeningTrackerRef.current.clearCheckpoint();
      saveProgressRef.current?.(true);
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      lifecycleSaveRef.current = false;
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Transport controls ---
  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      userPositionIntentContentKeyRef.current = contentKey;
      playbackStartedContentKeyRef.current = contentKey;
      setAudioPlaybackIntent(audio, true);
      requestAudioPlay('Play failed');
    } else {
      setAudioPlaybackIntent(audio, false);
      audio.pause();
    }
  }, [audioRef, contentKey, requestAudioPlay, userPositionIntentContentKeyRef, playbackStartedContentKeyRef]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const d = (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) ? audio.duration : duration;
    if (!d) return;

    const newTime = Math.max(0, Math.min(time, d));
    if (segmentPlaybackRef.current.active) {
      resetSegmentPlayback();
    }
    userPositionIntentContentKeyRef.current = contentKey;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(newTime);
    }
  }, [audioRef, contentKey, duration, resetSegmentPlayback, segmentPlaybackRef, userPositionIntentContentKeyRef]);

  const goToNextTrack = useCallback(() => {
    if (currentTrackIndex < playlist.length - 1) {
      setCurrentTrackIndex(prev => prev + 1);
    }
  }, [currentTrackIndex, playlist.length]);

  const goToPrevTrack = useCallback(() => {
    if (currentTrackIndex > 0) {
      setCurrentTrackIndex(prev => prev - 1);
    }
  }, [currentTrackIndex]);

  const changeRate = useCallback((diff: number) => {
    setPlaybackRate(prev => {
      const newRate = parseFloat((prev + diff).toFixed(2));
      const clamped = Math.max(0.5, Math.min(newRate, 2.0));
      localStorage.setItem('audioPlaybackRate', String(clamped));
      return clamped;
    });
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    localStorage.setItem('audioVolume', String(newVolume));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.key === ' ' || e.key === '`') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === '[') {
        e.preventDefault();
        goToPrevTrack();
      } else if (e.key === ']') {
        e.preventDefault();
        goToNextTrack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause, goToNextTrack, goToPrevTrack]);

  return {
    audioRef,
    progressBarRef,
    isPlaying,
    isLoading,
    isBuffering,
    isBookMode,
    currentTime,
    duration,
    error,
    playbackRate,
    volume,
    playlist,
    currentTrackIndex,
    currentTrack,
    currentTrackDisplayName,
    togglePlayPause,
    seek,
    goToNextTrack,
    goToPrevTrack,
    changeRate,
    handleVolumeChange
  };
};
