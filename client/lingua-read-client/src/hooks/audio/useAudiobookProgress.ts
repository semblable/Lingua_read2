import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import {
  getAudiobookProgress,
  updateAudiobookProgress,
  getAudioLessonProgress,
  updateAudioLessonProgress
} from '../../utils/api';
import { isLifecycleNetworkError } from '../../audio/mediaSrc';
import type { AudioElementRef, AudiobookBookLike, AudiobookTrackLike } from '../useAudiobookPlayer';
import type { ListeningActivityTracker } from '../../audio/listeningActivity';

export type LatestPlaybackStateSnapshot = {
  isBookMode: boolean;
  bookId: number | string | null;
  textId: number | string | null;
  currentTrackIndex: number;
  playlist: AudiobookTrackLike[];
  isInitialized: boolean;
  isPlaying: boolean;
};

export type UseAudiobookProgressArgs = {
  isBookMode: boolean;
  book: AudiobookBookLike | null | undefined;
  textId: number | string | null | undefined;
  contentKey: string;
  positionStorageKey: string | null;
  sourceTracks: AudiobookTrackLike[];
  audioRef: AudioElementRef;
  latestAudioElementRef: React.MutableRefObject<HTMLAudioElement | null>;
  latestPlaybackStateRef: React.MutableRefObject<LatestPlaybackStateSnapshot>;
  lifecycleSaveRef: React.MutableRefObject<boolean>;
  isPlaying: boolean;
  isInitialized: boolean;
  currentTrackIndex: number;
  flushListeningActivityRef: React.MutableRefObject<((force?: boolean) => void) | null>;
  listeningTrackerRef: React.MutableRefObject<ListeningActivityTracker>;
  setCurrentTrackIndex: React.Dispatch<React.SetStateAction<number>>;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  setIsInitialized: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
};

export type UseAudiobookProgressResult = {
  saveProgress: (force?: boolean) => Promise<void>;
  saveProgressRef: React.MutableRefObject<((force?: boolean) => Promise<void>) | null>;
  queueInitialSeek: (position: number) => boolean;
  applyInitialSeekIfReady: (audio: HTMLAudioElement | null) => boolean;
  restoredContentKeyRef: React.MutableRefObject<string>;
  playbackStartedContentKeyRef: React.MutableRefObject<string>;
  userPositionIntentContentKeyRef: React.MutableRefObject<string>;
  initialSeekRef: React.MutableRefObject<number | null>;
  lastServerUpdateRef: React.MutableRefObject<number | null>;
  justStartedPlayingRef: React.MutableRefObject<boolean>;
};

export const useAudiobookProgress = ({
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
  setCurrentTrackIndex,
  setCurrentTime,
  setIsInitialized,
  setIsLoading
}: UseAudiobookProgressArgs): UseAudiobookProgressResult => {
  const saveProgressRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const restoredContentKeyRef = useRef('');
  const playbackStartedContentKeyRef = useRef('');
  const userPositionIntentContentKeyRef = useRef('');
  const initialSeekRef = useRef<number | null>(null);
  const lastServerUpdateRef = useRef<number | null>(null);
  const justStartedPlayingRef = useRef(false);

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
  }, [contentKey, setCurrentTime]);

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
  }, [applyInitialSeekIfReady, audioRef, contentKey, setCurrentTime]);

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
  }, [book?.bookId, isBookMode, positionStorageKey, queueInitialSeek, sourceTracks, textId, setCurrentTrackIndex, setIsInitialized, setIsLoading]);

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
  }, [audioRef, latestAudioElementRef, latestPlaybackStateRef, lifecycleSaveRef, positionStorageKey]);

  useEffect(() => {
    saveProgressRef.current = saveProgress;
  }, [saveProgress]);

  // Cross-device sync: save position when playback starts so other clients
  // can detect it as the newest update.
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

  // Cross-device sync: poll for newer remote progress while paused.
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
  }, [audioRef, book?.bookId, contentKey, currentTrackIndex, isBookMode, isInitialized, isPlaying, sourceTracks, textId, setCurrentTime, setCurrentTrackIndex]);

  return {
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
  };
};
