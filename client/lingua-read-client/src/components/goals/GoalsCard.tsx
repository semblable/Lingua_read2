import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Spinner, Alert } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { getGoals } from '../../utils/api';
import GoalRow from './GoalRow';
import GoalModal from './GoalModal';
import type { Goal } from '../../utils/api/goals';

// Sort: overdue first, then nearest deadline / period-end, then highest %.
const sortForDisplay = (goals: Goal[]): Goal[] => {
  const score = (g: Goal): number => {
    if (g.state === 'overdue') return 0;
    if (g.deadline) return 1 + (new Date(g.deadline + 'T00:00:00').getTime() / 1e12);
    if (g.currentPeriodEnd) return 2 + (new Date(g.currentPeriodEnd + 'T00:00:00').getTime() / 1e12);
    return 5 - (g.percentComplete || 0);
  };
  return [...goals].sort((a, b) => score(a) - score(b));
};

interface GoalsCardProps {
  defaultLanguageId?: number | string | null;
  // When the parent already fetched goals (e.g., Home, which needs them for the
  // hero chip) it can pass them in to avoid a second round trip. The parent is
  // then responsible for refreshing them via `onChanged` after a save/delete.
  // When the prop is omitted entirely (e.g., Dashboard), GoalsCard falls back
  // to fetching internally — preserving the original standalone behaviour.
  goals?: Goal[] | null;
  loading?: boolean;
  error?: string | null;
  onChanged?: () => void;
}

function GoalsCard({
  defaultLanguageId,
  goals: externalGoals,
  loading: externalLoading,
  error: externalError,
  onChanged,
}: GoalsCardProps) {
  // `goals === undefined` means the parent didn't opt in; we own the fetch.
  // Anything else (including null or []) means the parent is in control.
  const isExternal = externalGoals !== undefined;

  const [internalGoals, setInternalGoals] = useState<Goal[]>([]);
  const [internalLoading, setInternalLoading] = useState(!isExternal);
  const [internalError, setInternalError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const loadInternal = useCallback(async () => {
    setInternalLoading(true);
    setInternalError('');
    try {
      const data = await getGoals('active');
      setInternalGoals(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load goals', e);
      setInternalError("Couldn't load your goals.");
    } finally {
      setInternalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isExternal) loadInternal();
  }, [isExternal, loadInternal]);

  // After a goal is created/edited/deleted in the modal, refresh whatever
  // source the data came from so the displayed list (and any parent-owned
  // derived state like the home hero chip) reflect the change.
  const refresh = useCallback(async () => {
    if (isExternal) {
      onChanged?.();
    } else {
      await loadInternal();
    }
  }, [isExternal, onChanged, loadInternal]);

  const goals = isExternal ? externalGoals ?? [] : internalGoals;
  const loading = isExternal ? !!externalLoading : internalLoading;
  const error = isExternal ? externalError ?? '' : internalError;

  const visible = sortForDisplay(goals).slice(0, 3);
  const remaining = goals.length - visible.length;

  return (
    <>
      <Card className="shadow-sm mb-4">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <Card.Title as="h5" className="mb-0">Goals</Card.Title>
            <div className="d-flex gap-2">
              {goals.length > 0 && (
                <Link to="/goals" className="btn btn-sm btn-outline-secondary">
                  View all{remaining > 0 ? ` (${goals.length})` : ''}
                </Link>
              )}
              <Button size="sm" variant="primary" onClick={() => setShowModal(true)}>＋ New goal</Button>
            </div>
          </div>

          {error && <Alert variant="danger">{error}</Alert>}

          {loading ? (
            <div className="text-center py-3"><Spinner animation="border" size="sm" /></div>
          ) : goals.length === 0 ? (
            <div className="text-center py-4 text-muted">
              <div className="mb-2" style={{ fontSize: '2rem' }}>🎯</div>
              <div className="mb-2">No active goals yet.</div>
              <Button size="sm" variant="primary" onClick={() => setShowModal(true)}>
                Set your first goal
              </Button>
            </div>
          ) : (
            <div>
              {visible.map(g => (
                <GoalRow key={g.goalId} goal={g} compact />
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

      <GoalModal
        show={showModal}
        onHide={() => setShowModal(false)}
        onSaved={refresh}
        defaultLanguageId={defaultLanguageId}
      />
    </>
  );
}

export default GoalsCard;
