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
test.each([true, false])('shows compact counts, hiding listening without audio: %s', async hasAudio => {
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio={hasAudio} />);
  expect(await screen.findByText('3×')).toBeInTheDocument();
  expect(!!screen.queryByText('2×')).toBe(hasAudio);
  expect(screen.queryByText(/Earlier activity totals are preserved/)).not.toBeInTheDocument();
  expect(!!screen.queryByRole('button', { name: /Listened passes/ })).toBe(hasAudio);
});
test('serializes repeated clicks on the same deliberate read', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(completeLesson).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<LessonStudyPanel textId={44} bookId={5} sourceRevision="revision" hasAudio={false} />);
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  const button = screen.getByRole('button', { name: 'Record a read' });
  fireEvent.click(button); fireEvent.click(button);
  expect(completeLesson).toHaveBeenCalledTimes(1);
  expect(completeLesson).toHaveBeenCalledWith(5, 44, false, { repeat: true, sourceRevision: 'revision' });
  await act(async () => finish({}));
  expect(screen.getByRole('status')).toHaveTextContent('Read recorded.');
});
test('recording a listen defaults to count only so playback time is not credited twice', async () => {
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio />);
  fireEvent.click(screen.getByRole('button', { name: /Listened passes/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Record a listen' }));
  expect(screen.getByLabelText('Additional listening time (minutes)')).toHaveValue(0);
  fireEvent.click(screen.getByRole('button', { name: 'Record listen' }));
  await waitFor(() => expect(recordLessonListen).toHaveBeenCalledWith(44, 'revision', 0));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No extra time added.'));
});
test('validates external listening duration and reports failed saves as unrecorded', async () => {
  vi.mocked(recordLessonListen).mockRejectedValue(new Error('Network unavailable; retry the same action.'));
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio />);
  fireEvent.click(screen.getByRole('button', { name: /Listened passes/ }));
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
  render(<LessonStudyPanel textId={44} hasAudio={false} />);
  await screen.findByText('3×');
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  expect(screen.getByRole('button', { name: 'Record a read' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Record a read' }));
  expect(completeLesson).not.toHaveBeenCalled();
  expect(screen.getByText(/Reload online/)).toBeInTheDocument();
});

test.each(['-0.001', '1440.001'])('rejects out-of-range minutes before rounding: %s', async minutes => {
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio />);
  fireEvent.click(screen.getByRole('button', { name: /Listened passes/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Record a listen' }));
  fireEvent.change(screen.getByLabelText('Additional listening time (minutes)'), { target: { value: minutes } });
  fireEvent.click(screen.getByRole('button', { name: 'Record listen' }));
  expect(recordLessonListen).not.toHaveBeenCalled();
  expect(await screen.findAllByText('Enter a duration between 0 and 1,440 minutes.')).toHaveLength(2);
});

test('a new listen defaults to no extra time after recording external listening time', async () => {
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio />);
  fireEvent.click(screen.getByRole('button', { name: /Listened passes/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Record a listen' }));
  fireEvent.change(screen.getByLabelText('Additional listening time (minutes)'), { target: { value: '2.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record listen' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Listen and listening time recorded.'));
  fireEvent.click(screen.getByRole('button', { name: /Listened passes/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Record a listen' }));
  expect(screen.getByLabelText('Additional listening time (minutes)')).toHaveValue(0);
  fireEvent.click(screen.getByRole('button', { name: 'Record listen' }));
  await waitFor(() => expect(recordLessonListen).toHaveBeenLastCalledWith(44, 'revision', 0));
});
test('header completion refreshes counters and an older response cannot overwrite them', async () => {
  let finishOld!: (value: { readCount: number; listenCount: number }) => void;
  vi.mocked(getLessonStudy).mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValue({ readCount: 4, listenCount: 2 });
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio />);
  await waitFor(() => expect(getLessonStudy).toHaveBeenCalledTimes(1));
  await act(async () => { window.dispatchEvent(new CustomEvent('lesson-study-changed', { detail: { textId: 44 } })); });
  expect(await screen.findByText('4×')).toBeInTheDocument();
  await act(async () => finishOld({ readCount: 3, listenCount: 2 }));
  expect(screen.queryByText('3×')).not.toBeInTheDocument();
});
