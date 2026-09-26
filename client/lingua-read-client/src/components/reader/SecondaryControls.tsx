import React from 'react';
import { Button, ButtonGroup, OverlayTrigger, Tooltip, Spinner } from 'react-bootstrap';
import type { Settings } from '../../contexts/SettingsContext';
import { WORD_STATUS_LABELS, type WordStatus } from '../../types/wordStatus';

interface SecondaryControlsProps {
  isMobile: boolean;
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
  // SecondaryControls only consumes `text` as a truthiness guard for the
  // toolbar buttons. The caller passes ReaderTextLike | null; using unknown
  // here keeps the prop boundary loose without bringing in a shared shape.
  text: unknown;
  loading: boolean;
  handleFullTextTranslation: () => void;
  handleOpenSummaryPopup: () => void;
  isSummarizing: boolean;
  handleTranslateUnknownWords: () => void;
  translatingUnknown: boolean;
  handleMarkAllUnknownAsKnown: () => void;
  isMarkingAll: boolean;
  // The language's word list has loaded. Auto ? and All Known wait for it: a save made while it
  // is still loading would be undone when it lands, as it was read before the save.
  wordsReady: boolean;
}

const SecondaryControls = React.memo(({
  isMobile,
  globalSettings,
  setReadingDensity,
  setReaderContentWidth,
  setShowWordInfoPanel,
  setReaderParagraphIndent,
  setReaderTextAlignment,
  setTextSize,
  setLeftPanelWidth,
  handleLineSpacingChange,
  handleParagraphSpacingChange,
  text,
  loading,
  handleFullTextTranslation,
  handleOpenSummaryPopup,
  isSummarizing,
  handleTranslateUnknownWords,
  translatingUnknown,
  handleMarkAllUnknownAsKnown,
  isMarkingAll,
  wordsReady
}: SecondaryControlsProps) => (
  <>
    <ButtonGroup size="sm" className="me-1" aria-label="Reading density">
        <OverlayTrigger placement="top" overlay={<Tooltip>Compact density</Tooltip>}>
          <Button
            variant={globalSettings.readingDensity === 'compact' ? 'primary' : 'outline-secondary'}
            onClick={() => setReadingDensity('compact')}
          >
            S
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Balanced density</Tooltip>}>
          <Button
            variant={globalSettings.readingDensity === 'balanced' ? 'primary' : 'outline-secondary'}
            onClick={() => setReadingDensity('balanced')}
          >
            M
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Spacious density</Tooltip>}>
          <Button
            variant={globalSettings.readingDensity === 'spacious' ? 'primary' : 'outline-secondary'}
            onClick={() => setReadingDensity('spacious')}
          >
            L
          </Button>
        </OverlayTrigger>
      </ButtonGroup>
    <ButtonGroup size="sm" className="me-1">
      <Button
        variant="outline-secondary"
        onClick={() => setTextSize(globalSettings.textSize - 2)}
        title="Decrease text size"
      >
        A-
      </Button>
      <Button
        variant="outline-secondary"
        onClick={() => setTextSize(globalSettings.textSize + 2)}
        title="Increase text size"
      >
        A+
      </Button>
    </ButtonGroup>
    <ButtonGroup size="sm" className="me-1">
      <Button
        variant="outline-secondary"
        onClick={() => setLeftPanelWidth(globalSettings.leftPanelWidth + 5)}
        title="Increase reading area (Wider)"
      >
        ◀
      </Button>
      <Button
        variant="outline-secondary"
        onClick={() => setLeftPanelWidth(globalSettings.leftPanelWidth - 5)}
        title="Decrease reading area (Narrower)"
      >
        ▶
      </Button>
    </ButtonGroup>
    <ButtonGroup size="sm" className="me-1" aria-label="Reader text width">
      <OverlayTrigger placement="top" overlay={<Tooltip>Narrow text column</Tooltip>}>
        <Button
          variant={globalSettings.readerContentWidth <= 660 ? 'primary' : 'outline-secondary'}
          onClick={() => setReaderContentWidth(620)}
        >
          N
        </Button>
      </OverlayTrigger>
      <OverlayTrigger placement="top" overlay={<Tooltip>Medium text column</Tooltip>}>
        <Button
          variant={globalSettings.readerContentWidth > 660 && globalSettings.readerContentWidth < 820 ? 'primary' : 'outline-secondary'}
          onClick={() => setReaderContentWidth(740)}
        >
          M
        </Button>
      </OverlayTrigger>
      <OverlayTrigger placement="top" overlay={<Tooltip>Wide text column</Tooltip>}>
        <Button
          variant={globalSettings.readerContentWidth >= 820 ? 'primary' : 'outline-secondary'}
          onClick={() => setReaderContentWidth(900)}
        >
          W
        </Button>
      </OverlayTrigger>
    </ButtonGroup>
    {!isMobile && (
      <ButtonGroup size="sm" className="me-1" aria-label="Reader panel visibility">
        <Button
          variant={globalSettings.showWordInfoPanel ? 'primary' : 'outline-secondary'}
          onClick={() => setShowWordInfoPanel(!globalSettings.showWordInfoPanel)}
          title="Toggle word info panel"
        >
          Panel
        </Button>
      </ButtonGroup>
    )}
    <ButtonGroup size="sm" className="me-1" aria-label="Paragraph indent">
      <Button
        variant={globalSettings.readerParagraphIndent ? 'primary' : 'outline-secondary'}
        onClick={() => setReaderParagraphIndent(!globalSettings.readerParagraphIndent)}
        title="Toggle paragraph indent"
      >
        Indent
      </Button>
    </ButtonGroup>
    <ButtonGroup size="sm" className="me-1" aria-label="Text alignment">
      <Button
        variant={globalSettings.readerTextAlignment !== 'justify' ? 'primary' : 'outline-secondary'}
        onClick={() => setReaderTextAlignment('left')}
        title="Ragged-right text"
      >
        Left
      </Button>
      <Button
        variant={globalSettings.readerTextAlignment === 'justify' ? 'primary' : 'outline-secondary'}
        onClick={() => setReaderTextAlignment('justify')}
        title="Justified text"
      >
        Justify
      </Button>
    </ButtonGroup>
    {!isMobile && (
      <ButtonGroup size="sm" className="me-1">
        <OverlayTrigger placement="top" overlay={<Tooltip>Line Spacing: Default (1.5)</Tooltip>}>
          <Button
            variant={parseFloat(String(globalSettings.lineSpacing)) === 1.5 ? 'primary' : 'outline-secondary'}
            onClick={() => handleLineSpacingChange(1.5)}
            aria-label="Set line spacing to default"
          >
            1.5
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Line Spacing: Relaxed (1.75)</Tooltip>}>
          <Button
            variant={parseFloat(String(globalSettings.lineSpacing)) === 1.75 ? 'primary' : 'outline-secondary'}
            onClick={() => handleLineSpacingChange(1.75)}
            aria-label="Set line spacing to relaxed"
          >
            1.75
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Line Spacing: Spacious (2.0)</Tooltip>}>
          <Button
            variant={parseFloat(String(globalSettings.lineSpacing)) === 2.0 ? 'primary' : 'outline-secondary'}
            onClick={() => handleLineSpacingChange(2.0)}
            aria-label="Set line spacing to spacious"
          >
            2.0
          </Button>
        </OverlayTrigger>
      </ButtonGroup>
    )}
    {!isMobile && (
      <ButtonGroup size="sm" className="me-1">
        <OverlayTrigger placement="top" overlay={<Tooltip>Paragraph Spacing: Tight</Tooltip>}>
          <Button
            variant={parseFloat(String(globalSettings.paragraphSpacing)) === 0.6 ? 'primary' : 'outline-secondary'}
            onClick={() => handleParagraphSpacingChange(0.6)}
            aria-label="Set tight paragraph spacing"
          >
            ¶T
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Paragraph Spacing: Normal</Tooltip>}>
          <Button
            variant={parseFloat(String(globalSettings.paragraphSpacing)) === 1.0 ? 'primary' : 'outline-secondary'}
            onClick={() => handleParagraphSpacingChange(1.0)}
            aria-label="Set normal paragraph spacing"
          >
            ¶N
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Paragraph Spacing: Relaxed</Tooltip>}>
          <Button
            variant={parseFloat(String(globalSettings.paragraphSpacing)) === 1.6 ? 'primary' : 'outline-secondary'}
            onClick={() => handleParagraphSpacingChange(1.6)}
            aria-label="Set relaxed paragraph spacing"
          >
            ¶R
          </Button>
        </OverlayTrigger>
      </ButtonGroup>
    )}
    {text && !loading && (
      <Button
        variant="info"
        size="sm"
        onClick={handleFullTextTranslation}
        className="me-1"
      >
        Translate
      </Button>
    )}
    {text && !loading && (
      <Button
        variant="outline-info"
        size="sm"
        onClick={handleOpenSummaryPopup}
        disabled={isSummarizing}
        className="me-1"
      >
        {isSummarizing ? <Spinner size="sm" /> : 'Summarize'}
      </Button>
    )}
    {text && !loading && (
      <Button
        variant="secondary"
        size="sm"
        onClick={handleTranslateUnknownWords}
        disabled={translatingUnknown || !wordsReady}
        className="ms-1"
        title={`Translate unknown/learning words; new ones are saved as ${WORD_STATUS_LABELS[(globalSettings.autoTranslateWordStatus || 5) as WordStatus] ?? 'Known'}`}
      >
        {translatingUnknown ? <Spinner size="sm" /> : 'Auto ?'}
      </Button>
    )}
    {text && !loading && (
      <Button
        variant="outline-success"
        size="sm"
        onClick={handleMarkAllUnknownAsKnown}
        disabled={isMarkingAll || !wordsReady}
        className="ms-1"
        title="Mark all untracked words as Known"
      >
        {isMarkingAll ? <Spinner size="sm" /> : 'All Known'}
      </Button>
    )}
  </>
));

SecondaryControls.displayName = 'SecondaryControls';

export default SecondaryControls;
