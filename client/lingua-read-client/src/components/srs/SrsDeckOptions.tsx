import { useEffect, useId, useState, type FormEvent } from 'react';
import { Alert, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import { getSrsDeckSettings, updateSrsDeckSettings } from '../../utils/api';
import type { Language } from '../../utils/api/languages';
import type { SrsDeckSettings } from '../../utils/api/srs';

type Props = {
  language?: Language;
  onSaved: () => void;
};

type DailyLimitFieldsProps = {
  label: string;
  min: number;
  defaultLimit?: number;
  deckLimit: string;
  todayLimit: string;
  setDeckLimit: (value: string) => void;
  setTodayLimit: (value: string) => void;
};

function DailyLimitFields({
  label, min, defaultLimit, deckLimit, todayLimit, setDeckLimit, setTodayLimit,
}: DailyLimitFieldsProps) {
  const id = useId();
  return (
    <fieldset className="mb-3">
      <legend className="fs-6 fw-semibold mb-2">{label}</legend>
      <Row className="g-2">
        <Form.Group as={Col} controlId={`${id}-deck`}>
          <Form.Label>Deck limit</Form.Label>
          <Form.Control type="number" min={min} max={9999} step={1} value={deckLimit}
            placeholder={String(defaultLimit ?? '')} onChange={event => setDeckLimit(event.target.value)} />
        </Form.Group>
        <Form.Group as={Col} controlId={`${id}-today`}>
          <Form.Label>Today only</Form.Label>
          <Form.Control type="number" min={min} max={9999} step={1} value={todayLimit}
            placeholder={deckLimit || String(defaultLimit ?? '')} onChange={event => setTodayLimit(event.target.value)} />
        </Form.Group>
      </Row>
    </fieldset>
  );
}

const numberOrNull = (value: string) => value === '' ? null : Number(value);

function DeckLimitsModal({ languageId, name, onSaved, onClose }: {
  languageId: number;
  name: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<SrsDeckSettings | null>(null);
  const [maxNew, setMaxNew] = useState('');
  const [maxReviews, setMaxReviews] = useState('');
  const [todayMaxNew, setTodayMaxNew] = useState('');
  const [todayMaxReviews, setTodayMaxReviews] = useState('');
  const [ignoreReviewLimit, setIgnoreReviewLimit] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSrsDeckSettings(languageId).then(data => {
      if (cancelled) return;
      setMaxNew(String(data.maxNewCards ?? ''));
      setMaxReviews(String(data.maxReviews ?? ''));
      setTodayMaxNew(String(data.todayMaxNewCards ?? ''));
      setTodayMaxReviews(String(data.todayMaxReviews ?? ''));
      setIgnoreReviewLimit(String(data.newCardsIgnoreReviewLimit ?? ''));
      setOptions(data);
    }).catch(err => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load deck limits.');
    });
    return () => { cancelled = true; };
  }, [languageId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!options || saving) return;
    setSaving(true);
    setError('');
    try {
      await updateSrsDeckSettings(languageId, {
        studyDay: options.studyDay,
        maxNewCards: numberOrNull(maxNew),
        maxReviews: numberOrNull(maxReviews),
        todayMaxNewCards: numberOrNull(todayMaxNew),
        todayMaxReviews: numberOrNull(todayMaxReviews),
        newCardsIgnoreReviewLimit: ignoreReviewLimit === '' ? null : ignoreReviewLimit === 'true',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save deck limits.');
      setSaving(false);
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Modal show onHide={saving ? undefined : onClose} centered aria-labelledby="srs-deck-limits-title">
      <Modal.Header closeButton={!saving}>
        <Modal.Title id="srs-deck-limits-title">{name} deck limits</Modal.Title>
      </Modal.Header>
      <Form onSubmit={save}>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}
          {!options && !error && <Spinner size="sm" role="status"><span className="visually-hidden">Loading deck limits</span></Spinner>}
          {options && (
            <>
              <p className="text-muted small">
                Blank fields use the limit shown. Today-only limits take priority until the next SRS day starts.
              </p>
              <DailyLimitFields label="New cards/day" min={0} defaultLimit={options.defaultMaxNewCards}
                deckLimit={maxNew} todayLimit={todayMaxNew} setDeckLimit={setMaxNew} setTodayLimit={setTodayMaxNew} />
              <DailyLimitFields label="Maximum reviews/day" min={1} defaultLimit={options.defaultMaxReviews}
                deckLimit={maxReviews} todayLimit={todayMaxReviews} setDeckLimit={setMaxReviews} setTodayLimit={setTodayMaxReviews} />
              <Form.Group controlId="srs-deck-ignore-review-limit">
                <Form.Label>New cards ignore review limit</Form.Label>
                <Form.Select value={ignoreReviewLimit} onChange={event => setIgnoreReviewLimit(event.target.value)}>
                  <option value="">Use shared default ({options.defaultNewCardsIgnoreReviewLimit ? 'on' : 'off'})</option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </Form.Select>
                <Form.Text>When off, scheduled reviews take available review slots first. Set new cards to 0 to pause introductions.</Form.Text>
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={!options || saving}>{saving ? 'Saving…' : 'Save deck limits'}</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

export default function SrsDeckOptions({ language, onSaved }: Props) {
  const [show, setShow] = useState(false);
  return (
    <>
      <Button variant="outline-secondary" size="sm" disabled={language?.languageId == null} onClick={() => setShow(true)}>
        Deck limits
      </Button>
      {show && language?.languageId != null && (
        <DeckLimitsModal key={language.languageId} languageId={language.languageId} name={language.name ?? 'Language'}
          onSaved={onSaved} onClose={() => setShow(false)} />
      )}
    </>
  );
}
