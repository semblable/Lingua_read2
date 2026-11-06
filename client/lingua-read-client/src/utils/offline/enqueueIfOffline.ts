import { enqueue, listPending, type PendingOp } from './syncQueue';

// A network failure surfaces as `fetch` throwing `TypeError: Failed to fetch`
// (Chrome/Firefox) or `NetworkError when attempting to fetch resource` (Safari).
// Application errors (4xx/5xx) come back through the `if (!response.ok)` branch
// in client.ts and throw a typed `ApiError` — we explicitly do NOT enqueue those.
function isNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'ApiError') {
    return false;
  }
  return error instanceof TypeError ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException &&
      (error.name === 'NetworkError' || error.name === 'TimeoutError'));
}

/**
 * Run a mutation. If `navigator.onLine === false` OR the network throws a
 * TypeError (server unreachable), enqueue the op for later replay and return
 * the synthetic success marker `{ offline: true, queuedOp: op }`. Application
 * errors (ApiError) and unexpected exceptions still propagate so callers can
 * surface them in the UI.
 *
 * `coalesceKey` is forwarded to enqueue() for last-write-wins ops (audio
 * position, last-read) so the queue retains only the newest value per key.
 */
export async function enqueueIfOffline<T>(
  op: PendingOp,
  run: () => Promise<T>,
  coalesceKey?: string,
  options: { queueOnUnauthorized?: boolean } = {}
): Promise<T | { offline: true; queuedOp: PendingOp }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await enqueue(op, coalesceKey);
    return { offline: true, queuedOp: op };
  }

  // Do not let a newer online edit overtake an older queued edit of the
  // same entity. Coalescing replaces it with the newest complete payload.
  if (coalesceKey) {
    let queued = false;
    try { queued = (await listPending()).some(pending => pending.coalesceKey === coalesceKey); } catch { /* online calls can work without local storage */ }
    if (queued) {
      await enqueue(op, coalesceKey);
      return { offline: true, queuedOp: op };
    }
  }

  try {
    return await run();
  } catch (err) {
    const unauthorized = options.queueOnUnauthorized && typeof err === 'object' && err !== null &&
      'status' in err && err.status === 401;
    if (isNetworkFailure(err) || unauthorized) {
      await enqueue(op, coalesceKey);
      return { offline: true, queuedOp: op };
    }
    throw err;
  }
}

// Type guard for callers that want to distinguish a queued result from a real one.
export function isOfflineQueued<T>(
  result: T | { offline: true; queuedOp: PendingOp }
): result is { offline: true; queuedOp: PendingOp } {
  return typeof result === 'object' && result !== null && 'offline' in result && (result as { offline?: true }).offline === true;
}
