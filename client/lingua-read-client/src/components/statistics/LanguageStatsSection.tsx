import React from 'react';
import { Alert, Badge, Card, Col, ProgressBar, Row } from 'react-bootstrap';
import CefrBadge from '../dashboard/CefrBadge';
import { formatDuration } from '../../utils/statistics';
import type { LanguageStatsRow } from '../../utils/statistics';

interface LanguageStatsSectionProps {
  languages: LanguageStatsRow[];
  loadingActivity: boolean;
  selectedLanguageId?: string | number | 'all';
  onSelectLanguage?: (value: string) => void;
}

const LanguageStatsSection = ({ languages, loadingActivity, selectedLanguageId, onSelectLanguage }: LanguageStatsSectionProps) => {
  if (languages.length === 0) {
    return <Alert variant="info">No language-specific data available yet.</Alert>;
  }

  const handleSelect = (languageId: number | string) => {
    if (typeof onSelectLanguage !== 'function') return;
    if (String(selectedLanguageId) === String(languageId)) {
      onSelectLanguage('all');
    } else {
      onSelectLanguage(String(languageId));
    }
  };

  return (
    <section className="mb-4">
      <div className="d-flex justify-content-between align-items-end mb-3 flex-wrap gap-2">
        <div>
          <h3 className="h4 fw-bold mb-1">Statistics by Language</h3>
          <div className="text-muted small">Vocabulary, reading, and listening in one place. Click a card to filter the page.</div>
        </div>
      </div>

      <Row className="g-3">
        {languages.map((language: LanguageStatsRow) => {
          const knownPercent = language.totalWordsEncountered > 0
            ? Math.round((language.knownWords / language.totalWordsEncountered) * 100)
            : 0;
          const learningPercent = language.totalWordsEncountered > 0
            ? Math.round((language.learningWords / language.totalWordsEncountered) * 100)
            : 0;
          const isSelected = String(selectedLanguageId) === String(language.languageId);
          const clickable = typeof onSelectLanguage === 'function';

          const cardProps = clickable
            ? {
                role: 'button',
                tabIndex: 0,
                onClick: () => handleSelect(language.languageId),
                onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(language.languageId);
                  }
                },
                'aria-pressed': isSelected
              }
            : {};

          return (
            <Col md={6} xl={4} key={language.languageId}>
              <Card
                className={`stats-card h-100 shadow-sm${clickable ? ' stats-card-clickable' : ''}${isSelected ? ' stats-card-selected' : ''}`}
                {...cardProps}
              >
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-start mb-3">
                    <div>
                      <Card.Title className="mb-1">{language.languageName}</Card.Title>
                      <div className="small text-muted">
                        {language.totalWordsEncountered.toLocaleString()} words encountered
                      </div>
                    </div>
                    <div className="text-end">
                      {language.cefrLevel && <CefrBadge level={language.cefrLevel} />}
                      {language.isCefrApproximate && (
                        <div className="small text-muted" title="CEFR estimate uses fallback thresholds">
                          approx.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="stats-language-metric">
                    <span>Known Words</span>
                    <strong className="text-success">{language.knownWords.toLocaleString()}</strong>
                  </div>
                  <div className="stats-language-metric">
                    <span>Learning Words</span>
                    <strong className="text-warning">{language.learningWords.toLocaleString()}</strong>
                  </div>

                  {language.totalWordsEncountered > 0 && (
                    <ProgressBar className="my-3 stats-stacked-progress">
                      <ProgressBar
                        variant="success"
                        now={knownPercent}
                        key="known"
                        label={`${knownPercent}%`}
                      />
                      <ProgressBar
                        variant="warning"
                        now={learningPercent}
                        key="learning"
                        label={learningPercent > 8 ? `${learningPercent}%` : undefined}
                      />
                    </ProgressBar>
                  )}

                  <div className="stats-language-metric">
                    <span>Words Read</span>
                    <strong>{loadingActivity ? 'Loading...' : language.displayWordsRead.toLocaleString()}</strong>
                  </div>
                  <div className="stats-language-metric">
                    <span>Listening Time</span>
                    <strong>{loadingActivity ? 'Loading...' : formatDuration(language.displaySecondsListened)}</strong>
                  </div>
                  <div className="stats-language-metric">
                    <span>Books Completed</span>
                    <Badge bg="success" className="rounded-pill">
                      {language.finishedBookCount} / {language.bookCount}
                    </Badge>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>
    </section>
  );
};

export default LanguageStatsSection;

