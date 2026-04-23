import React from 'react';
import { Button, Spinner } from 'react-bootstrap';

const ReaderLessonActions = React.memo(({
  text,
  isAudioLesson,
  previousTextId,
  nextTextId,
  completing,
  navigate,
  handleCompleteLesson
}) => {
  if (!text) return null;
  const showComplete = !isAudioLesson || text.bookId;
  const showBookNav = !!text.bookId;
  if (!showBookNav && !showComplete) return null;

  return (
    <div className="d-flex flex-wrap align-items-center gap-1 reader-lesson-actions">
      {showBookNav && (
        <>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => navigate(`/texts/${previousTextId}`)}
            disabled={!previousTextId}
          >
            Previous Text
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => navigate(`/texts/${nextTextId}`)}
            disabled={!nextTextId}
          >
            Next Text
          </Button>
        </>
      )}
      {showComplete && (
        <Button
          variant="success"
          onClick={handleCompleteLesson}
          disabled={completing}
          size="sm"
          className={showBookNav ? 'ms-1' : ''}
        >
          {completing ? <Spinner animation="border" size="sm" /> : (nextTextId === null && text?.bookId ? 'Finish Book' : 'Complete Lesson')}
        </Button>
      )}
    </div>
  );
});

export default ReaderLessonActions;
