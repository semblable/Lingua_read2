import React from 'react';
import { Button, Collapse } from 'react-bootstrap';

interface MobileLessonHeaderProps {
  isMobile: boolean;
  showMobileHeader: boolean;
  setShowMobileHeader: (value: boolean | ((prev: boolean) => boolean)) => void;
  showMoreControls: boolean;
  setShowMoreControls: (value: boolean | ((prev: boolean) => boolean)) => void;
  text: { title?: string } | null | undefined;
  primaryControls: React.ReactNode;
  secondaryControls: React.ReactNode;
  readerLessonActions: React.ReactNode;
  isAudioLesson: boolean;
  isAudioPlaying: boolean;
  toggleAudioPlayback: () => void;
}

const MobileLessonHeader = React.memo(({
  isMobile,
  showMobileHeader,
  setShowMobileHeader,
  showMoreControls,
  setShowMoreControls,
  text,
  primaryControls,
  secondaryControls,
  readerLessonActions,
  isAudioLesson,
  isAudioPlaying,
  toggleAudioPlayback
}: MobileLessonHeaderProps) => {
  if (!isMobile) return null;

  const handleToggleHeader = () => {
    if (showMobileHeader) {
      setShowMoreControls(false);
    }
    setShowMobileHeader(prev => !prev);
  };

  const handleCloseHeader = () => {
    setShowMobileHeader(false);
    setShowMoreControls(false);
  };

  return (
    <>
      <div className="mobile-lesson-fab">
        <Button
          variant="primary"
          size="sm"
          onClick={handleToggleHeader}
          aria-label={showMobileHeader ? 'Close lesson controls' : 'Open lesson controls'}
        >
          {showMobileHeader ? 'Hide' : 'Lesson'}
        </Button>
        {isAudioLesson && (
          <Button
            variant={isAudioPlaying ? 'warning' : 'outline-primary'}
            size="sm"
            onClick={toggleAudioPlayback}
            aria-label={isAudioPlaying ? 'Pause audio' : 'Play audio'}
          >
            {isAudioPlaying ? 'Pause' : 'Play'}
          </Button>
        )}
      </div>
      <div className={`lesson-topbar navbar-custom-bg ${showMobileHeader ? 'lesson-topbar-open' : 'lesson-topbar-closed'}`}>
        <div className="lesson-topbar-content">
          <div className="lesson-topbar-title">{text?.title}</div>
          <div className="lesson-topbar-actions">
            <Button
              variant={showMoreControls ? 'light' : 'outline-light'}
              size="sm"
              onClick={() => setShowMoreControls(prev => !prev)}
              aria-controls="lesson-more-controls"
              aria-expanded={showMoreControls}
            >
              Menu
            </Button>
            <Button
              variant="outline-light"
              size="sm"
              onClick={handleCloseHeader}
              aria-label="Close lesson controls"
            >
              Close
            </Button>
          </div>
        </div>
        <Collapse in={showMoreControls}>
          <div id="lesson-more-controls" className="lesson-controls-collapse lesson-controls-menu">
            <div className="lesson-controls-section">
              {primaryControls}
            </div>
            <div className="lesson-controls-section">
              {secondaryControls}
            </div>
            <div className="lesson-controls-section lesson-controls-section-reader-actions">
              {readerLessonActions}
            </div>
          </div>
        </Collapse>
      </div>
    </>
  );
});

export default MobileLessonHeader;
