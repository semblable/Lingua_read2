import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import {
  enqueue,
  pending,
  listPending,
  drain,
  clearAll,
  _resetForTests,
  _closeDbForTests,
} from '../utils/offline/syncQueue';
import { ApiError } from '../utils/api/client';

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
};

describe('syncQueue', () => {
  beforeEach(async () => {
    // Reset the IndexedDB state between tests.
    setOnline(true);
    try {
      await _resetForTests();
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

  test('clearAll empties the queue', async () => {
    await enqueue({ type: 'srsReview', payload: { cardId: 800, grade: 2 } });
    await enqueue({ type: 'wordStatusUpdate', payload: { wordId: 1, status: 2 } });
    expect(await pending()).toBe(2);

    await clearAll();
    expect(await pending()).toBe(0);
  });
});
