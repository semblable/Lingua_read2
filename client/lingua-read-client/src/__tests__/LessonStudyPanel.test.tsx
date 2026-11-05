import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('../utils/api', () => ({ completeLesson: vi.fn(), getLessonStudy: vi.fn(), recordLessonListen: vi.fn(), setLessonStudyCount: vi.fn() }));
import { completeLesson, getLessonStudy, recordLessonListen, setLessonStudyCount } from '../utils/api';
import LessonStudyPanel from '../components/reader/LessonStudyPanel';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLessonStudy).mockResolvedValue({ readCount: 3, listenCount: 2 });
  vi.mocked(completeLesson).mockResolvedValue({});
  vi.mocked(recordLessonListen).mockResolvedValue({});
  vi.mocked(setLessonStudyCount).mockResolvedValue({ readCount: 2.5, listenCount: 2 });
});

test('sets a fractional read directly, updates its displayed count, and supports Enter', async () => {
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio />);
  await screen.findByText('3×');
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  fireEvent.change(screen.getByLabelText('Read total'), { target: { value: '2.5' } });
  fireEvent.submit(screen.getByLabelText('Read total').closest('form')!);
  await waitFor(() => expect(setLessonStudyCount).toHaveBeenCalledWith(44, 'revision', 'read', 2.5, 3));
  expect(await screen.findByText('2.5×')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Reading statistics updated.');
});

test.each(['read', 'listen'] as const)('shows visible saving and saved feedback for a %s total', async kind => {
  let finish!: (value: { readCount: number; listenCount: number }) => void;
  vi.mocked(setLessonStudyCount).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio />);
  await screen.findByText('3×');
  const label = kind === 'read' ? 'Read' : 'Listened';
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label} passes`) }));
  const input = screen.getByLabelText(`${label} total`);
  const form = input.closest('form')!;
  fireEvent.change(input, { target: { value: '0.6' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Save total' }));
  expect(within(form).getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(input).toBeDisabled();
  await act(async () => finish(kind === 'read' ? { readCount: 0.6, listenCount: 2 } : { readCount: 3, listenCount: 0.6 }));
  expect(within(form).getByRole('button', { name: 'Saved' })).toBeVisible();
  expect(within(form).getByText(new RegExp(`${label} total set to 0.6×`))).toBeVisible();
  expect(screen.getByRole('status')).not.toHaveClass('visually-hidden');
  expect(screen.getByText(kind === 'read' ? 'Read saved' : 'Listen saved')).toBeVisible();
  fireEvent.change(input, { target: { value: '0.7' } });
  expect(within(form).getByRole('button', { name: 'Save total' })).toBeEnabled();
  expect(within(form).queryByText(/total set to/)).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveClass('visually-hidden');
});

test('steps in exact tenths, clamps at zero, and accepts decimal commas', async () => {
  vi.mocked(getLessonStudy).mockResolvedValue({ readCount: 0.3, listenCount: 0 });
  vi.mocked(setLessonStudyCount).mockResolvedValue({ readCount: 2.5, listenCount: 0 });
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio={false} />);
  await screen.findByText('0.3×');
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  const input = screen.getByLabelText('Read total');
  fireEvent.click(screen.getByRole('button', { name: 'Increase read total by 0.1' }));
  expect(input).toHaveValue('0.4');
  const decrease = screen.getByRole('button', { name: 'Decrease read total by 0.1' });
  for (let i = 0; i < 4; i++) fireEvent.click(decrease);
  expect(input).toHaveValue('0');
  expect(decrease).toBeDisabled();
  fireEvent.change(input, { target: { value: '2,5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save total' }));
  await waitFor(() => expect(setLessonStudyCount).toHaveBeenCalledWith(44, 'revision', 'read', 2.5, 0.3));
});

test.each(['', '-0.1', '0.25', '10000.1', 'Infinity', 'abc', '0x10'])('rejects invalid totals: %s', async value => {
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio={false} />);
  await screen.findByText('3×');
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  fireEvent.change(screen.getByLabelText('Read total'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save total' }));
  expect(setLessonStudyCount).not.toHaveBeenCalled();
  expect(screen.getByText('Enter a total between 0 and 10,000 in steps of 0.1.')).toBeInTheDocument();
});

test('steps correctly at the upper limit', async () => {
  vi.mocked(getLessonStudy).mockResolvedValue({ readCount: 9999.9, listenCount: 0 });
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio={false} />);
  await screen.findByText('9999.9×');
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Increase read total by 0.1' }));
  expect(screen.getByLabelText('Read total')).toHaveValue('10000');
  expect(screen.getByRole('button', { name: 'Increase read total by 0.1' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Decrease read total by 0.1' }));
  expect(screen.getByLabelText('Read total')).toHaveValue('9999.9');
});

test('a failed save retains the edit for retry and duplicate clicks serialize', async () => {
  let fail!: (error: Error) => void;
  vi.mocked(setLessonStudyCount).mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio={false} />);
  await screen.findByText('3×');
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  fireEvent.change(screen.getByLabelText('Read total'), { target: { value: '2.5' } });
  const save = screen.getByRole('button', { name: 'Save total' });
  fireEvent.click(save); fireEvent.click(save);
  expect(setLessonStudyCount).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error('Network unavailable')));
  expect(screen.getByLabelText('Read total')).toHaveValue('2.5');
  fireEvent.click(screen.getByRole('button', { name: 'Save total' }));
  await waitFor(() => expect(setLessonStudyCount).toHaveBeenCalledTimes(2));
  expect(vi.mocked(setLessonStudyCount).mock.calls[0]).toEqual(vi.mocked(setLessonStudyCount).mock.calls[1]);
});

test('late saves cannot overwrite a newly opened lesson', async () => {
  let finish!: (value: { readCount: number; listenCount: number }) => void;
  vi.mocked(setLessonStudyCount).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio={false} />);
  await screen.findByText('3×');
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  fireEvent.change(screen.getByLabelText('Read total'), { target: { value: '2.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save total' }));
  vi.mocked(getLessonStudy).mockResolvedValue({ readCount: 0.3, listenCount: 0 });
  view.rerender(<LessonStudyPanel textId={45} sourceRevision="other" hasAudio={false} />);
  await screen.findByText('0.3×');
  await act(async () => finish({ readCount: 2.5, listenCount: 0 }));
  expect(screen.getByRole('button', { name: 'Read passes: 0.3' })).toBeInTheDocument();
});

test('listened totals do not add listening time', async () => {
  vi.mocked(setLessonStudyCount).mockResolvedValue({ readCount: 3, listenCount: 0.3 });
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio />);
  await screen.findByText('2×');
  fireEvent.click(screen.getByRole('button', { name: /Listened passes/ }));
  fireEvent.change(screen.getByLabelText('Listened total'), { target: { value: '0.3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save total' }));
  await waitFor(() => expect(setLessonStudyCount).toHaveBeenCalledWith(44, 'revision', 'listen', 0.3, 2));
  expect(await screen.findByText('0.3×')).toBeInTheDocument();
  expect(recordLessonListen).not.toHaveBeenCalled();
});

test('refreshes a conflicting count and requires a fresh edit', async () => {
  vi.mocked(setLessonStudyCount).mockRejectedValue(Object.assign(new Error('This total changed elsewhere.'), { status: 409 }));
  render(<LessonStudyPanel textId={44} sourceRevision="revision" hasAudio={false} />);
  await screen.findByText('3×');
  fireEvent.click(screen.getByRole('button', { name: /Read passes/ }));
  fireEvent.change(screen.getByLabelText('Read total'), { target: { value: '2.5' } });
  vi.mocked(getLessonStudy).mockResolvedValue({ readCount: 4, listenCount: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Save total' }));
  expect(await screen.findByText('4×')).toBeInTheDocument();
  expect(screen.getByLabelText('Read total')).toHaveValue('4');
  expect(screen.getByRole('button', { name: 'Save total' })).toBeDisabled();
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
