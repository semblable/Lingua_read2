import React, { useState } from 'react';
import { Alert, Button, Card, Form, Modal, ProgressBar } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import { useAuthStore } from '../../utils/store';
import storage from '../../utils/storage';
import Sparkline from './Sparkline';

interface LanguageDashboardCardData {
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
}

const FOCUS_OPTIONS = ['estimate', 'maintenance', 'hidden', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const FORM_COUNT_NOTE = 'Distinct saved word forms and phrases. Inflections count separately; this is not a lemma count.';
const LEVEL_NOTE = 'A rough vocabulary-based CEFR estimate, not a measure of your overall proficiency.';

const LanguageDashboardCard = ({ lang, compact = false, showActivity = true, showResume = true }: {
  lang: LanguageDashboardCardData;
  compact?: boolean;
  showActivity?: boolean;
  showResume?: boolean;
}) => {
  const { user } = useAuthStore();
  const storageKey = `language-focus:${String(user?.id ?? user?.userId ?? user?.username ?? 'local')}:${lang.languageId}`;
  const [focus, setFocus] = useState(() => {
    const saved = storage.getItem(storageKey);
    return saved && FOCUS_OPTIONS.includes(saved) ? saved : 'estimate';
  });
  const [draft, setDraft] = useState(focus);
  const [editing, setEditing] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const estimate = focus === 'estimate';
  const showLevel = focus !== 'hidden';
  const level = focus === 'maintenance' ? 'Maintenance' : estimate
    ? lang.cefrLevel ? `${lang.cefrLevel} · estimate` : 'Vocabulary tracking' : `${focus} · self-set`;
  const hasReading = lang.last14DaysWords?.some(day => day.count > 0);
  const bandProgress = Math.max(0, Math.min(100, lang.bandProgressPercent || 0));
  const condensed = compact || focus === 'maintenance';
  const editButton = (
    <Button className="home-language-edit" variant="link" size="sm" aria-label={`Learning focus for ${lang.languageName}`} title={`Set your ${lang.languageName} level or choose maintenance`} onClick={() => { setDraft(focus); setEditing(true); }}>
      <i className="bi bi-sliders" aria-hidden="true" />
    </Button>
  );
  return (
    <>
      <Card className={`home-language-card ${condensed ? 'home-language-compact' : ''} ${!showActivity ? 'home-language-overview' : ''}`}>
        <Card.Body>
          {condensed ? (
            <div className="home-language-summary">
              <strong>{lang.languageName}</strong>
              <span className="text-muted" title={FORM_COUNT_NOTE}>{lang.knownWords.toLocaleString()} known forms</span>
              {showLevel && <span className="home-level-label" title={estimate ? LEVEL_NOTE : undefined}>{level}</span>}
              <div className="home-language-row-actions">
                <LinkContainer to="/library"><Button variant="link" size="sm" aria-label={`Open ${lang.languageName} library`}>Open library <i className="bi bi-chevron-right" aria-hidden="true" /></Button></LinkContainer>
                {editButton}
              </div>
            </div>
          ) : (
            <>
              <div className="home-language-heading">
                <h3>{lang.languageName}</h3>
                <div className="d-flex align-items-center gap-2">{showLevel && <span className="home-level-label" title={estimate ? LEVEL_NOTE : undefined}>{level}</span>}{editButton}</div>
              </div>
              <div className="home-language-numbers"><strong>{lang.knownWords.toLocaleString()}</strong><span title={FORM_COUNT_NOTE}>known word forms</span><span className="text-muted">{lang.totalWords.toLocaleString()} encountered</span></div>
              {estimate && lang.cefrLevel && lang.nextCefrLevel && (
                <div className="home-level-progress">
                  <div className="small text-muted mb-1">Vocabulary estimate · {lang.knownWordsToNextLevel.toLocaleString()} forms to {lang.nextCefrLevel}</div>
                  <ProgressBar><ProgressBar now={bandProgress} aria-label={`${lang.languageName} vocabulary estimate toward ${lang.nextCefrLevel}`} /></ProgressBar>
                </div>
              )}
              {showActivity && <div className="home-language-activity">
                <span><strong>{lang.todayWordsRead.toLocaleString()}</strong> words read today</span>
                {(lang.todayListeningSeconds ?? 0) > 0 && <span><strong>{Math.round((lang.todayListeningSeconds ?? 0) / 60)}</strong> min listened</span>}
                {lang.currentReadingStreakDays > 0 && <span><strong>{lang.currentReadingStreakDays}</strong> {lang.currentReadingStreakDays === 1 ? 'day' : 'days'} in a row</span>}
              </div>}
              {hasReading ? <div className="home-language-chart"><div className="home-chart-label">Last 14 days · words read</div><div className="home-chart-plot"><Sparkline data={lang.last14DaysWords ?? []} ariaLabel={`${lang.languageName}: words read over the last ${lang.last14DaysWords?.length} days`} /></div></div> : <div className="small text-muted mb-3">No reading in the last 14 days</div>}
              {showResume && <LinkContainer to={lang.continueReadingTextId ? `/texts/${lang.continueReadingTextId}` : '/library'}><Button size="sm" variant="outline-secondary">{lang.continueReadingTextId ? 'Continue reading' : 'Open library'} <i className="bi bi-chevron-right" aria-hidden="true" /></Button></LinkContainer>}
            </>
          )}
          {saveFailed && <p className="small text-muted mt-2 mb-0">Applied for this visit. Your browser couldn't save this preference.</p>}
        </Card.Body>
      </Card>
      <Modal show={editing} onHide={() => setEditing(false)} centered className="home-language-modal">
        <Modal.Header closeButton><Modal.Title>{lang.languageName} learning focus</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Label htmlFor={`language-focus-${lang.languageId}`}>Level display</Form.Label>
          <Form.Select id={`language-focus-${lang.languageId}`} value={draft} onChange={event => setDraft(event.target.value)}>
            <option value="estimate">Vocabulary estimate</option>
            <option value="maintenance">Maintenance</option>
            <option value="hidden">Hide level</option>
            {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(value => <option key={value} value={value}>{value} · self-set</option>)}
          </Form.Select>
          <p className="small text-muted mt-3 mb-0">{LEVEL_NOTE} {FORM_COUNT_NOTE}</p>
          <Alert variant="info" className="small mt-3 mb-0">This display preference is saved in this browser.</Alert>
        </Modal.Body>
        <Modal.Footer><Button variant="outline-secondary" onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" onClick={() => {
          setFocus(draft);
          setSaveFailed(!storage.setItem(storageKey, draft));
          setEditing(false);
        }}>Save preference</Button></Modal.Footer>
      </Modal>
    </>
  );
};

export default LanguageDashboardCard;
