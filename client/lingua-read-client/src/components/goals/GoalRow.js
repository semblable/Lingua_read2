import React from 'react';
import { Badge, ProgressBar, Button } from 'react-bootstrap';
import {
  TYPE_ICONS,
  formatMetric,
  formatScope,
  goalTitle,
  stateLabel,
  paceLabel,
} from './goalUtils';

// Compact goal row used in both the dashboard card and the /goals list.
function GoalRow({ goal, onEdit, onArchive, onRestore, onDelete, compact = false }) {
  const pct = Math.round((goal.percentComplete || 0) * 100);
  const pace = paceLabel(goal);
  const variant =
    goal.state === 'overdue' ? 'danger' :
    goal.state === 'completed' || goal.state === 'hit_this_period' ? 'success' :
    pace?.tone === 'warning' ? 'warning' :
    pace?.tone === 'danger' ? 'danger' : 'primary';

  return (
    <div className="goal-row d-flex align-items-center gap-3 py-2 border-bottom">
      <div style={{ fontSize: '1.4rem' }} aria-hidden="true">{TYPE_ICONS[goal.goalType]}</div>
      <div className="flex-grow-1 min-w-0">
        <div className="d-flex align-items-center justify-content-between gap-2">
          <div className="text-truncate fw-semibold">{goalTitle(goal)}</div>
          <small className="text-muted">{stateLabel(goal)}</small>
        </div>
        <ProgressBar
          now={Math.max(0, Math.min(100, pct))}
          variant={variant}
          style={{ height: '8px' }}
          className="mt-1"
        />
        <div className="d-flex justify-content-between align-items-center mt-1">
          <small className="text-muted">
            {formatMetric(goal.goalType, Math.max(0, goal.progress))} / {formatMetric(goal.goalType, goal.targetValue)}
            {goal.progress < 0 && (
              <span className="text-danger ms-2">({formatMetric(goal.goalType, goal.progress)})</span>
            )}
            <span className="ms-2">· {formatScope(goal)}</span>
          </small>
          {pace && !compact && (
            <Badge bg={pace.tone === 'success' ? 'success' : pace.tone === 'warning' ? 'warning' : 'danger'}>
              {pace.text}
            </Badge>
          )}
        </div>
      </div>
      {!compact && (
        <div className="d-flex flex-column gap-1">
          {onEdit && goal.state !== 'archived' && (
            <Button size="sm" variant="outline-secondary" onClick={() => onEdit(goal)}>Edit</Button>
          )}
          {onArchive && goal.state !== 'archived' && (
            <Button size="sm" variant="outline-secondary" onClick={() => onArchive(goal)}>Archive</Button>
          )}
          {onRestore && goal.state === 'archived' && (
            <Button size="sm" variant="outline-secondary" onClick={() => onRestore(goal)}>Restore</Button>
          )}
          {onDelete && goal.state === 'archived' && (
            <Button size="sm" variant="outline-danger" onClick={() => onDelete(goal)}>Delete</Button>
          )}
        </div>
      )}
    </div>
  );
}

export default GoalRow;
