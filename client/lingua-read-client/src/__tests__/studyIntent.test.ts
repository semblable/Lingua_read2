import { beforeEach, expect, test, vi } from 'vitest';
import { studyIntent } from '../utils/studyIntent';
import { useAuthStore } from '../utils/store';
import { completeLesson } from '../utils/api/books';
import { recordLessonListen } from '../utils/api/lessonStudy';
import { fetchApi } from '../utils/api/client';
vi.mock('../utils/api/client', () => ({ fetchApi: vi.fn(), API_URL: '/api' }));
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); useAuthStore.setState({ user: { id: 'learner-1' } }); });

test('holds an action ID across retries and separates account, text, revision and kind', () => {
  const first = studyIntent(44, 'listen', 'rev', 10);
  expect(studyIntent(44, 'listen', 'rev', 10).id).toBe(first.id);
  expect(() => studyIntent(44, 'listen', 'rev', 20)).toThrow(/original duration/);
  expect(studyIntent(44, 'read', 'rev').id).not.toBe(first.id);
  expect(studyIntent(45, 'listen', 'rev', 10).id).not.toBe(first.id);
  expect(studyIntent(44, 'listen', 'other', 10).id).not.toBe(first.id);
  useAuthStore.setState({ user: { id: 'learner-2' } });
  expect(studyIntent(44, 'listen', 'rev', 10).id).not.toBe(first.id);
  useAuthStore.setState({ user: { id: 'learner-1' } });
  first.done();
  expect(studyIntent(44, 'listen', 'rev', 10).id).not.toBe(first.id);
});
test('a lost read response retries the same ID, then a new intentional pass gets a new ID', async () => {
  vi.mocked(fetchApi).mockRejectedValueOnce(new TypeError('lost response')).mockResolvedValue({});
  await expect(completeLesson(5, 44, false, { repeat: true, sourceRevision: 'rev' })).rejects.toThrow();
  await completeLesson(5, 44, false, { repeat: true, sourceRevision: 'rev' });
  const body = (i: number) => JSON.parse(String(vi.mocked(fetchApi).mock.calls[i][1]?.body));
  expect(body(0).clientEventId).toBe(body(1).clientEventId);
  await completeLesson(5, 44, false, { repeat: true, sourceRevision: 'rev' });
  expect(body(2).clientEventId).not.toBe(body(1).clientEventId);
});
test('listen retry retains both ID and requested credit', async () => {
  vi.mocked(fetchApi).mockRejectedValueOnce(new TypeError('lost response')).mockResolvedValue({});
  await expect(recordLessonListen(44, 'rev', 60)).rejects.toThrow();
  await recordLessonListen(44, 'rev', 60);
  expect(vi.mocked(fetchApi).mock.calls[0]).toEqual(vi.mocked(fetchApi).mock.calls[1]);
});
test('a late acknowledgement cannot clear a newer read intent', () => {
  const old = studyIntent(44, 'read', 'rev');
  const retry = studyIntent(44, 'read', 'rev');
  old.done();
  const next = studyIntent(44, 'read', 'rev');
  retry.done();
  expect(studyIntent(44, 'read', 'rev').id).toBe(next.id);
});
test('normal completion and deliberate repeat keep separate pending intents', async () => {
  vi.mocked(fetchApi).mockRejectedValueOnce(new TypeError('lost normal response')).mockResolvedValue({});
  await expect(completeLesson(5, 44, false, { sourceRevision: 'rev' })).rejects.toThrow();
  await completeLesson(5, 44, false, { repeat: true, sourceRevision: 'rev' });
  const normal = JSON.parse(String(vi.mocked(fetchApi).mock.calls[0][1]?.body));
  const repeat = JSON.parse(String(vi.mocked(fetchApi).mock.calls[1][1]?.body));
  expect(normal.clientEventId).not.toBe(repeat.clientEventId);
});
test('standalone skipStats and repeat parameters survive browsers without URLSearchParams.size', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
  Object.defineProperty(URLSearchParams.prototype, 'size', { configurable: true, get: () => undefined });
  vi.mocked(fetchApi).mockResolvedValue({});
  try {
    await completeLesson(null, 44, true);
    expect(vi.mocked(fetchApi).mock.calls[0][0]).toBe('/texts/44/complete?skipStats=true');
    await completeLesson(null, 44, false, { repeat: true, sourceRevision: 'rev' });
    const path = vi.mocked(fetchApi).mock.calls[1][0];
    expect(path).toContain('repeat=true');
    expect(path).toContain('clientEventId=');
    expect(path).toContain('sourceRevision=rev');
  } finally {
    if (descriptor) Object.defineProperty(URLSearchParams.prototype, 'size', descriptor);
    else delete (URLSearchParams.prototype as unknown as { size?: number }).size;
  }
});
