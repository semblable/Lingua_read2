import React from 'react';
import { Card, Button, Alert } from 'react-bootstrap';
import AudiobookPlayer from '../AudiobookPlayer';

const LessonHeader = React.memo(({
  isMobile,
  text,
  words,
  isAudioLesson,
  book,
  primaryControls,
  secondaryControls,
  readerLessonActions,
  translateUnknownError,
  audioSrc,
  textId,
  audioRef,
  onTimeUpdate,
  onPlaybackStateChange,
  segmentPlaybackRequest,
  showDesktopLessonControls,
  setShowDesktopLessonControls
}) => {
  if (isMobile) return null;

  return (
    <Card className="shadow-sm mb-2 border-0 rounded-0 lesson-header">
      <Card.Body className="py-1 px-2 lesson-header-body">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Title - compact */}
          <div className="lesson-title-compact me-2">
            <h5 className="mb-0 text-truncate" style={{ maxWidth: '250px' }} title={text.title}>{text.title}</h5>
            <small className="text-muted lesson-meta">Lang: {text.languageName || 'N/A'} | {words.length} words</small>
          </div>

          {/* Audio Player - inline */}
          {isAudioLesson && audioSrc && (
            <AudiobookPlayer
              key="lesson-audio-player"
              type="lesson"
              audioSrc={audioSrc}
              textId={textId}
              languageId={text?.languageId}
              audioRef={audioRef}
              onTimeUpdate={onTimeUpdate}
              onPlaybackStateChange={onPlaybackStateChange}
              segmentPlaybackRequest={segmentPlaybackRequest}
            />
          )}
          {!isAudioLesson && book?.audiobookTracks?.length > 0 && (
            <AudiobookPlayer type="book" book={book} />
          )}

          <div className="d-flex align-items-center gap-1 ms-auto flex-shrink-0 lesson-header-actions">
            <Button
              variant={showDesktopLessonControls ? 'outline-secondary' : 'primary'}
              size="sm"
              onClick={() => setShowDesktopLessonControls(prev => !prev)}
              className="lesson-header-controls-toggle"
              aria-expanded={showDesktopLessonControls}
              aria-label={showDesktopLessonControls ? 'Hide lesson controls panel' : 'Show lesson controls panel'}
            >
              {showDesktopLessonControls ? 'Hide' : 'Show'}
            </Button>
          </div>
        </div>
        {showDesktopLessonControls && (
          <div className="lesson-controls-expanded-panel d-flex flex-wrap align-items-center gap-2 pt-2 mt-2 border-top">
            <div className="d-flex flex-wrap align-items-center gap-1">
              {primaryControls}
            </div>
            <div className="d-flex flex-wrap align-items-center gap-1">
              {secondaryControls}
            </div>
            {readerLessonActions}
          </div>
        )}
        {translateUnknownError && <Alert variant="danger" className="mt-1 mb-0 p-1 small">{translateUnknownError}</Alert>}
      </Card.Body>
    </Card>
  );
});

export default LessonHeader;
