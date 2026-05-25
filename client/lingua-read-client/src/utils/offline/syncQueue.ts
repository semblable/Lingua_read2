// IndexedDB-backed FIFO queue for mutations that failed because the network was
// unavailable. The PWA's API client wraps mutation calls; on a TypeError (the
// fetch failure mode for network unreachable), the call is enqueued here and
// replayed by drain() once the browser comes back online.

const DB_NAME = 'lingua-read-offline';
const DB_VERSION = 1;
const STORE = 'pending-ops';

export type PendingOp =
  | { type: 'srsReview'; payload: { cardId: number; grade: number } }
  | { type: 'wordStatusUpdate'; payload: { wordId: number; status: number } }
  | { type: 'wordCreate'; payload: { textId: number; term: string; translation?: string; status?: number } };

export type StoredPendingOp = PendingOp & {
  id: number;
  enqueuedAt: number;
};

export type SyncResult = {
  attempted: number;
  succeeded: number;
  failed: number;
};

export interface SyncHandlers {
  srsReview: (payload: PendingOp & { type: 'srsReview' }) => Promise<void>;
  wordStatusUpdate: (payload: PendingOp & { type: 'wordStatusUpdate' }) => Promise<void>;
  wordCreate: (payload: PendingOp & { type: 'wordCreate' }) => Promise<void>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open offline IndexedDB'));
  });
  return dbPromise;
}

function txStore(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function enqueue(op: PendingOp): Promise<number> {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const store = txStore(db, 'readwrite');
    const record: Omit<StoredPendingOp, 'id'> = { ...op, enqueuedAt: Date.now() };
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error ?? new Error('Failed to enqueue offline op'));
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
// - 'auth-stop': 401. fetchApi already redirects the user to /login. We leave
//   the op in the queue (it'll replay after re-auth) and STOP the loop so we
//   don't generate N more pointless 401s.
// - 'terminal': any other 4xx. The server is rejecting the op permanently;
//   retrying forever just keeps the queue stuck (this is what bit us before).
//   Drop the op.
// - 'retryable': network failures, 5xx, or unknown errors. Leave in queue.
//
// We duck-type on `error.status` so syncQueue stays handler-agnostic — the
// handlers throw `ApiError` from api/client.ts, which carries a numeric status.
type ErrorKind = 'auth-stop' | 'terminal' | 'retryable';
function classifyError(err: unknown): ErrorKind {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') {
      if (status === 401) return 'auth-stop';
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

  for (const op of ops) {
    attempted++;
    try {
      if (op.type === 'srsReview') {
        await handlers.srsReview(op);
      } else if (op.type === 'wordStatusUpdate') {
        await handlers.wordStatusUpdate(op);
      } else if (op.type === 'wordCreate') {
        await handlers.wordCreate(op);
      }
      await deleteOp(op.id);
      succeeded++;
    } catch (err) {
      const kind = classifyError(err);
      if (kind === 'auth-stop') {
        // 401: stop draining. handleUnauthorized in api/client.ts already
        // started the redirect to /login; remaining ops wait for re-auth.
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
      // Retryable: leave in queue for the next drain.
      failed++;
    }
  }

  return { attempted, succeeded, failed };
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
 * Wipe every queued op. Called from logout and handleUnauthorized (401
 * redirect) so a subsequent user on the same browser doesn't inherit pending
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
  dbPromise = null;
}
