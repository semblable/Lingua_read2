import React, { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Spinner } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import { getTexts } from '../../utils/api';
import type { StoredText } from '../../utils/store';
import ComprehensibilityBadge from '../shared/ComprehensibilityBadge';
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
    <Card className="shadow-sm mb-4" data-testid="resume-at-level-section">
      <Card.Body>
        <Card.Title className="mb-1">Resume at your level</Card.Title>
        <Card.Subtitle className="text-muted small mb-3">
          Unread texts where you already know {KRASHEN_SWEET_SPOT_MIN}–{KRASHEN_SWEET_SPOT_MAX}% of the words —
          the comprehension sweet spot for vocabulary growth.
        </Card.Subtitle>

        {Array.from(picksByLanguage.entries()).map(([language, picks]) => (
          <div key={language} className="mb-3" data-testid={`resume-language-${language}`}>
            <div className="text-muted text-uppercase small fw-bold mb-2">{language}</div>
            <Row className="g-2">
              {picks.map(({ text, percent }) => (
                <Col md={6} lg={4} key={text.textId}>
                  <LinkContainer to={`/texts/${text.textId}`}>
                    <Card
                      role="link"
                      className="h-100 resume-pick-card"
                      style={{ cursor: 'pointer' }}
                      data-testid={`resume-pick-${text.textId}`}
                    >
                      <Card.Body className="py-2 px-3">
                        <div className="text-truncate fw-semibold">{text.title}</div>
                        <div className="mt-1">
                          <ComprehensibilityBadge
                            totalWords={text.totalWords}
                            knownWords={text.knownWords}
                            unknownWords={text.unknownWords}
                            unknownWordPercentage={percent != null ? 100 - percent : text.unknownWordPercentage}
                          />
                        </div>
                      </Card.Body>
                    </Card>
                  </LinkContainer>
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
