import { newClientEventId } from './offline/clientEventId';
import { useAuthStore } from './store';

export function notifyStudyChange(textId: number | string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lesson-study-changed', { detail: { textId: Number(textId) } }));
}

// Session-scoped and partitioned by account. This is a retry intent, not a new
// offline queue that older clients could silently drain/discard.
export function studyIntent(textId: number | string, kind: string, revision = '', seconds = 0) {
  const owner = String(useAuthStore.getState().user?.id ?? 'session');
  const key = `lesson-study:${owner}:${textId}:${kind}:${revision}`;
  const finish = (id: string) => {
    const current = sessionStorage.getItem(key);
    if (current && (JSON.parse(current) as { id: string }).id === id) sessionStorage.removeItem(key);
  };
  const stored = sessionStorage.getItem(key);
  if (stored) {
    const previous = JSON.parse(stored) as { id: string; seconds: number };
    if (previous.seconds !== seconds) throw new Error(`Retry the pending listen with its original duration (${previous.seconds / 60} minutes) before recording a different one.`);
    return { id: previous.id, done: () => finish(previous.id) };
  }
  const id = newClientEventId();
  sessionStorage.setItem(key, JSON.stringify({ id, seconds }));
  return { id, done: () => finish(id) };
}
