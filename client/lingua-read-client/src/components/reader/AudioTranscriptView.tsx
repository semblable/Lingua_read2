import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { List, useDynamicRowHeight, type ListImperativeAPI } from 'react-window';
import TranscriptLine, { TranscriptParagraph } from './TranscriptLine';
import { groupTranscriptCues } from '../../utils/audioTranscript';
import type { Settings } from '../../contexts/SettingsContext';
import type { SrtEntry } from '../../utils/srtParser';

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
  listRef,
  languageCode,
  rightToLeft
}: AudioTranscriptViewProps) => {
  const suppressLineClickUntilRef = useRef(0);
  const touchMovedRef = useRef(false);
  const [listHeight, setListHeight] = useState(600);
  const [listWidth, setListWidth] = useState(0);
  const paragraphListRef = useRef<ListImperativeAPI | null>(null);
  const { paragraphs, paragraphByCue } = useMemo(() => groupTranscriptCues(srtLines, languageCode), [srtLines, languageCode]);
  const transcriptKey = useMemo(() => paragraphs.map(paragraph =>
    paragraph.cues.map(cue => cue.separator + cue.text).join('')).join('\n\n'), [paragraphs]);
  const effectiveLineSpacing = isMobile ? mobileReadingConfig.lineSpacing : globalSettings.lineSpacing;
  const containerClassName = `audio-transcript-container reader-align-${globalSettings.readerTextAlignment || 'left'}`;
  const fontStyle = getFontStyling(effectiveLineSpacing);
  const transcriptStyle = {
    ...fontStyle,
    '--reader-content-max-width': `${globalSettings.readerContentWidth || 740}px`,
    '--audio-transcript-row-padding': globalSettings.readingDensity === 'compact' ? '0.08em 0.65rem'
      : globalSettings.readingDensity === 'spacious' ? '0.24em 0.9rem' : '0.16em 0.75rem',
    '--audio-transcript-row-gap': `${Math.round((globalSettings.paragraphSpacing ?? 1) * 35) / 100}em`
  } as React.CSSProperties;
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: Math.ceil(globalSettings.textSize * (effectiveLineSpacing + (globalSettings.paragraphSpacing ?? 1)) + 24),
    key: [listWidth, globalSettings.readerContentWidth, globalSettings.textSize, globalSettings.textFont,
      effectiveLineSpacing, globalSettings.paragraphSpacing, globalSettings.readingDensity,
      globalSettings.readerTextAlignment, languageCode, transcriptKey].join(':')
  });

  // The reader addresses original cue indices; the virtual list now renders groups.
  useImperativeHandle(listRef, () => ({
    get element() { return paragraphListRef.current?.element ?? null; },
    scrollToRow: ({ index, ...options }) => {
      const paragraphIndex = paragraphByCue[index];
      const line = srtLines[index];
      if (paragraphIndex === undefined || !line || !paragraphs[paragraphIndex]) return;
      const followCue = () => {
        const viewport = paragraphListRef.current?.element;
        const cue = document.getElementById(`srt-line-${line.id}`);
        if (!viewport || !cue || !viewport.contains(cue)) return false;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.anchorNode && viewport.contains(selection.anchorNode)) return true;
        const bounds = viewport.getBoundingClientRect();
        const position = cue.getBoundingClientRect();
        const center = position.top + position.height / 2;
        if (center < bounds.top + bounds.height * 0.25 || center > bounds.top + bounds.height * 0.75) {
          viewport.scrollTo({ top: viewport.scrollTop + center - bounds.top - bounds.height / 2, behavior: 'smooth' });
        }
        return true;
      };
      if (!followCue()) {
        paragraphListRef.current?.scrollToRow({ ...options, index: paragraphIndex });
        requestAnimationFrame(followCue);
      }
    }
  }), [paragraphByCue, paragraphs, srtLines]);

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
  if (paragraphs.length === 0) return <p className="p-3">No transcript text available.</p>;

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
        {paragraphs.map((paragraph, index) => (
          <div className="transcript-row" key={index}>
            <TranscriptParagraph paragraph={paragraph} currentLineId={currentSrtLineId}
              processLineContent={processTextContent} hasSelection={hasSelection}
              handleLineClick={startTime => {
                if (Date.now() >= suppressLineClickUntilRef.current) handleLineClick(startTime);
              }} />
          </div>
        ))}
      </div>
    );
  }

  const desktopItemData = {
    currentLineId: currentSrtLineId,
    processLineContent: processTextContent,
    handleLineClick,
    paragraphs,
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
        rowCount={paragraphs.length}
        rowHeight={rowHeight}
        rowProps={desktopItemData}
        overscanCount={5}
        listRef={paragraphListRef}
        onResize={({ width }) => setListWidth(width)}
        style={{ height: listHeight }}
      />
    </div>
  );
});

AudioTranscriptView.displayName = 'AudioTranscriptView';

export default AudioTranscriptView;
