import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  GOAL_TYPE,
  GOAL_MODE,
  GOAL_RECURRENCE,
  formatMetric,
  goalTitle,
  stateLabel,
  paceLabel,
} from '../components/goals/goalUtils';
import GoalRow from '../components/goals/GoalRow';
import GoalsCard from '../components/goals/GoalsCard';

vi.mock('../utils/api', () => ({
  getGoals: vi.fn(),
  getAllLanguages: vi.fn(() => Promise.resolve([])),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  archiveGoal: vi.fn(),
  restoreGoal: vi.fn(),
  deleteGoal: vi.fn(),
  getGoalSuggestion: vi.fn(() => Promise.resolve({
    suggestedTarget: 1000,
    currentMetric: 0,
    last7DaysTotal: 0,
    last30DaysTotal: 0,
  })),
}));

import * as api from '../utils/api';

const baseGoal = {
  goalId: 1,
  userId: 'u',
  languageId: 1,
  languageName: 'French',
  goalType: GOAL_TYPE.WordsRead,
  mode: GOAL_MODE.Delta,
  recurrence: GOAL_RECURRENCE.None,
  targetValue: 1000,
  baselineValue: 0,
  progress: 0,
  percentComplete: 0,
  state: 'active',
};

describe('goalUtils', () => {
  test('formatMetric formats listening time as h/m', () => {
    expect(formatMetric(GOAL_TYPE.ListeningSeconds, 90)).toBe('2 min');
    expect(formatMetric(GOAL_TYPE.ListeningSeconds, 3600)).toBe('1h');
    expect(formatMetric(GOAL_TYPE.ListeningSeconds, 5400)).toBe('1h 30m');
  });

  test('formatMetric formats word counts with locale separators', () => {
    expect(formatMetric(GOAL_TYPE.WordsRead, 12345)).toMatch(/12[,.\s]?345/);
  });

  test('goalTitle prefers user-supplied title', () => {
    expect(goalTitle({ ...baseGoal, title: 'My read goal' })).toBe('My read goal');
  });

  test('goalTitle generates a sensible auto-title for one-time delta', () => {
    expect(goalTitle({ ...baseGoal, languageName: 'French' })).toMatch(/Read .* in French/i);
  });

  test('stateLabel reflects overdue with day count', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    expect(stateLabel({ ...baseGoal, state: 'overdue', deadline: yesterday })).toMatch(/Overdue/);
  });

  test('paceLabel maps server enum to tone', () => {
    expect(paceLabel({ pace: 'on_track' }).tone).toBe('success');
    expect(paceLabel({ pace: 'behind' }).tone).toBe('danger');
    expect(paceLabel({})).toBeNull();
  });
});

describe('GoalRow', () => {
  test('renders progress fraction and percent for delta goal', () => {
    render(<GoalRow goal={{ ...baseGoal, progress: 250, percentComplete: 0.25 }} />);
    expect(screen.getByText(/250 \/ 1,000|250 \/ 1\.000/)).toBeInTheDocument();
  });

  test('shows negative regression when progress is negative', () => {
    render(<GoalRow goal={{ ...baseGoal, progress: -3 }} />);
    expect(screen.getByText(/-3/)).toBeInTheDocument();
  });

  test('shows pace badge for on-track delta goal', () => {
    render(<GoalRow goal={{ ...baseGoal, progress: 600, percentComplete: 0.6, pace: 'on_track' }} />);
    expect(screen.getByText('On track')).toBeInTheDocument();
  });
});

describe('GoalsCard', () => {
  beforeEach(() => {
    api.getGoals.mockReset();
  });

  test('renders empty state when no goals exist', async () => {
    api.getGoals.mockResolvedValueOnce([]);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GoalsCard />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/No active goals yet/)).toBeInTheDocument();
    });
  });

  test('renders up to 3 goals and shows total count when more', async () => {
    const many = Array.from({ length: 5 }).map((_, i) => ({
      ...baseGoal,
      goalId: i + 1,
      title: `Goal ${i + 1}`,
      progress: i * 100,
      percentComplete: i * 0.1,
    }));
    api.getGoals.mockResolvedValueOnce(many);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GoalsCard />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/View all \(5\)/)).toBeInTheDocument();
    });
    // 3 visible goals
    expect(screen.getAllByText(/Goal \d/).length).toBe(3);
  });

  test('opens modal when clicking New goal', async () => {
    api.getGoals.mockResolvedValueOnce([]);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GoalsCard />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText(/No active goals yet/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Set your first goal/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create goal/i })).toBeInTheDocument();
    });
  });

  test('skips its own fetch when the parent passes goals in', async () => {
    // The Home page fetches goals once for the hero chip and then hands the
    // same array to GoalsCard. Without this short-circuit the page would fire
    // two identical /goals requests on every load.
    const external = [{ ...baseGoal, goalId: 9, title: 'External goal' }];
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GoalsCard goals={external} />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByText('External goal')).toBeInTheDocument();
    });
    expect(api.getGoals).not.toHaveBeenCalled();
  });

  test('uses the parent loading flag when goals are externally controlled', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <GoalsCard goals={null} loading />
      </MemoryRouter>
    );
    // Spinner visible, no internal fetch, no empty-state copy.
    expect(document.querySelector('.spinner-border')).toBeTruthy();
    expect(screen.queryByText(/No active goals yet/)).toBeNull();
    expect(api.getGoals).not.toHaveBeenCalled();
  });
});
