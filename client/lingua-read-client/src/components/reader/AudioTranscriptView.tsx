import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { List, useDynamicRowHeight, type ListImperativeAPI } from 'react-window';
import { Button, ButtonGroup, Form } from 'react-bootstrap';
import TranscriptLine, { TranscriptParagraph } from './TranscriptLine';
import { AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY, AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, groupTranscriptCues,
  readTranscriptAlignments, type TranscriptLayout } from '../../utils/audioTranscript';
import storage from '../../utils/storage';
import type { Settings } from '../../contexts/SettingsContext';
import type { SrtEntry } from '../../utils/srtParser';

interface AudioTranscriptViewProps {
  isMobile: boolean;
  srtLines: SrtEntry[];
  currentSrtLineId: number | string | null;
  isAudioPlaying?: boolean;
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
  isAudioPlaying = false,
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
  const [layout, setLayout] = useState<TranscriptLayout>(() =>
    storage.getItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY) === 'flow' ? 'flow' : 'cues');
  const [alignments, setAlignments] = useState(readTranscriptAlignments);
  const [hasNativeSelection, setHasNativeSelection] = useState(false);
  const followingCueRef = useRef<number | null>(null);
  const followAfterSwitchRef = useRef<number | string | null>(null);
  const paragraphListRef = useRef<ListImperativeAPI | null>(null);
  const contentWidth = Math.min(globalSettings.readerContentWidth || 740, (listWidth || (isMobile ? 360 : 740)) - 32);
  const wideScript = /^(?:zh|ja)(?:[-_]|$)/iu.test(languageCode ?? '');
  // Aim for about six lines in flow mode, with a cap for unpunctuated speech.
  // Keep each timed cue intact even when an individual cue is unusually long.
  const flowCharacters = Math.max(72, Math.min(480, Math.floor(contentWidth / (globalSettings.textSize * (wideScript ? 0.95 : 0.55))) * 6));
  const { paragraphs, paragraphByCue } = useMemo(() => groupTranscriptCues(srtLines, languageCode, layout,
    { maxCharacters: flowCharacters }), [srtLines, languageCode, layout, flowCharacters]);
  const transcriptKey = useMemo(() => paragraphs.map(paragraph =>
    paragraph.cues.map(cue => cue.separator + cue.text).join('')).join('\n\n'), [paragraphs]);
  const effectiveLineSpacing = isMobile ? mobileReadingConfig.lineSpacing : globalSettings.lineSpacing;
  const alignment = alignments[layout];
  const hasCurrentCue = currentSrtLineId !== null && srtLines.some(line => line.id === currentSrtLineId);
  const containerClassName = `audio-transcript-container audio-transcript-layout-${layout} reader-align-${alignment}${hasCurrentCue || isAudioPlaying ? ' is-following-cue' : ''}${hasNativeSelection ? ' has-native-selection' : ''}`;
  const fontStyle = getFontStyling(effectiveLineSpacing);
  const transcriptStyle = {
    ...fontStyle,
    '--reader-content-max-width': `${globalSettings.readerContentWidth || 740}px`,
    '--audio-transcript-row-padding': globalSettings.readingDensity === 'compact' ? '0.08em 0.65rem'
      : globalSettings.readingDensity === 'spacious' ? '0.24em 0.9rem' : '0.16em 0.75rem',
    '--audio-transcript-row-gap': `${Math.round((globalSettings.paragraphSpacing ?? 1) * (layout === 'flow' ? 20 : 35)) / 100}em`
  } as React.CSSProperties;
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: Math.ceil(globalSettings.textSize * (effectiveLineSpacing + (globalSettings.paragraphSpacing ?? 1)) + 24),
    key: [listWidth, globalSettings.readerContentWidth, globalSettings.textSize, globalSettings.textFont,
      effectiveLineSpacing, globalSettings.paragraphSpacing, globalSettings.readingDensity,
      alignment, languageCode, layout, transcriptKey].join(':')
  });

  // The reader addresses original cue indices; the virtual list now renders groups.
  useImperativeHandle(listRef, () => ({
    get element() { return paragraphListRef.current?.element ?? null; },
    scrollToRow: ({ index, ...options }) => {
      const paragraphIndex = paragraphByCue[index];
      const line = srtLines[index];
      if (paragraphIndex === undefined || !line || !paragraphs[paragraphIndex]) return;
      followingCueRef.current = line.id;
      const followCue = () => {
        if (followingCueRef.current !== line.id) return true;
        const viewport = paragraphListRef.current?.element;
        const cue = document.getElementById(`srt-line-${line.id}`);
        if (!viewport || !cue || !viewport.contains(cue)) return false;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.anchorNode && viewport.contains(selection.anchorNode)) return true;
        const bounds = viewport.getBoundingClientRect();
        const position = cue.getBoundingClientRect();
        const center = position.top + position.height / 2;
        const delta = center - bounds.top - bounds.height / 2;
        if (Math.abs(delta) > Math.max(12, bounds.height * 0.05)) {
          viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + delta), behavior: 'smooth' });
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
    const updateSelection = () => {
      const selection = window.getSelection();
      const container = textContentRef.current;
      setHasNativeSelection(Boolean(selection && !selection.isCollapsed && container &&
        ((selection.anchorNode && container.contains(selection.anchorNode)) ||
          (selection.focusNode && container.contains(selection.focusNode)))));
    };
    document.addEventListener('selectionchange', updateSelection);
    return () => document.removeEventListener('selectionchange', updateSelection);
  }, [textContentRef]);

  useEffect(() => {
    const cueId = followAfterSwitchRef.current;
    followAfterSwitchRef.current = null;
    if (cueId === null) return;
    const index = srtLines.findIndex(line => line.id === cueId);
    if (index < 0) return;
    if (isMobile) document.getElementById(`srt-line-${cueId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    else listRef.current?.scrollToRow({ index, align: 'center' });
  }, [layout, isMobile, listRef, srtLines]);

  useEffect(() => {
    const container = readingContainerRef.current;
    if (!container) return;
    const updateHeight = () => {
      if (isMobile) {
        setListWidth(container.getBoundingClientRect().width || window.innerWidth);
        return;
      }
      const top = paragraphListRef.current?.element?.getBoundingClientRect().top ?? container.getBoundingClientRect().top;
      setListHeight(Math.max(200, window.innerHeight - top - 16));
    };
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

  const layoutSwitch = (
    <div className="audio-transcript-layout-controls reader-quiet-controls">
      <ButtonGroup size="sm" aria-label="Transcript alignment">
        {([
          ['left', 'Left', 'Ragged-right text'],
          ['center', 'Center', 'Centered text'],
          ['justify', 'Justify', 'Justified text']
        ] as const).map(([value, label, title]) => (
          <Button key={value} variant={alignment === value ? 'primary' : 'outline-secondary'} title={title}
            aria-pressed={alignment === value} onClick={() => {
              const next = { ...alignments, [layout]: value };
              setAlignments(next);
              storage.setItem(AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY, JSON.stringify(next));
            }}>{label}</Button>
        ))}
      </ButtonGroup>
      <Form.Check type="switch" role="switch" id="audio-transcript-flow" label="Flowing text"
        checked={layout === 'flow'} onChange={event => {
          const next = event.target.checked ? 'flow' : 'cues';
          followAfterSwitchRef.current = currentSrtLineId;
          setLayout(next);
          storage.setItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, next);
        }} />
    </div>
  );

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
      <div className="audio-transcript-view">
        {layoutSwitch}
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
    <div className="audio-transcript-view">
      {layoutSwitch}
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
    </div>
  );
});

AudioTranscriptView.displayName = 'AudioTranscriptView';

export default AudioTranscriptView;
