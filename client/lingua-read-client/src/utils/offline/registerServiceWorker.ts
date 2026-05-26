// Thin wrapper around vite-plugin-pwa's virtual registration entry. Kept in
// its own module so tests can mock it without pulling the virtual module into
// the Vitest dependency graph.

/** Function returned by vite-plugin-pwa's `registerSW`. Call with `true` to
 *  activate the waiting service worker AND reload the page in one step. */
export type UpdateSW = (reloadPage?: boolean) => Promise<void>;

export async function registerServiceWorker(options: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
} = {}): Promise<UpdateSW | null> {
  // Skip in non-browser environments (e.g. SSR, Vitest happy-dom without SW support).
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

  try {
    // Resolved at build time by vite-plugin-pwa.
    const { registerSW } = await import(/* @vite-ignore */ 'virtual:pwa-register');
    // `registerSW` returns the update trigger. We MUST surface it so the
    // caller can wire a "Reload to update" affordance — without that, the
    // ship config (`registerType: 'prompt'`) leaves the new SW stuck in
    // "waiting" forever and users keep running the cached old bundle.
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: options.onNeedRefresh,
      onOfflineReady: options.onOfflineReady,
    });
    return updateSW as UpdateSW;
  } catch (err) {
    // Module is unavailable in dev (devOptions.enabled=false) and in tests.
    // Don't crash the app — just log so it's visible in the console.
    // eslint-disable-next-line no-console
    console.debug('[pwa] service worker registration skipped:', err);
    return null;
  }
}
