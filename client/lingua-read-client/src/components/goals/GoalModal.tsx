import React, { useEffect, useState } from 'react';
import { Modal, Button, Form, Alert, Spinner, ButtonGroup } from 'react-bootstrap';
import {
  getAllLanguages,
  createGoal,
  updateGoal,
  getGoalSuggestion,
} from '../../utils/api';
import {
  GOAL_TYPE,
  GOAL_MODE,
  GOAL_RECURRENCE,
  TYPE_LABELS,
  formatMetric,
} from './goalUtils';

const SCOPE_ALL = '__all__';

// Convert seconds <-> hours-with-half-step for the listening-time input.
const secsToHours = (s: number): string => (s / 3600).toFixed(1).replace(/\.0$/, '');
const hoursToSecs = (h: string | number): number => Math.round(parseFloat(String(h || 0)) * 3600);

import type { Goal } from '../../utils/api/goals';

type GoalModalProps = {
  show: boolean;
  onHide: () => void;
  onSaved?: () => void | Promise<void>;
  editing?: Goal | null;
  defaultLanguageId?: number | string | null;
};

function GoalModal({
  show,
  onHide,
  onSaved,
  editing,
  defaultLanguageId
}: GoalModalProps) {
  const isEdit = !!editing;

  const [type, setType] = useState<number>(GOAL_TYPE.WordsRead);
  // scope is the language-id selector value; '__all__' for all-languages,
  // '' for unselected, otherwise the languageId as a string.
  const [scope, setScope] = useState<string>(
    defaultLanguageId != null ? String(defaultLanguageId) : ''
  );
  const [recurrence, setRecurrence] = useState<number>(GOAL_RECURRENCE.None);
  const [mode, setMode] = useState<number>(GOAL_MODE.Delta);
  const [target, setTarget] = useState('');
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadline, setDeadline] = useState('');
  const [title, setTitle] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [languages, setLanguages] = useState([]);
  const [suggestion, setSuggestion] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load language list on first open.
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    (async () => {
      try {
        const langs = await getAllLanguages();
        if (!cancelled) setLanguages(langs || []);
      } catch (e) {
        console.error('Goal modal: language load failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [show]);

  // Pre-populate when editing an existing goal.
  useEffect(() => {
    if (!show) return;
    if (isEdit && editing) {
      setType(editing.goalType);
      setScope(editing.languageId == null ? SCOPE_ALL : String(editing.languageId));
      setRecurrence(editing.recurrence);
      setMode(editing.mode);
      setTarget(
        editing.goalType === GOAL_TYPE.ListeningSeconds
          ? secsToHours(editing.targetValue)
          : String(editing.targetValue)
      );
      setHasDeadline(!!editing.deadline);
      setDeadline(editing.deadline || '');
      setTitle(editing.title || '');
    } else {
      setType(GOAL_TYPE.WordsRead);
      setScope(defaultLanguageId ? String(defaultLanguageId) : SCOPE_ALL);
      setRecurrence(GOAL_RECURRENCE.None);
      setMode(GOAL_MODE.Delta);
      setTarget('');
      setHasDeadline(false);
      setDeadline('');
      setTitle('');
      setShowAdvanced(false);
    }
    setError('');
  }, [show, isEdit, editing, defaultLanguageId]);

  // Fetch a smart default whenever the inputs that drive it change (only when creating).
  useEffect(() => {
    if (!show || isEdit) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const langId = scope === SCOPE_ALL ? null : (scope ? parseInt(scope, 10) : null);
        const data = await getGoalSuggestion({
          type,
          languageId: langId,
          recurrence,
          mode,
        });
        if (cancelled) return;
        setSuggestion(data);
        // Only auto-fill target if the user hasn't typed anything.
        if (!target) {
          if (type === GOAL_TYPE.ListeningSeconds) {
            setTarget(secsToHours(data.suggestedTarget));
          } else {
            setTarget(String(data.suggestedTarget));
          }
        }
      } catch (e) {
        console.error('suggestion fetch failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, isEdit, type, scope, recurrence, mode]);

  // Recurring => Delta only, no deadline.
  useEffect(() => {
    if (recurrence !== GOAL_RECURRENCE.None) {
      if (mode !== GOAL_MODE.Delta) setMode(GOAL_MODE.Delta);
      if (hasDeadline) setHasDeadline(false);
    }
  }, [recurrence, mode, hasDeadline]);

  const targetSeconds = type === GOAL_TYPE.ListeningSeconds ? hoursToSecs(target) : null;
  const targetValue = type === GOAL_TYPE.ListeningSeconds ? targetSeconds : parseInt(target || '0', 10);

  const livePreview = (() => {
    if (!targetValue || targetValue <= 0) return null;
    const totals = suggestion;
    if (mode === GOAL_MODE.Milestone && type === GOAL_TYPE.WordsKnown && totals) {
      const remaining = Math.max(0, targetValue - totals.currentMetric);
      return `You're at ${formatMetric(type, totals.currentMetric)} known. ${formatMetric(type, remaining)} to go.`;
    }
    if (recurrence === GOAL_RECURRENCE.Weekly && totals) {
      const last = totals.last7DaysTotal || 0;
      if (last > 0) {
        const diff = Math.round(((targetValue - last) / last) * 100);
        return `Last 7 days: ${formatMetric(type, last)}. This target is ${diff >= 0 ? '+' : ''}${diff}% vs that.`;
      }
    }
    if (recurrence === GOAL_RECURRENCE.Monthly && totals) {
      const last = totals.last30DaysTotal || 0;
      if (last > 0) {
        const diff = Math.round(((targetValue - last) / last) * 100);
        return `Last 30 days: ${formatMetric(type, last)}. This target is ${diff >= 0 ? '+' : ''}${diff}% vs that.`;
      }
    }
    if (recurrence === GOAL_RECURRENCE.None && hasDeadline && deadline) {
      const days = Math.max(
        1,
        Math.ceil((new Date(deadline + 'T00:00:00').getTime() - new Date().getTime()) / 86400000)
      );
      const perDay = Math.ceil(targetValue / days);
      const pace7 = totals?.last7DaysTotal || 0;
      const paceDay = Math.round(pace7 / 7);
      const note = pace7 > 0 ? ` Your last-7-day pace is ${formatMetric(type, paceDay)}/day.` : '';
      return `That's about ${formatMetric(type, perDay)}/day.${note}`;
    }
    if (recurrence === GOAL_RECURRENCE.None && !hasDeadline && totals?.last30DaysTotal) {
      const perDay = totals.last30DaysTotal / 30;
      if (perDay > 0) {
        const days = Math.ceil(targetValue / perDay);
        const finishDate = new Date();
        finishDate.setDate(finishDate.getDate() + days);
        return `At your last-30-day pace, you'd finish around ${finishDate.toLocaleDateString()}.`;
      }
    }
    return null;
  })();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (!targetValue || targetValue <= 0) {
      setError('Target must be greater than zero.');
      return;
    }
    if (hasDeadline && !deadline) {
      setError('Pick a deadline date or turn the deadline off.');
      return;
    }
    if (recurrence !== GOAL_RECURRENCE.None && mode === GOAL_MODE.Milestone) {
      setError('Recurring goals cannot be milestone goals.');
      return;
    }

    const langId = scope === SCOPE_ALL ? null : (scope ? parseInt(scope, 10) : null);

    const payload = {
      languageId: langId,
      goalType: type,
      mode,
      recurrence,
      targetValue,
      deadline: hasDeadline && deadline ? deadline : null,
      title: title.trim() || null,
    };

    setSaving(true);
    try {
      if (isEdit) {
        // PUT only allows target/deadline/title changes server-side.
        await updateGoal(editing.goalId, {
          targetValue,
          deadline: hasDeadline ? deadline : null,
          clearDeadline: !hasDeadline,
          title: payload.title,
        });
      } else {
        // payload's numeric goalType / mode / recurrence widen from the enum
        // unions in api-types; the backend accepts any int in the valid range
        // and the form constrains the values via UI, so cast at the boundary.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await createGoal(payload as any);
      }
      if (onSaved) onSaved();
      onHide();
    } catch (err) {
      console.error('save goal failed', err);
      setError(err?.message || 'Failed to save goal.');
    } finally {
      setSaving(false);
    }
  };

  const recurringActive = recurrence !== GOAL_RECURRENCE.None;
  const showModeChooser = !recurringActive &&
    (type === GOAL_TYPE.WordsKnown || showAdvanced);

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title as="h5">{isEdit ? 'Edit goal' : 'New goal'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        <Form onSubmit={handleSubmit}>
          <Form.Group className="mb-3">
            <Form.Label>Type</Form.Label>
            <ButtonGroup className="d-flex">
              {[GOAL_TYPE.WordsRead, GOAL_TYPE.ListeningSeconds, GOAL_TYPE.WordsKnown].map(t => (
                <Button
                  key={t}
                  variant={type === t ? 'primary' : 'outline-secondary'}
                  onClick={() => !isEdit && setType(t)}
                  disabled={isEdit}
                >
                  {TYPE_LABELS[t]}
                </Button>
              ))}
            </ButtonGroup>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Scope</Form.Label>
            <Form.Select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={isEdit}
            >
              <option value={SCOPE_ALL}>All languages</option>
              {languages.map((l) => (
                <option key={l.languageId} value={l.languageId}>{l.name}</option>
              ))}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Cadence</Form.Label>
            <ButtonGroup className="d-flex">
              {[
                { v: GOAL_RECURRENCE.None, label: 'One-time' },
                { v: GOAL_RECURRENCE.Weekly, label: 'Weekly' },
                { v: GOAL_RECURRENCE.Monthly, label: 'Monthly' },
              ].map(({ v, label }) => (
                <Button
                  key={v}
                  variant={recurrence === v ? 'primary' : 'outline-secondary'}
                  onClick={() => !isEdit && setRecurrence(v)}
                  disabled={isEdit}
                >
                  {label}
                </Button>
              ))}
            </ButtonGroup>
            {recurringActive && (
              <Form.Text muted>
                Resets every {recurrence === GOAL_RECURRENCE.Weekly ? 'Monday' : 'first of the month'}.
                Period end is the deadline.
              </Form.Text>
            )}
          </Form.Group>

          {showModeChooser && (
            <Form.Group className="mb-3">
              <Form.Label>Mode</Form.Label>
              <ButtonGroup className="d-flex">
                <Button
                  variant={mode === GOAL_MODE.Delta ? 'primary' : 'outline-secondary'}
                  onClick={() => !isEdit && setMode(GOAL_MODE.Delta)}
                  disabled={isEdit}
                >
                  Build up
                </Button>
                <Button
                  variant={mode === GOAL_MODE.Milestone ? 'primary' : 'outline-secondary'}
                  onClick={() => !isEdit && setMode(GOAL_MODE.Milestone)}
                  disabled={isEdit}
                >
                  Reach total
                </Button>
              </ButtonGroup>
              <Form.Text muted>
                {mode === GOAL_MODE.Delta
                  ? 'Progress measured from where you are now.'
                  : 'Aim for an absolute total — useful for words known.'}
              </Form.Text>
            </Form.Group>
          )}

          {!showModeChooser && !recurringActive && type !== GOAL_TYPE.WordsKnown && !isEdit && (
            <div className="mb-3">
              <Button
                variant="link"
                size="sm"
                className="p-0"
                onClick={() => setShowAdvanced(true)}
              >
                Advanced: choose milestone instead of build-up
              </Button>
            </div>
          )}

          <Form.Group className="mb-3">
            <Form.Label>
              Target {type === GOAL_TYPE.ListeningSeconds ? '(hours)' : type === GOAL_TYPE.ListeningSeconds ? '(seconds)' : '(words)'}
            </Form.Label>
            <Form.Control
              type="number"
              min="0"
              step={type === GOAL_TYPE.ListeningSeconds ? '0.5' : '1'}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={loading ? 'Loading suggestion…' : 'Target'}
            />
          </Form.Group>

          {!recurringActive && (
            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                id="has-deadline-switch"
                label="Set a deadline"
                checked={hasDeadline}
                onChange={(e) => setHasDeadline(e.target.checked)}
              />
              {hasDeadline && (
                <Form.Control
                  type="date"
                  className="mt-2"
                  value={deadline}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              )}
            </Form.Group>
          )}

          <Form.Group className="mb-3">
            <Form.Label>Title (optional)</Form.Label>
            <Form.Control
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Auto-generated if empty"
              maxLength={200}
            />
          </Form.Group>

          {livePreview && (
            <Alert variant="info" className="py-2 small mb-3">
              {livePreview}
            </Alert>
          )}

          <div className="d-flex justify-content-end gap-2">
            <Button variant="secondary" onClick={onHide} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? <Spinner as="span" size="sm" animation="border" /> : (isEdit ? 'Save' : 'Create goal')}
            </Button>
          </div>
        </Form>
      </Modal.Body>
    </Modal>
  );
}

export default GoalModal;
