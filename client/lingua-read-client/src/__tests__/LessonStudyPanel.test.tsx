import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('../utils/api', () => ({ completeLesson: vi.fn(), getLessonStudy: vi.fn(), recordLessonListen: vi.fn() }));
import { completeLesson, getLessonStudy, recordLessonListen } from '../utils/api';
import LessonStudyPanel from '../components/reader/LessonStudyPanel';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLessonStudy).mockResolvedValue({ readCount: 3, listenCount: 2 });
  vi.mocked(completeLesson).mockResolvedValue({});
  vi.mocked(recordLessonListen).mockResolvedValue({});
});
test('shows counts and their tracking scope without implying reconstructed history', async () => {
  render(<LessonStudyPanel textId={44} sourceRevision="revision" />);
  expect(await screen.findByText('3×')).toBeInTheDocument();
  expect(screen.getByText('2×')).toBeInTheDocument();
  expect(screen.getByText(/Earlier activity totals are preserved/)).toBeInTheDocument();
});
test('serializes repeated clicks on the same deliberate read', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(completeLesson).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<LessonStudyPanel textId={44} bookId={5} sourceRevision="revision" />);
  const button = screen.getByRole('button', { name: 'Record a read' });
  fireEvent.click(button); fireEvent.click(button);
  expect(completeLesson).toHaveBeenCalledTimes(1);
  expect(completeLesson).toHaveBeenCalledWith(5, 44, false, { repeat: true, sourceRevision: 'revision' });
  await act(async () => finish({}));
  expect(screen.getByRole('status')).toHaveTextContent('Read recorded.');
});
test('recording a listen defaults to count only so playback time is not credited twice', async () => {
  render(<LessonStudyPanel textId={44} sourceRevision="revision" />);
  fireEvent.click(screen.getByRole('button', { name: 'Record a listen' }));
  expect(screen.getByLabelText('Additional listening time (minutes)')).toHaveValue(0);
  fireEvent.click(screen.getByRole('button', { name: 'Record listen' }));
  await waitFor(() => expect(recordLessonListen).toHaveBeenCalledWith(44, 'revision', 0));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No extra time added.'));
});
test('validates external listening duration and reports failed saves as unrecorded', async () => {
  vi.mocked(recordLessonListen).mockRejectedValue(new Error('Network unavailable; retry the same action.'));
  render(<LessonStudyPanel textId={44} sourceRevision="revision" />);
  fireEvent.click(screen.getByRole('button', { name: 'Record a listen' }));
  fireEvent.change(screen.getByLabelText('Additional listening time (minutes)'), { target: { value: '-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record listen' }));
  expect(recordLessonListen).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Additional listening time (minutes)'), { target: { value: '2.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record listen' }));
  await waitFor(() => expect(recordLessonListen).toHaveBeenCalledWith(44, 'revision', 150));
  expect(await screen.findAllByText(/Network unavailable/)).toHaveLength(2);
  expect(screen.getByRole('status')).not.toHaveTextContent('recorded');
});
test('old cached lessons stay readable while pass recording requires a source revision', async () => {
  render(<LessonStudyPanel textId={44} />);
  await screen.findByText('3×');
  expect(screen.getByRole('button', { name: 'Record a read' })).toBeDisabled();
  expect(screen.getByText(/Reload online/)).toBeInTheDocument();
});
test('header completion refreshes counters and an older response cannot overwrite them', async () => {
  let finishOld!: (value: { readCount: number; listenCount: number }) => void;
  vi.mocked(getLessonStudy).mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValue({ readCount: 4, listenCount: 2 });
  render(<LessonStudyPanel textId={44} sourceRevision="revision" />);
  await waitFor(() => expect(getLessonStudy).toHaveBeenCalledTimes(1));
  await act(async () => { window.dispatchEvent(new CustomEvent('lesson-study-changed', { detail: { textId: 44 } })); });
  expect(await screen.findByText('4×')).toBeInTheDocument();
  await act(async () => finishOld({ readCount: 3, listenCount: 2 }));
  expect(screen.queryByText('3×')).not.toBeInTheDocument();
});
