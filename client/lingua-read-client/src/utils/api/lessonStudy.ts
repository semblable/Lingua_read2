import { fetchApi } from './client';
import { studyIntent, notifyStudyChange } from '../studyIntent';

export type LessonStudyCounts = { readCount: number; listenCount: number };
export const getLessonStudy = (textId: number | string) => fetchApi<LessonStudyCounts>(`/lesson-study/${textId}`);
export async function recordLessonListen(textId: number | string, sourceRevision: string, durationSeconds: number) {
  if (!navigator.onLine) throw new Error('Connect to record a listen. Playback time still uses the existing offline activity queue.');
  const intent = studyIntent(textId, 'listen', sourceRevision, durationSeconds);
  const result = await fetchApi(`/lesson-study/${textId}/listen`, { method: 'POST',
    body: JSON.stringify({ clientEventId: intent.id, sourceRevision, durationSeconds }) });
  intent.done();
  notifyStudyChange(textId);
  return result;
}
