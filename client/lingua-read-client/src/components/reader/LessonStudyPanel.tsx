import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Form, InputGroup, Modal } from 'react-bootstrap';
import { completeLesson, getLessonStudy, recordLessonListen, setLessonStudyCount, type LessonStudyCounts } from '../../utils/api';
import './LessonStudyPanel.css';

type Props = { textId: number; bookId?: number | null; sourceRevision?: string; hasAudio: boolean };

export default function LessonStudyPanel(props: Props) {
  return <LessonStudyPanelBody key={`${props.textId}:${props.sourceRevision ?? ''}`} {...props} />;
}

function LessonStudyPanelBody({ textId, bookId, sourceRevision, hasAudio }: Props) {
  const [counts, setCounts] = useState<LessonStudyCounts | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'read' | 'listen' | null>(null);
  const [busy, setBusy] = useState(false);
  const [showListen, setShowListen] = useState(false);
  const [minutes, setMinutes] = useState('0');
  const [editor, setEditor] = useState<{ kind: 'read' | 'listen'; value: string; expected: number } | null>(null);
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
      setEditor(null);
      setShowListen(false);
      if (kind === 'listen') setMinutes('0');
      setNoticeKind(kind);
      setNotice(kind === 'read' ? 'Read recorded.' : seconds > 0 ? 'Listen and listening time recorded.' : 'Listen recorded. No extra time added.');
      await refresh();
    } catch (e) { if (currentText.current === activeText) setError((e as Error).message || 'Could not record this pass. Retry to check the same action.'); }
    finally { working.current = false; if (currentText.current === activeText) setBusy(false); }
  };

  const saveCount = async () => {
    if (working.current || !sourceRevision || !editor) return;
    const value = Number(editor.value.trim().replace(',', '.'));
    if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(editor.value.trim()) || !Number.isFinite(value) || value < 0 || value > 10000
      || Math.abs(value * 10 - Math.round(value * 10)) > 1e-8) {
      setError('Enter a total between 0 and 10,000 in steps of 0.1.'); return;
    }
    const count = Math.round(value * 10) / 10;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      // Invalidate any count refresh started before this save.
      ++loadVersion.current;
      const result = await setLessonStudyCount(textId, sourceRevision, editor.kind, count, editor.expected);
      if (currentText.current !== textId) return;
      ++loadVersion.current;
      setCounts(result);
      setEditor(null);
      const savedCount = result[editor.kind === 'read' ? 'readCount' : 'listenCount'];
      const label = editor.kind === 'read' ? 'Read' : 'Listened';
      setNoticeKind(editor.kind);
      setNotice(savedCount === count
        ? `${label} total set to ${savedCount}×.${editor.kind === 'read' ? ' Reading statistics updated.' : ' Listening time unchanged.'}`
        : `${label} total is now ${savedCount}×. A later change was preserved.`);
    } catch (e) {
      if (currentText.current !== textId) return;
      setError((e as Error).message || 'Could not save this total. Retry the same value.');
      if (e && typeof e === 'object' && 'status' in e && e.status === 409) {
        setEditor(null);
        await refresh();
      }
    } finally { working.current = false; if (currentText.current === textId) setBusy(false); }
  };

  const countEditor = (kind: 'read' | 'listen') => {
    const active = editor?.kind === kind ? editor : null;
    const count = counts?.[kind === 'read' ? 'readCount' : 'listenCount'];
    const value = active?.value ?? (count === undefined ? '' : String(count));
    const numeric = Number(value.replace(',', '.'));
    const disabled = busy || !sourceRevision || count === undefined;
    const change = (value: string) => {
      setError('');
      setNotice('');
      setEditor({ kind, value, expected: active?.expected ?? count ?? 0 });
    };
    const step = (delta: number) => {
      if (!Number.isFinite(numeric)) return;
      change(String(Math.min(100000, Math.max(0, Math.round(numeric * 10) + delta)) / 10));
    };
    return <Form className="lesson-study__editor" onSubmit={event => { event.preventDefault(); void saveCount(); }}>
      <Form.Label htmlFor={`lesson-${textId}-${kind}-total`}>{kind === 'read' ? 'Read' : 'Listened'} total</Form.Label>
      <InputGroup size="sm">
        <Button variant="outline-secondary" aria-label={`Decrease ${kind} total by 0.1`} disabled={disabled || numeric <= 0} onClick={() => step(-1)}>−0.1×</Button>
        <Form.Control id={`lesson-${textId}-${kind}-total`} type="text" inputMode="decimal" autoComplete="off"
          value={value} disabled={disabled} onChange={event => change(event.target.value)}
          aria-describedby={`lesson-${textId}-${kind}-hint`}
          onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditor(null); setError(''); } }} />
        <InputGroup.Text>×</InputGroup.Text>
        <Button variant="outline-secondary" aria-label={`Increase ${kind} total by 0.1`} disabled={disabled || numeric >= 10000} onClick={() => step(1)}>+0.1×</Button>
      </InputGroup>
      <Form.Text id={`lesson-${textId}-${kind}-hint`} className="lesson-study-dialog__hint d-block mb-2">
        {kind === 'read' ? 'Updates words read, including rereads. Sentence credit is counted once. Lesson status stays unchanged.' : 'Changes passes only. Listening time is tracked separately.'}
      </Form.Text>
      {active && error && <Alert variant="warning" className="py-1 small">{error}</Alert>}
      <Button type="submit" size="sm" disabled={disabled || !active}>{busy && active ? 'Saving…' : notice && noticeKind === kind && !active ? 'Saved' : 'Save total'}</Button>
      {active && <Button size="sm" variant="outline-secondary" className="ms-2" disabled={busy} onClick={() => { setEditor(null); setError(''); }}>Cancel</Button>}
      {notice && noticeKind === kind && <p className="lesson-study__saved small mt-2 mb-0">{notice}</p>}
    </Form>;
  };

  return <section className="lesson-study" aria-label="Lesson practice">
    <Dropdown autoClose="outside">
      <Dropdown.Toggle size="sm" variant="outline-secondary" className="lesson-study__count" disabled={busy}
        aria-label={`Read passes: ${counts?.readCount ?? 'unavailable'}`}>
        <i className="bi bi-book" aria-hidden="true" />Read <strong>{counts ? `${counts.readCount}×` : '—'}</strong>
      </Dropdown.Toggle>
      <Dropdown.Menu>
        {countEditor('read')}
        <Dropdown.Divider />
        <Dropdown.Item as="button" disabled={!sourceRevision} onClick={() => void record('read')}>Record a read</Dropdown.Item>
        {!sourceRevision && <Dropdown.ItemText>Reload online to record a pass.</Dropdown.ItemText>}
      </Dropdown.Menu>
    </Dropdown>
    {hasAudio && <Dropdown autoClose="outside">
      <Dropdown.Toggle size="sm" variant="outline-secondary" className="lesson-study__count" disabled={busy}
        aria-label={`Listened passes: ${counts?.listenCount ?? 'unavailable'}`}>
        <i className="bi bi-headphones" aria-hidden="true" />Listened <strong>{counts ? `${counts.listenCount}×` : '—'}</strong>
      </Dropdown.Toggle>
      <Dropdown.Menu>
        {countEditor('listen')}
        <Dropdown.Divider />
        <Dropdown.Item as="button" disabled={!sourceRevision} onClick={() => setShowListen(true)}>Record a listen</Dropdown.Item>
        {!sourceRevision && <Dropdown.ItemText>Reload online to record a pass.</Dropdown.ItemText>}
      </Dropdown.Menu>
    </Dropdown>}
    <span role="status" aria-live="polite" className={notice ? 'lesson-study__notice' : 'visually-hidden'}>
      {notice && <><i className="bi bi-check-circle" aria-hidden="true" />
        <span aria-hidden="true">{noticeKind === 'read' ? 'Read saved' : 'Listen saved'}</span></>}
      <span className="visually-hidden">{notice}</span>
    </span>
    {error && !editor && <Alert variant="warning" className="py-1 mt-2 mb-0 small">{error}</Alert>}
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
