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
  | { type: 'wordCreate'; payload: { term: string; languageId: number; translation?: string; status?: number } };

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

export async function drain(handlers: SyncHandlers): Promise<SyncResult> {
  // Guard 1: do not attempt while offline — we'd just re-enqueue everything.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  // Guard 2: re-entrancy — concurrent drains would race on the same store.
  if (draining) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }
  draining = true;

  try {
    const ops = await listPending();
    let succeeded = 0;
    let failed = 0;

    for (const op of ops) {
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
      } catch {
        // Leave failed op in the queue; later drain will retry.
        failed++;
      }
    }

    return { attempted: ops.length, succeeded, failed };
  } finally {
    draining = false;
  }
}

// Test-only: wipe everything. Production code never calls this — it would
// silently drop user mutations.
export async function _resetForTests(): Promise<void> {
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
