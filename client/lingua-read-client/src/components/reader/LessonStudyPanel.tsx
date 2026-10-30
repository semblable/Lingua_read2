import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Form, Modal } from 'react-bootstrap';
import { completeLesson, getLessonStudy, recordLessonListen, type LessonStudyCounts } from '../../utils/api';
import './LessonStudyPanel.css';

type Props = { textId: number; bookId?: number | null; sourceRevision?: string; hasAudio: boolean };

export default function LessonStudyPanel(props: Props) {
  return <LessonStudyPanelBody key={`${props.textId}:${props.sourceRevision ?? ''}`} {...props} />;
}

function LessonStudyPanelBody({ textId, bookId, sourceRevision, hasAudio }: Props) {
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
    const durationMinutes = Number(minutes);
    const seconds = Math.round(durationMinutes * 60);
    if (kind === 'listen' && (!minutes.trim() || !Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440)) {
      setError('Enter a duration between 0 and 1,440 minutes.'); return;
    }
    working.current = true; setBusy(true); setError(''); setNotice('');
    const activeText = textId;
    try {
      if (kind === 'read') await completeLesson(bookId ?? null, textId, false, { repeat: true, sourceRevision });
      else await recordLessonListen(textId, sourceRevision, seconds);
      if (currentText.current !== activeText) return;
      setShowListen(false);
      if (kind === 'listen') setMinutes('0');
      setNotice(kind === 'read' ? 'Read recorded.' : seconds > 0 ? 'Listen and listening time recorded.' : 'Listen recorded. No extra time added.');
      await refresh();
    } catch (e) { if (currentText.current === activeText) setError((e as Error).message || 'Could not record this pass. Retry to check the same action.'); }
    finally { working.current = false; if (currentText.current === activeText) setBusy(false); }
  };

  return <section className="lesson-study" aria-label="Lesson practice">
    <Dropdown>
      <Dropdown.Toggle size="sm" variant="outline-secondary" className="lesson-study__count" disabled={busy}
        aria-label={`Read passes: ${counts?.readCount ?? 'unavailable'}`}>
        <i className="bi bi-book" aria-hidden="true" />Read <strong>{counts ? `${counts.readCount}×` : '—'}</strong>
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item as="button" disabled={!sourceRevision} onClick={() => void record('read')}>Record a read</Dropdown.Item>
        {!sourceRevision && <Dropdown.ItemText>Reload online to record a pass.</Dropdown.ItemText>}
      </Dropdown.Menu>
    </Dropdown>
    {hasAudio && <Dropdown>
      <Dropdown.Toggle size="sm" variant="outline-secondary" className="lesson-study__count" disabled={busy}
        aria-label={`Listened passes: ${counts?.listenCount ?? 'unavailable'}`}>
        <i className="bi bi-headphones" aria-hidden="true" />Listened <strong>{counts ? `${counts.listenCount}×` : '—'}</strong>
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item as="button" disabled={!sourceRevision} onClick={() => setShowListen(true)}>Record a listen</Dropdown.Item>
        {!sourceRevision && <Dropdown.ItemText>Reload online to record a pass.</Dropdown.ItemText>}
      </Dropdown.Menu>
    </Dropdown>}
    <span role="status" aria-live="polite" className="visually-hidden">{notice}</span>
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
