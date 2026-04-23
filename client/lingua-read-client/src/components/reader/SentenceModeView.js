import React, { useMemo } from 'react';
import { Button, Card, Badge } from 'react-bootstrap';
import { parseSentenceExplanation } from '../../utils/parseSentenceExplanation';
import { getTitleLineVariant } from '../../utils/readerText';

const SentenceModeView = React.memo(({
  currentSegment,
  segmentCount,
  currentSegmentIndex,
  creditedSegmentCount,
  fontStyle,
  processTextContent,
  handleWordSelection,
  textContentRef,
  canGoPrev,
  canGoNext,
  onPrev,
  onNext,
  onReplayAudio,
  canUseSentenceTts,
  isSpeakingSentence,
  sentenceTtsEnabled,
  setSentenceTtsEnabled,
  sentenceTtsRate,
  setSentenceTtsRate,
  isAudioLesson,
  sentenceAudioRepeats,
  setSentenceAudioRepeats,
  onShowTranslation,
  onShowExplanation,
  isTranslatingSegment,
  isExplainingSegment,
  isTranslationVisible,
  isExplanationVisible,
  currentSegmentTranslation,
  currentSegmentExplanation
}) => {
  const explanationParsed = useMemo(
    () => parseSentenceExplanation(currentSegmentExplanation), [currentSegmentExplanation]
  );
  const isTitleSegment = currentSegment.type === 'title';
  const renderSentenceModeTitle = () => {
    const titleLines = currentSegment.text.split('\n');

    return titleLines.map((line, lineIndex) => {
    if (!line.trim()) {
      return <div key={`title-segment-spacer-${lineIndex}`} className="reader-title-line-spacer" aria-hidden="true" />;
    }

    const titleLineVariant = getTitleLineVariant(line, lineIndex, titleLines);

    return (
      <div
        key={`title-segment-line-${lineIndex}`}
        className={`reader-title-line sentence-mode-title-line reader-title-line-${titleLineVariant}`}
      >
        {processTextContent(line)}
      </div>
    );
    });
  };

  if (!currentSegment) {
    return <p className="p-3">No sentence available.</p>;
  }

  return (
    <div className="sentence-mode-view">
      <div className="sentence-mode-toolbar">
        <div className="sentence-mode-toolbar-group">
          <Button variant="outline-secondary" size="sm" onClick={onPrev} disabled={!canGoPrev}>
            Previous
          </Button>
          <Badge bg="secondary">
            {segmentCount === 0 ? 0 : currentSegmentIndex + 1} / {segmentCount}
          </Badge>
          <Badge bg="light" text="dark">
            Read: {creditedSegmentCount}
          </Badge>
          <Button variant="outline-secondary" size="sm" onClick={onNext} disabled={!canGoNext}>
            Next
          </Button>
        </div>
        <div className="sentence-mode-toolbar-group">
          {isAudioLesson ? (
            <>
              <Button variant="outline-primary" size="sm" onClick={onReplayAudio}>
                Replay Audio
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setSentenceAudioRepeats(prev => Math.max(1, prev - 1))}
                disabled={sentenceAudioRepeats <= 1}
              >
                -
              </Button>
              <Badge bg="info">Repeats: {sentenceAudioRepeats}</Badge>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => setSentenceAudioRepeats(prev => Math.min(10, prev + 1))}
                disabled={sentenceAudioRepeats >= 10}
              >
                +
              </Button>
            </>
          ) : (
            sentenceTtsEnabled && (
              <>
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={onReplayAudio}
                  disabled={!canUseSentenceTts || !sentenceTtsEnabled}
                  title={canUseSentenceTts ? 'Read the current sentence aloud' : 'Speech synthesis is not supported in this browser'}
                >
                  {isSpeakingSentence ? 'Speaking...' : 'Listen'}
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
                  onClick={() => setSentenceTtsRate((prev) => prev - 0.1)}
                  disabled={!canUseSentenceTts || !sentenceTtsEnabled || sentenceTtsRate <= 0.5}
                  aria-label="Decrease speech rate"
                >
                  -
                </Button>
                <Badge bg="info">Rate: {sentenceTtsRate.toFixed(1)}x</Badge>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => setSentenceTtsRate((prev) => prev + 0.1)}
                  disabled={!canUseSentenceTts || !sentenceTtsEnabled || sentenceTtsRate >= 1.5}
                  aria-label="Increase speech rate"
                >
                  +
                </Button>
              </>
            )
          )}
          <Button variant="outline-info" size="sm" onClick={onShowTranslation} disabled={isTranslatingSegment}>
            {isTranslatingSegment ? 'Translating...' : (isTranslationVisible ? 'Hide Translation' : 'Show Translation')}
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={onShowExplanation} disabled={isExplainingSegment}>
            {isExplainingSegment ? 'Explaining...' : (isExplanationVisible ? 'Hide Explanation' : 'Explain Sentence')}
          </Button>
        </div>
      </div>
      <Card className="sentence-mode-card shadow-sm border-0">
        <Card.Body>
          <div
            className={`sentence-mode-text${isTitleSegment ? ' sentence-mode-title-text' : ''}`}
            ref={textContentRef}
            style={fontStyle}
            onMouseUp={handleWordSelection}
            onTouchEnd={handleWordSelection}
          >
            {Array.isArray(currentSegment.mediaBlocks) && currentSegment.mediaBlocks.length > 0 && (
              <div className="sentence-mode-media-stack">
                {currentSegment.mediaBlocks.map((mediaBlock, mediaIndex) => (
                  <figure key={`sentence-media-${currentSegment.index}-${mediaIndex}`} className="reader-image-block sentence-mode-image-block">
                    <img
                      src={mediaBlock.imageUrl}
                      alt={mediaBlock.altText || mediaBlock.caption || 'Illustration'}
                      className="reader-inline-image"
                    />
                    {mediaBlock.caption && (
                      <figcaption className="reader-image-caption">{mediaBlock.caption}</figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}
            {isTitleSegment ? renderSentenceModeTitle() : processTextContent(currentSegment.text)}
          </div>
          {isTranslationVisible && (
            <div className="sentence-mode-translation">
              {currentSegmentTranslation || 'No translation available.'}
            </div>
          )}
          {isExplanationVisible && (
            <div className="sentence-mode-explanation">
              {explanationParsed.fallback != null ? (
                <div className="sentence-mode-explanation-fallback">{explanationParsed.fallback || 'No explanation available.'}</div>
              ) : (
                <div className="sentence-mode-explanation-sections">
                  {explanationParsed.sections.map((sec) => (
                    <section key={sec.id} className="sentence-mode-explanation-section">
                      <h6 className="sentence-mode-explanation-heading">{sec.label}</h6>
                      <div className="sentence-mode-explanation-body">{sec.body}</div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
});

export default SentenceModeView;
