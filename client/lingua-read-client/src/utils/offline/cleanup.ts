import { clearAll } from './syncQueue';
import { clearCachedBookmarks } from '../bookmarks';

/**
 * Wipe per-user offline state — service worker Cache Storage, the pending
 * op queue and the local bookmark cache. Called from useAuthStore.logout so a
 * subsequent user on the same browser doesn't inherit the previous user's
 * cached texts, book metadata, audio, bookmarks or queued mutations
 * (cross-user data leak).
 *
 * Best-effort: failures are swallowed so logout itself never blocks. The
 * caller is not expected to handle errors.
 */
export async function clearOfflineState(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n).catch(() => undefined)));
    }
  } catch {
    /* swallow — best effort */
  }
  try {
    await clearAll();
  } catch {
    /* swallow — best effort */
  }
  // No-op until the one-time bookmark upload has run: before that the cache
  // is the only copy of those bookmarks.
  clearCachedBookmarks();
}
