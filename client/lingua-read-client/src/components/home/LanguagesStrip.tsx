import React, { useState } from 'react';
import { Card } from 'react-bootstrap';
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

const activityTime = (language: LanguageStripItem): number => {
  const timestamp = language.lastActivityAt ? Date.parse(language.lastActivityAt) : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const LanguagesStrip: React.FC<{ languages: LanguageStripItem[]; maxVisible?: number }> = ({ languages, maxVisible = 3 }) => {
  const [recentCutoff] = useState(() => Date.now() - 14 * 86400000);
  if (!languages?.length) return null;
  const visible = [...languages].sort((a, b) => activityTime(b) - activityTime(a) || b.knownWords - a.knownWords).slice(0, maxVisible);
  const active = visible.filter(language => language.todayWordsRead > 0 || (language.todayListeningSeconds ?? 0) > 0
    || language.last14DaysWords?.some(day => day.count > 0)
    || activityTime(language) > recentCutoff);
  const dormant = visible.filter(language => !active.includes(language));
  return (
    <Card className="home-languages" data-testid="languages-strip">
      <Card.Body>
        <div className="home-section-heading"><h2>Your languages</h2><Link to="/dashboard">See all{languages.length > visible.length ? ` (${languages.length})` : ''} <i className="bi bi-chevron-right" aria-hidden="true" /></Link></div>
        {active.length > 0 && <div className="home-active-languages">{active.map(language => <LanguageDashboardCard key={language.languageId} lang={language} showActivity={active.length > 1} showResume={active.length > 1} />)}</div>}
        {dormant.length > 0 && <div className="home-dormant-languages">{dormant.map(language => <LanguageDashboardCard key={language.languageId} lang={language} compact />)}</div>}
        <p className="home-language-footnote">Vocabulary counts saved forms, including inflections, rather than lemmas. CEFR levels are estimates. <span>Use <i className="bi bi-sliders" aria-hidden="true" /> to set your level or choose maintenance.</span></p>
      </Card.Body>
    </Card>
  );
};

export default LanguagesStrip;
