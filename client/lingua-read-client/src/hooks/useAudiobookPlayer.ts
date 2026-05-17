import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAudiobookProgress,
  updateAudiobookProgress,
  getAudioLessonProgress,
  updateAudioLessonProgress,
  logListeningActivity
} from '../utils/api';
import {
  createEmptySourceSwap,
  getAudioPlaybackIntent,
  getTrackDisplayName,
  isAbortLikeError,
  isLifecycleNetworkError,
  isSourceSwapAbort,
  normalizeMediaSrc,
  setAudioPlaybackIntent
} from '../audio/mediaSrc';
import {
  applySegmentRequest,
  cancelSegmentPlayback,
  createSegmentPlaybackState,
  evaluateSegmentBoundary,
  isStaleSegmentRequest,
  type SegmentPlaybackRequest,
  type SegmentPlaybackState
} from '../audio/segmentPlayback';
import {
  createListeningActivityTracker,
  type ListeningActivityTracker
} from '../audio/listeningActivity';

// --- Public types ----------------------------------------------------------

// The track shape spans two runtime sources: AudiobookTrackDto from the API
// and a synthetic lesson-audio item. Loose-but-typed so both fit.
export type AudiobookTrackLike = {
  trackId?: number | string;
  title?: string | null;
  url?: string | null;
  filePath?: string | null;
  isLesson?: boolean;
  trackNumber?: number;
  duration?: number | null;
};

// Minimal shape AudiobookPlayer actually reads off the book. BookDetailDto
// from the API matches this structurally (bookId + languageId +
// audiobookTracks). Caller doesn't need to pass the full DTO.
export type AudiobookBookLike = {
  bookId?: number | string | null;
  languageId?: number | string | null;
  audiobookTracks?: AudiobookTrackLike[] | null;
};

// Either ref shape works — useReaderAudioSync exposes RefObject<HTMLAudioElement>
// while useRef returns MutableRefObject<HTMLAudioElement | null>. Reading
// `.current` from either gives `HTMLAudioElement | null`.
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

export const useAudiobookPlayer = ({
  type = 'book',
  book,
  audioSrc,
  textId,
  languageId,
  audioRef: externalAudioRef,
  onTimeUpdate,
  onPlaybackStateChange,
  segmentPlaybackRequest
}: UseAudiobookPlayerArgs): UseAudiobookPlayerResult => {
  // --- ONE: Refs and stable callbacks --------------------------------------
  const internalAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef: AudioElementRef = externalAudioRef ?? internalAudioRef;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  const progressBarRef = useRef<HTMLDivElement | null>(null);
  const segmentPlaybackRef = useRef<SegmentPlaybackState>(createSegmentPlaybackState());
  const sourceSwapRef = useRef(createEmptySourceSwap());
  const lifecycleSaveRef = useRef(false);
  const latestAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const latestPlaybackStateRef = useRef({
    isBookMode: type === 'book',
    bookId: book?.bookId ?? null,
    textId: textId ?? null,
    currentTrackIndex: 0,
    playlist: [] as AudiobookTrackLike[],
    isInitialized: false,
    isPlaying: false
  });
  const saveProgressRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const restoredContentKeyRef = useRef('');
  const playbackStartedContentKeyRef = useRef('');
  const userPositionIntentContentKeyRef = useRef('');
  const listeningTrackerRef = useRef<ListeningActivityTracker>(
    createListeningActivityTracker()
  );
  const flushListeningActivityRef = useRef<((force?: boolean) => void) | null>(null);

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

  // --- TWO: State management -----------------------------------------------
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
  const initialSeekRef = useRef<number | null>(null);
  const lastServerUpdateRef = useRef<number | null>(null);

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

  useEffect(() => {
    listeningTrackerRef.current.setLanguageId(effectiveLanguageId);
  }, [effectiveLanguageId]);

  // --- THREE: Data derivation ----------------------------------------------
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

  // --- FOUR: Initial progress loading --------------------------------------
  const applyInitialSeekIfReady = useCallback((audio: HTMLAudioElement | null) => {
    if (!audio || initialSeekRef.current == null) return false;

    if (
      restoredContentKeyRef.current === contentKey ||
      userPositionIntentContentKeyRef.current === contentKey ||
      playbackStartedContentKeyRef.current === contentKey
    ) {
      initialSeekRef.current = null;
      return false;
    }

    console.log(`[AudioPlayer] Seeking to ${initialSeekRef.current}`);
    audio.currentTime = initialSeekRef.current;
    setCurrentTime(initialSeekRef.current);
    restoredContentKeyRef.current = contentKey;
    initialSeekRef.current = null;
    return true;
  }, [contentKey]);

  const queueInitialSeek = useCallback((position: number) => {
    if (!Number.isFinite(position) || position <= 0) return false;

    if (
      restoredContentKeyRef.current === contentKey ||
      userPositionIntentContentKeyRef.current === contentKey ||
      playbackStartedContentKeyRef.current === contentKey
    ) {
      return false;
    }

    initialSeekRef.current = position;
    setCurrentTime(position);

    const audio = audioRef.current;
    if ((audio?.readyState ?? 0) >= 1) {
      return applyInitialSeekIfReady(audio);
    }

    return true;
  }, [applyInitialSeekIfReady, audioRef, contentKey]);

  useEffect(() => {
    let mounted = true;
    const loadProgress = async () => {
      if (sourceTracks.length === 0) {
        setIsLoading(false);
        return;
      }

      try {
        let savedTrackIndex = 0;
        let savedPosition = 0;
        let serverUpdateTime: number | null = null;

        if (isBookMode && book?.bookId) {
          setIsLoading(true);
          const progress = await getAudiobookProgress(book.bookId);
          if (progress?.currentAudiobookTrackId) {
            const idx = sourceTracks.findIndex(t => t.trackId === progress.currentAudiobookTrackId);
            if (idx !== -1) {
              savedTrackIndex = idx;
              savedPosition = progress.currentAudiobookPosition || 0;
              console.log(`[AudioPlayer] Restoring Book progress: Track ${idx}, Pos ${savedPosition}`);
            }
          }
          if (progress?.updatedAt) {
            const parsed = new Date(progress.updatedAt).getTime();
            if (Number.isFinite(parsed)) {
              serverUpdateTime = parsed;
              lastServerUpdateRef.current = parsed;
            }
          }
        } else if (!isBookMode && textId) {
          const progress = await getAudioLessonProgress(textId);
          if (progress && progress.currentPosition != null && progress.currentPosition > 0) {
            savedPosition = progress.currentPosition;
            console.log(`[AudioPlayer] Restoring Lesson progress: Pos ${savedPosition}`);
          }
          if (progress?.updatedAt) {
            const parsed = new Date(progress.updatedAt).getTime();
            if (Number.isFinite(parsed)) {
              serverUpdateTime = parsed;
              lastServerUpdateRef.current = parsed;
            }
          }
        }

        if (positionStorageKey) {
          try {
            const localRaw = localStorage.getItem(positionStorageKey);
            if (localRaw) {
              const localData = JSON.parse(localRaw);
              const localPosition = Number(localData.position) || 0;
              const localTimestamp = Number(localData.timestamp) || 0;
              const localIsFresher = serverUpdateTime != null && localTimestamp > serverUpdateTime + 2000;
              const shouldUseLocal = savedPosition <= 0 || localIsFresher;

              if (localPosition > 0 && shouldUseLocal) {
                let localTrackIndex = savedTrackIndex;

                if (isBookMode) {
                  if (localData.trackId != null) {
                    localTrackIndex = sourceTracks.findIndex(t => t.trackId === localData.trackId);
                  } else if (localData.trackIndex != null) {
                    localTrackIndex = Number(localData.trackIndex);
                  }
                }

                if (!isBookMode || (Number.isInteger(localTrackIndex) && localTrackIndex >= 0 && localTrackIndex < sourceTracks.length)) {
                  console.log(`[AudioPlayer] Restoring from localStorage: ${localPosition}`);
                  savedPosition = localPosition;
                  savedTrackIndex = localTrackIndex;
                }
              }
            }
          } catch { /* corrupted or unavailable */ }
        }

        if (mounted) {
          setCurrentTrackIndex(savedTrackIndex);
          if (savedPosition > 0) {
            queueInitialSeek(savedPosition);
          }
          if (isBookMode) {
            setIsInitialized(true);
          }
        }
      } catch (e) {
        console.error('Failed to load progress:', e);
        if (mounted && positionStorageKey) {
          try {
            const localRaw = localStorage.getItem(positionStorageKey);
            if (localRaw) {
              const localData = JSON.parse(localRaw);
              if (localData.position > 0) {
                console.log(`[AudioPlayer] Server unreachable, restoring from localStorage: ${localData.position}`);
                if (isBookMode && localData.trackIndex != null) {
                  setCurrentTrackIndex(localData.trackIndex);
                }
                queueInitialSeek(localData.position);
              }
            }
          } catch { /* corrupted or unavailable */ }
        }
        if (mounted && isBookMode) setIsInitialized(true);
      } finally {
        if (mounted && isBookMode) setIsLoading(false);
      }
    };

    loadProgress();

    return () => {
      mounted = false;
    };
  }, [book?.bookId, isBookMode, positionStorageKey, queueInitialSeek, sourceTracks, textId]);

  // --- FIVE: Active track management ---------------------------------------
  const currentTrack = playlist[currentTrackIndex];
  const currentTrackDisplayName = getTrackDisplayName(currentTrack);

  const resetSegmentPlayback = useCallback(() => {
    segmentPlaybackRef.current = cancelSegmentPlayback();
  }, []);

  useEffect(() => {
    initialSeekRef.current = null;
    restoredContentKeyRef.current = '';
    playbackStartedContentKeyRef.current = '';
    userPositionIntentContentKeyRef.current = '';
    lastServerUpdateRef.current = null;
    justStartedPlayingRef.current = false;
    wasPlayingRef.current = false;
    resetSegmentPlayback();
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
  }, [contentKey, isBookMode, resetSegmentPlayback, sourceTracks.length]);

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

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isInitialized || !currentTrack) return;

    const src = buildTrackSrc(currentTrack);
    const currentSrc = normalizeMediaSrc(audio.currentSrc || audio.src);
    const nextSrc = normalizeMediaSrc(src);
    const isSameSrc = currentSrc && currentSrc === nextSrc;

    if (isSameSrc) {
      setIsBuffering(false);
      return;
    }

    // Don't reset an in-flight segment request that was just configured by
    // the segment effect — only reset if there is no pending segment or the
    // request ID changed (i.e. the segment is genuinely stale after a src swap).
    if (isStaleSegmentRequest(segmentPlaybackRef.current, segmentPlaybackRequest)) {
      resetSegmentPlayback();
    }
    sourceSwapRef.current = {
      previousSrc: currentSrc,
      nextSrc
    };

    console.log(`[AudioPlayer] Loading Track: ${src}`);
    setError('');
    audio.src = src;
    audio.load();
    setIsBuffering(true);

    if (isPlayingRef.current) {
      requestAudioPlay('Auto-play on track change failed');
    }
  }, [currentTrack, isInitialized, audioRef, buildTrackSrc, requestAudioPlay, resetSegmentPlayback, segmentPlaybackRequest]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!segmentPlaybackRequest?.requestId) {
      if (segmentPlaybackRef.current.active) {
        resetSegmentPlayback();
        audio.pause();
      }
      return;
    }

    if (segmentPlaybackRef.current.requestId === segmentPlaybackRequest.requestId) return;

    const nextState = applySegmentRequest(segmentPlaybackRequest);
    segmentPlaybackRef.current = nextState;

    userPositionIntentContentKeyRef.current = contentKey;
    audio.currentTime = nextState.startTime;
    setCurrentTime(nextState.startTime);
    requestAudioPlay('Segment playback failed', { forceIntent: Boolean(segmentPlaybackRequest.forcePlay) });
  }, [audioRef, contentKey, requestAudioPlay, resetSegmentPlayback, segmentPlaybackRequest]);

  // --- SIX: Event listeners & logic ----------------------------------------
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

    const boundary = evaluateSegmentBoundary(segmentPlaybackRef.current, time);
    if (boundary.action === 'replay') {
      segmentPlaybackRef.current = boundary.nextState;
      audio.currentTime = boundary.seekTo;
      setCurrentTime(boundary.seekTo);
      requestAudioPlay('Segment replay failed');
      return;
    }
    if (boundary.action === 'stop') {
      segmentPlaybackRef.current = boundary.nextState;
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
  }, [audioRef, requestAudioPlay]);

  const syncPlaybackState = useCallback((nextIsPlaying: boolean) => {
    setIsPlaying(nextIsPlaying);
    if (onPlaybackStateChangeRef.current) {
      onPlaybackStateChangeRef.current(nextIsPlaying);
    }
  }, []);

  const handleEnded = useCallback(() => {
    if (isBookMode && currentTrackIndex < playlist.length - 1) {
      console.log('[AudioPlayer] Track ended, advancing...');
      setCurrentTrackIndex(prev => prev + 1);
    } else {
      console.log('[AudioPlayer] Finished.');
      syncPlaybackState(false);
    }
  }, [isBookMode, currentTrackIndex, playlist.length, syncPlaybackState]);

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
      // Stop accruing listening seconds while audio is stalled — capture the
      // elapsed run up to now into pending, then clear the checkpoint so the
      // periodic interval doesn't restart accrual mid-buffer.
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
      // Manual pauses should cancel bounded segment playback so resume/play
      // does not remain tied to an old sentence boundary.
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
  }, [audioRef, contentKey, handleLoadedMetadata, handleTimeUpdate, handleEnded, handleError, resetSegmentPlayback, syncPlaybackState]);

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

  // --- SEVEN: Progress saving ----------------------------------------------
  const saveProgress = useCallback(async (force = false) => {
    const audio = audioRef.current || latestAudioElementRef.current;
    const {
      isBookMode: isBookModeSnapshot,
      bookId,
      textId: textIdSnapshot,
      currentTrackIndex: currentTrackIndexSnapshot,
      playlist: playlistSnapshot,
      isInitialized: isInitializedSnapshot,
      isPlaying: isPlayingSnapshot
    } = latestPlaybackStateRef.current;

    if (!audio || !isInitializedSnapshot) return;
    if (!force && audio.paused && !isPlayingSnapshot) return;

    const currentPos = audio.currentTime;
    const track = playlistSnapshot[currentTrackIndexSnapshot];
    if (!track) return;

    if (positionStorageKey && currentPos > 0) {
      try {
        localStorage.setItem(positionStorageKey, JSON.stringify({
          position: currentPos,
          trackId: track.trackId,
          trackIndex: currentTrackIndexSnapshot,
          timestamp: Date.now()
        }));
      } catch { /* quota exceeded or unavailable */ }
    }

    try {
      const isPageLifecycleSave = lifecycleSaveRef.current || document.hidden;
      if (isBookModeSnapshot && bookId != null) {
        await updateAudiobookProgress(bookId, {
          currentAudiobookTrackId: (track.trackId as number | null) ?? null,
          currentAudiobookPosition: currentPos
        }, {
          keepalive: isPageLifecycleSave
        });
      } else if (textIdSnapshot != null) {
        await updateAudioLessonProgress(textIdSnapshot, {
          currentPosition: currentPos
        }, {
          keepalive: isPageLifecycleSave
        });
      }
    } catch (e) {
      if ((lifecycleSaveRef.current || document.hidden) && isLifecycleNetworkError(e)) {
        console.debug('[AudioPlayer] Ignoring page-lifecycle progress save interruption.', e);
        return;
      }
      console.error('Save progress failed', e);
    }
  }, [audioRef, positionStorageKey]);

  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  const flushListeningActivity = useCallback((force = false) => {
    const tracker = listeningTrackerRef.current;
    const payload = tracker.prepareFlush(Date.now(), force, isPlayingRef.current);
    if (!payload) return;

    const isLifecycleFlush = lifecycleSaveRef.current || (typeof document !== 'undefined' && document.hidden);
    const logPromise = isLifecycleFlush
      ? logListeningActivity(payload.languageId, payload.durationSeconds, { keepalive: true })
      : logListeningActivity(payload.languageId, payload.durationSeconds);
    Promise.resolve(logPromise).catch((e: unknown) => {
      if (isLifecycleFlush && isLifecycleNetworkError(e)) {
        console.debug('[AudioPlayer] Ignoring page-lifecycle listening flush interruption.', e);
        return;
      }
      tracker.restorePending(payload.durationSeconds);
      console.error('Log listening activity failed', e);
    });
  }, []);

  useEffect(() => {
    flushListeningActivityRef.current = flushListeningActivity;
  }, [flushListeningActivity]);

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

  const wasPlayingRef = useRef(false);

  useEffect(() => {
    const tracker = listeningTrackerRef.current;
    if (isPlaying) {
      // Only arm the checkpoint if one isn't already in flight — the `playing`
      // audio event may have already set it. Overwriting would discard accrual.
      tracker.ensureCheckpoint(Date.now());
      wasPlayingRef.current = true;
    } else if (wasPlayingRef.current) {
      console.log('[AudioPlayer] Paused - Saving progress.');
      flushListeningActivity(true);
      tracker.clearCheckpoint();
      saveProgress(true);
      wasPlayingRef.current = false;
    }
  }, [isPlaying, saveProgress, flushListeningActivity]);

  useEffect(() => {
    return () => {
      console.log('[AudioPlayer] Unmounting - Saving progress.');
      flushListeningActivityRef.current?.(true);
      listeningTrackerRef.current.clearCheckpoint();
      saveProgressRef.current?.(true);
    };
  }, []);

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
  }, []);

  // --- Cross-device sync ----------------------------------------------------
  const justStartedPlayingRef = useRef(false);

  useEffect(() => {
    if (isPlaying && isInitialized && !justStartedPlayingRef.current) {
      justStartedPlayingRef.current = true;
      console.log('[AudioPlayer] Play started - saving position for cross-device sync');
      playbackStartedContentKeyRef.current = contentKey;
      saveProgress(true);
      lastServerUpdateRef.current = Date.now();
    } else if (!isPlaying) {
      justStartedPlayingRef.current = false;
    }
  }, [contentKey, isPlaying, isInitialized, saveProgress]);

  useEffect(() => {
    if (isPlaying || !isInitialized) return;

    const checkRemoteProgress = async () => {
      if (document.hidden) return;

      try {
        let remoteProgress: Awaited<ReturnType<typeof getAudiobookProgress>> |
                            Awaited<ReturnType<typeof getAudioLessonProgress>> |
                            null = null;

        if (isBookMode && book?.bookId) {
          remoteProgress = await getAudiobookProgress(book.bookId);
        } else if (!isBookMode && textId) {
          remoteProgress = await getAudioLessonProgress(textId);
        }

        if (!remoteProgress?.updatedAt) return;

        const remoteUpdateTime = new Date(remoteProgress.updatedAt).getTime();
        const localUpdateTime = lastServerUpdateRef.current || 0;

        if (remoteUpdateTime > localUpdateTime + 2000) {
          if (!isBookMode && playbackStartedContentKeyRef.current === contentKey) {
            lastServerUpdateRef.current = remoteUpdateTime;
            return;
          }

          console.log('[AudioPlayer] Cross-device sync: detected newer remote position');

          let newPosition: number | null = null;
          let newTrackIndex = currentTrackIndex;

          if (isBookMode) {
            if ('currentAudiobookTrackId' in remoteProgress && remoteProgress.currentAudiobookTrackId) {
              const idx = sourceTracks.findIndex(t => t.trackId === remoteProgress!.currentAudiobookTrackId);
              if (idx !== -1) {
                newTrackIndex = idx;
                newPosition = remoteProgress.currentAudiobookPosition ?? null;
              }
            }
          } else if ('currentPosition' in remoteProgress) {
            newPosition = remoteProgress.currentPosition ?? null;
          }

          if (newPosition != null && newPosition > 0) {
            if (newTrackIndex !== currentTrackIndex) {
              setCurrentTrackIndex(newTrackIndex);
            }

            const audio = audioRef.current;
            if (audio && Math.abs(audio.currentTime - newPosition) > 2) {
              console.log(`[AudioPlayer] Cross-device sync: seeking to ${newPosition}s`);
              audio.currentTime = newPosition;
              setCurrentTime(newPosition);
            }
          }

          lastServerUpdateRef.current = remoteUpdateTime;
        }
      } catch (e) {
        console.error('[AudioPlayer] Cross-device sync check failed:', e);
      }
    };

    const pollInterval = setInterval(checkRemoteProgress, 5000);
    checkRemoteProgress();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkRemoteProgress();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [audioRef, book?.bookId, contentKey, currentTrackIndex, isBookMode, isInitialized, isPlaying, sourceTracks, textId]);

  // --- EIGHT: Render-side controls -----------------------------------------
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
  }, [audioRef, contentKey, requestAudioPlay]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const d = (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) ? audio.duration : duration;
    if (!d) return;

    const newTime = Math.max(0, Math.min(time, d));
    console.log(`[AudioPlayer] Seeking to ${newTime}s (Requested: ${time}s, Duration: ${d}s)`);
    if (segmentPlaybackRef.current.active) {
      resetSegmentPlayback();
    }
    userPositionIntentContentKeyRef.current = contentKey;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(newTime);
    }
  }, [audioRef, contentKey, duration, resetSegmentPlayback]);

  const goToNextTrack = useCallback(() => {
    if (currentTrackIndex < playlist.length - 1) {
      console.log('[AudioPlayer] Manually advancing to next track.');
      setCurrentTrackIndex(prev => prev + 1);
    }
  }, [currentTrackIndex, playlist.length]);

  const goToPrevTrack = useCallback(() => {
    if (currentTrackIndex > 0) {
      console.log('[AudioPlayer] Manually going to previous track.');
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
