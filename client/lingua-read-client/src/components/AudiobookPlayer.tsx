import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button, Spinner, Alert, ProgressBar } from 'react-bootstrap';
import { getAudiobookProgress, updateAudiobookProgress, getAudioLessonProgress, updateAudioLessonProgress, logListeningActivity } from '../utils/api';
import { formatTime } from '../utils/helpers';
import './AudiobookPlayer.css';

interface SegmentPlaybackState {
  active: boolean;
  requestId: string | number | null;
  startTime: number;
  endTime: number;
  remainingRepeats: number;
}

const createSegmentPlaybackState = (): SegmentPlaybackState => ({
  active: false,
  requestId: null,
  startTime: 0,
  endTime: 0,
  remainingRepeats: 0
});

const normalizeMediaSrc = (src: string | null | undefined): string => {
  if (!src) return '';
  if (src.startsWith('blob:')) return src;

  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isAbortLikeError = (errorLike: any): boolean => {
  const name = errorLike?.name || '';
  const message = errorLike?.message || '';
  const code = errorLike?.code;

  return name === 'AbortError' || code === 1 || /abort(ed)?/i.test(message);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isLifecycleNetworkError = (errorLike: any): boolean => {
  const name = errorLike?.name || '';
  const message = errorLike?.message || '';

  return name === 'TypeError' && /networkerror|failed to fetch/i.test(message);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setAudioPlaybackIntent = (audio: any, shouldPlay: boolean) => {
  if (!audio) return;
  audio.__lrAllowPlayback = shouldPlay;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getAudioPlaybackIntent = (audio: any): boolean => Boolean(audio?.__lrAllowPlayback);
const LISTENING_ACTIVITY_FLUSH_SECONDS = 10;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getTrackDisplayName = (track: any): string => {
  if (!track) return '';
  if (track.title) return track.title;

  const path = track.filePath || track.url || '';
  const fileName = path.split(/[\\/]/).pop() || '';
  return fileName.replace(/\.[^/.]+$/, '') || 'Untitled track';
};

// Most props are typed loosely because the caller (TextDisplay or LessonHeader)
// passes different subsets per usage. Phase E2 will split the player into
// modules with proper contracts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAudio = any;

interface AudiobookPlayerProps {
  type?: 'book' | 'lesson';
  book?: AnyAudio;
  audioSrc?: string | null;
  textId?: number | string | null;
  languageId?: number | string | null;
  audioRef?: React.MutableRefObject<HTMLAudioElement | null>;
  onTimeUpdate?: AnyAudio;
  onPlaybackStateChange?: AnyAudio;
  segmentPlaybackRequest?: AnyAudio;
}

const AudiobookPlayer = ({
  type = 'book',
  book,
  audioSrc,
  textId,
  languageId,
  audioRef: externalAudioRef,
  onTimeUpdate,
  onPlaybackStateChange,
  segmentPlaybackRequest
}: AudiobookPlayerProps) => {
  // --- ONE: Refs and Stable Callbacks ---
  const internalAudioRef = useRef(null);
  const audioRef = externalAudioRef || internalAudioRef;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  const progressBarRef = useRef(null);
  const segmentPlaybackRef = useRef(createSegmentPlaybackState());
  const sourceSwapRef = useRef({ previousSrc: '', nextSrc: '' });
  const lifecycleSaveRef = useRef(false);
  const latestAudioElementRef = useRef(null);
  const latestPlaybackStateRef = useRef({
    isBookMode: type === 'book',
    bookId: book?.bookId ?? null,
    textId: textId ?? null,
    currentTrackIndex: 0,
    playlist: [],
    isInitialized: false,
    isPlaying: false
  });
  const saveProgressRef = useRef(null);
  const restoredContentKeyRef = useRef('');
  const playbackStartedContentKeyRef = useRef('');
  const userPositionIntentContentKeyRef = useRef('');
  const listeningLastCheckpointAtRef = useRef(null);
  const pendingListeningSecondsRef = useRef(0);
  const listeningActivityLanguageIdRef = useRef(null);
  const flushListeningActivityRef = useRef(null);
  const isAudioStallingRef = useRef(false);

  // NOTE: Removed unused progressSaveRef

  // Keep onTimeUpdateRef current
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



  // --- TWO: State Management ---
  const isBookMode = type === 'book';
  const effectiveLanguageId = languageId || (book?.languageId);
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

  // Core Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true); // Initial load (seeking/fetching progress)
  const [isBuffering, setIsBuffering] = useState(false); // Network buffering
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('audioVolume');
    return saved ? parseFloat(saved) : 1.0;
  });

  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Track State
  const [playlist, setPlaylist] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);

  // Initialization Flags
  const [isInitialized, setIsInitialized] = useState(false);
  const initialSeekRef = useRef(null); // Position to seek to once metadata loads

  // Cross-device sync: track server update timestamp
  const lastServerUpdateRef = useRef(null);

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
    listeningActivityLanguageIdRef.current = effectiveLanguageId;
  }, [effectiveLanguageId]);

  // --- THREE: Data Derivation ---

  // Memoize the "source of truth" for tracks. 
  // FIX: Removed unnecessary `book.id` dependency (used book.bookId)
  const sourceTracks = useMemo(() => {
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
  }, [isBookMode, book, audioSrc]); // Depend on book object to catch deep changes if needed, or stick to book.audiobookTracks if stable. 'book' covers props updates.

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

  // --- FOUR: Initial Progress Loading ---
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
    if (audio?.readyState >= 1) {
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
        let serverUpdateTime = null;

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
          // Store server update time for cross-device sync
          if (progress?.updatedAt) {
            const parsedServerUpdateTime = new Date(progress.updatedAt).getTime();
            if (Number.isFinite(parsedServerUpdateTime)) {
              serverUpdateTime = parsedServerUpdateTime;
              lastServerUpdateRef.current = serverUpdateTime;
            }
          }
        } else if (!isBookMode && textId) {
          const progress = await getAudioLessonProgress(textId);
          if (progress?.currentPosition > 0) {
            savedPosition = progress.currentPosition;
            console.log(`[AudioPlayer] Restoring Lesson progress: Pos ${savedPosition}`);
          }
          if (progress?.updatedAt) {
            const parsedServerUpdateTime = new Date(progress.updatedAt).getTime();
            if (Number.isFinite(parsedServerUpdateTime)) {
              serverUpdateTime = parsedServerUpdateTime;
              lastServerUpdateRef.current = serverUpdateTime;
            }
          }
        }

        // Use localStorage when the server has no position, or when the local
        // checkpoint is clearly newer than the last server write.
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
        console.error("Failed to load progress:", e);
        // Fallback to localStorage if server is unreachable
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




  // --- FIVE: Active Track Management ---
  const currentTrack = playlist[currentTrackIndex];
  const currentTrackDisplayName = getTrackDisplayName(currentTrack);

  const resetSegmentPlayback = useCallback(() => {
    segmentPlaybackRef.current = createSegmentPlaybackState();
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

  const buildTrackSrc = useCallback((track: AnyAudio): string => {
    let src = track?.isLesson ? track.url : track?.filePath;

    if (src && !src.startsWith('http') && !src.startsWith('blob:')) {
      src = src.startsWith('/') ? src : `/${src}`;

      const envBaseUrl = import.meta.env.VITE_API_URL;
      if (envBaseUrl && envBaseUrl.startsWith('http')) {
        src = `${envBaseUrl}${src}`;
      }
    }

    return src || '';
  }, []);

  const logPlaybackInterruption = useCallback((context: string, errorLike: AnyAudio) => {
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
    if (!segmentPlaybackRequest?.requestId ||
        segmentPlaybackRef.current.requestId !== segmentPlaybackRequest.requestId) {
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

    // If it was already playing, continue playing the new track
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

    const startTime = Math.max(0, segmentPlaybackRequest.startTime || 0);
    const endTime = Math.max(startTime, segmentPlaybackRequest.endTime || startTime);
    const repeatCount = Math.max(1, segmentPlaybackRequest.repeatCount || 1);

    segmentPlaybackRef.current = {
      active: true,
      requestId: segmentPlaybackRequest.requestId,
      startTime,
      endTime,
      remainingRepeats: repeatCount
    };

    userPositionIntentContentKeyRef.current = contentKey;
    audio.currentTime = startTime;
    setCurrentTime(startTime);
    requestAudioPlay('Segment playback failed', { forceIntent: Boolean(segmentPlaybackRequest.forcePlay) });
  }, [audioRef, contentKey, requestAudioPlay, resetSegmentPlayback, segmentPlaybackRequest]);


  // --- SIX: Event Listeners & Logic ---

  // FIX: Wrapped handlers in useCallback to be stable dependencies
  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    sourceSwapRef.current = { previousSrc: '', nextSrc: '' };
    setDuration(audio.duration);
    setIsBuffering(false);
    applyInitialSeekIfReady(audio);
  }, [applyInitialSeekIfReady, audioRef]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;
    setCurrentTime(time);

    const segmentPlayback = segmentPlaybackRef.current;
    if (segmentPlayback.active && time >= Math.max(segmentPlayback.endTime - 0.05, segmentPlayback.startTime)) {
      if (segmentPlayback.remainingRepeats > 1) {
        segmentPlayback.remainingRepeats -= 1;
        audio.currentTime = segmentPlayback.startTime;
        setCurrentTime(segmentPlayback.startTime);
        requestAudioPlay('Segment replay failed');
        return;
      }

      const endTime = segmentPlayback.endTime;
      resetSegmentPlayback();
      audio.pause();
      audio.currentTime = endTime;
      setCurrentTime(endTime);
      if (onTimeUpdateRef.current) {
        onTimeUpdateRef.current(endTime);
      }
      return;
    }

    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(time);
    }
  }, [audioRef, requestAudioPlay, resetSegmentPlayback]);

  const syncPlaybackState = useCallback((nextIsPlaying: boolean) => {
    setIsPlaying(nextIsPlaying);
    if (onPlaybackStateChangeRef.current) {
      onPlaybackStateChangeRef.current(nextIsPlaying);
    }
  }, []);

  const handleEnded = useCallback(() => {
    if (isBookMode && currentTrackIndex < playlist.length - 1) {
      console.log("[AudioPlayer] Track ended, advancing...");
      setCurrentTrackIndex(prev => prev + 1);
    } else {
      console.log("[AudioPlayer] Finished.");
      syncPlaybackState(false);
    }
  }, [isBookMode, currentTrackIndex, playlist.length, syncPlaybackState]);

  const handleError = useCallback((e: Event) => {
    const audio = e?.target as HTMLAudioElement | null;
    const mediaErr = audio?.error;
    const currentSrc = normalizeMediaSrc(audio?.currentSrc ?? audio?.src);
    const expectedNextSrc = sourceSwapRef.current.nextSrc;
    const isSourceSwapAbort = expectedNextSrc && currentSrc === expectedNextSrc && isAbortLikeError(mediaErr);

    if (isSourceSwapAbort) {
      console.debug('[AudioPlayer] Ignoring media abort during source transition.', {
        src: audio?.currentSrc ?? audio?.src,
        mediaErrorCode: mediaErr?.code,
        mediaErrorMessage: mediaErr?.message
      });
      return;
    }

    console.error("Audio Error:", {
      event: e,
      src: audio?.currentSrc ?? audio?.src,
      networkState: audio?.networkState,
      readyState: audio?.readyState,
      mediaErrorCode: mediaErr?.code,
      mediaErrorMessage: mediaErr?.message,
    });
    setError("Error loading audio.");
    setIsBuffering(false);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onWaiting = () => {
      setIsBuffering(true);
      // Stop accruing listening seconds while audio is stalled — capture the
      // elapsed run up to now into pending, then null the checkpoint so the
      // periodic interval doesn't restart accrual mid-buffer.
      isAudioStallingRef.current = true;
      flushListeningActivityRef.current?.(false);
      listeningLastCheckpointAtRef.current = null;
    };
    const onPlaying = () => {
      sourceSwapRef.current = { previousSrc: '', nextSrc: '' };
      setIsBuffering(false);
      isAudioStallingRef.current = false;
      if (isPlayingRef.current) {
        listeningLastCheckpointAtRef.current = Date.now();
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
    audio.addEventListener('durationchange', handleLoadedMetadata); // Also listen for durationchange
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('playing', onPlaying);

    // Check if metadata is already loaded (race condition fix)
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
    // FIX: Added all handler dependencies
  }, [audioRef, contentKey, handleLoadedMetadata, handleTimeUpdate, handleEnded, handleError, resetSegmentPlayback, syncPlaybackState]);

  // Sync Playback Rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, audioRef]);

  // Sync Volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioRef]);

  // Restore Rate
  useEffect(() => {
    const savedCallback = localStorage.getItem('audioPlaybackRate');
    if (savedCallback) {
      const r = parseFloat(savedCallback);
      if (!isNaN(r)) setPlaybackRate(r);
    }
  }, []);


  // --- SEVEN: Progress Saving ---
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

    // Save to localStorage as fallback (survives failed keepalive requests on mobile refresh)
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
      if (isBookModeSnapshot && bookId) {
        await updateAudiobookProgress(bookId, {
          currentAudiobookTrackId: track.trackId,
          currentAudiobookPosition: currentPos
        }, {
          keepalive: isPageLifecycleSave
        });
      } else if (textIdSnapshot) {
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
      console.error("Save progress failed", e);
    }
  }, [audioRef, positionStorageKey]);

  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  const flushListeningActivity = useCallback((force = false) => {
    const now = Date.now();
    const lastCheckpointAt = listeningLastCheckpointAtRef.current;

    if (lastCheckpointAt != null) {
      const elapsedSeconds = (now - lastCheckpointAt) / 1000;
      if (elapsedSeconds > 0) {
        pendingListeningSecondsRef.current += elapsedSeconds;
      }
      listeningLastCheckpointAtRef.current = now;
    } else if (isPlayingRef.current && !isAudioStallingRef.current) {
      listeningLastCheckpointAtRef.current = now;
    }

    // On force flush (pause / unmount / page lifecycle) round the sub-second
    // remainder so it isn't repeatedly truncated away. Periodic flushes still
    // floor so they never report seconds that haven't accumulated yet.
    const secondsToLog = force
      ? Math.round(pendingListeningSecondsRef.current)
      : Math.floor(pendingListeningSecondsRef.current);
    if (secondsToLog <= 0 || (!force && secondsToLog < LISTENING_ACTIVITY_FLUSH_SECONDS)) {
      return;
    }

    const languageIdForActivity = listeningActivityLanguageIdRef.current;
    if (!languageIdForActivity) {
      return;
    }

    const isLifecycleFlush = lifecycleSaveRef.current || (typeof document !== 'undefined' && document.hidden);
    pendingListeningSecondsRef.current -= secondsToLog;
    const logPromise = isLifecycleFlush
      ? logListeningActivity(languageIdForActivity, secondsToLog, { keepalive: true })
      : logListeningActivity(languageIdForActivity, secondsToLog);
    Promise.resolve(logPromise).catch(e => {
      if (isLifecycleFlush && isLifecycleNetworkError(e)) {
        console.debug('[AudioPlayer] Ignoring page-lifecycle listening flush interruption.', e);
        return;
      }
      pendingListeningSecondsRef.current += secondsToLog;
      console.error('Log listening activity failed', e);
    });
  }, []);

  useEffect(() => {
    flushListeningActivityRef.current = flushListeningActivity;
  }, [flushListeningActivity]);

  // Periodic Save
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

  // Save on Unmount / Pause
  // Ref to track previous playing state to valid "Pause" event
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    if (isPlaying) {
      if (listeningLastCheckpointAtRef.current == null) {
        listeningLastCheckpointAtRef.current = Date.now();
      }
      wasPlayingRef.current = true;
    } else if (wasPlayingRef.current) {
      // Transitioned from True -> False
      console.log("[AudioPlayer] Paused - Saving progress.");
      flushListeningActivity(true);
      listeningLastCheckpointAtRef.current = null;
      saveProgress(true); // Force save on pause
      wasPlayingRef.current = false;
    }
  }, [isPlaying, saveProgress, flushListeningActivity]);

  // Save on Unmount (React Lifecycle)
  useEffect(() => {
    return () => {
      console.log("[AudioPlayer] Unmounting - Saving progress.");
      flushListeningActivityRef.current?.(true);
      listeningLastCheckpointAtRef.current = null;
      saveProgressRef.current?.(true);
    };
  }, []);

  // Page Exit Save (Browser Lifecycle)
  useEffect(() => {
    const handleUnload = () => {
      lifecycleSaveRef.current = true;
      flushListeningActivityRef.current?.(true);
      listeningLastCheckpointAtRef.current = null;
      saveProgressRef.current?.(true);
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload); // Also listen for beforeunload
    return () => {
      lifecycleSaveRef.current = false;
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    }
  }, []);

  // --- CROSS-DEVICE SYNC ---

  // Track if we just transitioned to playing (to avoid re-saving on every render)
  const justStartedPlayingRef = useRef(false);

  // Save progress immediately when playback STARTS (transition from paused to playing)
  useEffect(() => {
    if (isPlaying && isInitialized && !justStartedPlayingRef.current) {
      justStartedPlayingRef.current = true;
      console.log('[AudioPlayer] Play started - saving position for cross-device sync');
      playbackStartedContentKeyRef.current = contentKey;
      saveProgress(true);
      // Update our known server time to now
      lastServerUpdateRef.current = Date.now();
    } else if (!isPlaying) {
      // Reset the flag when playback stops
      justStartedPlayingRef.current = false;
    }
  }, [contentKey, isPlaying, isInitialized, saveProgress]);

  // Poll for remote updates when NOT playing (to sync from other devices)
  useEffect(() => {
    // Only poll when not playing and initialized
    if (isPlaying || !isInitialized) return;

    const checkRemoteProgress = async () => {
      // Don't poll if page is hidden (browser tab not visible)
      if (document.hidden) return;

      try {
        let remoteProgress = null;

        if (isBookMode && book?.bookId) {
          remoteProgress = await getAudiobookProgress(book.bookId);
        } else if (!isBookMode && textId) {
          remoteProgress = await getAudioLessonProgress(textId);
        }

        if (!remoteProgress?.updatedAt) return;

        const remoteUpdateTime = new Date(remoteProgress.updatedAt).getTime();
        const localUpdateTime = lastServerUpdateRef.current || 0;

        // If remote update is newer than our last known update, sync to it
        // Use 2 second buffer to account for potential clock drift
        if (remoteUpdateTime > localUpdateTime + 2000) {
          if (!isBookMode && playbackStartedContentKeyRef.current === contentKey) {
            lastServerUpdateRef.current = remoteUpdateTime;
            return;
          }

          console.log('[AudioPlayer] Cross-device sync: detected newer remote position');

          let newPosition = null;
          let newTrackIndex = currentTrackIndex;

          if (isBookMode) {
            // Verify the remote track matches expected content. The audiobook
            // progress endpoint returns `{ currentAudiobookTrackId, currentAudiobookPosition }`
            // while the lesson endpoint returns `{ currentPosition }` — narrow with `in`.
            if ('currentAudiobookTrackId' in remoteProgress && remoteProgress.currentAudiobookTrackId) {
              const idx = sourceTracks.findIndex(t => t.trackId === remoteProgress.currentAudiobookTrackId);
              if (idx !== -1) {
                newTrackIndex = idx;
                newPosition = remoteProgress.currentAudiobookPosition ?? null;
              }
              // If track not found, don't sync (might be different audiobook)
            }
          } else if ('currentPosition' in remoteProgress) {
            newPosition = remoteProgress.currentPosition ?? null;
          }

          // Only sync if we have a valid position (not null/undefined and > 0)
          if (newPosition != null && newPosition > 0) {
            // Update track index if changed
            if (newTrackIndex !== currentTrackIndex) {
              setCurrentTrackIndex(newTrackIndex);
            }

            // Seek to new position
            const audio = audioRef.current;
            if (audio && Math.abs(audio.currentTime - newPosition) > 2) { // Only sync if diff > 2 seconds
              console.log(`[AudioPlayer] Cross-device sync: seeking to ${newPosition}s`);
              audio.currentTime = newPosition;
              setCurrentTime(newPosition);
            }
          }

          // Update our known server time regardless (to avoid re-checking)
          lastServerUpdateRef.current = remoteUpdateTime;
        }
      } catch (e) {
        console.error('[AudioPlayer] Cross-device sync check failed:', e);
      }
    };

    // Poll every 5 seconds when not playing
    const pollInterval = setInterval(checkRemoteProgress, 5000);

    // Also check immediately when we stop playing
    checkRemoteProgress();

    // Listen for visibility changes to poll when tab becomes visible again
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


  // --- EIGHT: Render Helpers ---

  // FIX: Moved helper functions to BEFORE the keyboard effect to allow hoisting/dependency reference
  // Wrapped in useCallback for dependency stability
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
  }, [audioRef, contentKey, requestAudioPlay]); // Safe dependency

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Use audio.duration if available, fallback to state
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
      console.log("[AudioPlayer] Manually advancing to next track.");
      setCurrentTrackIndex(prev => prev + 1);
    }
  }, [currentTrackIndex, playlist.length]);

  const goToPrevTrack = useCallback(() => {
    if (currentTrackIndex > 0) {
      console.log("[AudioPlayer] Manually going to previous track.");
      setCurrentTrackIndex(prev => prev - 1);
    }
  }, [currentTrackIndex]);

  const changeRate = (diff: number) => {
    setPlaybackRate(prev => {
      const newRate = parseFloat((prev + diff).toFixed(2));
      const clamped = Math.max(0.5, Math.min(newRate, 2.0));
      localStorage.setItem('audioPlaybackRate', String(clamped));
      return clamped;
    });
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    localStorage.setItem('audioVolume', String(newVolume));
  };

  // Keyboard Shortcuts
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
    // FIX: Added dependencies
  }, [togglePlayPause, goToNextTrack, goToPrevTrack]);

  return (
    <div className="audiobook-player p-1 rounded-2 audiobook-player-custom-bg" style={{ maxWidth: '550px', width: '100%' }}>
      {/* 
        CRITICAL: Always render the audio element. 
        If it's conditionally rendered (e.g. only after isLoading is false), 
        the audioRef will be null when the event listener effect runs for the first time, 
        causing seeking and time updates to stay broken until a prop changes.
      */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />

      {isLoading ? (
        <div className="d-flex justify-content-center p-2">
          <Spinner animation="border" size="sm" />
        </div>
      ) : playlist.length === 0 ? (
        <div className="text-muted small p-2">No audio available</div>
      ) : (
        <>
          {error && <Alert variant="danger" className="p-1 mb-1 small">{error}</Alert>}

          {isBookMode && playlist.length > 1 && (
            <div className="audiobook-player__track-info mb-1" title={currentTrackDisplayName}>
              <span className="fw-semibold">
                Track {currentTrackIndex + 1} of {playlist.length}
              </span>
              {currentTrackDisplayName && (
                <span className="text-truncate">
                  {currentTrackDisplayName}
                </span>
              )}
            </div>
          )}

          <div className="d-flex align-items-center gap-3">
            {/* Progress Section */}
            <div className="d-flex align-items-center flex-grow-1 gap-2" style={{ minWidth: '150px' }}>
              <small className="text-muted text-nowrap small-xs">
                {formatTime(currentTime)}
              </small>
              <ProgressBar
                ref={progressBarRef}
                now={duration ? (currentTime / duration) * 100 : 0}
                className="flex-grow-1"
                style={{ height: '4px', cursor: 'pointer', minWidth: '60px' }}
                variant="info"
                onClick={(e) => {
                  if (!progressBarRef.current) return;
                  const rect = progressBarRef.current.getBoundingClientRect();
                  const pos = (e.clientX - rect.left) / rect.width;
                  const d = audioRef.current?.duration || duration;
                  if (d) seek(pos * d);
                }}
              />
              <small className="text-muted text-nowrap small-xs">
                {formatTime(duration)}
              </small>
            </div>

            {/* Controls Section */}
            <div className="d-flex align-items-center gap-2 flex-wrap audiobook-player__controls">
              <div className="d-flex gap-1 audiobook-player__transport">
                {isBookMode && playlist.length > 1 && (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="p-1 border-0"
                    onClick={goToPrevTrack}
                    disabled={currentTrackIndex === 0}
                    title="Previous Track ([)"
                  >
                    <i className="bi bi-skip-start-fill"></i>
                  </Button>
                )}

                <Button variant="outline-secondary" size="sm" className="p-1 border-0" onClick={() => seek(currentTime - 10)} title="-10s">
                  <i className="bi bi-rewind-fill"></i>
                </Button>

                <Button
                  variant={isPlaying ? "outline-primary" : "primary"}
                  size="sm"
                  className="p-1 rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: '30px', height: '30px' }}
                  onClick={togglePlayPause}
                  title="Play/Pause (Space)"
                >
                  {isBuffering ? (
                    <Spinner animation="grow" size="sm" style={{ width: '0.6rem', height: '0.6rem' }} />
                  ) : (
                    <i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'}`}></i>
                  )}
                </Button>

                <Button variant="outline-secondary" size="sm" className="p-1 border-0" onClick={() => seek(currentTime + 10)} title="+10s">
                  <i className="bi bi-fast-forward-fill"></i>
                </Button>

                {isBookMode && playlist.length > 1 && (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    className="p-1 border-0"
                    onClick={goToNextTrack}
                    disabled={currentTrackIndex === playlist.length - 1}
                    title="Next Track (])"
                  >
                    <i className="bi bi-skip-end-fill"></i>
                  </Button>
                )}
              </div>

              {/* Rate Controls */}
              <div className="d-flex align-items-center border-start ps-2 gap-1 audiobook-player__rate-group">
                <Button variant="link" size="sm" className="p-0 text-decoration-none text-secondary"
                  onClick={() => changeRate(-0.05)} disabled={playbackRate <= 0.5} title="Slower">-</Button>
                <span className="small text-muted" style={{ minWidth: '35px', textAlign: 'center', fontSize: '0.75rem' }}>{playbackRate.toFixed(2)}x</span>
                <Button variant="link" size="sm" className="p-0 text-decoration-none text-secondary"
                  onClick={() => changeRate(0.05)} disabled={playbackRate >= 2.0} title="Faster">+</Button>
              </div>

              {/* Volume Control */}
              <div className="d-flex align-items-center gap-1 ms-2 ps-2 border-start audiobook-player__volume-group" style={{ width: '80px' }}>
                <i className={`bi ${volume === 0 ? 'bi-volume-mute-fill' : volume < 0.5 ? 'bi-volume-down-fill' : 'bi-volume-up-fill'} text-muted small`}></i>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={handleVolumeChange}
                  className="form-range"
                  style={{ height: '4px', width: '50px' }}
                  title={`Volume: ${Math.round(volume * 100)}%`}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AudiobookPlayer;