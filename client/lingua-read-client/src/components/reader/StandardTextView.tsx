import React from 'react';
import { Button, Spinner, Badge } from 'react-bootstrap';
import { buildDisplayBlocks, getTitleLineVariant } from '../../utils/readerText';
import type { DisplayBlock } from '../../utils/readerText';
import type { Settings } from '../../contexts/SettingsContext';

interface ProcessedSentenceResult {
  sentenceElements: React.ReactNode[] | null;
  nextSentenceIndex: number;
}

interface StandardTextViewProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  text: any;
  globalSettings: Settings;
  readingUiMode: string;
  mobileReadingConfig: {
    lineSpacing: number;
    blockPadding: string | number;
    chunkSize: number;
  };
  getFontFamilyForList: () => string;
  handleWordSelection: () => void;
  processTextContent: (text: string) => React.ReactNode;
  renderProcessedContentAsSentences: (
    processed: React.ReactNode,
    startIndex: number
  ) => ProcessedSentenceResult;
  isMobile: boolean;
  textContentRef: React.RefObject<HTMLDivElement>;
  canUseSentenceTts: boolean;
  isSpeakingSentence: boolean;
  sentenceTtsEnabled: boolean;
  setSentenceTtsEnabled: (value: boolean) => void;
  sentenceTtsRate: number;
  setSentenceTtsRate: (value: number | ((prev: number) => number)) => void;
  onSpeakSentence: () => void;
  handleCompleteLesson: () => void;
  completing: boolean;
  nextTextId?: number | null;
}

const StandardTextView = React.memo(({
  text,
  globalSettings,
  readingUiMode,
  mobileReadingConfig,
  getFontFamilyForList,
  handleWordSelection,
  processTextContent,
  renderProcessedContentAsSentences,
  isMobile,
  textContentRef,
  canUseSentenceTts,
  isSpeakingSentence,
  sentenceTtsEnabled,
  setSentenceTtsEnabled,
  sentenceTtsRate,
  setSentenceTtsRate,
  onSpeakSentence,
  handleCompleteLesson,
  completing,
  nextTextId
}: StandardTextViewProps) => {
  if (!text?.content) return null;
  const displayBlocks = buildDisplayBlocks(text.content, text.structuredContent);
  let currentSentenceIndex = 0;
  const groupSentences = (sentenceElements: React.ReactNode[], groupSize: number): React.ReactNode[][] => {
    if (!Array.isArray(sentenceElements) || sentenceElements.length === 0) return [];
    const groups: React.ReactNode[][] = [];
    let currentGroup: React.ReactNode[] = [];
    let sentenceCount = 0;
    sentenceElements.forEach((sentence: React.ReactNode) => {
      currentGroup.push(sentence);
      sentenceCount += 1;
      if (sentenceCount >= groupSize) {
        groups.push(currentGroup);
        currentGroup = [];
        sentenceCount = 0;
      }
    });
    if (currentGroup.length) groups.push(currentGroup);
    return groups;
  };
  const modeClass = readingUiMode === 'modern' ? 'modern' : 'classic';
  const renderLineAsSentences = (lineText: string): React.ReactNode[] => {
    const processedLineElements = processTextContent(lineText);
    const { sentenceElements, nextSentenceIndex } = renderProcessedContentAsSentences(processedLineElements, currentSentenceIndex);
    currentSentenceIndex = nextSentenceIndex;
    return sentenceElements ?? [];
  };
  const renderTitleLine = (line: string, lineIndex: number, blockKey: string, lines: string[]): React.ReactNode => {
    if (!line) {
      return <div key={`${blockKey}-spacer-${lineIndex}`} className="reader-title-line-spacer" aria-hidden="true" />;
    }

    const titleLineVariant = getTitleLineVariant(line, lineIndex, lines);

    return (
      <div
        key={`${blockKey}-line-${lineIndex}`}
        className={`reader-title-line reader-title-line-${modeClass} reader-title-line-${titleLineVariant}`}
      >
        {renderLineAsSentences(line)}
      </div>
    );
  };

  return (
    <div className="d-flex flex-column gap-2 h-100">
      {sentenceTtsEnabled && (
        <div className="d-flex flex-wrap align-items-center gap-1 px-2 pt-2">
          <Button
            variant="outline-primary"
            size="sm"
            onClick={onSpeakSentence}
            disabled={!canUseSentenceTts || !sentenceTtsEnabled}
            title={canUseSentenceTts ? 'Read the current sentence aloud' : 'Speech synthesis is not supported in this browser'}
          >
            {isSpeakingSentence ? 'Speaking...' : 'Speak Sentence'}
          </Button>
          <Button
            variant={sentenceTtsEnabled ? 'outline-success' : 'outline-secondary'}
            size="sm"
            onClick={() => setSentenceTtsEnabled(!sentenceTtsEnabled)}
            disabled={!canUseSentenceTts}
          >
            {sentenceTtsEnabled ? 'TTS On' : 'TTS Off'}
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setSentenceTtsRate((prev: number) => prev - 0.1)}
            disabled={!canUseSentenceTts || !sentenceTtsEnabled || sentenceTtsRate <= 0.5}
            aria-label="Decrease sentence speech rate"
          >
            -
          </Button>
          <Badge bg="info">Rate: {sentenceTtsRate.toFixed(1)}x</Badge>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => setSentenceTtsRate((prev: number) => prev + 0.1)}
            disabled={!canUseSentenceTts || !sentenceTtsEnabled || sentenceTtsRate >= 1.5}
            aria-label="Increase sentence speech rate"
          >
            +
          </Button>
        </div>
      )}
      <div
        className={`text-content text-content-${modeClass} reader-align-${globalSettings.readerTextAlignment || 'left'} ${globalSettings.readerParagraphIndent ? 'reader-indent-on' : 'reader-indent-off'}`}
        ref={textContentRef}
        style={{
          fontSize: `${globalSettings.textSize}px`,
          lineHeight: isMobile ? mobileReadingConfig.lineSpacing : 'var(--reading-line-height)',
          fontFamily: getFontFamilyForList(),
          // Custom properties don't appear in React.CSSProperties; cast at the
          // boundary so the `--mobile-reading-*` vars propagate to children.
          ...({
            '--mobile-reading-block-padding': mobileReadingConfig.blockPadding,
            '--mobile-reading-line-height': mobileReadingConfig.lineSpacing
          } as React.CSSProperties)
        }}
        onMouseUp={handleWordSelection}
        onTouchEnd={handleWordSelection}
      >
        {displayBlocks.map((block: DisplayBlock) => {
          if (block.type === 'image') {
            return (
              <figure key={block.key} className={`reader-image-block reader-image-block-${modeClass}`}>
                <img
                  src={block.imageUrl ?? undefined}
                  alt={block.altText || block.caption || 'Illustration'}
                  className="reader-inline-image"
                />
                {block.caption && (
                  <figcaption className="reader-image-caption">{block.caption}</figcaption>
                )}
              </figure>
            );
          }

          if (block.isTitleBlock) {
            return (
              <div
                key={`${block.key}-title`}
                className={`reader-title-block reader-title-block-${modeClass}`}
              >
                {(block.lines ?? []).map((line: string, lineIndex: number) => renderTitleLine(line, lineIndex, block.key, block.lines ?? []))}
              </div>
            );
          }

          const processedParaElements = processTextContent(block.text ?? '');
          const { sentenceElements, nextSentenceIndex } = renderProcessedContentAsSentences(processedParaElements, currentSentenceIndex);
          currentSentenceIndex = nextSentenceIndex;

          if (isMobile) {
            const grouped = groupSentences(sentenceElements || [], mobileReadingConfig.chunkSize);
            return (
              <div key={block.key} className={`reading-block-group reading-block-group-${modeClass}`}>
                {grouped.map((group: React.ReactNode[], groupIndex: number) => (
                  <p key={`${block.key}-group-${groupIndex}`} className={`reading-block reading-block-${modeClass}`}>
                    {group.map((sentence: React.ReactNode, sentenceIndex: number) => (
                      <React.Fragment key={`${block.key}-group-${groupIndex}-sentence-${sentenceIndex}`}>
                        {sentence}
                        {sentenceIndex < group.length - 1 ? ' ' : null}
                      </React.Fragment>
                    ))}
                  </p>
                ))}
              </div>
            );
          }

          return (
            <p key={block.key} className={`reader-paragraph reader-paragraph-${modeClass}`}>
              {sentenceElements}
            </p>
          );
        })}
      </div>
      <div className="reader-end-of-text-actions">
        <Button
          variant="success"
          size="lg"
          onClick={handleCompleteLesson}
          disabled={completing}
        >
          {completing ? <Spinner animation="border" size="sm" /> : (nextTextId === null && text?.bookId ? 'Finish Book' : 'Complete Lesson')}
        </Button>
      </div>
    </div>
  );
});

export default StandardTextView;
