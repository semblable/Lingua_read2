import React from 'react';
import { Card, Button, Alert } from 'react-bootstrap';
import AudiobookPlayerImpl from '../AudiobookPlayer';
import type { ReaderText, ReaderBook } from '../../hooks/useReaderState';
import type { SegmentPlaybackRequest } from '../../hooks/useReaderAudioSync';
import type { Word } from '../../utils/api/words';

// AudiobookPlayer accepts heterogeneous prop subsets per usage (lesson vs
// book). Cast to a permissive shape; Phase E2 will split it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AudiobookPlayer = AudiobookPlayerImpl as React.ComponentType<any>;

interface LessonHeaderProps {
  isMobile: boolean;
  text: ReaderText | null;
  words: Word[];
  isAudioLesson: boolean;
  book: ReaderBook | null;
  primaryControls: React.ReactNode;
  secondaryControls: React.ReactNode;
  readerLessonActions: React.ReactNode;
  translateUnknownError?: string | null;
  audioSrc?: string | null;
  textId?: number | string | null;
  audioRef?: React.RefObject<HTMLAudioElement>;
  onTimeUpdate?: (newTime: number) => void;
  onPlaybackStateChange?: (nextIsPlaying: boolean) => void;
  segmentPlaybackRequest?: SegmentPlaybackRequest | null;
  showDesktopLessonControls: boolean;
  setShowDesktopLessonControls: (updater: (prev: boolean) => boolean) => void;
}

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
}: LessonHeaderProps) => {
  if (isMobile || !text) return null;

  return (
    <Card className="shadow-sm mb-2 border-0 rounded-0 lesson-header">
      <Card.Body className="py-1 px-2 lesson-header-body">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Title - compact */}
          <div className="lesson-title-compact me-2">
            <h5 className="mb-0 text-truncate" style={{ maxWidth: '250px' }} title={text.title ?? undefined}>{text.title}</h5>
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
          {!isAudioLesson && (book?.audiobookTracks?.length ?? 0) > 0 && (
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
