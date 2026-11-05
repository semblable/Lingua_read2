import { fetchApi } from './client';
import { studyIntent, notifyStudyChange } from '../studyIntent';

export type LessonStudyCounts = { readCount: number; listenCount: number };
export const getLessonStudy = (textId: number | string) => fetchApi<LessonStudyCounts>(`/lesson-study/${textId}`);
export async function setLessonStudyCount(textId: number | string, sourceRevision: string,
  kind: 'read' | 'listen', count: number, expectedCount: number) {
  if (!navigator.onLine) throw new Error('Connect to change a lesson total.');
  // Absolute targets and expected totals keep a retry safe even after a reload.
  const intent = studyIntent(textId, `set-${kind}`, `${sourceRevision}:${expectedCount}:${count}`);
  try {
    const result = await fetchApi<LessonStudyCounts>(`/lesson-study/${textId}/count`, { method: 'PUT',
      body: JSON.stringify({ clientEventId: intent.id, sourceRevision, kind, count, expectedCount }) });
    intent.done();
    notifyStudyChange(textId);
    return result;
  } catch (error) {
    // A rejected action was not committed. A new edit may safely use a new ID.
    if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 404 || error.status === 409)) intent.done();
    throw error;
  }
}
export async function recordLessonListen(textId: number | string, sourceRevision: string, durationSeconds: number) {
  if (!navigator.onLine) throw new Error('Connect to record a listen. Playback time still uses the existing offline activity queue.');
  const intent = studyIntent(textId, 'listen', sourceRevision, durationSeconds);
  const result = await fetchApi(`/lesson-study/${textId}/listen`, { method: 'POST',
    body: JSON.stringify({ clientEventId: intent.id, sourceRevision, durationSeconds }) });
  intent.done();
  notifyStudyChange(textId);
  return result;
}
