import React from 'react';
import { Button, Spinner } from 'react-bootstrap';
import type { NavigateFunction } from 'react-router-dom';

type DisplayMode = 'text' | 'audio';

interface PrimaryControlsProps {
  isAudioLesson: boolean;
  // TextDisplay holds this as `string` rather than the narrow union — keep
  // permissive here, narrow internally.
  displayMode: string;
  setDisplayMode: (updater: (prev: string) => string) => void;
  isSentenceMode: boolean;
  setSentenceModeEnabled: (enabled: boolean) => void;
  text: { bookId?: number | null } | null | undefined;
  handleCompleteLesson: () => void;
  handleCompleteLessonNoStats: () => void;
  completing: boolean;
  nextTextId?: number | null;
  navigate: NavigateFunction;
}

const PrimaryControls = React.memo(({
  isAudioLesson,
  displayMode,
  setDisplayMode,
  isSentenceMode,
  setSentenceModeEnabled,
  text,
  handleCompleteLesson,
  handleCompleteLessonNoStats,
  completing,
  navigate
}: PrimaryControlsProps) => (
  <>
    {isAudioLesson && (
      <Button
        variant="outline-info"
        size="sm"
        onClick={() => setDisplayMode((p: string) => p === 'audio' ? 'text' : 'audio')}
        title={displayMode === 'audio' ? 'Text View' : 'Audio View'}
        className="me-1"
      >
        {displayMode === 'audio' ? 'Text' : 'Audio'} View
      </Button>
    )}
    <Button
      variant={isSentenceMode ? 'primary' : 'outline-primary'}
      size="sm"
      onClick={() => setSentenceModeEnabled(!isSentenceMode)}
      className="me-1"
    >
      Sentence Mode
    </Button>
    {isAudioLesson && !text?.bookId && (
      <>
        <Button variant="success" onClick={handleCompleteLesson} disabled={completing} size="sm" className="ms-1">
          {completing ? <Spinner animation="border" size="sm" /> : 'Complete Lesson'}
        </Button>
        <Button variant="outline-success" onClick={handleCompleteLessonNoStats} disabled={completing} size="sm" className="ms-1">
          Finish (no stats)
        </Button>
      </>
    )}
    {text?.bookId && (
      <Button
        variant="outline-primary"
        size="sm"
        onClick={() => navigate(`/books/${text.bookId}`)}
        className="ms-1"
      >
        Back to Book
      </Button>
    )}
    {!text?.bookId && (
      <Button
        variant="outline-secondary"
        size="sm"
        onClick={() => navigate('/texts')}
        className="ms-1"
      >
        Back to Texts
      </Button>
    )}
  </>
));

PrimaryControls.displayName = 'PrimaryControls';

export default PrimaryControls;
