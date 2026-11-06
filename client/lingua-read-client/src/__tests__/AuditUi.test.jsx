import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navigation from '../components/Navigation';
import CreateFolderModal from '../components/library/CreateFolderModal';
import RenameFolderModal from '../components/library/RenameFolderModal';
import GoalModal from '../components/goals/GoalModal';
import ManualEntryModal from '../components/ManualEntryModal';
import ActivityHeatmap from '../components/statistics/ActivityHeatmap';

vi.mock('../utils/store', () => ({ useAuthStore: () => ({ isAuthenticated: true, logout: vi.fn() }) }));
vi.mock('../utils/api', () => ({
  getAllLanguages: vi.fn(async () => []), getGoalSuggestion: vi.fn(async () => ({ suggestedTarget: 100 })),
  createGoal: vi.fn(), updateGoal: vi.fn(), logManualActivity: vi.fn(),
}));

test('mobile navigation collapses after selecting a page and includes Goals', async () => {
  render(<MemoryRouter><Navigation /></MemoryRouter>);
  const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('link', { name: 'Goals' }));
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
});

test.each(['create', 'rename'])('folder %s exposes native, named color buttons with selection state', (kind) => {
  if (kind === 'create') render(<CreateFolderModal show onHide={vi.fn()} onSubmit={vi.fn()} />);
  else render(<RenameFolderModal show onHide={vi.fn()} onSubmit={vi.fn()} folder={{ folderId: 1, name: 'Folder' }} />);
  const swatch = screen.getAllByRole('button', { name: /Select .* folder color/ })[0];
  expect(swatch.tagName).toBe('BUTTON');
  expect(swatch).toHaveAttribute('type', 'button');
  swatch.focus();
  expect(swatch).toHaveFocus();
  fireEvent.click(swatch);
  expect(swatch).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(swatch);
  expect(swatch).toHaveAttribute('aria-pressed', 'false');
});

test.each(['goal', 'manual'])('%s dialog allows its body to scroll within the viewport', async (kind) => {
  if (kind === 'goal') render(<GoalModal show onHide={vi.fn()} />);
  else render(<ManualEntryModal show onHide={vi.fn()} onSubmitSuccess={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('.modal-dialog-scrollable')).toBeInTheDocument());
  expect(document.querySelector('.modal-body')).toBeInTheDocument();
});

test('heatmap describes its activity as a labelled region without incomplete grid semantics', () => {
  render(<ActivityHeatmap readingActivity={{ activityByDate: [] }} listeningActivity={{ listeningByDate: [] }} period="week" />);
  expect(screen.getByRole('region', { name: 'Daily activity heatmap' })).toBeInTheDocument();
  expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  expect(screen.queryByRole('gridcell')).not.toBeInTheDocument();
  expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
});
