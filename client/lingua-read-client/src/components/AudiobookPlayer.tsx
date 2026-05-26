import { useContext } from 'react';
import { Button, Spinner, Alert, ProgressBar } from 'react-bootstrap';
import { formatTime } from '../utils/helpers';
import {
  useAudiobookPlayer,
  type UseAudiobookPlayerArgs
} from '../hooks/useAudiobookPlayer';
import { SettingsContext } from '../contexts/SettingsContext';
import './AudiobookPlayer.css';

export type AudiobookPlayerProps = UseAudiobookPlayerArgs;

const AudiobookPlayer = (props: AudiobookPlayerProps) => {
  const { settings } = useContext(SettingsContext);
  const autoAdvanceTracks = props.autoAdvanceTracks ?? settings.autoAdvanceAudiobookTracks;
  const {
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
    currentTrackDisplayName,
    togglePlayPause,
    seek,
    goToNextTrack,
    goToPrevTrack,
    changeRate,
    handleVolumeChange
  } = useAudiobookPlayer({ ...props, autoAdvanceTracks });

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
                  variant={isPlaying ? 'outline-primary' : 'primary'}
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
