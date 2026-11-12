import React, { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { getTexts } from '../../utils/api';
import type { StoredText } from '../../utils/store';
import {
  comprehensionBand,
  comprehensionPercent,
  KRASHEN_SWEET_SPOT_MAX,
  KRASHEN_SWEET_SPOT_MIN,
} from '../../utils/comprehensibility';

const PICKS_PER_LANGUAGE = 3;
const TARGET_PERCENT = (KRASHEN_SWEET_SPOT_MIN + KRASHEN_SWEET_SPOT_MAX) / 2;

interface ScoredText {
  text: StoredText;
  percent: number;
  languageName: string;
}

const RecommendedText = ({ text, percent }: Pick<ScoredText, 'text' | 'percent'>) => {
  const total = text.totalWords;
  const unfamiliar = total != null && total > 0
    ? Math.max(0, Math.min(total, text.unknownWords ?? Math.round(total * (100 - percent) / 100))) : null;
  return (
    <Link to={`/texts/${text.textId}`} className="card h-100 resume-pick-card" data-testid={`resume-pick-${text.textId}`}>
      <div className="card-body">
        <div className="home-pick-meta">
          <span className="home-format"><i className={`bi bi-${text.isAudioLesson ? 'headphones' : 'file-text'}`} aria-hidden="true" /> {text.isAudioLesson ? 'Audio' : 'Text'}</span>
          {total != null && total > 0 && <span>{total.toLocaleString()} {text.isAudioLesson ? 'transcript words' : 'words'}</span>}
        </div>
        <h3 className="home-pick-title">{text.title}</h3>
        <div className="home-vocabulary">{Math.round(percent)}% vocabulary coverage</div>
        <div className="home-pick-details">
          {unfamiliar != null && <span title="Word occurrences outside your familiar vocabulary; repeated forms may appear more than once.">{unfamiliar.toLocaleString()} unfamiliar {unfamiliar === 1 ? 'word' : 'words'}</span>}
          {!text.isAudioLesson && total != null && total > 0 && <span title="Estimated at 200 words per minute">~{Math.max(1, Math.ceil(total / 200))} min read</span>}
        </div>
      </div>
    </Link>
  );
};

const ResumeAtLevelSection: React.FC = () => {
  const [texts, setTexts] = useState<StoredText[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await getTexts()) as StoredText[] | null | undefined;
        if (!cancelled) setTexts(data ?? []);
      } catch {
        if (!cancelled) setTexts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const picksByLanguage = useMemo<Map<string, ScoredText[]>>(() => {
    if (!texts || texts.length === 0) return new Map();
    const grouped = new Map<string, ScoredText[]>();

    for (const text of texts) {
      if (text.isFinished) continue;
      const percent = comprehensionPercent({
        totalWords: text.totalWords,
        knownWords: text.knownWords,
        unknownWords: text.unknownWords,
        unknownWordPercentage: text.unknownWordPercentage,
      });
      if (percent == null) continue;
      if (comprehensionBand(percent) !== 'sweet-spot') continue;

      const language = text.languageName ?? 'Unknown';
      const arr = grouped.get(language) ?? [];
      arr.push({ text, percent, languageName: language });
      grouped.set(language, arr);
    }

    // Sort each group by closeness to the middle of the sweet-spot band, then truncate.
    const result = new Map<string, ScoredText[]>();
    for (const [lang, items] of grouped) {
      const sorted = [...items].sort((a, b) =>
        Math.abs(a.percent - TARGET_PERCENT) - Math.abs(b.percent - TARGET_PERCENT)
      );
      result.set(lang, sorted.slice(0, PICKS_PER_LANGUAGE));
    }
    return result;
  }, [texts]);

  if (loading) {
    return (
      <Card className="shadow-sm mb-4" data-testid="resume-at-level-section">
        <Card.Body className="text-center py-3">
          <Spinner animation="border" size="sm" />
        </Card.Body>
      </Card>
    );
  }

  if (picksByLanguage.size === 0) return null;

  return (
    <Card className="shadow-sm mb-4 home-recommendations" data-testid="resume-at-level-section">
      <Card.Body>
        <Card.Title as="h2" className="mb-1">Find your next read</Card.Title>
        <Card.Subtitle className="text-muted small mb-3">
          From your library · {KRASHEN_SWEET_SPOT_MIN}–{KRASHEN_SWEET_SPOT_MAX}% vocabulary coverage, with room to grow.
        </Card.Subtitle>

        {Array.from(picksByLanguage.entries()).map(([language, picks]) => (
          <div key={language} className="mb-3" data-testid={`resume-language-${language}`}>
            <div className="text-muted text-uppercase small fw-bold mb-2">{language}</div>
            <Row className="g-2 home-recommendation-grid">
              {picks.map(({ text, percent }) => (
                <Col md={6} lg={4} key={text.textId}>
                  <RecommendedText text={text} percent={percent} />
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
