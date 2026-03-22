import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button, Spinner, Alert, ProgressBar } from 'react-bootstrap';
import { getAudiobookProgress, updateAudiobookProgress, getAudioLessonProgress, updateAudioLessonProgress, logListeningActivity } from '../utils/api';
import { formatTime } from '../utils/helpers';
import './AudiobookPlayer.css';

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
}) => {
  // --- ONE: Refs and Stable Callbacks ---
  const internalAudioRef = useRef(null);
  const audioRef = externalAudioRef || internalAudioRef;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  const progressBarRef = useRef(null);
  const segmentPlaybackRef = useRef({
    active: false,
    requestId: null,
    startTime: 0,
    endTime: 0,
    remainingRepeats: 0
  });

  // NOTE: Removed unused progressSaveRef

  // Keep onTimeUpdateRef current
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onPlaybackStateChangeRef.current = onPlaybackStateChange;
  }, [onPlaybackStateChange]);



  // --- TWO: State Management ---
  const isBookMode = type === 'book';
  const effectiveLanguageId = languageId || (book?.languageId);

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
      if (prev.length !== newTracks.length) {
        setIsInitialized(false); // Reset initialization on track change
        return newTracks;
      }
      if (prev.length > 0 && prev[0].trackId !== newTracks[0]?.trackId) {
        setIsInitialized(false);
        return newTracks;
      }
      return newTracks;
    });
  }, [sourceTracks]);


  // --- FOUR: Initial Progress Loading ---
  useEffect(() => {
    let mounted = true;
    const loadProgress = async () => {
      // FIX: Added 'sourceTracks' dependency logic inside or check
      // FIX: Added 'sourceTracks' dependency logic inside or check
      if (sourceTracks.length === 0) {
        // Don't set initialized to true if no tracks, wait for them.
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        let savedTrackIndex = 0;
        let savedPosition = 0;

        if (isBookMode && book?.bookId) {
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
            lastServerUpdateRef.current = new Date(progress.updatedAt).getTime();
          }
        } else if (!isBookMode && textId) {
          const progress = await getAudioLessonProgress(textId);
          if (progress?.currentPosition) {
            savedPosition = progress.currentPosition;
            console.log(`[AudioPlayer] Restoring Lesson progress: Pos ${savedPosition}`);
          }
          // Store server update time for cross-device sync
          if (progress?.updatedAt) {
            lastServerUpdateRef.current = new Date(progress.updatedAt).getTime();
          }
        }

        if (mounted) {
          setCurrentTrackIndex(savedTrackIndex);
          if (savedPosition > 0) {
            initialSeekRef.current = savedPosition;
            setCurrentTime(savedPosition);
          }
          setIsInitialized(true);
        }
      } catch (e) {
        console.error("Failed to load progress:", e);
        if (mounted) setIsInitialized(true);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadProgress();

    return () => {
      mounted = false;
    };
    // FIX: Included sourceTracks to re-run if tracks change (although logic handles empty). 
    // Ideally we want this to run once per "content", but sourceTracks is the content def.
  }, [book?.bookId, textId, isBookMode, sourceTracks]);




  // --- FIVE: Active Track Management ---
  const currentTrack = playlist[currentTrackIndex];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isInitialized || !currentTrack) return;

    // FIX: More robust URL construction. 
    // If it's a full URL, use it. Otherwise, ensure it starts with / for relative path.
    let src = currentTrack.isLesson ? currentTrack.url : currentTrack.filePath;

    if (src && !src.startsWith('http') && !src.startsWith('blob:')) {
      // Prepend leading slash if missing
      src = src.startsWith('/') ? src : `/${src}`;

      // If we have an environment variable for the base URL, use it (optional prefix)
      // But only if it's a full URL (origin). If it's just something like "/api", we don't want it for static files.
      const envBaseUrl = process.env.REACT_APP_API_URL;
      if (envBaseUrl && envBaseUrl.startsWith('http')) {
        src = `${envBaseUrl}${src}`;
      }
    }

    const currentSrc = audio.src;

    // FIX: Optimized check for same source
    const isSameSrc = currentSrc && (currentSrc.includes(src) || (src && src.includes(currentSrc)));

    if (isSameSrc) {
      return;
    }

    segmentPlaybackRef.current = {
      active: false,
      requestId: null,
      startTime: 0,
      endTime: 0,
      remainingRepeats: 0
    };

    console.log(`[AudioPlayer] Loading Track: ${src}`);
    audio.src = src;
    audio.load();
    setIsBuffering(true);

    // If it was already playing, continue playing the new track
    if (isPlayingRef.current) {
      audio.play().catch(e => console.warn("Auto-play on track change failed", e));
    }
  }, [currentTrack, isInitialized, audioRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!segmentPlaybackRequest?.requestId) {
      if (segmentPlaybackRef.current.active) {
        segmentPlaybackRef.current = { active: false, requestId: null, startTime: 0, endTime: 0, remainingRepeats: 0 };
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

    audio.currentTime = startTime;
    setCurrentTime(startTime);
    audio.play().catch(e => console.warn("Segment playback failed", e));
  }, [audioRef, segmentPlaybackRequest]);


  // --- SIX: Event Listeners & Logic ---

  // FIX: Wrapped handlers in useCallback to be stable dependencies
  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration);
    setIsBuffering(false);

    if (initialSeekRef.current !== null) {
      console.log(`[AudioPlayer] Seeking to ${initialSeekRef.current}`);
      audio.currentTime = initialSeekRef.current;
      setCurrentTime(initialSeekRef.current);
      initialSeekRef.current = null;
    }
  }, [audioRef]);

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
        audio.play().catch(e => console.warn("Segment replay failed", e));
        return;
      }

      const endTime = segmentPlayback.endTime;
      segmentPlaybackRef.current = {
        active: false,
        requestId: null,
        startTime: 0,
        endTime: 0,
        remainingRepeats: 0
      };
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
  }, [audioRef]);

  const syncPlaybackState = useCallback((nextIsPlaying) => {
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

  const handleError = useCallback((e) => {
    console.error("Audio Error:", e);
    setError("Error loading audio.");
    setIsBuffering(false);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsBuffering(false);
    };
    const onPlay = () => syncPlaybackState(true);
    const onPause = () => {
      // Manual pauses should cancel bounded segment playback so resume/play
      // does not remain tied to an old sentence boundary.
      if (segmentPlaybackRef.current.active) {
        segmentPlaybackRef.current = {
          active: false,
          requestId: null,
          startTime: 0,
          endTime: 0,
          remainingRepeats: 0
        };
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
  }, [audioRef, handleLoadedMetadata, handleTimeUpdate, handleEnded, handleError, syncPlaybackState]);

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
    const audio = audioRef.current;
    if (!audio || !isInitialized) return;

    if (!force && audio.paused && !isPlaying) return;

    // FIX: Removed unused 'nav'
    const currentPos = audio.currentTime;
    const track = playlist[currentTrackIndex];
    if (!track) return;

    try {
      if (isBookMode && book?.bookId) {
        await updateAudiobookProgress(book.bookId, {
          currentAudiobookTrackId: track.trackId,
          currentAudiobookPosition: currentPos
        });
      } else if (textId) {
        await updateAudioLessonProgress(textId, {
          currentPosition: currentPos
        });
      }
    } catch (e) {
      console.error("Save progress failed", e);
    }
    // FIX: Added audioRef dependency
  }, [isBookMode, book?.bookId, textId, currentTrackIndex, playlist, isInitialized, isPlaying, audioRef]);

  // Periodic Save
  useEffect(() => {
    const interval = setInterval(() => {
      if (isPlaying) {
        saveProgress();
        if (effectiveLanguageId) {
          logListeningActivity(effectiveLanguageId, 10);
        }
      }
    }, 10000);

    return () => {
      clearInterval(interval);
    };
  }, [isPlaying, saveProgress, effectiveLanguageId]);

  // Save on Unmount / Pause
  // Ref to track previous playing state to valid "Pause" event
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    if (isPlaying) {
      wasPlayingRef.current = true;
    } else if (wasPlayingRef.current) {
      // Transitioned from True -> False
      console.log("[AudioPlayer] Paused - Saving progress.");
      saveProgress(true); // Force save on pause
      wasPlayingRef.current = false;
    }
  }, [isPlaying, saveProgress]);

  // Save on Unmount (React Lifecycle)
  useEffect(() => {
    return () => {
      console.log("[AudioPlayer] Unmounting - Saving progress.");
      saveProgress(true); // Force save
    };
  }, [saveProgress]);

  // Page Exit Save (Browser Lifecycle)
  useEffect(() => {
    const handleUnload = () => saveProgress(true);
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload); // Also listen for beforeunload
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    }
  }, [saveProgress]);

  // --- CROSS-DEVICE SYNC ---

  // Track if we just transitioned to playing (to avoid re-saving on every render)
  const justStartedPlayingRef = useRef(false);

  // Save progress immediately when playback STARTS (transition from paused to playing)
  useEffect(() => {
    if (isPlaying && isInitialized && !justStartedPlayingRef.current) {
      justStartedPlayingRef.current = true;
      console.log('[AudioPlayer] Play started - saving position for cross-device sync');
      saveProgress(true);
      // Update our known server time to now
      lastServerUpdateRef.current = Date.now();
    } else if (!isPlaying) {
      // Reset the flag when playback stops
      justStartedPlayingRef.current = false;
    }
  }, [isPlaying, isInitialized, saveProgress]);

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
          console.log('[AudioPlayer] Cross-device sync: detected newer remote position');

          let newPosition = null;
          let newTrackIndex = currentTrackIndex;

          if (isBookMode) {
            // Verify the remote track matches expected content
            if (remoteProgress.currentAudiobookTrackId) {
              const idx = sourceTracks.findIndex(t => t.trackId === remoteProgress.currentAudiobookTrackId);
              if (idx !== -1) {
                newTrackIndex = idx;
                newPosition = remoteProgress.currentAudiobookPosition;
              }
              // If track not found, don't sync (might be different audiobook)
            }
          } else {
            newPosition = remoteProgress.currentPosition;
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
  }, [isPlaying, isInitialized, isBookMode, book?.bookId, textId, currentTrackIndex, sourceTracks, audioRef]);


  // --- EIGHT: Render Helpers ---

  // FIX: Moved helper functions to BEFORE the keyboard effect to allow hoisting/dependency reference
  // Wrapped in useCallback for dependency stability
  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play()
        .catch(e => console.error("Play failed", e));
    } else {
      audio.pause();
    }
  }, [audioRef]); // Safe dependency

  const seek = useCallback((time) => {
    const audio = audioRef.current;
    if (!audio) return;

    // Use audio.duration if available, fallback to state
    const d = (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) ? audio.duration : duration;
    if (!d) return;

    const newTime = Math.max(0, Math.min(time, d));
    console.log(`[AudioPlayer] Seeking to ${newTime}s (Requested: ${time}s, Duration: ${d}s)`);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [audioRef, duration]);

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

  const changeRate = (diff) => {
    setPlaybackRate(prev => {
      const newRate = parseFloat((prev + diff).toFixed(2));
      const clamped = Math.max(0.5, Math.min(newRate, 2.0));
      localStorage.setItem('audioPlaybackRate', clamped);
      return clamped;
    });
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    localStorage.setItem('audioVolume', newVolume);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
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
      <audio ref={audioRef} style={{ display: 'none' }} />

      {isLoading ? (
        <div className="d-flex justify-content-center p-2">
          <Spinner animation="border" size="sm" />
        </div>
      ) : playlist.length === 0 ? (
        <div className="text-muted small p-2">No audio available</div>
      ) : (
        <>
          {error && <Alert variant="danger" size="sm" className="p-1 mb-1">{error}</Alert>}

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