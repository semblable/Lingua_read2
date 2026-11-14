import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import ActivityHeatmap from '../components/statistics/ActivityHeatmap';
import ChartDataTable from '../components/statistics/ChartDataTable';

afterEach(() => { cleanup(); vi.useRealTimers(); });

test('daily values can be inspected through a native date control and a table without hundreds of Tab stops', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 13, 12));
  const { container } = render(<ActivityHeatmap period="last_week"
    readingActivity={{ totalWordsRead: 321, activityByDate: [{ date: '2026-11-12', wordsRead: 321 }], activityByLanguage: [] }}
    listeningActivity={{ totalListeningSeconds: 150, listeningByDate: [{ date: '2026-11-12', minutesListened: 2.5 }], listeningByLanguage: [] }} />);
  const inspector = screen.getByLabelText('Inspect daily reading activity');
  fireEvent.change(inspector, { target: { value: '2026-11-12' } });
  expect(screen.getByRole('status')).toHaveTextContent('2026-11-12: 321 words');
  const table = screen.getByRole('table', { name: 'Daily reading activity', hidden: true });
  expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(8);
  const row = within(table).getByRole('rowheader', { name: '2026-11-12', hidden: true }).closest('tr')!;
  expect(within(row).getByRole('cell', { name: '321', hidden: true })).toBeInTheDocument();
  expect(container.querySelector('.stats-heatmap-outer [tabindex]')).toBeNull();
  fireEvent.click(screen.getByLabelText('Listening'));
  expect(screen.getByLabelText('Inspect daily listening activity')).toHaveValue('2026-11-12');
  expect(screen.getByRole('status')).toHaveTextContent('2.5 minutes');
});

test('chart data distinguishes missing comparison values from zero', () => {
  render(<ChartDataTable caption="Reading comparison" columns={[
    { key: 'date', label: 'Date' }, { key: 'current', label: 'Current' }, { key: 'previous', label: 'Previous' },
  ]} rows={[{ date: '2026-11-13', current: 0, previous: null }]} />);
  fireEvent.click(screen.getByText('View data table: Reading comparison'));
  const table = screen.getByRole('table', { name: 'Reading comparison' });
  expect(within(table).getByRole('cell', { name: /^0$/ })).toBeInTheDocument();
  expect(within(table).getByRole('cell', { name: 'No data' })).toBeInTheDocument();
});
