import React from 'react';
import { Button, Dropdown, Spinner } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import { WORD_STATUS_LABELS, type WordStatus } from '../../types/wordStatus';
import ReaderAppearance from './ReaderAppearance';
import './ReaderToolbar.css';

export interface SecondaryControlsProps {
  isMobile: boolean;
  isAudioTranscript?: boolean;
  showParagraphIndent?: boolean;
  showTextAlignment?: boolean;
  globalSettings: Settings;
  setReadingDensity: (density: string) => void;
  setReaderContentWidth: (width: number) => void;
  setShowWordInfoPanel: (show: boolean) => void;
  setReaderParagraphIndent: (indent: boolean) => void;
  setReaderTextAlignment: (alignment: string) => void;
  setTextSize: (size: number) => void;
  setLeftPanelWidth: (width: number) => void;
  handleLineSpacingChange: (value: number) => void;
  handleParagraphSpacingChange: (value: number) => void;
  text: unknown;
  loading: boolean;
  handleFullTextTranslation: () => void;
  handleOpenSummaryPopup: () => void;
  isSummarizing: boolean;
  handleTranslateUnknownWords: () => void;
  translatingUnknown: boolean;
  handleMarkAllUnknownAsKnown: () => void;
  isMarkingAll: boolean;
  wordsReady: boolean;
}

const SecondaryControls = React.memo((props: SecondaryControlsProps) => {
  const { isMobile, globalSettings, setShowWordInfoPanel, text, loading, handleFullTextTranslation,
    handleOpenSummaryPopup, isSummarizing, handleTranslateUnknownWords, translatingUnknown,
    handleMarkAllUnknownAsKnown, isMarkingAll, wordsReady } = props;
  return (
    <>
      {!isMobile && <Button variant="outline-secondary" size="sm"
        aria-pressed={globalSettings.showWordInfoPanel} onClick={() => setShowWordInfoPanel(!globalSettings.showWordInfoPanel)}
        title="Toggle word info panel">Panel</Button>}
      {text && !loading && <>
        <Button variant="outline-secondary" size="sm" onClick={handleFullTextTranslation}>Translate</Button>
        <Button variant="outline-secondary" size="sm" onClick={handleOpenSummaryPopup} disabled={isSummarizing}>
          {isSummarizing ? <Spinner size="sm" /> : 'Summarize'}
        </Button>
        <Button variant="outline-secondary" size="sm" onClick={handleTranslateUnknownWords}
          disabled={translatingUnknown || !wordsReady}
          title={`Translate unknown/learning words; new ones are saved as ${WORD_STATUS_LABELS[(globalSettings.autoTranslateWordStatus || 5) as WordStatus] ?? 'Known'}`}>
          {translatingUnknown ? <Spinner size="sm" /> : 'Auto ?'}
        </Button>
      </>}
      <ReaderAppearance {...props} />
      {text && !loading && <Dropdown className="reader-lesson-menu">
        <Dropdown.Toggle variant="outline-secondary" size="sm" aria-label="More lesson actions">More</Dropdown.Toggle>
        <Dropdown.Menu align="end" className="reader-lesson-menu-content">
          <Dropdown.Item as="button" onClick={handleMarkAllUnknownAsKnown} disabled={isMarkingAll || !wordsReady}
            title="Mark all untracked words as Known">
            {isMarkingAll ? 'Marking words…' : 'All Known'}
          </Dropdown.Item>
          <div className="reader-lesson-menu-hint">Marks every untracked word in this lesson as Known.</div>
        </Dropdown.Menu>
      </Dropdown>}
    </>
  );
});

SecondaryControls.displayName = 'SecondaryControls';
export default SecondaryControls;
