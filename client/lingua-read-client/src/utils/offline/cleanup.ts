import { clearAll } from './syncQueue';
import { clearCachedBookmarks } from '../bookmarks';
import { notifyOfflineEvent } from './events';

/**
 * Wipe per-user service worker Cache Storage and the local bookmark cache.
 * Session expiry retains the pending queue so work can sync after login.
 * Also called from useAuthStore.logout so a
 * subsequent user on the same browser doesn't inherit the previous user's
 * cached texts, book metadata, audio, bookmarks or queued mutations
 * (cross-user data leak).
 *
 * Best-effort: failures are swallowed so logout itself never blocks. The
 * caller is not expected to handle errors.
 */
export async function clearOfflineCaches(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n).catch(() => undefined)));
    }
  } catch {
    /* swallow — best effort */
  }
  // No-op until the one-time bookmark upload has run: before that the cache
  // is the only copy of those bookmarks.
  clearCachedBookmarks();
}

/** Explicit logout discards queued mutations; session expiry must preserve them. */
export async function clearOfflineState(): Promise<void> {
  // Invalidate pending reader coordinators before awaiting cache/queue cleanup.
  // Late failures must not enqueue work into a subsequent user's session.
  notifyOfflineEvent('session-ended');
  await clearOfflineCaches();
  try {
    await clearAll();
  } catch {
    /* swallow — best effort */
  }
}
