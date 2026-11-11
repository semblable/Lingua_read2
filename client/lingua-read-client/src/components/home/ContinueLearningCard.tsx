import React, { useEffect, useState } from 'react';
import { Button, Card, ProgressBar, Spinner } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import { getText } from '../../utils/api';
import type { RecentTexts, Text } from '../../utils/api/texts';
import { normalizeMediaUrl } from '../library/mediaUrl';
import { comprehensionPercent } from '../../utils/comprehensibility';
import { relativeTime, resumeSummary, resumeTitle } from './resumeSummary';

interface ContinueLearningCardProps {
  text: RecentTexts[number] | null;
  loading?: boolean;
}

const ContinueLearningCard: React.FC<ContinueLearningCardProps> = ({ text, loading }) => {
  const [enrichment, setEnrichment] = useState<{ textId: number; data: Text | null } | null>(null);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const textId = text?.textId;
  const hasSummary = text?.totalWords != null;
  const fullText = enrichment?.textId === textId ? enrichment?.data : null;
  const enriching = textId != null && !hasSummary && enrichment?.textId !== textId;

  useEffect(() => {
    let cancelled = false;
    if (textId == null || hasSummary) return;
    // Compatibility with servers predating the recent-text summary.
    getText(textId).then(data => {
      if (!cancelled) setEnrichment({ textId, data: data ?? null });
    }).catch(() => {
      if (!cancelled) setEnrichment({ textId, data: null });
    });
    return () => { cancelled = true; };
  }, [textId, hasSummary]);

  if (loading) return (
    <Card className="home-continue-card h-100"><Card.Body className="home-card-loading"><Spinner animation="border" role="status"><span className="visually-hidden">Loading your last text</span></Spinner></Card.Body></Card>
  );
  if (!text) return (
    <Card className="home-continue-card h-100" data-testid="continue-card-empty">
      <Card.Body>
        <div className="home-section-label">Continue learning</div>
        <h2>A new chapter starts here.</h2>
        <p className="text-muted">Choose something you're curious about and make it part of your day.</p>
        <LinkContainer to="/library"><Button variant="primary">Open library <i className="bi bi-arrow-right ms-2" aria-hidden="true" /></Button></LinkContainer>
      </Card.Body>
    </Card>
  );

  const summaryText = { ...text, totalWords: text.totalWords ?? fullText?.totalWords ?? undefined };
  const summary = resumeSummary(summaryText);
  const comprehension = comprehensionPercent({
    totalWords: summaryText.totalWords,
    knownWords: text.knownWords ?? fullText?.knownWords,
    unknownWordPercentage: fullText?.unknownWordPercentage,
  });
  const previewSource = (text.preview || fullText?.content || '').replace(/\s+/g, ' ').trim();
  const preview = previewSource.length > 180
    ? `${previewSource.slice(0, 180).replace(/\s+\S*$/, '')}…` : previewSource;
  const title = resumeTitle(text);
  const lastOpened = relativeTime(text.lastAccessedAt);

  return (
    <Card className="home-continue-card h-100" data-testid="continue-card">
      <Card.Body>
        <div className="home-section-label"><i className="bi bi-bookmark" aria-hidden="true" /> Continue learning</div>
        <div className="home-current-text">
          <div className={`home-cover ${text.isAudioLesson ? 'home-cover-audio' : ''}`} aria-hidden="true">
            {text.coverImagePath && failedCover !== text.coverImagePath ? (
              <img src={normalizeMediaUrl(text.coverImagePath) ?? undefined} alt="" onError={() => setFailedCover(text.coverImagePath ?? null)} />
            ) : (
              <><i className={`bi bi-${text.isAudioLesson ? 'headphones' : 'book'}`} /><span>{text.languageName || 'LinguaRead'}</span><div className="home-cover-lines"><b /><b /><b /><b /><b /></div></>
            )}
          </div>
          <div className="home-current-copy">
            <div className="home-content-meta"><span>{text.languageName}</span><span className="home-format">{text.isAudioLesson ? 'Audio' : 'Text'}</span>{lastOpened && <span>Opened {lastOpened}</span>}</div>
            <h2 title={title}>{title}</h2>
            {text.bookTitle && text.title !== text.bookTitle && <div className="small text-muted mb-2">{text.title}</div>}
            {comprehension != null && <div className="home-vocabulary"><i className="bi bi-check2-circle" aria-hidden="true" /> {Math.round(comprehension)}% vocabulary coverage</div>}
            {preview && <div className="home-text-preview"><span>From this text</span><p>{preview}</p></div>}
            <div className="home-resume-position">
              <span><i className={`bi bi-${text.isAudioLesson ? 'play-circle' : 'bookmark-check'}`} aria-hidden="true" /> {summary.position}</span>
              {summary.eta && <span title={text.isAudioLesson ? 'Estimated from transcript length' : 'Estimated at 200 words per minute'}>{summary.eta}</span>}
            </div>
            {enriching ? <Spinner animation="border" size="sm" /> : summary.percent != null && (
              <div className="home-reading-progress">
                <div><span>{summary.label}</span><span>{summary.percent}%</span></div>
                <ProgressBar><ProgressBar now={summary.percent} aria-label={summary.label} /></ProgressBar>
              </div>
            )}
          </div>
        </div>
        <div className="home-continue-actions">
          <LinkContainer to={`/texts/${text.textId}`}><Button variant="primary">Resume <i className="bi bi-arrow-right ms-2" aria-hidden="true" /></Button></LinkContainer>
          <LinkContainer to="/library"><Button variant="outline-secondary">Open library</Button></LinkContainer>
        </div>
      </Card.Body>
    </Card>
  );
};

export default ContinueLearningCard;
