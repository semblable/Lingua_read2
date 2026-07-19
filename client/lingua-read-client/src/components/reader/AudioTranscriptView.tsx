import React, { useRef } from 'react';
import { List, type ListImperativeAPI } from 'react-window';
import TranscriptLine, { type TranscriptRowProps } from './TranscriptLine';
import type { Settings } from '../../contexts/SettingsContext';
import type { SrtEntry } from '../../utils/srtParser';

type TranscriptItemData = Omit<TranscriptRowProps, 'hasSelection'>;

interface AudioTranscriptViewProps {
  isMobile: boolean;
  srtLines: SrtEntry[];
  currentSrtLineId: number | string | null;
  getFontStyling: (lineSpacing: number) => React.CSSProperties;
  handleLineClick: (startTime: number) => void;
  handleWordSelection: () => void;
  processTextContent: (text: string) => React.ReactNode;
  globalSettings: Settings;
  mobileReadingConfig: { lineSpacing: number };
  textContentRef: React.RefObject<HTMLDivElement>;
  readingContainerRef: React.RefObject<HTMLDivElement>;
  itemData: TranscriptItemData;
  listRef: React.RefObject<ListImperativeAPI>;
}

const AudioTranscriptView = React.memo(({
  isMobile,
  srtLines,
  currentSrtLineId,
  getFontStyling,
  handleLineClick,
  handleWordSelection,
  processTextContent,
  globalSettings,
  mobileReadingConfig,
  textContentRef,
  readingContainerRef,
  itemData,
  listRef
}: AudioTranscriptViewProps) => {
  const suppressLineClickUntilRef = useRef(0);
  const touchMovedRef = useRef(false);
  if (!srtLines || srtLines.length === 0) return <p className="p-3">Loading transcript...</p>;
  const effectiveLineSpacing = isMobile ? mobileReadingConfig.lineSpacing : globalSettings.lineSpacing;
  const listHeight = readingContainerRef.current ? readingContainerRef.current.clientHeight - 30 : 600;

  const hasSelection = () => {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
  };

  if (isMobile) {
    const handleTouchStart = () => {
      touchMovedRef.current = false;
    };

    const handleTouchMove = () => {
      touchMovedRef.current = true;
    };

    const handleTouchEnd = () => {
      const shouldSuppressClick = touchMovedRef.current || hasSelection();
      if (shouldSuppressClick) {
        suppressLineClickUntilRef.current = Date.now() + 400;
      }
      handleWordSelection();
      touchMovedRef.current = false;
    };

    return (
      <div
        className="audio-transcript-container"
        ref={textContentRef}
        onMouseUp={handleWordSelection}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {srtLines.map((line: SrtEntry) => (
          <p
            key={line.id}
            id={`srt-line-${line.id}`}
            className={`srt-line ${line.id === currentSrtLineId ? 'active-srt-line' : ''}`}
            style={{
              ...getFontStyling(effectiveLineSpacing),
              padding: '0.4rem 0.6rem',
              borderRadius: '6px',
              transition: 'background-color 0.3s ease',
              cursor: 'pointer'
            }}
            onClick={() => {
              if (Date.now() < suppressLineClickUntilRef.current || hasSelection()) return;
              handleLineClick(line.startTime);
            }}
          >
            {processTextContent(line.text)}
          </p>
        ))}
      </div>
    );
  }

  const calculatedItemSize = (globalSettings.textSize * effectiveLineSpacing * 1.6) + 18;
  const desktopItemData = {
    ...itemData,
    hasSelection
  };

  return (
    <div
      className="audio-transcript-container"
      ref={textContentRef}
      style={{ height: '100%', overflow: 'hidden' }}
      onMouseUp={handleWordSelection}
    >
      <List
        rowComponent={TranscriptLine}
        rowCount={srtLines.length}
        rowHeight={calculatedItemSize}
        rowProps={desktopItemData}
        overscanCount={5}
        listRef={listRef}
        style={{ height: listHeight, paddingRight: '15px', paddingLeft: '15px' }}
      />
    </div>
  );
});

AudioTranscriptView.displayName = 'AudioTranscriptView';

export default AudioTranscriptView;
