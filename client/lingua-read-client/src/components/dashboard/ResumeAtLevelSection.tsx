import React, { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { getTexts } from '../../utils/api';
import type { TextsList } from '../../utils/api/texts';
import { KRASHEN_SWEET_SPOT_MAX, KRASHEN_SWEET_SPOT_MIN } from '../../utils/comprehensibility';
import { readingSuggestions, type ReadingSuggestion } from './readingSuggestions';

const RecommendedReading = ({ pick }: { pick: ReadingSuggestion }) => {
  const { book, kind, totalWords, unfamiliarWords, percent } = pick;
  const inProgress = book != null && book.remainingParts < book.partCount;
  return (
    <Link to={pick.href} className="card h-100 resume-pick-card" data-testid={`resume-pick-${pick.key}`}>
      <div className="card-body">
        <div className="home-pick-meta">
          <span className="home-format"><i className={`bi bi-${kind === 'book' ? 'book' : kind === 'audio' ? 'headphones' : 'file-text'}`} aria-hidden="true" /> {kind === 'book' ? 'Book' : kind === 'audio' ? 'Audio' : 'Text'}</span>
          <span>{totalWords.toLocaleString()} {kind === 'audio' ? 'transcript words' : inProgress ? 'words in unread parts' : 'words'}</span>
        </div>
        <h3 className="home-pick-title">{pick.title}</h3>
        <div className="home-vocabulary">{Math.round(percent)}% vocabulary coverage</div>
        {book && <p className="text-muted small mb-2">{inProgress ? `Across ${book.remainingParts} of ${book.partCount} parts still unread` : 'Across the whole book'}</p>}
        <div className="home-pick-details">
          <span title="Word occurrences outside your familiar vocabulary; repeated forms may appear more than once.">{unfamiliarWords.toLocaleString()} unfamiliar {unfamiliarWords === 1 ? 'word' : 'words'}</span>
          {kind === 'text' && <span title="Estimated at 200 words per minute">~{Math.max(1, Math.ceil(totalWords / 200))} min read</span>}
          {book && !inProgress && <span>{book.partCount} {book.partCount === 1 ? 'part' : 'parts'}</span>}
        </div>
        <div className="home-pick-action small fw-semibold mt-3">
          {pick.action} <i className="bi bi-arrow-right" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
};

const ResumeAtLevelSection: React.FC = () => {
  const [texts, setTexts] = useState<TextsList | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getTexts();
        if (!cancelled) setTexts(data ?? []);
      } catch {
        if (!cancelled) setTexts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const picksByLanguage = useMemo(() => readingSuggestions(texts ?? []), [texts]);

  if (loading) {
    return (
      <Card className="shadow-sm mb-4" data-testid="resume-at-level-section">
        <Card.Body className="text-center py-3">
          <Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Finding reading suggestions</span></Spinner>
        </Card.Body>
      </Card>
    );
  }

  if (picksByLanguage.size === 0) return null;

  return (
    <Card className="shadow-sm mb-4 home-recommendations" data-testid="resume-at-level-section">
      <Card.Body>
        <Card.Title as="h2" className="mb-1">What to read next</Card.Title>
        <Card.Subtitle className="text-muted small mb-3">
          Books, texts and audio from your library · {KRASHEN_SWEET_SPOT_MIN}–{KRASHEN_SWEET_SPOT_MAX}% vocabulary coverage
        </Card.Subtitle>

        {Array.from(picksByLanguage.entries()).map(([language, picks]) => (
          <div key={language} className="mb-3" data-testid={`resume-language-${language}`}>
            <div className="text-muted text-uppercase small fw-bold mb-2">{language}</div>
            <Row className="g-2 home-recommendation-grid">
              {picks.map(pick => (
                <Col md={6} lg={4} key={pick.key}>
                  <RecommendedReading pick={pick} />
                </Col>
              ))}
            </Row>
          </div>
        ))}
      </Card.Body>
    </Card>
  );
};

export default ResumeAtLevelSection;
