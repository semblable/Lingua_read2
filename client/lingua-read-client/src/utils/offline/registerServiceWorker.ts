// Thin wrapper around vite-plugin-pwa's virtual registration entry. Kept in
// its own module so tests can mock it without pulling the virtual module into
// the Vitest dependency graph.

export async function registerServiceWorker(options: {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
} = {}): Promise<void> {
  // Skip in non-browser environments (e.g. SSR, Vitest happy-dom without SW support).
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    // Resolved at build time by vite-plugin-pwa.
    const { registerSW } = await import(/* @vite-ignore */ 'virtual:pwa-register');
    registerSW({
      immediate: true,
      onNeedRefresh: options.onNeedRefresh,
      onOfflineReady: options.onOfflineReady,
    });
  } catch (err) {
    // Module is unavailable in dev (devOptions.enabled=false) and in tests.
    // Don't crash the app — just log so it's visible in the console.
    // eslint-disable-next-line no-console
    console.debug('[pwa] service worker registration skipped:', err);
  }
}
