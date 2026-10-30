import { newClientEventId } from './offline/clientEventId';
import { useAuthStore } from './store';

type PendingIntent = { id: string; seconds: number };
// Keep IDs usable when storage is blocked or full. A null entry also prevents
// an acknowledged ID from returning if removing its stored copy failed.
const memoryIntents = new Map<string, PendingIntent | null>();

function readIntent(key: string): PendingIntent | null {
  if (memoryIntents.has(key)) return memoryIntents.get(key) ?? null;
  try {
    const stored = sessionStorage.getItem(key);
    const value: unknown = stored ? JSON.parse(stored) : null;
    if (value && typeof value === 'object' && 'id' in value && 'seconds' in value
      && typeof value.id === 'string' && value.id.trim() && value.id.length <= 64
      && typeof value.seconds === 'number' && Number.isFinite(value.seconds)) {
      const intent = { id: value.id, seconds: value.seconds };
      memoryIntents.set(key, intent);
      return intent;
    }
  } catch { /* Storage access and malformed saved data must not block recording. */ }
  return null;
}

export function notifyStudyChange(textId: number | string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lesson-study-changed', { detail: { textId: Number(textId) } }));
}

// Session-scoped and partitioned by account. This is a retry intent, not a new
// offline queue that older clients could silently drain/discard.
export function studyIntent(textId: number | string, kind: string, revision = '', seconds = 0) {
  const owner = String(useAuthStore.getState().user?.id ?? 'session');
  const key = `lesson-study:${owner}:${textId}:${kind}:${revision}`;
  const finish = (id: string) => {
    if (readIntent(key)?.id !== id) return;
    memoryIntents.set(key, null);
    try { sessionStorage.removeItem(key); }
    catch { /* The in-memory acknowledgement overrides a stale stored copy. */ }
  };
  const previous = readIntent(key);
  if (previous) {
    if (previous.seconds !== seconds) throw new Error(`Retry the pending listen with its original duration (${previous.seconds / 60} minutes) before recording a different one.`);
    return { id: previous.id, done: () => finish(previous.id) };
  }
  const id = newClientEventId();
  const intent = { id, seconds };
  memoryIntents.set(key, intent);
  try { sessionStorage.setItem(key, JSON.stringify(intent)); }
  catch { /* Retry identity remains available in memory for this page lifetime. */ }
  return { id, done: () => finish(id) };
}
