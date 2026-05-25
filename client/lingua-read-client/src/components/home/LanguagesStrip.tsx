import React from 'react';
import { Card, Col, Row } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import LanguageDashboardCard from '../dashboard/LanguageDashboardCard';

interface LanguageStripItem {
  languageId: number;
  languageName: string;
  knownWords: number;
  totalWords: number;
  cefrLevel?: string | null;
  nextCefrLevel?: string | null;
  knownWordsToNextLevel: number;
  bandProgressPercent?: number;
  isCefrApproximate?: boolean;
  todayWordsRead: number;
  todayListeningSeconds?: number;
  currentReadingStreakDays: number;
  last14DaysWords?: Array<{ date: string; count: number }>;
  continueReadingTextId?: number | null;
  lastActivityAt?: string | null;
}

interface LanguagesStripProps {
  languages: LanguageStripItem[];
  maxVisible?: number;
}

// Sort by most-recent activity, then by total known words as a tie-breaker.
const sortByActivity = (langs: LanguageStripItem[]): LanguageStripItem[] => {
  return [...langs].sort((a, b) => {
    const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return (b.knownWords || 0) - (a.knownWords || 0);
  });
};

const LanguagesStrip: React.FC<LanguagesStripProps> = ({ languages, maxVisible = 3 }) => {
  if (!languages || languages.length === 0) return null;

  const sorted = sortByActivity(languages);
  const visible = sorted.slice(0, maxVisible);
  const remaining = sorted.length - visible.length;

  return (
    <Card className="shadow-sm mb-4" data-testid="languages-strip">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <Card.Title as="h5" className="mb-0">
            Your languages
          </Card.Title>
          <Link to="/dashboard" className="btn btn-sm btn-outline-secondary">
            See all{remaining > 0 ? ` (${languages.length})` : ''} →
          </Link>
        </div>
        <Row className="g-3">
          {visible.map((lang) => (
            <Col key={lang.languageId} md={6} xl={4}>
              <LanguageDashboardCard lang={lang} />
            </Col>
          ))}
        </Row>
      </Card.Body>
    </Card>
  );
};

export default LanguagesStrip;
