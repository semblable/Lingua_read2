import { clearAll } from './syncQueue';

/**
 * Wipe per-user offline state — service worker Cache Storage AND the
 * pending op queue. Called from useAuthStore.logout so a subsequent user
 * on the same browser doesn't inherit the previous user's cached texts,
 * book metadata, audio, or queued mutations (cross-user data leak).
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
}
