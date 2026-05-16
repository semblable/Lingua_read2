import React, { useEffect, useState, useCallback } from 'react';
import { Container, Card, Tabs, Tab, Button, Spinner, Alert } from 'react-bootstrap';
import {
  getGoals,
  archiveGoal,
  restoreGoal,
  deleteGoal,
} from '../utils/api';
import GoalRow from '../components/goals/GoalRow';
import GoalModal from '../components/goals/GoalModal';
import type { Goal } from '../utils/api/goals';

function Goals() {
  const [activeTab, setActiveTab] = useState('active');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await getGoals(status);
      setGoals(Array.isArray(data) ? data : []);
    } catch (e) {
      setError('Couldn\'t load goals.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(activeTab); }, [activeTab, load]);

  const onArchive = async (g: Goal) => {
    if (g.goalId == null) return;
    await archiveGoal(g.goalId);
    load(activeTab);
  };
  const onRestore = async (g: Goal) => {
    if (g.goalId == null) return;
    await restoreGoal(g.goalId);
    load(activeTab);
  };
  const onDelete = async (g: Goal) => {
    if (g.goalId == null) return;
    if (!window.confirm('Delete this goal permanently?')) return;
    await deleteGoal(g.goalId);
    load(activeTab);
  };
  const onEdit = (g: Goal) => {
    setEditing(g);
    setShowModal(true);
  };

  const renderList = () => {
    if (loading) return <div className="text-center py-4"><Spinner animation="border" /></div>;
    if (error) return <Alert variant="danger">{error}</Alert>;
    if (goals.length === 0) {
      return (
        <div className="text-center py-5 text-muted">
          {activeTab === 'active' ? 'No active goals. Create one above.'
            : activeTab === 'completed' ? 'No completed goals yet.'
            : 'No archived goals.'}
        </div>
      );
    }
    return goals.map(g => (
      <GoalRow
        key={g.goalId}
        goal={g}
        onEdit={activeTab === 'active' ? onEdit : undefined}
        onArchive={activeTab !== 'archived' ? onArchive : undefined}
        onRestore={activeTab === 'archived' ? onRestore : undefined}
        onDelete={activeTab === 'archived' ? onDelete : undefined}
      />
    ));
  };

  return (
    <Container className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h1 className="h3 mb-0">Goals</h1>
        <Button variant="primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          ＋ New goal
        </Button>
      </div>

      <Card className="shadow-sm">
        <Card.Body>
          <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k ?? 'active')} className="mb-3">
            <Tab eventKey="active" title="Active" />
            <Tab eventKey="completed" title="Completed" />
            <Tab eventKey="archived" title="Archived" />
          </Tabs>
          {renderList()}
        </Card.Body>
      </Card>

      <GoalModal
        show={showModal}
        onHide={() => { setShowModal(false); setEditing(null); }}
        editing={editing}
        onSaved={() => load(activeTab)}
      />
    </Container>
  );
}

export default Goals;
