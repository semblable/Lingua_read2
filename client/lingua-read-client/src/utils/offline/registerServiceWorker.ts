// Thin wrapper around vite-plugin-pwa's virtual registration entry. Kept in
// its own module so tests can mock it without pulling the virtual module into
// the Vitest dependency graph.

/** Function returned by vite-plugin-pwa's `registerSW`. Call with `true` to
 *  activate the waiting service worker AND reload the page in one step. */
export type UpdateSW = (reloadPage?: boolean) => Promise<void>;

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
    // With `registerType: 'autoUpdate'` the plugin automatically calls
    // skipWaiting + clients.claim and reloads the page when a new SW is
    // downloaded — no manual "Reload to update" prompt is needed.
    const updateSW = registerSW({
      immediate: true,
      onOfflineReady: options.onOfflineReady,
    });
    return updateSW as UpdateSW;
  } catch (err) {
    // Module is unavailable in dev (devOptions.enabled=false) and in tests.
    // Don't crash the app — just log so it's visible in the console.
    console.debug('[pwa] service worker registration skipped:', err);
    return null;
  }
}
