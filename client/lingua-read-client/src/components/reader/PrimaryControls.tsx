import React from 'react';
import { Button } from 'react-bootstrap';
import type { NavigateFunction } from 'react-router-dom';
import { libraryPath } from '../../utils/helpers';
import './ReaderToolbar.css';

interface PrimaryControlsProps {
  isAudioLesson: boolean;
  displayMode: string;
  setDisplayMode: (updater: (prev: string) => string) => void;
  isSentenceMode: boolean;
  setSentenceModeEnabled: (enabled: boolean) => void;
}

export const ReaderNavigation = ({ text, navigate }: {
  text: { bookId?: number | null; folderId?: number | null } | null | undefined;
  navigate: NavigateFunction;
}) => (
  <Button variant="link" size="sm" className="reader-back-link"
    onClick={() => navigate(text?.bookId ? `/books/${text.bookId}` : libraryPath(text?.folderId))}
    aria-label={text?.bookId ? 'Back to Book' : 'Back to Library'}>
    <span aria-hidden="true">← </span>{text?.bookId ? 'Book' : 'Library'}
  </Button>
);

const PrimaryControls = React.memo(({
  isAudioLesson, displayMode, setDisplayMode, isSentenceMode, setSentenceModeEnabled,
}: PrimaryControlsProps) => (
  <>
    {isAudioLesson && (
      <Button variant="outline-secondary" size="sm" onClick={() => setDisplayMode(p => p === 'audio' ? 'text' : 'audio')}
        title={displayMode === 'audio' ? 'Text View' : 'Audio View'}>
        {displayMode === 'audio' ? 'Text' : 'Audio'} View
      </Button>
    )}
    <Button variant={isSentenceMode ? 'secondary' : 'outline-secondary'} size="sm"
      aria-pressed={isSentenceMode} onClick={() => setSentenceModeEnabled(!isSentenceMode)}>
      Sentence Mode
    </Button>
  </>
));

PrimaryControls.displayName = 'PrimaryControls';
export default PrimaryControls;
