import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { completeLesson, getLessonStudy, recordLessonListen, type LessonStudyCounts } from '../../utils/api';
import './LessonStudyPanel.css';

type Props = { textId: number; bookId?: number | null; sourceRevision?: string };

export default function LessonStudyPanel(props: Props) {
  return <LessonStudyPanelBody key={`${props.textId}:${props.sourceRevision ?? ''}`} {...props} />;
}

function LessonStudyPanelBody({ textId, bookId, sourceRevision }: Props) {
  const [counts, setCounts] = useState<LessonStudyCounts | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showListen, setShowListen] = useState(false);
  const [minutes, setMinutes] = useState('0');
  const working = useRef(false);
  const currentText = useRef<number | null>(textId);
  const loadVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++loadVersion.current;
    try { const value = await getLessonStudy(textId); if (currentText.current === textId && loadVersion.current === version) setCounts(value); }
    catch { /* Reading remains available when counts cannot be loaded. */ }
  }, [textId]);
  useEffect(() => {
    currentText.current = textId;
    void Promise.resolve().then(refresh);
    return () => { currentText.current = null; };
  }, [refresh, textId]);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<{ textId: number }>).detail.textId === textId) void refresh(); };
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('lesson-study-changed', changed);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('lesson-study-changed', changed);
    };
  }, [refresh, textId]);

  const record = async (kind: 'read' | 'listen') => {
    if (working.current || !sourceRevision) return;
    const seconds = Math.round(Number(minutes) * 60);
    if (kind === 'listen' && (!minutes.trim() || !Number.isFinite(seconds) || seconds < 0 || seconds > 86400)) {
      setError('Enter a duration between 0 and 1,440 minutes.'); return;
    }
    working.current = true; setBusy(true); setError(''); setNotice('');
    const activeText = textId;
    try {
      if (kind === 'read') await completeLesson(bookId ?? null, textId, false, { repeat: true, sourceRevision });
      else await recordLessonListen(textId, sourceRevision, seconds);
      if (currentText.current !== activeText) return;
      setShowListen(false);
      setNotice(kind === 'read' ? 'Read recorded.' : seconds > 0 ? 'Listen and listening time recorded.' : 'Listen recorded. No extra time added.');
      await refresh();
    } catch (e) { if (currentText.current === activeText) setError((e as Error).message || 'Could not record this pass. Retry to check the same action.'); }
    finally { working.current = false; if (currentText.current === activeText) setBusy(false); }
  };

  return <section className="lesson-study border-bottom px-3 py-2" aria-label="Lesson practice">
    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
      <div className="d-flex align-items-center gap-3 small">
        <span className="lesson-study__count"><i className="bi bi-book" aria-hidden="true" />Read <strong>{counts ? `${counts.readCount}×` : '—'}</strong></span>
        <span className="lesson-study__count"><i className="bi bi-headphones" aria-hidden="true" />Listened <strong>{counts ? `${counts.listenCount}×` : '—'}</strong></span>
      </div>
      <div className="d-flex gap-2">
        <Button size="sm" variant="outline-secondary" disabled={busy || !sourceRevision} onClick={() => void record('read')}>Record a read</Button>
        <Button size="sm" variant="outline-secondary" disabled={busy || !sourceRevision} onClick={() => setShowListen(true)}>Record a listen</Button>
      </div>
    </div>
    <div className="lesson-study__scope mt-1">Recorded passes since tracking began. Earlier activity totals are preserved.{!sourceRevision && ' Reload online to record a pass.'}</div>
    <div role="status" aria-live="polite" className="lesson-study__status small">{notice}</div>
    {error && <Alert variant="warning" className="py-1 mt-2 mb-0 small">{error}</Alert>}
    <Modal show={showListen} onHide={() => !busy && setShowListen(false)} contentClassName="lesson-study-dialog" centered>
      <Modal.Header closeButton={!busy}><Modal.Title>Record a completed listen</Modal.Title></Modal.Header>
      <Modal.Body>
        <p>This adds one listen to this lesson.</p>
        <Form.Group controlId="lesson-listen-minutes">
          <Form.Label>Additional listening time (minutes)</Form.Label>
          <Form.Control type="number" min="0" max="1440" step="0.1" value={minutes} onChange={e => setMinutes(e.target.value)} disabled={busy} />
          <Form.Text className="lesson-study-dialog__hint">Leave at 0 if the player already tracked this time. Add time for a listen outside the app.</Form.Text>
        </Form.Group>
        {error && <Alert variant="warning" className="mt-2 mb-0">{error}</Alert>}
      </Modal.Body>
      <Modal.Footer><Button variant="secondary" disabled={busy} onClick={() => setShowListen(false)}>Cancel</Button>
        <Button disabled={busy} onClick={() => void record('listen')}>{busy ? 'Recording…' : 'Record listen'}</Button></Modal.Footer>
    </Modal>
  </section>;
}
