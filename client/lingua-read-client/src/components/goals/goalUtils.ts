import type { Goal } from '../../utils/api/goals';

// Goal-related shared helpers — keep in sync with server enums.
export const GOAL_TYPE = {
  WordsRead: 1,
  ListeningSeconds: 2,
  WordsKnown: 3,
} as const;
export type GoalTypeValue = typeof GOAL_TYPE[keyof typeof GOAL_TYPE];

export const GOAL_MODE = {
  Delta: 1,
  Milestone: 2,
} as const;
export type GoalModeValue = typeof GOAL_MODE[keyof typeof GOAL_MODE];

export const GOAL_RECURRENCE = {
  None: 0,
  Weekly: 1,
  Monthly: 2,
} as const;
export type GoalRecurrenceValue = typeof GOAL_RECURRENCE[keyof typeof GOAL_RECURRENCE];

export const TYPE_LABELS: Record<number, string> = {
  [GOAL_TYPE.WordsRead]: 'Words read',
  [GOAL_TYPE.ListeningSeconds]: 'Listening time',
  [GOAL_TYPE.WordsKnown]: 'Words known',
};

export const TYPE_ICONS: Record<number, string> = {
  [GOAL_TYPE.WordsRead]: '📖',
  [GOAL_TYPE.ListeningSeconds]: '🎧',
  [GOAL_TYPE.WordsKnown]: '🧠',
};

export const formatMetric = (type: number, value: number | null | undefined): string => {
  if (value == null) return '0';
  if (type === GOAL_TYPE.ListeningSeconds) {
    const m = Math.round(value / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h}h ${rest}m` : `${h}h`;
  }
  return value.toLocaleString();
};

export const formatScope = (g: Goal): string => {
  if (g.languageId == null) return 'All languages';
  return g.languageName || `Language ${g.languageId}`;
};

export const autoTitle = (g: Goal): string => {
  const verb = g.goalType === GOAL_TYPE.WordsRead ? 'Read'
    : g.goalType === GOAL_TYPE.ListeningSeconds ? 'Listen'
    : g.mode === GOAL_MODE.Milestone ? 'Reach' : 'Learn';
  const target = formatMetric(g.goalType ?? 0, g.targetValue);
  const scope = formatScope(g);
  if (g.recurrence === GOAL_RECURRENCE.Weekly) return `${verb} ${target}/week — ${scope}`;
  if (g.recurrence === GOAL_RECURRENCE.Monthly) return `${verb} ${target}/month — ${scope}`;
  if (g.mode === GOAL_MODE.Milestone && g.goalType === GOAL_TYPE.WordsKnown) {
    return `Reach ${target} known ${scope === 'All languages' ? 'words' : scope + ' words'}`;
  }
  return `${verb} ${target} in ${scope}`;
};

export const goalTitle = (g: Goal): string => g.title || autoTitle(g);

export const daysUntil = (dateStr: string | null | undefined): number | null => {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const stateLabel = (g: Goal): string => {
  switch (g.state) {
    case 'completed': return 'Completed';
    case 'overdue': {
      const d = daysUntil(g.deadline);
      return d != null ? `Overdue · ${Math.abs(d)}d` : 'Overdue';
    }
    case 'archived': return 'Archived';
    case 'hit_this_period': return 'Hit this period';
    case 'in_progress': {
      if (g.currentPeriodEnd) {
        const d = daysUntil(g.currentPeriodEnd);
        if (d === 0) return 'Due today';
        if (d != null && d > 0) return `${d}d left this ${g.recurrence === GOAL_RECURRENCE.Monthly ? 'month' : 'week'}`;
      }
      return 'In progress';
    }
    default: {
      if (g.deadline) {
        const d = daysUntil(g.deadline);
        if (d === 0) return 'Due today';
        if (d != null && d > 0) return `${d}d left`;
      }
      return 'Active';
    }
  }
};

export const paceLabel = (g: Goal): { text: string; tone: string } | null => {
  if (!g.pace) return null;
  switch (g.pace) {
    case 'on_track': return { text: 'On track', tone: 'success' };
    case 'ahead': return { text: 'Ahead of pace', tone: 'success' };
    case 'slightly_behind': return { text: 'Slightly behind', tone: 'warning' };
    case 'behind': return { text: 'Behind', tone: 'danger' };
    default: return null;
  }
};
