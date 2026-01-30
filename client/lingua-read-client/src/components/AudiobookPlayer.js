import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button, Spinner, Alert, ProgressBar, ButtonGroup } from 'react-bootstrap';
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
  onTimeUpdate
}) => {
  // --- ONE: Refs and Stable Callbacks ---
  const internalAudioRef = useRef(null);
  const audioRef = externalAudioRef || internalAudioRef;
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const progressBarRef = useRef(null);

  // State refs for access inside event listeners/timers without triggering effects
  const progressSaveRef = useRef({
    pending: false,
    jobId: null,
    lastSavedTime: 0,
    accumulatedListenTime: 0
  });

  // Keep onTimeUpdateRef current
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

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

  // Track State
  const [playlist, setPlaylist] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);

  // Initialization Flags
  const [isInitialized, setIsInitialized] = useState(false);
  const initialSeekRef = useRef(null); // Position to seek to once metadata loads

  // --- THREE: Data Derivation (The Fix for the Loop) ---
  // Memoize the "source of truth" for tracks. 
  // Only changes if book ID or textId+audioSrc changes.
  const sourceTracks = useMemo(() => {
    if (isBookMode && book?.audiobookTracks) {
      return book.audiobookTracks;
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
  }, [isBookMode, book?.id, book?.audiobookTracks, audioSrc]);

  useEffect(() => {
    const newTracks = sourceTracks;
    // Simple deep equality check or ID check to avoid unnecessary updates if ref changed but content didn't
    setPlaylist(prev => {
      if (prev.length !== newTracks.length) return newTracks;
      if (prev.length > 0 && prev[0].trackId !== newTracks[0]?.trackId) return newTracks;
      // If looks same, keep old ref to be safe, or just update. 
      // For now, updating properly.
      return newTracks;
    });
  }, [sourceTracks]);


  // --- FOUR: Initial Progress Loading (Run ONCE per book/text) ---
  useEffect(() => {
    let mounted = true;
    const loadProgress = async () => {
      // If no tracks, nothing to load
      if (sourceTracks.length === 0) {
        setIsInitialized(true);
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
        } else if (!isBookMode && textId) {
          const progress = await getAudioLessonProgress(textId);
          if (progress?.currentPosition) {
            savedPosition = progress.currentPosition;
            console.log(`[AudioPlayer] Restoring Lesson progress: Pos ${savedPosition}`);
          }
        }

        if (mounted) {
          setCurrentTrackIndex(savedTrackIndex);
          if (savedPosition > 0) {
            initialSeekRef.current = savedPosition;
            // Optimistically update current time for UI
            setCurrentTime(savedPosition);
          }
          setIsInitialized(true);
        }
      } catch (e) {
        console.error("Failed to load progress:", e);
        if (mounted) setIsInitialized(true); // Proceed anyway
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadProgress();

    return () => { mounted = false; };
  }, [book?.bookId, textId, isBookMode]); // Core resource IDs only. NOT tracks.


  // --- FIVE: Active Track Management ---
  const currentTrack = playlist[currentTrackIndex];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isInitialized || !currentTrack) return;

    const backendBaseUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    // If it's a full URL (Lesson), use it. If relative (Book), prepend API URL.
    const src = currentTrack.isLesson
      ? currentTrack.url
      : `${backendBaseUrl}/${currentTrack.filePath}`;

    const currentSrc = audio.src;
    // Check if we already have this src loaded (avoid reloading on re-renders)
    // Note: audio.src property returns absolute URL, so strictly simple comparison works well
    if (currentSrc.includes(src) || src.includes(currentSrc) && currentSrc !== '') {
      // Already loaded.
      return;
    }

    console.log(`[AudioPlayer] Loading Track: ${src}`);
    audio.src = src;
    audio.load();
    setIsBuffering(true);

    // If we have an initial seek pending for THIS load, it will be handled by loadedmetadata.
    // If we changed tracks manually (not initial load), we usually want to play.
    if (!initialSeekRef.current && isPlaying) {
      audio.play().catch(e => console.warn("Auto-play on track change failed", e));
    }

  }, [currentTrack, isInitialized, isPlaying]); // Depend on initialized so we don't load before knowing where to start


  // --- SIX: Event Listeners & Logic ---
  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration);
    setIsBuffering(false);

    // Apply Initial Seek if exists
    if (initialSeekRef.current !== null) {
      console.log(`[AudioPlayer] Seeking to ${initialSeekRef.current}`);
      audio.currentTime = initialSeekRef.current;
      setCurrentTime(initialSeekRef.current);
      initialSeekRef.current = null; // Clear it
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = audio.currentTime;
    setCurrentTime(time);

    if (onTimeUpdateRef.current) {
      onTimeUpdateRef.current(time);
    }
  };

  const handleEnded = () => {
    if (isBookMode && currentTrackIndex < playlist.length - 1) {
      console.log("[AudioPlayer] Track ended, advancing...");
      // Go to next track
      setCurrentTrackIndex(prev => prev + 1);
      // "Next track" effect will trigger and load source
    } else {
      console.log("[AudioPlayer] Finished.");
      setIsPlaying(false);
    }
  };

  const handleError = (e) => {
    console.error("Audio Error:", e);
    setError("Error loading audio.");
    setIsBuffering(false);
  };

  // Attach listeners once
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Standard events
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('waiting', () => setIsBuffering(true));
    audio.addEventListener('playing', () => setIsBuffering(false));

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('waiting', () => setIsBuffering(true));
      audio.removeEventListener('playing', () => setIsBuffering(false));
    };
  }, []);

  // Sync Playback Rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Restore Rate from LocalStorage
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

    // Don't save if not playing and not forced (e.g. paused)
    if (!force && audio.paused && !isPlaying) return;

    const nav = navigator; // for sendBeacon if needed, or stick to fetch
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
  }, [isBookMode, book?.bookId, textId, currentTrackIndex, playlist, isInitialized, isPlaying]);

  // Periodic Save & Listening Log
  useEffect(() => {
    const interval = setInterval(() => {
      if (isPlaying) {
        saveProgress();
        // Logic for listening stats could go here or separate
        if (effectiveLanguageId) {
          logListeningActivity(effectiveLanguageId, 10); // Log 10s chunks? Or increment counter?
        }
      }
    }, 10000); // Save every 10s

    // Separate listening log interval (every 60s)
    const logInterval = setInterval(() => {
      if (isPlaying && effectiveLanguageId) {
        logListeningActivity(effectiveLanguageId, 60);
      }
    }, 60000);

    return () => {
      clearInterval(interval);
      clearInterval(logInterval);
    };
  }, [isPlaying, saveProgress, effectiveLanguageId]);

  // Save on Unmount / Pause
  useEffect(() => {
    // Save when pausing
    if (!isPlaying && isInitialized) {
      saveProgress(true); // Force save
    }
  }, [isPlaying, isInitialized, saveProgress]);

  // Page Exit Save
  useEffect(() => {
    const handleUnload = () => saveProgress(true);
    window.addEventListener('pagehide', handleUnload);
    return () => window.removeEventListener('pagehide', handleUnload);
  }, [saveProgress]);


  // --- EIGHT: Render Helpers ---

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === ' ' || e.key === '`') {
        e.preventDefault();
        togglePlayPause();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying]); // togglePlayPause depends on ref effectively via closure but simple toggle is fine. 
  // IMPORTANT: The togglePlayPause function below uses refs for audioRef.current, BUT uses 'isPlaying' state for valid check? 
  // No, it uses 'currentTime', etc. Wait, togglePlayPause calls audio.pause/play which updates state.
  // We need to make sure togglePlayPause is fresh or uses refs. 
  // The togglePlayPause definition below uses 'setIsPlaying' and 'audioRef.current'. It does NOT close over 'isPlaying' for logic, 
  // except maybe to decide intent? No, it checks `audio.paused`. So it is safe to act on audio element source of truth.
  // The dependency [isPlaying] here is really just to refresh the listener, though not strictly needed if closure is clean.
  // Actually, togglePlayPause is redefined on every render? No, it's const in render scope.
  // Ideally, wrap togglePlayPause in useCallback.
  // For now, attaching/detaching on isPlaying change is fine, ensures the function captured is relatively fresh.

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play()
        .then(() => setIsPlaying(true))
        .catch(e => console.error("Play failed", e));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const seek = (time) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newTime = Math.max(0, Math.min(time, duration));
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const changeRate = (diff) => {
    setPlaybackRate(prev => {
      const newRate = parseFloat((prev + diff).toFixed(2));
      const clamped = Math.max(0.5, Math.min(newRate, 2.0));
      localStorage.setItem('audioPlaybackRate', clamped);
      return clamped;
    });
  };

  if (isLoading) return <Spinner animation="border" size="sm" />;
  if (playlist.length === 0) return <div className="text-muted small">No audio available</div>;

  return (
    <div className="audiobook-player p-1 rounded-2 w-100 audiobook-player-custom-bg">
      {/* Hidden Audio Element */}
      <audio ref={audioRef} style={{ display: 'none' }} />

      {error && <Alert variant="danger" size="sm" className="p-1 mb-1">{error}</Alert>}

      {/* Progress Bar & Time */}
      <div className="audiobook-player__progress d-flex align-items-center mb-0 gap-2">
        <small className="text-muted text-nowrap" style={{ minWidth: '40px' }}>
          {formatTime(currentTime)}
        </small>

        <ProgressBar
          ref={progressBarRef}
          now={duration ? (currentTime / duration) * 100 : 0}
          className="flex-grow-1"
          style={{ height: '6px', cursor: 'pointer' }}
          variant="info"
          onClick={(e) => {
            const rect = progressBarRef.current.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            seek(pos * duration);
          }}
        />

        <small className="text-muted text-nowrap" style={{ minWidth: '40px', textAlign: 'right' }}>
          {formatTime(duration)}
        </small>
      </div>

      {/* Controls Row */}
      <div className="d-flex justify-content-between align-items-center mt-1">
        {/* Speed */}
        <ButtonGroup size="sm">
          <Button variant="link" size="sm" className="p-0 text-decoration-none text-secondary"
            onClick={() => changeRate(-0.1)} disabled={playbackRate <= 0.5}>-</Button>
          <span className="mx-2 small text-muted" style={{ minWidth: '30px', textAlign: 'center' }}>{playbackRate}x</span>
          <Button variant="link" size="sm" className="p-0 text-decoration-none text-secondary"
            onClick={() => changeRate(0.1)} disabled={playbackRate >= 2.0}>+</Button>
        </ButtonGroup>

        {/* Transport */}
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" className="py-0 px-2 rounded-pill" onClick={() => seek(currentTime - 10)}>
            -10s
          </Button>

          <Button
            variant={isPlaying ? "outline-primary" : "primary"}
            size="sm"
            className="py-0 px-3 rounded-pill d-flex align-items-center justify-content-center"
            style={{ width: '40px' }}
            onClick={togglePlayPause}
            title="Play (Space or `)"
          >
            {isBuffering ? (
              <Spinner animation="grow" size="sm" role="status" aria-hidden="true" style={{ width: '0.6rem', height: '0.6rem' }} />
            ) : (
              <i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'}`} style={{ fontSize: '1.2em' }}></i>
            )}
          </Button>

          <Button variant="outline-secondary" size="sm" className="py-0 px-2 rounded-pill" onClick={() => seek(currentTime + 10)}>
            +10s
          </Button>
        </div>

        {/* Track Info (Book Mode Only) */}
        <div className="small text-muted text-truncate" style={{ maxWidth: '100px' }}>
          {isBookMode && playlist.length > 1 && (
            <span>Track {currentTrackIndex + 1}/{playlist.length}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudiobookPlayer;