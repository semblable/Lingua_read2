// IndexedDB-backed FIFO queue for mutations that failed because the network was
// unavailable. The PWA's API client wraps mutation calls; on a TypeError (the
// fetch failure mode for network unreachable), the call is enqueued here and
// replayed by drain() once the browser comes back online.

import type { LessonListeningCredit } from '../../audio/listeningActivity';
import { getConflictingWord, notifyWordReplay, offlineSessionRevision, type ConflictingWord } from './events';

const DB_NAME = 'lingua-read-offline';
const DB_VERSION = 1;
const STORE = 'pending-ops';

type WordEditVersion = { clientUpdatedAt?: string; translationUpdatedAt?: string; expectedRevision?: string;
  translationOnly?: boolean; statusUpdatedAt?: string };

export type PendingOp =
  // SRS grade. Carries a clientEventId the backend dedupes on (a grade applied
  // twice would double-advance the card), plus when and in which time zone it
  // happened so the replay is scheduled from the review, not from the sync.
  // The three are optional only for ops queued by older builds.
  | { type: 'srsReview'; payload: { cardId: number; grade: number; clientEventId?: string; reviewedAt?: string; timezoneOffsetMinutes?: number } }
  | { type: 'wordStatusUpdate'; payload: WordEditVersion & { wordId: number; status: number; translation?: string; textId?: number; sentence?: string } }
  | { type: 'wordCreate'; payload: WordEditVersion & { textId: number; term: string; translation?: string; status?: number; sentence?: string | null; replaceExisting?: boolean } }
  // Listening time. Additive on the server, so each op carries a clientEventId
  // the backend dedupes on — a replay (or a request whose response was lost on a
  // flaky link) can't double-count the seconds.
  | { type: 'logListening'; payload: { languageId: number | string; durationSeconds: number; clientEventId: string; lesson?: LessonListeningCredit } }
  // Audio position. Last-write-wins; coalesced on enqueue (see coalesceKey) so
  // only the newest position replays, and carries clientUpdatedAt so a late
  // drain can't clobber a newer value the server already holds.
  | { type: 'audiobookProgress'; payload: { bookId: number | string; trackId: number | null; position: number | null; clientUpdatedAt: string } }
  | { type: 'audioLessonProgress'; payload: { textId: number | string; position: number | null; clientUpdatedAt: string } }
  // Keep every sentence credit for server-side deduplication. The timestamp
  // separately prevents a late replay from replacing a newer sentence cursor.
  | { type: 'sentenceRead'; payload: { textId: number; currentSegmentIndex?: number; clientUpdatedAt?: string; segments: { segmentIndex: number; segmentText: string }[] } }
  // Book last-read is last-write-wins and coalesced like audio position.
  | { type: 'lastRead'; payload: { bookId: number | string; textId: number | string; clientUpdatedAt: string } }
  // Sentence bookmark add/remove. Last-write-wins per sentence: coalesced on
  // enqueue and timestamp-guarded server-side, so a late drain can't undo a
  // newer toggle made on another device.
  | { type: 'bookmarkSet'; payload: { textId: number; sentenceIndex: number; bookmarked: boolean; clientUpdatedAt: string } };

export type StoredPendingOp = PendingOp & {
  id: number;
  enqueuedAt: number;
  // Set on last-write-wins ops. When present, enqueue() removes any existing
  // pending op with the same key before adding, so the queue keeps only the
  // newest value instead of dozens of stale 10s saves.
  coalesceKey?: string;
  conflictingWord?: ConflictingWord;
  // The first example may come from an earlier edit than the status retained here.
  exampleCapturedAt?: number;
};

type QueuedWord = Extract<PendingOp, { type: 'wordCreate' | 'wordStatusUpdate' }>;
type StoredWord = Extract<StoredPendingOp, { type: 'wordCreate' | 'wordStatusUpdate' }>;
export type WordConflict = StoredWord & { conflictingWord: ConflictingWord };

export type SyncResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  authRequired?: boolean;
};

export interface SyncHandlers {
  srsReview: (payload: PendingOp & { type: 'srsReview' }) => Promise<void>;
  wordStatusUpdate: (op: Extract<PendingOp, { type: 'wordStatusUpdate' }> & { enqueuedAt?: number }) => Promise<unknown>;
  wordCreate: (op: Extract<PendingOp, { type: 'wordCreate' }> & { enqueuedAt?: number }) => Promise<unknown>;
  logListening: (payload: PendingOp & { type: 'logListening' }) => Promise<void>;
  audiobookProgress: (payload: PendingOp & { type: 'audiobookProgress' }) => Promise<void>;
  audioLessonProgress: (payload: PendingOp & { type: 'audioLessonProgress' }) => Promise<void>;
  sentenceRead: (payload: Extract<PendingOp, { type: 'sentenceRead' }> & { enqueuedAt?: number }) => Promise<void>;
  lastRead: (payload: PendingOp & { type: 'lastRead' }) => Promise<void>;
  bookmarkSet: (payload: PendingOp & { type: 'bookmarkSet' }) => Promise<void>;
}

export function queuedWordEditTime(clientUpdatedAt?: string, enqueuedAt?: number): string | undefined {
  if (clientUpdatedAt !== undefined) return clientUpdatedAt;
  // The previous queue format already stored the enqueue time in IndexedDB.
  const date = new Date(enqueuedAt ?? NaN);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function exampleTime(op: QueuedWord, editTime: string, capturedAt?: number): number {
  if (!op.payload.sentence?.trim() || !(Number(op.payload.textId) > 0)) return Infinity;
  if (capturedAt !== undefined) return capturedAt;
  const status = op.payload.status ?? 1;
  return status >= 1 && status <= 4 ? Date.parse(editTime) : Infinity;
}

function mergeWordEdits(previous: StoredWord, incoming: QueuedWord, enqueuedAt: number, incomingExampleAt?: number) {
  const previousTime = queuedWordEditTime(previous.payload.clientUpdatedAt, previous.enqueuedAt)!;
  const incomingTime = queuedWordEditTime(incoming.payload.clientUpdatedAt, enqueuedAt)!;
  // A slow request in another tab can enqueue an older intent after a newer one.
  const previousIsLater = Date.parse(previousTime) > Date.parse(incomingTime);
  const latest = previousIsLater ? previous : incoming;
  const op: QueuedWord = latest.type === 'wordCreate'
    ? { type: latest.type, payload: { ...latest.payload } }
    : { type: latest.type, payload: { ...latest.payload } };
  op.payload.clientUpdatedAt = previousIsLater ? previousTime : incomingTime;

  // A gloss has no status intent. An earlier explicit grade retains its own time
  // even when a later translation and grade travel in the same request.
  const previousStatusAt = previous.payload.statusUpdatedAt ?? previousTime;
  const incomingStatusAt = incoming.payload.statusUpdatedAt ?? incomingTime;
  if (!previous.payload.translationOnly || !incoming.payload.translationOnly) {
    const usePrevious = !previous.payload.translationOnly && (incoming.payload.translationOnly ||
      Date.parse(previousStatusAt) > Date.parse(incomingStatusAt));
    op.payload.status = (usePrevious ? previous.payload.status : incoming.payload.status) ?? 1;
    delete op.payload.translationOnly;
    const statusAt = usePrevious ? previousStatusAt : incomingStatusAt;
    op.payload.statusUpdatedAt = statusAt === op.payload.clientUpdatedAt ? undefined : statusAt;
  }

  const previousTranslationAt = previous.payload.translationUpdatedAt ?? previousTime;
  const incomingTranslationAt = incoming.payload.translationUpdatedAt ?? incomingTime;
  const keepPreviousTranslation = previous.payload.translation !== undefined && (
    incoming.payload.translation === undefined || Date.parse(previousTranslationAt) > Date.parse(incomingTranslationAt));
  op.payload.translation = keepPreviousTranslation ? previous.payload.translation : incoming.payload.translation;
  const translationAt = keepPreviousTranslation ? previousTranslationAt : incomingTranslationAt;
  op.payload.translationUpdatedAt = op.payload.translation !== undefined && translationAt !== op.payload.clientUpdatedAt
    ? translationAt : undefined;

  const previousExampleAt = exampleTime(previous, previousTime, previous.exampleCapturedAt);
  const nextExampleAt = exampleTime(incoming, incomingTime, incomingExampleAt);
  const firstExampleAt = Math.min(previousExampleAt, nextExampleAt);
  if (Number.isFinite(firstExampleAt)) {
    const example = previousExampleAt <= nextExampleAt ? previous : incoming;
    op.payload.sentence = example.payload.sentence;
    op.payload.textId = example.payload.textId!;
  } else {
    delete op.payload.sentence;
    if (op.type === 'wordStatusUpdate') delete op.payload.textId;
  }
  return { op, exampleCapturedAt: Number.isFinite(firstExampleAt) ? firstExampleAt : undefined };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const invalidate = () => { if (dbPromise === opening) dbPromise = null; };
      db.onclose = invalidate;
      db.onversionchange = () => { db.close(); invalidate(); };
      resolve(db);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('Failed to open offline IndexedDB'));
    };
  });
  dbPromise = opening;
  void opening.catch(() => { if (dbPromise === opening) dbPromise = null; });
  return opening;
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function enqueue(op: PendingOp, coalesceKey?: string): Promise<number> {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    let id: number;
    const enqueuedAt = Date.now();
    let exampleCapturedAt: number | undefined;
    store.transaction.oncomplete = () => resolve(id);
    store.transaction.onabort = () => reject(store.transaction.error ?? new Error('Offline write aborted'));

    const add = () => {
      const record: Omit<StoredPendingOp, 'id'> = {
        ...op,
        enqueuedAt,
        ...(exampleCapturedAt !== undefined ? { exampleCapturedAt } : {}),
        ...(coalesceKey ? { coalesceKey } : {})
      };
      const req = store.add(record);
      req.onsuccess = () => { id = req.result as number; };
      req.onerror = () => reject(req.error ?? new Error('Failed to enqueue offline op'));
    };

    if (!coalesceKey) {
      add();
      return;
    }

    // Coalesce: drop any existing pending op carrying the same key (within this
    // same transaction) so only the newest value survives to replay. The queue
    // is small, so a full cursor scan is cheap.
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const previous = cursor.value as StoredPendingOp;
        if (!previous.conflictingWord && previous.coalesceKey === coalesceKey) {
          if ((previous.type === 'wordStatusUpdate' && op.type === 'wordStatusUpdate') ||
            (previous.type === 'wordCreate' && op.type === 'wordCreate')) {
            const merged = mergeWordEdits(previous, op, enqueuedAt, exampleCapturedAt);
            op = merged.op;
            exampleCapturedAt = merged.exampleCapturedAt;
          }
          cursor.delete();
        }
        cursor.continue();
      } else {
        add();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error('Failed to coalesce offline queue'));
  });
}

export async function pending(): Promise<number> {
  return (await listPending()).length;
}

async function listQueue(): Promise<StoredPendingOp[]> {
  const db = await openDb();
  return new Promise<StoredPendingOp[]>((resolve, reject) => {
    const store = txStore(db, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as StoredPendingOp[]).sort((a, b) => a.id - b.id));
    req.onerror = () => reject(req.error ?? new Error('Failed to list pending ops'));
  });
}

export async function listPending(): Promise<StoredPendingOp[]> {
  return (await listQueue()).filter(op => !op.conflictingWord);
}

function isWordConflict(op: StoredPendingOp): op is WordConflict {
  return op.conflictingWord !== undefined && (op.type === 'wordStatusUpdate' || op.type === 'wordCreate');
}

export async function listWordConflicts(): Promise<WordConflict[]> {
  return (await listQueue()).filter(isWordConflict);
}

async function updateQueuedOp(id: number, update: (store: IDBObjectStore, op: StoredPendingOp) => void): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    store.transaction.oncomplete = () => resolve();
    store.transaction.onabort = () => reject(store.transaction.error ?? new Error('Offline update aborted'));
    const request = store.get(id);
    request.onsuccess = () => { if (request.result) update(store, request.result as StoredPendingOp); };
  });
}

export async function resolveWordConflict(id: number, reapply: boolean): Promise<void> {
  await updateQueuedOp(id, (store, op) => {
    if (!isWordConflict(op)) return;
    if (reapply) {
      // Keep an explicit reapply distinct from other pending edits for the same word.
      store.add({
        type: op.type,
        enqueuedAt: Date.now(),
        // If this snapshot predates versioned conflicts, refresh it on the
        // server before permitting an overwrite.
        payload: { ...op.payload, expectedRevision: op.conflictingWord.revision ?? 'unknown' },
      });
    }
    store.delete(id);
  });
}

/**
 * Removes queued ops matching `match` before they sync, e.g. an SRS grade
 * the user undid while offline. Returns how many were removed.
 */
export async function removePending(match: (op: StoredPendingOp) => boolean): Promise<number> {
  const matches = (await listQueue()).filter(match);
  for (const op of matches) await deleteOp(op.id);
  return matches.length;
}

async function deleteOp(id: number): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Failed to delete pending op'));
  });
}

async function hasPending(id: number): Promise<boolean> {
  const db = await openDb();
  return new Promise<boolean>((resolve, reject) => {
    const req = txStore(db, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result !== undefined && !(req.result as StoredPendingOp).conflictingWord);
    req.onerror = () => reject(req.error ?? new Error('Failed to check pending op'));
  });
}

let draining = false;

// Web Locks key for cross-tab coordination. With { ifAvailable: true }, a
// second tab racing to drain will get null back from request() and skip,
// preventing the duplicate-mutation race two open tabs would otherwise
// cause on reconnect.
const DRAIN_LOCK = 'lr-offline-drain';
const SKIPPED: SyncResult = { attempted: 0, succeeded: 0, failed: 0 };

// Classify a handler error so drain() can decide whether to retry, drop, or halt.
// - 'auth-stop': 401. Leave the op queued and signal the background sync UI
//   to request login without replacing the active page.
// - 'terminal': other 4xx except 408/429. The server is rejecting the op permanently;
//   retrying forever just keeps the queue stuck (this is what bit us before).
//   Drop the op.
// - 'retryable': network failures, 408/429, 5xx, or unknown errors. Leave in queue.
//
// We duck-type on `error.status` so syncQueue stays handler-agnostic — the
// handlers throw `ApiError` from api/client.ts, which carries a numeric status.
type ErrorKind = 'auth-stop' | 'terminal' | 'retryable';
function classifyError(err: unknown): ErrorKind {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') {
      if (status === 401) return 'auth-stop';
      if (status === 408 || status === 429) return 'retryable';
      if (status >= 400 && status < 500) return 'terminal';
    }
  }
  return 'retryable';
}

async function drainOnce(handlers: SyncHandlers): Promise<SyncResult> {
  const session = offlineSessionRevision();
  const ops = await listPending();
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;
  let authRequired = false;

  for (const op of ops) {
    // An undo, deletion, or newer coalesced edit may have removed an operation
    // while an earlier handler in this snapshot was awaiting its response.
    if (!await hasPending(op.id)) continue;
    if (offlineSessionRevision() !== session) break;
    attempted++;
    try {
      let result: unknown;
      if (op.type === 'srsReview') {
        await handlers.srsReview(op);
      } else if (op.type === 'wordStatusUpdate') {
        result = await handlers.wordStatusUpdate(op);
      } else if (op.type === 'wordCreate') {
        result = await handlers.wordCreate(op);
      } else if (op.type === 'logListening') {
        await handlers.logListening(op);
      } else if (op.type === 'audiobookProgress') {
        await handlers.audiobookProgress(op);
      } else if (op.type === 'audioLessonProgress') {
        await handlers.audioLessonProgress(op);
      } else if (op.type === 'sentenceRead') {
        await handlers.sentenceRead(op);
      } else if (op.type === 'lastRead') {
        await handlers.lastRead(op);
      } else if (op.type === 'bookmarkSet') {
        await handlers.bookmarkSet(op);
      }
      if (offlineSessionRevision() !== session) break;
      await deleteOp(op.id);
      if (op.type === 'wordCreate' || op.type === 'wordStatusUpdate') {
        notifyWordReplay({ op, outcome: 'confirmed', result });
      }
      succeeded++;
    } catch (err) {
      if (offlineSessionRevision() !== session) break;
      const kind = classifyError(err);
      if (op.type === 'wordCreate' || op.type === 'wordStatusUpdate') {
        const word = getConflictingWord(err);
        if (word) {
          await updateQueuedOp(op.id, (store, stored) => store.put({ ...stored, conflictingWord: word }));
          notifyWordReplay({ op, outcome: 'conflict', result: word });
          failed++;
          continue;
        }
        notifyWordReplay({ op, outcome: kind === 'terminal' ? 'rejected' : 'retryable' });
      }
      if (kind === 'auth-stop') {
        // Keep the active page and all remaining work available during login.
        authRequired = true;
        failed++;
        break;
      }
      if (kind === 'terminal') {
        // Permanent server-side rejection. Drop the op so the queue can
        // eventually drain instead of looping on the same bad payload.
        try { await deleteOp(op.id); } catch { /* swallow */ }
        failed++;
        continue;
      }
      // Stop at the first retryable failure: later writes must not overtake it.
      failed++;
      break;
    }
  }

  return { attempted, succeeded, failed, ...(authRequired ? { authRequired } : {}) };
}

export async function drain(handlers: SyncHandlers): Promise<SyncResult> {
  // Guard: do not attempt while offline — we'd just re-enqueue everything.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return SKIPPED;
  }

  // Multi-tab coordination via Web Locks. With { ifAvailable: true }, a
  // concurrent caller (other tab or same tab) gets a null lock and we skip
  // rather than racing on the same pending-ops store. Wrapped in try/catch
  // so an InvalidStateError from a detached document (or any other edge-case
  // rejection from the Locks API itself) falls back to SKIPPED instead of
  // surfacing as an unhandled rejection up the drain caller chain.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks && typeof locks.request === 'function') {
    try {
      const result = await locks.request(
        DRAIN_LOCK,
        { ifAvailable: true },
        async (lock) => (lock ? drainOnce(handlers) : SKIPPED)
      );
      return result ?? SKIPPED;
    } catch {
      return SKIPPED;
    }
  }

  // Fallback for environments without Web Locks (older browsers, test env):
  // module-scoped re-entrancy guard. Safe within a single tab; cross-tab
  // races are only possible on these legacy targets.
  if (draining) return SKIPPED;
  draining = true;
  try {
    return await drainOnce(handlers);
  } finally {
    draining = false;
  }
}

/**
 * Wipe every queued op. Called from explicit logout
 * so a subsequent user on the same browser doesn't inherit pending
 * mutations (cross-user leak). Also used as a reset-between-tests primitive.
 */
export async function clearAll(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Failed to clear offline queue'));
  });
}

// Test-only: force the next openDb() to reopen, so a `delete database()` in tests
// gets picked up.
export function _closeDbForTests(): void {
  void dbPromise?.then(db => db.close(), () => {});
  dbPromise = null;
}
