import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Spinner, Alert, ProgressBar, ButtonGroup, Form } from 'react-bootstrap';
import { getAudiobookProgress, updateAudiobookProgress, logListeningActivity } from '../utils/api';
import { formatTime } from '../utils/helpers';

const AudiobookPlayer = ({ book }) => {
  const { audiobookTracks = [], bookId, languageId } = book || {};

  const audioRef = useRef(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // Loading initial state/progress
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackPositionLoaded, setPlaybackPositionLoaded] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false); // State for when play is clicked but audio not ready
  const lastKnownPositionRef = useRef(0); // Cache last known playback position across lessons
  // --- Volume State ---
  const [volume, setVolume] = useState(1.0); // 1.0 = max volume
  // --- Mute State ---
  const [isMuted, setIsMuted] = useState(false);
  const [volumeBeforeMute, setVolumeBeforeMute] = useState(1.0);

  // Sync audio element volume with state, considering mute
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);
  const lastKnownTrackIndexRef = useRef(0); // Cache last known track index across lessons

  // Refs
  const saveIntervalRef = useRef(null);
  const listeningLogIntervalRef = useRef(null);
  const accumulatedListenTimeRef = useRef(0);
  const progressBarRef = useRef(null);
  const initialSeekPositionRef = useRef(null); // Ref to store position loaded from backend

  const currentTrack = audiobookTracks.length > 0 ? audiobookTracks[currentTrackIndex] : null;

  // --- Load Last Playback Position ---
  useEffect(() => {
    const loadLastPosition = async () => {
      setIsLoading(true);
      try {
        const progress = await getAudiobookProgress(bookId); // Pass bookId
        if (progress.currentAudiobookTrackId && progress.currentAudiobookPosition != null) {
          const lastTrackIndex = audiobookTracks.findIndex(t => t.trackId === progress.currentAudiobookTrackId);
          console.log(`[AudioPlayer Load] Received progress: Track ID ${progress.currentAudiobookTrackId}, Position ${progress.currentAudiobookPosition}. Current Book ID: ${bookId}`);
          if (lastTrackIndex !== -1) {
            setCurrentTrackIndex(lastTrackIndex);
            lastKnownTrackIndexRef.current = lastTrackIndex; // Update cached track index when restoring saved progress
            // Store the loaded position in the ref instead of setting state immediately
            initialSeekPositionRef.current = progress.currentAudiobookPosition;
            console.log(`[AudioPlayer Load] Will attempt to resume Book ${bookId} at Track Index ${lastTrackIndex} (ID: ${progress.currentAudiobookTrackId}), Position ${progress.currentAudiobookPosition}`);
          } else {
             console.warn(`[AudioPlayer Load] Last saved track ID ${progress.currentAudiobookTrackId} not found in tracks for current Book ID ${bookId}. Starting from beginning.`);
             setCurrentTrackIndex(0);
             lastKnownTrackIndexRef.current = 0; // Reset cached track index if no saved progress
             // Ensure initial seek ref is cleared if starting from beginning
             initialSeekPositionRef.current = null;
             console.log(`[AudioPlayer Log] setCurrentTime(0) from loadLastPosition (track not found or no progress)`);
             setCurrentTime(0); // Set time to 0 if starting fresh
          }
        } else {
            // No progress saved for this book
            console.log(`[AudioPlayer Load] No progress found for Book ID ${bookId}. Restoring cached position if available.`);
            const cachedTrackIndex = lastKnownTrackIndexRef.current || 0;
            const cachedPosition = lastKnownPositionRef.current || 0;
            console.log(`[AudioPlayer Log] Restoring cached track index ${cachedTrackIndex} and position ${cachedPosition} (no progress found)`);
            setCurrentTrackIndex(cachedTrackIndex);
            initialSeekPositionRef.current = null;
            setCurrentTime(cachedPosition);
        }
      } catch (err) {
        console.error("Failed to load playback position:", err);
        // Fallback to start from beginning on error
        setCurrentTrackIndex(0);
        initialSeekPositionRef.current = null;
        console.log(`[AudioPlayer Log] setCurrentTime(0) from loadLastPosition (error case)`);
        setCurrentTime(0);
      } finally {
        setIsLoading(false);
        setPlaybackPositionLoaded(true);
      }
    };

    if (bookId && audiobookTracks.length > 0) {
        console.log("[AudioPlayer] Attempting to load last position.");
        loadLastPosition();
    } else {
        setIsLoading(false);
        setPlaybackPositionLoaded(true);
    }
  }, [bookId, audiobookTracks]); // Ensure bookId and tracks are stable before loading

  // --- Restore Playback Rate ---
  useEffect(() => {
      const savedRate = localStorage.getItem('audioPlaybackRate');
      if (savedRate && !isNaN(parseFloat(savedRate))) {
          const rate = parseFloat(savedRate);
          setPlaybackRate(Math.max(0.5, Math.min(rate, 2.0)));
          console.log(`[AudioPlayer Rate Restore] Restored rate: ${rate}`);
      }
  }, []);

  // --- Save Progress ---
  const saveProgress = useCallback(async (isUnmounting = false, trackOverride = null, positionOverride = null) => {
    // Use refs and state directly here
    const audio = audioRef.current;
    const track = trackOverride || currentTrack;
    const position = positionOverride !== null ? positionOverride : (audio ? audio.currentTime : null);
    const ready = audio ? audio.readyState : null;

    if (!track || !audio || ready === 0) {
      console.log("[AudioPlayer Save] Skipping save: No track, audio ref, or audio not ready.");
      return;
    }

    // Avoid saving 0 position if track just started unless unmounting and duration exists
    if (position === 0 && !isUnmounting && audio.duration > 0) {
      console.log("[AudioPlayer Save] Skipping save: Position is 0 and not unmounting.");
      return;
    }

    // Also skip saving if position is effectively the end of the track (within 0.5s) unless unmounting
    if (!isUnmounting && audio.duration > 0 && audio.duration - position < 0.5) {
      console.log("[AudioPlayer Save] Skipping save: Position is at the end of the track.");
      return;
    }

    // *** DEBUG LOG: Check position just before API call in saveProgress ***
    console.log(`[AudioPlayer Save DEBUG] About to call API. Track ID: ${track?.trackId}, Position: ${position}, isUnmounting: ${isUnmounting}`);
    console.log(`[AudioPlayer Save] Attempting to save progress for Book ${bookId}: Track ID ${track.trackId}, Position ${position}, Unmounting: ${isUnmounting}`);
    try {
      await updateAudiobookProgress(bookId, {
        currentAudiobookTrackId: track.trackId,
        currentAudiobookPosition: position
      });
      console.log(`[AudioPlayer Save] Successfully saved progress for Book ${bookId}: Track ID ${track.trackId}, Position ${position}`);
    } catch (err) {
      console.error("[AudioPlayer Save] Failed to save audiobook progress:", err);
      // Avoid setting error state if unmounting, as component is gone
      if (!isUnmounting) {
          setError("Failed to save progress.");
      }
    }
  }, [bookId, currentTrack]); // Removed updateAudiobookProgress dependency

  // --- Audio Element Setup & Event Listeners ---
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    let isMounted = true;

    const handleLoadedMetadata = () => {
      if (!isMounted) return;
      console.log(`[AudioPlayer] Metadata loaded. Duration: ${audio.duration}`);
      setDuration(audio.duration);
      audio.playbackRate = playbackRate;

      // Use the ref for initial seek after metadata loads
      const seekPos = initialSeekPositionRef.current;
      if (playbackPositionLoaded && seekPos != null && seekPos < audio.duration) { // Allow seeking to 0
        console.log(`[AudioPlayer] Seeking to loaded/initial position ${seekPos} after metadata loaded.`);
        audio.currentTime = seekPos;
        console.log(`[AudioPlayer Log] setCurrentTime from handleLoadedMetadata (initial seek): ${seekPos}`);
        setCurrentTime(seekPos); // Update state now that seek is done
        initialSeekPositionRef.current = null; // Clear the ref after seeking
      }
      // Note: Removed the fallback seek based on currentTime state here,
      // as initial seek should handle resuming/starting.

      // Auto-play if isPlaying was true (intent set by togglePlayPause) and audio is currently paused
      if (isPlaying && audio.paused) {
        console.log("[AudioPlayer] Attempting play post-metadata (intent was set).");
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(e => {
            if (isMounted) {
              console.error("Error auto-playing post-metadata:", e);
              setError(`Playback failed: ${e.message}. Try clicking play.`);
              setIsPlaying(false);
              setIsLoadingAudio(false); // Ensure loading state is cleared on error
            }
          });
        }
      } else if (isPlaying) {
         // If isPlaying is true but audio isn't paused, it might already be playing
         // or about to fire the 'play' event. Ensure loading state is false.
         setIsLoadingAudio(false);
      }
    };

    const handleTimeUpdate = () => {
      if (isMounted) {
          // console.log(`[AudioPlayer Log] setCurrentTime from handleTimeUpdate: ${audio.currentTime}`); // Very noisy, disable normally
          setCurrentTime(audio.currentTime);
          lastKnownPositionRef.current = audio.currentTime; // Update cached position
          lastKnownTrackIndexRef.current = currentTrackIndex; // Update cached track index
      }
    };

    const handlePlay = () => {
      if (isMounted) {
        console.log("[AudioPlayer] 'play' event.");
        setIsPlaying(true);
        setIsLoadingAudio(false); // Clear loading state on successful play
        setError('');
      }
    };

    const handlePause = () => {
      if (isMounted) {
        console.log("[AudioPlayer] 'pause' event.");
        setIsPlaying(false);
        setIsLoadingAudio(false); // Clear loading state on pause
      }
    };

    const handleEnded = () => {
      if (!isMounted) return;
      console.log(`[AudioPlayer] Track ${currentTrackIndex + 1} ended.`);
      if (currentTrackIndex < audiobookTracks.length - 1) {
        // Move to the next track
        const nextIndex = currentTrackIndex + 1;
        console.log(`[AudioPlayer] Auto-advancing to track ${nextIndex + 1}`);
        setCurrentTrackIndex(nextIndex);
        console.log(`[AudioPlayer Log] setCurrentTime(0) from handleEnded (track advance)`);
        setCurrentTime(0); // Reset time for the new track visually
        initialSeekPositionRef.current = 0; // Ensure seek ref is 0 for next track
        setIsPlaying(true); // Set intent to play the next track automatically

        // Save progress immediately for the new track at position 0
        const nextTrack = audiobookTracks[nextIndex];
        saveProgress(false, nextTrack, 0);
      } else {
        console.log("[AudioPlayer] Last track finished.");
        setIsPlaying(false); // Stop playing after the last track
      }
    };

    // --- Setup ---
    console.log(`[AudioPlayer] Setup effect for Track ${currentTrackIndex + 1}`);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    // Set source and rate
    const backendBaseUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
    const newSrc = `${backendBaseUrl}/${currentTrack.filePath}`;
    let sourceChanged = false;
    console.log("[AudioPlayer] Current Track Data:", currentTrack);
    console.log(`[AudioPlayer] Constructed Audio URL: ${newSrc}`);

    // Check if the source needs to be updated
    const needsSourceUpdate = audio.src !== newSrc;

    if (needsSourceUpdate) {
      // --- DEBUGGING: Log source change ---
      console.log(`[AudioPlayer DEBUG] Source change detected! Old src: ${audio.src}, New src: ${newSrc}`);
      console.log(`[AudioPlayer] Applying new src to audio element.`);
      audio.src = newSrc;
      sourceChanged = true;
      setDuration(0); // Reset duration

      // --- FIX: Only reset seek position if it's not the initial load ---
      // If the old source was empty, it means this is the initial load for this component instance.
      // In this case, we *keep* the initialSeekPositionRef loaded from the backend.
      // If the old source was *not* empty, it means the track is actually changing, so reset to 0.
      if (audio.src && audio.src !== newSrc) { // Check if old src existed and is different
         console.log(`[AudioPlayer DEBUG] Actual track change detected. Resetting initialSeekPositionRef to 0.`);
         initialSeekPositionRef.current = 0;
      } else {
         console.log(`[AudioPlayer DEBUG] Initial source load. Preserving initialSeekPositionRef (${initialSeekPositionRef.current}).`);
      }
      // --- END FIX ---

      setIsLoadingAudio(isPlaying); // Set loading if intent was to play
    }

    if (audio.playbackRate !== playbackRate) {
        console.log(`[AudioPlayer] Applying playback rate: ${playbackRate}`);
        audio.playbackRate = playbackRate;
    }

    if (sourceChanged) {
        console.log("[AudioPlayer] Calling load() due to src change.");
        audio.load();
    } else {
       // Source did not change
       // If intent is to play and it's paused, try playing (handles rate changes etc.)
       if (isPlaying && audio.paused && audio.readyState >= 2) {
            console.log("[AudioPlayer] Attempting play (src unchanged, isPlaying=true, audio paused, readyState>=2).");
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    if (isMounted) {
                        console.error("Error playing (src unchanged):", e);
                        setError(`Playback failed: ${e.message}.`);
                        setIsPlaying(false);
                        setIsLoadingAudio(false);
                    }
                });
            }
       } else if (isPlaying && audio.paused && audio.readyState < 2) {
           // If intent is to play, but audio not ready yet, ensure loading indicator is shown
           setIsLoadingAudio(true);
       }
       // If source didn't change and we are NOT trying to play,
       // ensure any previously loaded seek position is applied if metadata just loaded.
       // This handles resuming playback without auto-play.
       else if (!isPlaying && playbackPositionLoaded && initialSeekPositionRef.current != null && audio.readyState >= 1 /*HAVE_METADATA*/) {
            const seekPos = initialSeekPositionRef.current;
            // Check if audio.currentTime needs updating
            if (audio.currentTime !== seekPos && seekPos < audio.duration) {
                console.log(`[AudioPlayer] Applying loaded position ${seekPos} after metadata (not auto-playing).`);
                audio.currentTime = seekPos;
                console.log(`[AudioPlayer Log] setCurrentTime from useEffect (applying loaded pos): ${seekPos}`);
                setCurrentTime(seekPos); // Update state
            }
            // Clear ref once checked/applied
            initialSeekPositionRef.current = null;
       }
    }


    // --- Cleanup ---
    return () => {
      console.log(`[AudioPlayer] Cleanup effect for Track ${currentTrackIndex + 1}`);
      isMounted = false;
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [currentTrackIndex, playbackRate, audiobookTracks, isPlaying, playbackPositionLoaded, currentTrack, saveProgress]); // Added saveProgress dependency

  // --- Play/Pause Logic ---
  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
        console.error("[AudioPlayer togglePlayPause] Audio ref is null!");
        setError("Audio element not available.");
        return;
    }
    console.log(`[AudioPlayer togglePlayPause] Called. Current isPlaying state: ${isPlaying}, audio.paused: ${audio.paused}`);

    if (!audio.paused) { // If it's playing or trying to play
      console.log("[AudioPlayer togglePlayPause] Audio is not paused. Attempting to pause...");
      audio.pause();
      // 'pause' event listener will set isPlaying = false and isLoadingAudio = false
    } else { // If it IS paused
      console.log(`[AudioPlayer togglePlayPause] Attempting to play... (readyState: ${audio.readyState})`);
      setError('');
      setIsLoadingAudio(false); // Reset loading state

      if (audio.readyState === 0) {
          console.warn(`[AudioPlayer togglePlayPause] Play attempt when readyState is 0. Setting loading state.`);
          setIsLoadingAudio(true); // Show loading indicator
          setIsPlaying(true); // Set intent to play, handleLoadedMetadata will trigger play later
          // Ensure load is triggered if needed (though useEffect should handle it)
          if (!audio.src || audio.src !== `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/${currentTrack.filePath}`) {
              audio.src = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/${currentTrack.filePath}`;
              audio.load();
          } else if (audio.networkState === 3) { // NETWORK_NO_SOURCE
              audio.load();
          }
      } else if (audio.readyState >= 2) { // HAVE_CURRENT_DATA or more
          console.log(`[AudioPlayer togglePlayPause] readyState is ${audio.readyState}. Calling audio.play().`);
          const playPromise = audio.play();
          if (playPromise !== undefined) {
              playPromise.then(_ => {
                  console.log("[AudioPlayer togglePlayPause] audio.play() promise resolved.");
                  // 'play' event listener sets states
              }).catch(e => {
                  console.error("[AudioPlayer togglePlayPause] audio.play() promise rejected:", e);
                  setError(`Playback failed: ${e.message}.`);
                  setIsPlaying(false);
                  setIsLoadingAudio(false);
              });
          } else {
              console.warn("[AudioPlayer togglePlayPause] audio.play() did not return a promise.");
              setIsPlaying(true); // Manually set state as fallback
          }
      } else { // readyState is 1 (HAVE_METADATA)
          console.warn(`[AudioPlayer togglePlayPause] Play attempt when readyState is ${audio.readyState}. Setting loading state.`);
          setIsLoadingAudio(true); // Show loading indicator while data buffers
          setIsPlaying(true); // Set intent to play
      }
    }
  }, [isPlaying, currentTrack]); // Add currentTrack dependency

  // --- Keyboard Shortcut (` key) ---
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === '`') {
        event.preventDefault();
        togglePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [togglePlayPause]);

  // --- Apply Playback Rate ---
   useEffect(() => {
       if (audioRef.current) {
           audioRef.current.playbackRate = playbackRate;
           console.log(`[AudioPlayer Rate Apply] Set audio playbackRate to: ${playbackRate}`);
       }
   }, [playbackRate]);

  // --- Handlers for Playback Speed ---
  const changePlaybackRate = (delta) => {
      setPlaybackRate(prevRate => {
          const newRate = parseFloat((prevRate + delta).toFixed(2));
          const clampedRate = Math.max(0.5, Math.min(newRate, 2.0));
          localStorage.setItem('audioPlaybackRate', clampedRate.toString());
          console.log(`[AudioPlayer Rate Change] New rate: ${clampedRate}`);
          return clampedRate;
      });
  };

  // --- Seek Function ---
  const seek = (offsetSeconds) => {
      const audio = audioRef.current;
      if (!audio || isNaN(audio.duration)) return;
      const newTime = Math.max(0, Math.min(audio.currentTime + offsetSeconds, audio.duration));
      audio.currentTime = newTime;
      console.log(`[AudioPlayer Log] setCurrentTime from seek(): ${newTime}`);
      setCurrentTime(newTime); // Update state immediately for responsiveness
      console.log(`[AudioPlayer Seek] Seeked by ${offsetSeconds}s to ${newTime}s`);
  };

  // --- Progress Bar Click Handler ---
  const handleProgressClick = (event) => {
      const audio = audioRef.current;
      const progressBar = progressBarRef.current;
      if (!audio || !progressBar || isNaN(audio.duration) || audio.duration === 0) return;

      const rect = progressBar.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const width = progressBar.offsetWidth;
      const percentage = clickX / width;
      const newTime = audio.duration * percentage;

      if (!isNaN(newTime)) {
          audio.currentTime = newTime;
          console.log(`[AudioPlayer Log] setCurrentTime from handleProgressClick(): ${newTime}`);
          setCurrentTime(newTime); // Update state immediately
          console.log(`[AudioPlayer Seek] Seeked via progress bar to ${newTime}s (${(percentage * 100).toFixed(1)}%)`);
      }
  };

  // --- Log Listening Time ---
  const logListeningTime = useCallback(async (isUnmounting = false) => {
    const timeToLog = Math.floor(accumulatedListenTimeRef.current);
    if (timeToLog > 0 && languageId) {
      console.log(`[AudioPlayer Log] Attempting to log listening time: ${timeToLog}s for Lang ${languageId}, Unmounting: ${isUnmounting}`);
      try {
        await logListeningActivity(languageId, timeToLog);
        console.log(`[AudioPlayer Log] Successfully logged ${timeToLog}s.`);
        accumulatedListenTimeRef.current = 0; // Reset only on success
      } catch (err) {
        console.error("[AudioPlayer Log] Failed to log listening activity:", err);
        // Don't reset accumulator if logging failed, try again next time (unless unmounting)
        if (isUnmounting) accumulatedListenTimeRef.current = 0;
      }
    } else if (isUnmounting) {
      console.log("[AudioPlayer Log] No accumulated time to log on unmount.");
    }
  }, [languageId]); // Removed logListeningActivity dependency

  // --- Effect for Timers and Cleanup ---
  useEffect(() => {
    const audioInstance = audioRef.current; // Capture ref value for cleanup
    let secondTimer = null;

    if (isPlaying && !isLoadingAudio) {
      // Start timers
      saveIntervalRef.current = setInterval(() => saveProgress(false), 15000);
      listeningLogIntervalRef.current = setInterval(() => logListeningTime(false), 60000);
      secondTimer = setInterval(() => {
        accumulatedListenTimeRef.current += 1;
      }, 1000);
      console.log("[AudioPlayer Timers] Started save/log timers.");
    } else {
      // Clear intervals if paused or loading
      clearInterval(saveIntervalRef.current);
      clearInterval(listeningLogIntervalRef.current);
      clearInterval(secondTimer);
      console.log("[AudioPlayer Timers] Cleared save/log timers.");
      // Save progress immediately when paused (if audio is ready and wasn't loading)
      if (!isPlaying && !isLoadingAudio && audioInstance && audioInstance.readyState > 0) {
          console.log("[AudioPlayer Timers] Saving/logging immediately on pause.");
          saveProgress(false);
          logListeningTime(false);
      }
    }

    // Cleanup function for this effect
    return () => {
      console.log("[AudioPlayer Cleanup] Running cleanup for timers effect...");
      // Always clear intervals on cleanup
      clearInterval(saveIntervalRef.current);
      clearInterval(listeningLogIntervalRef.current);
      clearInterval(secondTimer);

      // --- Save final state on unmount ---
      // This cleanup runs when dependencies change OR component unmounts.
      // We capture the state *at the time of cleanup setup*.
      // Use refs directly for potentially more up-to-date values if needed,
      // but state values from the closure should be sufficient if deps are correct.
      const audio = audioInstance; // Use captured ref value
      const track = currentTrack; // Use state variable captured by closure
      const position = audio ? audio.currentTime : null;
      const ready = audio ? audio.readyState : null;

      // Log unconditionally first
      console.log(`[AudioPlayer Cleanup] Final state check: isPlaying=${isPlaying}, isLoadingAudio=${isLoadingAudio}, bookId=${bookId}, trackId=${track?.trackId}, position=${position}, readyState=${ready}`);

      if (audio && ready > 0 && track) { // Use captured ref value 'audio'
          // *** DEBUG LOG: Check position just before saving in cleanup ***
          console.log(`[AudioPlayer Cleanup DEBUG] About to save final state. Track ID: ${track.trackId}, Position Read from audioRef.current: ${audio.currentTime}`);
          console.log(`[AudioPlayer Cleanup] Saving final state: Book ${bookId}, Track ${track.trackId}, Pos ${position}`); // Note: 'position' here uses the value read on line 486
          // Call the useCallback versions directly
          saveProgress(true);
          logListeningTime(true);
      } else {
           console.log(`[AudioPlayer Cleanup] Skipping final save/log. Conditions not met: audio=${!!audio}, readyState=${ready}, track=${!!track}`); // Use captured ref value 'audio'
      }
    };
    // Dependencies: Run effect when play state or loading state changes.
    // Also include saveProgress and logListeningTime if they were defined outside and wrapped in useCallback.
    // bookId, currentTrack are needed by the cleanup function's logic/logging.
  }, [isPlaying, isLoadingAudio, saveProgress, logListeningTime, bookId, currentTrack]);


  // --- Render Logic ---
  if (isLoading) {
    return <Spinner animation="border" size="sm" />;
  }

  if (audiobookTracks.length === 0) {
    return <p className="text-muted">No audiobook tracks available for this book.</p>;
  }

  if (!currentTrack) {
     return <Alert variant="warning">Could not load current track data.</Alert>;
  }


  // --- Ultra-Compact Dark-Mode Player (Fixed) ---
  return (
    <div className="audiobook-player p-1 rounded-2 w-100 audiobook-player-custom-bg"> {/* Reduced padding */}
      {error && <Alert variant="danger" className="mb-1 p-1 small">{error}</Alert>}
      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* Top Row: Track Info + Progress */}
      <div className="d-flex align-items-center mb-0 gap-2"> {/* Reduced margin-bottom */}
         <small className="text-muted text-nowrap">
             Trk {currentTrackIndex + 1}/{audiobookTracks.length}
         </small>
        <ProgressBar
          ref={progressBarRef}
          now={duration ? (currentTime / duration) * 100 : 0}
          className="flex-grow-1"
          style={{
            height: '4px',
            cursor: 'pointer',
            '--bs-progress-bar-bg': 'var(--bs-primary)',
            '--bs-progress-bg': 'var(--bs-secondary-bg)'
          }}
          onClick={handleProgressClick}
          title={`${formatTime(currentTime)} / ${formatTime(duration)} - Click to seek`}
        />
         <small className="text-muted text-nowrap">
             {formatTime(currentTime)}/{formatTime(duration)}
         </small>
      </div>

      {/* Dense Controls */}
      <div className="d-flex justify-content-between align-items-center gap-1">
        {/* Speed Controls */}
        <ButtonGroup size="sm">
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => changePlaybackRate(-0.05)}
            disabled={playbackRate <= 0.5}
            className="px-1 py-0"
            title="Decrease speed">
            <i className="bi bi-dash-lg"></i>
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            disabled
            className="px-1 py-0"
            style={{ minWidth: '38px' }}
            title={`Speed: ${playbackRate.toFixed(2)}x`}>
            <small>{playbackRate.toFixed(1)}x</small>
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => changePlaybackRate(0.05)}
            disabled={playbackRate >= 2.0}
            className="px-1 py-0"
            title="Increase speed">
            <i className="bi bi-plus-lg"></i>
          </Button>
        </ButtonGroup>

        {/* Main Controls */}
        <div className="d-flex align-items-center gap-1">
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => seek(-30)}
            className="px-1 py-0"
            title="-30s">
            <i className="bi bi-rewind-fill" />
          </Button>
          <Button
            variant="outline-primary" // Changed to primary for emphasis
            size="sm"
            onClick={togglePlayPause}
            className="px-1 py-0" // Reduced padding
            title={isPlaying ? 'Pause (` key)' : 'Play (` key)'}
            style={{ minWidth: '40px' }} // Ensure it's slightly larger
            disabled={isLoadingAudio} // Disable button while loading audio
          >
            {isLoadingAudio ? (
              <Spinner animation="border" size="sm" />
            ) : (
              <i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'}`} style={{ fontSize: '1.0rem' }} />
            )}
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => seek(30)}
            className="px-1 py-0"
            title="+30s">
            <i className="bi bi-fast-forward-fill" />
          </Button>
        </div>

        {/* Track Navigation */}
        <ButtonGroup size="sm">
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => {
                // console.log(`[AudioPlayer Log] setCurrentTime(0) from prev track button`); // Removed - Let loadedmetadata handle initial time
                // setCurrentTime(0); // Reset time state immediately - Let loadedmetadata handle initial time
                initialSeekPositionRef.current = 0; // Ensure seek ref is 0
                setCurrentTrackIndex(prev => Math.max(0, prev - 1));
            }}
            disabled={currentTrackIndex === 0}
            className="px-1 py-0"
            title="Previous Track">
            <i className="bi bi-skip-start-fill" />
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => {
                // console.log(`[AudioPlayer Log] setCurrentTime(0) from next track button`); // Removed - Let loadedmetadata handle initial time
                // setCurrentTime(0); // Reset time state immediately - Let loadedmetadata handle initial time
                initialSeekPositionRef.current = 0; // Ensure seek ref is 0
                setCurrentTrackIndex(prev => Math.min(audiobookTracks.length - 1, prev + 1));
            }}
            disabled={currentTrackIndex === audiobookTracks.length - 1}
            className="px-1 py-0"
            title="Next Track">
            <i className="bi bi-skip-end-fill" />
          </Button>
        </ButtonGroup>
        {/* Volume Control */}
        <div className="d-flex align-items-center gap-1 ms-2" style={{ minWidth: 120 }}>
          <i
            className={`bi ${isMuted || volume === 0 ? 'bi-volume-mute' : 'bi-volume-up'}`}
            style={{ fontSize: '1.1rem', color: 'var(--bs-body-color)', cursor: 'pointer' }}
            title={isMuted ? "Unmute" : "Mute"}
            onClick={() => {
              if (!isMuted) {
                // Mute: Store current volume (or 1.0 if already 0) and set mute state
                setVolumeBeforeMute(volume === 0 ? 1.0 : volume);
                setIsMuted(true);
              } else {
                // Unmute: Restore volume and clear mute state
                setIsMuted(false);
                setVolume(volumeBeforeMute === 0 ? 1.0 : volumeBeforeMute); // Restore to 1.0 if previous was 0
              }
            }}
            aria-label={isMuted ? "Unmute" : "Mute"}
            tabIndex={0} // Make it focusable
            role="button" // Indicate it's interactive
          />
          <Form.Range
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume} // Slider reflects mute state
            onChange={e => {
              const newVolume = parseFloat(e.target.value);
              setVolume(newVolume);
              // If user drags slider to 0, mute. If they drag away from 0, unmute.
              if (newVolume === 0) {
                if (!isMuted) {
                  setVolumeBeforeMute(1.0); // Store 1.0 if muted via slider
                  setIsMuted(true);
                }
              } else {
                if (isMuted) {
                  setIsMuted(false);
                }
                // Keep track of the last non-zero volume set by the slider
                setVolumeBeforeMute(newVolume);
              }
            }}
            style={{ width: 80 }}
            aria-label="Volume"
            title="Volume"
          />
        </div>
      </div>
    </div>
  );
};

export default AudiobookPlayer;