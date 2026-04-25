import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Spinner, Alert } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { getGoals } from '../../utils/api';
import GoalRow from './GoalRow';
import GoalModal from './GoalModal';

// Sort: overdue first, then nearest deadline / period-end, then highest %.
const sortForDisplay = (goals) => {
  const score = (g) => {
    if (g.state === 'overdue') return 0;
    if (g.deadline) return 1 + (new Date(g.deadline + 'T00:00:00').getTime() / 1e12);
    if (g.currentPeriodEnd) return 2 + (new Date(g.currentPeriodEnd + 'T00:00:00').getTime() / 1e12);
    return 5 - (g.percentComplete || 0);
  };
  return [...goals].sort((a, b) => score(a) - score(b));
};

function GoalsCard({ defaultLanguageId }) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getGoals('active');
      setGoals(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load goals', e);
      setError('Couldn\'t load your goals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
        onSaved={load}
        defaultLanguageId={defaultLanguageId}
      />
    </>
  );
}

export default GoalsCard;
