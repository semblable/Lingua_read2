// Thin wrapper around vite-plugin-pwa's virtual registration entry. Kept in
// its own module so tests can mock it without pulling the virtual module into
// the Vitest dependency graph.

/** Function returned by vite-plugin-pwa's `registerSW`. Call with `true` to
 *  activate the waiting service worker AND reload the page in one step. */
export type UpdateSW = (reloadPage?: boolean) => Promise<void>;

/**
 * Whether this page runs the build the active service worker precached. The worker
 * deletes the previous build's precache entries when it activates, so an older page's
 * entry script is no longer there — nor on the server, which only has the new build.
 * Answers false when it can't tell, so the caller falls back to reloading.
 */
export async function pageMatchesPrecache(): Promise<boolean> {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  if (!entry || typeof caches === 'undefined') return false;
  try {
    return (await caches.match(entry.src, { ignoreSearch: true })) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Called when a newer service worker has taken over this page (instead of the plugin's
 * unconditional reload). Page loads come from the network (see vite.config.ts), so the
 * page usually runs that worker's build already: the first visit after a deploy. Only a
 * page from an older build, such as a tab left open across a deploy, has to reload,
 * because its lazy chunks are gone.
 */
export async function reloadIfOutdated(): Promise<void> {
  if (!(await pageMatchesPrecache())) window.location.reload();
}

export async function registerServiceWorker(options: {
  onOfflineReady?: () => void;
} = {}): Promise<UpdateSW | null> {
  // Skip in non-browser environments (e.g. SSR, Vitest happy-dom without SW support).
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

  try {
    // Resolved at build time by vite-plugin-pwa. No `@vite-ignore` here: Rolldown
    // (Vite 8) honours it by leaving the bare specifier in the bundle, which the
    // browser can't load, and vite-plugin-pwa then falls back to injecting its
    // own registerSW.js without the autoUpdate reload handling.
    const { registerSW } = await import('virtual:pwa-register');
    // With `registerType: 'autoUpdate'` a new service worker calls skipWaiting +
    // clients.claim, and the plugin calls onNeedReload once it has taken over.
    const updateSW = registerSW({
      immediate: true,
      onOfflineReady: options.onOfflineReady,
      onNeedReload: () => {
        void reloadIfOutdated();
      },
    });
    return updateSW as UpdateSW;
  } catch (err) {
    // Module is unavailable in dev (devOptions.enabled=false) and in tests.
    // Don't crash the app — just log so it's visible in the console.
    console.debug('[pwa] service worker registration skipped:', err);
    return null;
  }
}
