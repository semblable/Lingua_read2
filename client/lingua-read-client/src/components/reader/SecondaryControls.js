import React from 'react';
import { Button, ButtonGroup, OverlayTrigger, Tooltip, Spinner } from 'react-bootstrap';

const SecondaryControls = React.memo(({
  isMobile,
  globalSettings,
  setReadingDensity,
  setReaderContentWidth,
  setShowWordInfoPanel,
  setReaderParagraphIndent,
  setReaderTextAlignment,
  updateSetting,
  updateUserSettings,
  leftPanelWidth,
  setLeftPanelWidth,
  handleLineSpacingChange,
  handleParagraphSpacingChange,
  text,
  loading,
  handleFullTextTranslation,
  handleTranslateUnknownWords,
  translatingUnknown,
  handleMarkAllUnknownAsKnown,
  isMarkingAll
}) => (
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
        onClick={() => {
          const newSize = Math.max(12, globalSettings.textSize - 2);
          updateSetting('textSize', newSize);
          updateUserSettings({ textSize: newSize })
            .catch(err => console.error('[Save Settings] Failed to save text size via API:', err));
        }}
        title="Decrease text size"
      >
        A-
      </Button>
      <Button
        variant="outline-secondary"
        onClick={() => {
          const newSize = Math.min(32, globalSettings.textSize + 2);
          updateSetting('textSize', newSize);
          updateUserSettings({ textSize: newSize })
            .catch(err => console.error('[Save Settings] Failed to save text size via API:', err));
        }}
        title="Increase text size"
      >
        A+
      </Button>
    </ButtonGroup>
    <ButtonGroup size="sm" className="me-1">
      <Button
        variant="outline-secondary"
        onClick={() => {
          const newWidth = Math.min(leftPanelWidth + 5, 85);
          setLeftPanelWidth(newWidth);
          updateSetting('leftPanelWidth', newWidth);
          updateUserSettings({ leftPanelWidth: newWidth })
            .catch(err => console.error('[Save Settings] Failed to save panel width via API:', err));
        }}
        title="Increase reading area (Wider)"
      >
        ◀
      </Button>
      <Button
        variant="outline-secondary"
        onClick={() => {
          const newWidth = Math.max(leftPanelWidth - 5, 20);
          setLeftPanelWidth(newWidth);
          updateSetting('leftPanelWidth', newWidth);
          updateUserSettings({ leftPanelWidth: newWidth })
            .catch(err => console.error('[Save Settings] Failed to save panel width via API:', err));
        }}
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
            variant={parseFloat(globalSettings.lineSpacing) === 1.5 ? 'primary' : 'outline-secondary'}
            onClick={() => handleLineSpacingChange(1.5)}
            aria-label="Set line spacing to default"
          >
            1.5
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Line Spacing: Relaxed (1.75)</Tooltip>}>
          <Button
            variant={parseFloat(globalSettings.lineSpacing) === 1.75 ? 'primary' : 'outline-secondary'}
            onClick={() => handleLineSpacingChange(1.75)}
            aria-label="Set line spacing to relaxed"
          >
            1.75
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Line Spacing: Spacious (2.0)</Tooltip>}>
          <Button
            variant={parseFloat(globalSettings.lineSpacing) === 2.0 ? 'primary' : 'outline-secondary'}
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
            variant={parseFloat(globalSettings.paragraphSpacing) === 0.6 ? 'primary' : 'outline-secondary'}
            onClick={() => handleParagraphSpacingChange(0.6)}
            aria-label="Set tight paragraph spacing"
          >
            ¶T
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Paragraph Spacing: Normal</Tooltip>}>
          <Button
            variant={parseFloat(globalSettings.paragraphSpacing) === 1.0 ? 'primary' : 'outline-secondary'}
            onClick={() => handleParagraphSpacingChange(1.0)}
            aria-label="Set normal paragraph spacing"
          >
            ¶N
          </Button>
        </OverlayTrigger>
        <OverlayTrigger placement="top" overlay={<Tooltip>Paragraph Spacing: Relaxed</Tooltip>}>
          <Button
            variant={parseFloat(globalSettings.paragraphSpacing) === 1.6 ? 'primary' : 'outline-secondary'}
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
        variant="secondary"
        size="sm"
        onClick={handleTranslateUnknownWords}
        disabled={translatingUnknown}
        className="ms-1"
        title="Translate unknown/learning words"
      >
        {translatingUnknown ? <Spinner size="sm" /> : 'Auto ?'}
      </Button>
    )}
    {text && !loading && (
      <Button
        variant="outline-success"
        size="sm"
        onClick={handleMarkAllUnknownAsKnown}
        disabled={isMarkingAll}
        className="ms-1"
        title="Mark all untracked words as Known"
      >
        {isMarkingAll ? <Spinner size="sm" /> : 'All Known'}
      </Button>
    )}
  </>
));

export default SecondaryControls;
