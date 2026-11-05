import React, { useEffect, useMemo, useRef, useState } from 'react';
import { List, useDynamicRowHeight, type ListImperativeAPI } from 'react-window';
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
  mobileReadingConfig: { lineSpacing: number; blockPadding: string | number };
  textContentRef: React.RefObject<HTMLDivElement | null>;
  readingContainerRef: React.RefObject<HTMLDivElement | null>;
  itemData: TranscriptItemData;
  listRef: React.RefObject<ListImperativeAPI | null>;
  // BCP-47 code of the text, for the browser's hyphenation and screen readers.
  languageCode?: string | null;
  rightToLeft?: boolean;
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
  listRef,
  languageCode,
  rightToLeft
}: AudioTranscriptViewProps) => {
  const suppressLineClickUntilRef = useRef(0);
  const touchMovedRef = useRef(false);
  const [listHeight, setListHeight] = useState(600);
  const [listWidth, setListWidth] = useState(0);
  const transcriptKey = useMemo(() => srtLines.map(line => line.text).join('\n'), [srtLines]);
  const effectiveLineSpacing = isMobile ? mobileReadingConfig.lineSpacing : globalSettings.lineSpacing;
  const containerClassName = `audio-transcript-container reader-align-${globalSettings.readerTextAlignment || 'left'} ${globalSettings.readerParagraphIndent ? 'reader-indent-on' : 'reader-indent-off'}`;
  const fontStyle = getFontStyling(effectiveLineSpacing);
  const transcriptStyle = {
    ...fontStyle,
    '--reader-content-max-width': `${globalSettings.readerContentWidth || 740}px`,
    '--audio-transcript-row-padding': mobileReadingConfig.blockPadding,
    '--audio-transcript-row-gap': `${globalSettings.paragraphSpacing ?? 1}em`
  } as React.CSSProperties;
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: Math.ceil(globalSettings.textSize * (effectiveLineSpacing + (globalSettings.paragraphSpacing ?? 1)) + 24),
    key: [listWidth, globalSettings.readerContentWidth, globalSettings.textSize, globalSettings.textFont,
      effectiveLineSpacing, globalSettings.paragraphSpacing, globalSettings.readingDensity,
      globalSettings.readerParagraphIndent, globalSettings.readerTextAlignment, transcriptKey].join(':')
  });

  useEffect(() => {
    if (isMobile) return;
    const container = readingContainerRef.current;
    if (!container) return;
    const updateHeight = () => setListHeight(Math.max(200, window.innerHeight - container.getBoundingClientRect().top - 24));
    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    window.addEventListener('resize', updateHeight);
    updateHeight();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [isMobile, readingContainerRef]);

  if (!srtLines || srtLines.length === 0) return <p className="p-3">Loading transcript...</p>;

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
        className={containerClassName}
        ref={textContentRef}
        style={transcriptStyle}
        lang={languageCode || undefined}
        dir={rightToLeft === undefined ? 'auto' : rightToLeft ? 'rtl' : 'ltr'}
        onMouseUp={handleWordSelection}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {srtLines.map((line: SrtEntry) => (
          <div className="transcript-row" key={line.id}>
            <p
              id={`srt-line-${line.id}`}
              className={`srt-line ${line.id === currentSrtLineId ? 'active-srt-line' : ''}`}
              onClick={() => {
                if (Date.now() < suppressLineClickUntilRef.current || hasSelection()) return;
                handleLineClick(line.startTime);
              }}
            >
              {processTextContent(line.text)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  const desktopItemData = {
    ...itemData,
    hasSelection
  };

  return (
    <div
      className={containerClassName}
      ref={textContentRef}
      lang={languageCode || undefined}
      dir={rightToLeft === undefined ? 'auto' : rightToLeft ? 'rtl' : 'ltr'}
      style={transcriptStyle}
      onMouseUp={handleWordSelection}
    >
      <List
        rowComponent={TranscriptLine}
        rowCount={srtLines.length}
        rowHeight={rowHeight}
        rowProps={desktopItemData}
        overscanCount={5}
        listRef={listRef}
        onResize={({ width }) => setListWidth(width)}
        style={{ height: listHeight }}
      />
    </div>
  );
});

AudioTranscriptView.displayName = 'AudioTranscriptView';

export default AudioTranscriptView;
