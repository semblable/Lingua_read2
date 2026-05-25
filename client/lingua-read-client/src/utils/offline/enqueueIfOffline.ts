import { enqueue, type PendingOp } from './syncQueue';

// A network failure surfaces as `fetch` throwing `TypeError: Failed to fetch`
// (Chrome/Firefox) or `NetworkError when attempting to fetch resource` (Safari).
// Application errors (4xx/5xx) come back through the `if (!response.ok)` branch
// in client.ts and throw a typed `ApiError` — we explicitly do NOT enqueue those.
function isNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'ApiError') {
    return false;
  }
  return error instanceof TypeError;
}

/**
 * Run a mutation. If `navigator.onLine === false` OR the network throws a
 * TypeError (server unreachable), enqueue the op for later replay and return
 * the synthetic success marker `{ offline: true, queuedOp: op }`. Application
 * errors (ApiError) and unexpected exceptions still propagate so callers can
 * surface them in the UI.
 */
export async function enqueueIfOffline<T>(
  op: PendingOp,
  run: () => Promise<T>
): Promise<T | { offline: true; queuedOp: PendingOp }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await enqueue(op);
    return { offline: true, queuedOp: op };
  }

  try {
    return await run();
  } catch (err) {
    if (isNetworkFailure(err)) {
      await enqueue(op);
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
