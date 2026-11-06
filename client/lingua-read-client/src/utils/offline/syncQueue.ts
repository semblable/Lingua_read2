// IndexedDB-backed FIFO queue for mutations that failed because the network was
// unavailable. The PWA's API client wraps mutation calls; on a TypeError (the
// fetch failure mode for network unreachable), the call is enqueued here and
// replayed by drain() once the browser comes back online.

const DB_NAME = 'lingua-read-offline';
const DB_VERSION = 1;
const STORE = 'pending-ops';

export type PendingOp =
  // SRS grade. Carries a clientEventId the backend dedupes on (a grade applied
  // twice would double-advance the card), plus when and in which time zone it
  // happened so the replay is scheduled from the review, not from the sync.
  // The three are optional only for ops queued by older builds.
  | { type: 'srsReview'; payload: { cardId: number; grade: number; clientEventId?: string; reviewedAt?: string; timezoneOffsetMinutes?: number } }
  | { type: 'wordStatusUpdate'; payload: { wordId: number; status: number; translation?: string } }
  | { type: 'wordCreate'; payload: { textId: number; term: string; translation?: string; status?: number; sentence?: string | null; replaceExisting?: boolean } }
  // Listening time. Additive on the server, so each op carries a clientEventId
  // the backend dedupes on — a replay (or a request whose response was lost on a
  // flaky link) can't double-count the seconds.
  | { type: 'logListening'; payload: { languageId: number | string; durationSeconds: number; clientEventId: string } }
  // Audio position. Last-write-wins; coalesced on enqueue (see coalesceKey) so
  // only the newest position replays, and carries clientUpdatedAt so a late
  // drain can't clobber a newer value the server already holds.
  | { type: 'audiobookProgress'; payload: { bookId: number | string; trackId: number | null; position: number | null; clientUpdatedAt: string } }
  | { type: 'audioLessonProgress'; payload: { textId: number | string; position: number | null; clientUpdatedAt: string } }
  // Reading position. sentenceRead is already idempotent server-side (it dedupes
  // by credited segment index), so it is appended, not coalesced. lastRead is
  // last-write-wins and coalesced + timestamp-guarded like audio position.
  | { type: 'sentenceRead'; payload: { textId: number; currentSegmentIndex?: number; segments: { segmentIndex: number; segmentText: string }[] } }
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
};

export type SyncResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  authRequired?: boolean;
};

export interface SyncHandlers {
  srsReview: (payload: PendingOp & { type: 'srsReview' }) => Promise<void>;
  wordStatusUpdate: (payload: PendingOp & { type: 'wordStatusUpdate' }) => Promise<void>;
  wordCreate: (payload: PendingOp & { type: 'wordCreate' }) => Promise<void>;
  logListening: (payload: PendingOp & { type: 'logListening' }) => Promise<void>;
  audiobookProgress: (payload: PendingOp & { type: 'audiobookProgress' }) => Promise<void>;
  audioLessonProgress: (payload: PendingOp & { type: 'audioLessonProgress' }) => Promise<void>;
  sentenceRead: (payload: PendingOp & { type: 'sentenceRead' }) => Promise<void>;
  lastRead: (payload: PendingOp & { type: 'lastRead' }) => Promise<void>;
  bookmarkSet: (payload: PendingOp & { type: 'bookmarkSet' }) => Promise<void>;
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
    store.transaction.oncomplete = () => resolve(id);
    store.transaction.onabort = () => reject(store.transaction.error ?? new Error('Offline write aborted'));

    const add = () => {
      const record: Omit<StoredPendingOp, 'id'> = {
        ...op,
        enqueuedAt: Date.now(),
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
        if ((cursor.value as StoredPendingOp).coalesceKey === coalesceKey) {
          const previous = cursor.value as StoredPendingOp;
          if (previous.type === 'wordStatusUpdate' && op.type === 'wordStatusUpdate') {
            op = { ...op, payload: { ...previous.payload, ...op.payload } };
          }
          if (previous.type === 'wordCreate' && op.type === 'wordCreate') {
            op = { ...op, payload: { ...op.payload,
              translation: op.payload.translation ?? previous.payload.translation,
              sentence: op.payload.sentence || previous.payload.sentence } };
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
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const store = txStore(db, 'readonly');
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to count pending ops'));
  });
}

export async function listPending(): Promise<StoredPendingOp[]> {
  const db = await openDb();
  return new Promise<StoredPendingOp[]>((resolve, reject) => {
    const store = txStore(db, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as StoredPendingOp[]).sort((a, b) => a.id - b.id));
    req.onerror = () => reject(req.error ?? new Error('Failed to list pending ops'));
  });
}

/**
 * Removes queued ops matching `match` before they sync, e.g. an SRS grade
 * the user undid while offline. Returns how many were removed.
 */
export async function removePending(match: (op: StoredPendingOp) => boolean): Promise<number> {
  const matches = (await listPending()).filter(match);
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
  const ops = await listPending();
  let succeeded = 0;
  let failed = 0;
  let attempted = 0;
  let authRequired = false;

  for (const op of ops) {
    attempted++;
    try {
      if (op.type === 'srsReview') {
        await handlers.srsReview(op);
      } else if (op.type === 'wordStatusUpdate') {
        await handlers.wordStatusUpdate(op);
      } else if (op.type === 'wordCreate') {
        await handlers.wordCreate(op);
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
      await deleteOp(op.id);
      succeeded++;
    } catch (err) {
      const kind = classifyError(err);
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
