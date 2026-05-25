import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, ProgressBar, Spinner } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import { getText } from '../../utils/api';
import type { RecentTexts, Text } from '../../utils/api/texts';
import { comprehensionBand, comprehensionPercent } from '../../utils/comprehensibility';
import ComprehensibilityBadge from '../shared/ComprehensibilityBadge';

type RecentText = RecentTexts[number];

interface ContinueLearningCardProps {
  text: RecentText | null;
  loading?: boolean;
}

const formatEta = (totalWords?: number, knownWords?: number): string | null => {
  if (!totalWords || totalWords <= 0) return null;
  const remaining = Math.max(0, totalWords - (knownWords ?? 0));
  if (remaining <= 0) return 'Wrapping up';
  const minutes = Math.max(1, Math.ceil(remaining / 200));
  return `~${minutes} min remaining`;
};

const displayTitle = (text: RecentText): string => {
  if (text.bookTitle) {
    const part = text.partNumber ? ` · Part ${text.partNumber}` : '';
    return `${text.bookTitle}${part}`;
  }
  return text.title || 'Untitled';
};

const partSubtitle = (text: RecentText, fullText: Text | null): string | null => {
  if (text.bookTitle && text.title && text.title !== text.bookTitle) {
    return text.title;
  }
  if (fullText && fullText.title && fullText.title !== text.title) {
    return fullText.title;
  }
  return null;
};

const EmptyContinueCard: React.FC = () => (
  <Card className="shadow-sm h-100" data-testid="continue-card-empty">
    <Card.Body className="d-flex flex-column">
      <Card.Subtitle className="text-muted small text-uppercase fw-bold mb-2">
        Continue learning
      </Card.Subtitle>
      <Card.Title className="mb-2">Nothing to resume yet</Card.Title>
      <Card.Text className="text-muted">
        Pick a text from your library to start reading.
      </Card.Text>
      <div className="mt-auto d-flex gap-2 flex-wrap">
        <LinkContainer to="/library">
          <Button variant="primary">Open library</Button>
        </LinkContainer>
        <LinkContainer to="/texts/create">
          <Button variant="outline-secondary">Add a text</Button>
        </LinkContainer>
      </div>
    </Card.Body>
  </Card>
);

const LoadingContinueCard: React.FC = () => (
  <Card className="shadow-sm h-100">
    <Card.Body className="d-flex align-items-center justify-content-center" style={{ minHeight: 200 }}>
      <Spinner animation="border" />
    </Card.Body>
  </Card>
);

const ContinueLearningCard: React.FC<ContinueLearningCardProps> = ({ text, loading }) => {
  const [fullText, setFullText] = useState<Text | null>(null);
  const [enriching, setEnriching] = useState(false);

  const textId = text?.textId;
  useEffect(() => {
    let cancelled = false;
    if (textId == null) {
      setFullText(null);
      return;
    }
    setEnriching(true);
    (async () => {
      try {
        const data = await getText(textId as number);
        if (!cancelled) setFullText(data ?? null);
      } catch {
        if (!cancelled) setFullText(null);
      } finally {
        if (!cancelled) setEnriching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [textId]);

  if (loading) return <LoadingContinueCard />;
  if (!text) return <EmptyContinueCard />;

  const totalWords = fullText?.totalWords ?? undefined;
  const knownWords = fullText?.knownWords ?? undefined;
  const isAudio = !!text.isAudioLesson;

  // Progress: known/total word ratio. (Audio playback position isn't on the
  // detail endpoint, so we surface vocabulary comprehension for both modes.)
  const progressPercent = (() => {
    if (totalWords && totalWords > 0 && knownWords != null) {
      return Math.round((knownWords / totalWords) * 100);
    }
    return null;
  })();

  const compPercent = comprehensionPercent({
    totalWords,
    knownWords,
    unknownWords: fullText?.unknownWords,
    unknownWordPercentage: fullText?.unknownWordPercentage,
  });
  const band = comprehensionBand(compPercent);
  const progressVariant = band === 'sweet-spot' ? 'success' : 'primary';

  const eta = isAudio ? null : formatEta(totalWords, knownWords);
  const subtitle = partSubtitle(text, fullText);

  return (
    <Card
      className="shadow-sm h-100"
      data-testid="continue-card"
      style={isAudio ? { borderLeft: '4px solid var(--bs-info, #0dcaf0)' } : undefined}
    >
      <Card.Body className="d-flex flex-column">
        <Card.Subtitle className="text-muted small text-uppercase fw-bold mb-2 d-flex align-items-center gap-2">
          <span>Continue learning</span>
          {isAudio && (
            <Badge bg="info" pill style={{ fontSize: '0.65rem' }}>
              Audio
            </Badge>
          )}
        </Card.Subtitle>

        <Card.Title className="mb-1" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
          {displayTitle(text)}
        </Card.Title>
        {subtitle && (
          <div className="text-muted mb-2" style={{ fontSize: '0.95rem' }}>
            {subtitle}
          </div>
        )}

        <div className="d-flex align-items-center gap-2 flex-wrap mb-3">
          {text.languageName && (
            <Badge bg="secondary" pill style={{ fontSize: '0.7rem' }}>
              {text.languageName}
            </Badge>
          )}
          {compPercent != null && (
            <ComprehensibilityBadge
              totalWords={totalWords}
              knownWords={knownWords}
              unknownWords={fullText?.unknownWords}
              unknownWordPercentage={fullText?.unknownWordPercentage}
              showLabel
            />
          )}
        </div>

        <div className="mb-3" style={{ minHeight: 40 }}>
          {enriching ? (
            <Spinner animation="border" size="sm" />
          ) : progressPercent != null ? (
            <>
              <div className="d-flex justify-content-between small text-muted mb-1">
                <span>Vocabulary known</span>
                <span>{progressPercent}%</span>
              </div>
              <ProgressBar
                now={progressPercent}
                variant={progressVariant}
                style={{ height: 8 }}
              />
              {eta && <div className="small text-muted mt-1">{eta}</div>}
            </>
          ) : (
            <div className="small text-muted">No progress recorded yet.</div>
          )}
        </div>

        <div className="mt-auto d-flex gap-2 flex-wrap">
          <LinkContainer to={`/texts/${text.textId}`}>
            <Button variant="primary">Resume</Button>
          </LinkContainer>
          <LinkContainer to="/library">
            <Button variant="outline-secondary">Open library</Button>
          </LinkContainer>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ContinueLearningCard;
