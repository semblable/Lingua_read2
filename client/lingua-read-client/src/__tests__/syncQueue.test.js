import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import {
  enqueue,
  pending,
  listPending,
  drain,
  clearAll,
  _closeDbForTests,
} from '../utils/offline/syncQueue';
import { enqueueIfOffline } from '../utils/offline/enqueueIfOffline';
import { ApiError } from '../utils/api/client';

// Full handler set including the listening/position/reading-progress ops added
// for offline resilience. Tests override individual handlers as needed.
const fullHandlers = (overrides = {}) => ({
  srsReview: vi.fn(),
  wordStatusUpdate: vi.fn(),
  wordCreate: vi.fn(),
  logListening: vi.fn(),
  audiobookProgress: vi.fn(),
  audioLessonProgress: vi.fn(),
  sentenceRead: vi.fn(),
  lastRead: vi.fn(),
  ...overrides,
});

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
};

// Install a fake navigator.locks for the duration of the current test. The
// returned `restore` puts the property back to its original (usually undefined
// in happy-dom). `granted: true` simulates getting the lock; `false` simulates
// another tab holding it (ifAvailable returns null).
const installFakeLocks = ({ granted }) => {
  const request = vi.fn(async (_name, _options, callback) =>
    callback(granted ? { name: _name } : null)
  );
  const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'locks');
  Object.defineProperty(window.navigator, 'locks', {
    configurable: true,
    get: () => ({ request }),
  });
  const restore = () => {
    if (descriptor) {
      Object.defineProperty(window.navigator, 'locks', descriptor);
    } else {
      // happy-dom default: no locks property. Remove ours.
      delete window.navigator.locks;
    }
  };
  return { request, restore };
};

describe('syncQueue', () => {
  beforeEach(async () => {
    // Reset the IndexedDB state between tests.
    setOnline(true);
    try {
      await clearAll();
    } catch {
      _closeDbForTests();
    }
  });

  test('enqueue persists ops and pending() returns the count', async () => {
    expect(await pending()).toBe(0);
    await enqueue({ type: 'srsReview', payload: { cardId: 1, grade: 2 } });
    await enqueue({ type: 'wordStatusUpdate', payload: { wordId: 5, status: 3 } });
    expect(await pending()).toBe(2);
  });

  test('listPending returns ops sorted by insertion order', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 10, grade: 0 } });
    await enqueue({ type: 'srsReview', payload: { cardId: 11, grade: 1 } });
    await enqueue({ type: 'srsReview', payload: { cardId: 12, grade: 2 } });

    const ops = await listPending();
    expect(ops.map((o) => o.payload.cardId)).toEqual([10, 11, 12]);
  });

  test('drain replays ops in FIFO order and removes them after success', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 100, grade: 2 } });
    await enqueue({ type: 'srsReview', payload: { cardId: 101, grade: 3 } });

    const seen = [];
    const handlers = {
      srsReview: vi.fn(async (op) => { seen.push(op.payload.cardId); }),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(),
    };

    const result = await drain(handlers);
    expect(result).toEqual({ attempted: 2, succeeded: 2, failed: 0 });
    expect(seen).toEqual([100, 101]);
    expect(await pending()).toBe(0);
  });

  test('drain dispatches each op type to the matching handler', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 1, grade: 2 } });
    await enqueue({ type: 'wordStatusUpdate', payload: { wordId: 9, status: 5 } });
    await enqueue({ type: 'wordCreate', payload: { textId: 42, term: 'gato' } });

    const handlers = {
      srsReview: vi.fn(),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(),
    };
    await drain(handlers);

    expect(handlers.srsReview).toHaveBeenCalledTimes(1);
    expect(handlers.wordStatusUpdate).toHaveBeenCalledTimes(1);
    expect(handlers.wordCreate).toHaveBeenCalledTimes(1);
  });

  test('drain leaves failing ops in the queue for retry', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 200, grade: 2 } });
    await enqueue({ type: 'srsReview', payload: { cardId: 201, grade: 2 } });

    const handlers = {
      srsReview: vi.fn(async (op) => {
        if (op.payload.cardId === 201) throw new Error('still down');
      }),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(),
    };
    const result = await drain(handlers);
    expect(result).toEqual({ attempted: 2, succeeded: 1, failed: 1 });

    const remaining = await listPending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload.cardId).toBe(201);
  });

  test('drain is a no-op when the queue is empty', async () => {
    const handlers = {
      srsReview: vi.fn(),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(),
    };
    const result = await drain(handlers);
    expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(handlers.srsReview).not.toHaveBeenCalled();
  });

  test('drain skips replay when navigator.onLine is false', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 300, grade: 2 } });
    setOnline(false);

    const handlers = {
      srsReview: vi.fn(),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(),
    };
    const result = await drain(handlers);
    expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(handlers.srsReview).not.toHaveBeenCalled();
    // Op is still pending — it'll be picked up on reconnect.
    expect(await pending()).toBe(1);
  });

  test('a successful drain is idempotent', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 400, grade: 2 } });

    const handlers = {
      srsReview: vi.fn(),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(),
    };

    await drain(handlers);
    await drain(handlers);

    expect(handlers.srsReview).toHaveBeenCalledTimes(1);
    expect(await pending()).toBe(0);
  });

  test('drain drops the op when the server returns a 4xx (terminal error)', async () => {
    // Regression for H1+H2: a wordCreate with the old textId=0 produced a
    // permanent 400, and the catch-all kept it queued forever. The fix is to
    // delete ops that the server permanently rejects.
    await enqueue({ type: 'wordCreate', payload: { textId: 7, term: 'perro' } });
    await enqueue({ type: 'srsReview', payload: { cardId: 500, grade: 2 } });

    const handlers = {
      srsReview: vi.fn(),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(async () => { throw new ApiError('Bad request', 400); }),
    };

    const result = await drain(handlers);
    expect(result.attempted).toBe(2);
    // wordCreate gets dropped, srsReview succeeds.
    expect(await pending()).toBe(0);
    expect(handlers.srsReview).toHaveBeenCalledTimes(1);

    // Second drain: nothing left to do, no infinite loop.
    const second = await drain(handlers);
    expect(second).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
  });

  test('drain keeps the op queued on 5xx (retryable error)', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 600, grade: 2 } });

    const handlers = {
      srsReview: vi.fn(async () => { throw new ApiError('boom', 503); }),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(),
    };

    const result = await drain(handlers);
    expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    expect(await pending()).toBe(1);
  });

  test('drain halts on 401 and leaves remaining ops queued for re-auth', async () => {
    // The bug: every reconnect re-triggered drain, every drain re-issued the
    // same 401 against every queued op, the badge never cleared.
    // The fix: stop iterating after the first 401 — the user is being
    // redirected to /login and the remaining ops will replay after re-auth.
    await enqueue({ type: 'srsReview', payload: { cardId: 700, grade: 2 } });
    await enqueue({ type: 'srsReview', payload: { cardId: 701, grade: 2 } });
    await enqueue({ type: 'srsReview', payload: { cardId: 702, grade: 2 } });

    const handlers = {
      srsReview: vi.fn(async () => { throw new ApiError('Authentication required', 401); }),
      wordStatusUpdate: vi.fn(),
      wordCreate: vi.fn(),
    };

    const result = await drain(handlers);
    // Only the first op was attempted; the loop broke.
    expect(handlers.srsReview).toHaveBeenCalledTimes(1);
    expect(result.attempted).toBe(1);
    // All three ops still queued (none dropped).
    expect(await pending()).toBe(3);
  });

  test('enqueue coalesces ops sharing a coalesceKey, keeping only the newest', async () => {
    await enqueue(
      { type: 'audiobookProgress', payload: { bookId: 1, trackId: 10, position: 5, clientUpdatedAt: 'a' } },
      'audiobookProgress:book:1'
    );
    await enqueue(
      { type: 'audiobookProgress', payload: { bookId: 1, trackId: 10, position: 42, clientUpdatedAt: 'b' } },
      'audiobookProgress:book:1'
    );
    // A different book has its own key and must not be coalesced away.
    await enqueue(
      { type: 'audiobookProgress', payload: { bookId: 2, trackId: 20, position: 7, clientUpdatedAt: 'c' } },
      'audiobookProgress:book:2'
    );

    const ops = await listPending();
    expect(ops).toHaveLength(2);
    const book1 = ops.find((o) => o.payload.bookId === 1);
    expect(book1.payload.position).toBe(42);
  });

  test('logListening ops are appended (not coalesced) and replay in order', async () => {
    await enqueue({ type: 'logListening', payload: { languageId: 3, durationSeconds: 10, clientEventId: 'e1' } });
    await enqueue({ type: 'logListening', payload: { languageId: 3, durationSeconds: 10, clientEventId: 'e2' } });
    expect(await pending()).toBe(2);

    const seen = [];
    const handlers = fullHandlers({
      logListening: vi.fn(async (op) => { seen.push(op.payload.clientEventId); }),
    });
    const result = await drain(handlers);
    expect(result).toEqual({ attempted: 2, succeeded: 2, failed: 0 });
    expect(seen).toEqual(['e1', 'e2']);
    expect(await pending()).toBe(0);
  });

  test('drain dispatches each new op type to the matching handler', async () => {
    await enqueue({ type: 'logListening', payload: { languageId: 1, durationSeconds: 10, clientEventId: 'x' } });
    await enqueue(
      { type: 'audiobookProgress', payload: { bookId: 1, trackId: 1, position: 1, clientUpdatedAt: 'a' } },
      'audiobookProgress:book:1'
    );
    await enqueue(
      { type: 'audioLessonProgress', payload: { textId: 5, position: 2, clientUpdatedAt: 'a' } },
      'audioLessonProgress:lesson:5'
    );
    await enqueue({ type: 'sentenceRead', payload: { textId: 5, currentSegmentIndex: 0, segments: [{ segmentIndex: 0, segmentText: 'hi' }] } });
    await enqueue(
      { type: 'lastRead', payload: { bookId: 1, textId: 9, clientUpdatedAt: 'a' } },
      'lastRead:book:1'
    );

    const handlers = fullHandlers();
    await drain(handlers);

    expect(handlers.logListening).toHaveBeenCalledTimes(1);
    expect(handlers.audiobookProgress).toHaveBeenCalledTimes(1);
    expect(handlers.audioLessonProgress).toHaveBeenCalledTimes(1);
    expect(handlers.sentenceRead).toHaveBeenCalledTimes(1);
    expect(handlers.lastRead).toHaveBeenCalledTimes(1);
    expect(await pending()).toBe(0);
  });

  test('enqueueIfOffline forwards coalesceKey so offline position saves coalesce', async () => {
    setOnline(false);
    await enqueueIfOffline(
      { type: 'audiobookProgress', payload: { bookId: 1, trackId: 1, position: 1, clientUpdatedAt: 'a' } },
      async () => 'ran',
      'audiobookProgress:book:1'
    );
    await enqueueIfOffline(
      { type: 'audiobookProgress', payload: { bookId: 1, trackId: 1, position: 99, clientUpdatedAt: 'b' } },
      async () => 'ran',
      'audiobookProgress:book:1'
    );

    expect(await pending()).toBe(1);
    const ops = await listPending();
    expect(ops[0].payload.position).toBe(99);
  });

  test('clearAll empties the queue', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 800, grade: 2 } });
    await enqueue({ type: 'wordStatusUpdate', payload: { wordId: 1, status: 2 } });
    expect(await pending()).toBe(2);

    await clearAll();
    expect(await pending()).toBe(0);
  });

  test('drain uses navigator.locks when available', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 900, grade: 2 } });
    const { request, restore } = installFakeLocks({ granted: true });

    try {
      const handlers = {
        srsReview: vi.fn(),
        wordStatusUpdate: vi.fn(),
        wordCreate: vi.fn(),
      };
      const result = await drain(handlers);

      expect(request).toHaveBeenCalledWith(
        'lr-offline-drain',
        expect.objectContaining({ ifAvailable: true }),
        expect.any(Function)
      );
      expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
      expect(handlers.srsReview).toHaveBeenCalledTimes(1);
      expect(await pending()).toBe(0);
    } finally {
      restore();
    }
  });

  test('drain skips when another tab holds the Web Lock', async () => {
    // Regression for the multi-tab race: two tabs reconnecting would each
    // call drain() and double-submit the same op. With ifAvailable:true,
    // the losing tab gets null back and aborts cleanly.
    await enqueue({ type: 'srsReview', payload: { cardId: 901, grade: 2 } });
    const { restore } = installFakeLocks({ granted: false });

    try {
      const handlers = {
        srsReview: vi.fn(),
        wordStatusUpdate: vi.fn(),
        wordCreate: vi.fn(),
      };
      const result = await drain(handlers);

      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
      expect(handlers.srsReview).not.toHaveBeenCalled();
      // Op stays queued — the holding tab is responsible for processing it.
      expect(await pending()).toBe(1);
    } finally {
      restore();
    }
  });

  test('drain returns SKIPPED if the Web Locks API itself rejects', async () => {
    // Defensive: an InvalidStateError on a detached document (or any other
    // surprise rejection from locks.request) must not propagate as an
    // unhandled rejection — drain has historically returned the SKIPPED
    // tuple on re-entrancy, and the Web Locks path should preserve that.
    await enqueue({ type: 'srsReview', payload: { cardId: 902, grade: 2 } });

    const request = vi.fn(async () => { throw new DOMException('detached', 'InvalidStateError'); });
    const descriptor = Object.getOwnPropertyDescriptor(window.navigator, 'locks');
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      get: () => ({ request }),
    });

    try {
      const handlers = {
        srsReview: vi.fn(),
        wordStatusUpdate: vi.fn(),
        wordCreate: vi.fn(),
      };
      const result = await drain(handlers);
      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
      expect(handlers.srsReview).not.toHaveBeenCalled();
      // Op stays queued for the next attempt.
      expect(await pending()).toBe(1);
    } finally {
      if (descriptor) {
        Object.defineProperty(window.navigator, 'locks', descriptor);
      } else {
        delete window.navigator.locks;
      }
    }
  });
});
