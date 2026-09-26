// The service worker update path. Regression target: with vite-plugin-pwa's autoUpdate
// default, every page reloaded itself once a new service worker took over, so the first
// visit after each deploy loaded the app and then reloaded it. Page loads now come from
// the network, and the page reloads only when it runs an older build than the worker.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const { registerSWMock } = vi.hoisted(() => ({
  registerSWMock: vi.fn((_options: { onNeedReload?: () => void }) => vi.fn()),
}));

vi.mock('virtual:pwa-register', () => ({ registerSW: registerSWMock }));

import {
  pageMatchesPrecache,
  reloadIfOutdated,
  registerServiceWorker,
} from '../utils/offline/registerServiceWorker';

const ENTRY = 'http://localhost/static/index-AbC123.js';

describe('service worker update handling', () => {
  let originalLocation: Location;
  let reload: ReturnType<typeof vi.fn>;
  let match: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    registerSWMock.mockClear();
    // Inserted as an inert type first: happy-dom tries (and fails) to load a module script
    // on insertion, while a type change afterwards doesn't load anything.
    const script = document.createElement('script');
    script.type = 'text/plain';
    script.src = ENTRY;
    document.head.appendChild(script);
    script.type = 'module';

    match = vi.fn(async () => undefined);
    vi.stubGlobal('caches', { match });

    // happy-dom's location.reload would tear the test environment down.
    originalLocation = window.location;
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/', reload },
    });
  });

  afterEach(() => {
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  test('a page from the precached build does not reload', async () => {
    match.mockResolvedValue(new Response(''));

    expect(await pageMatchesPrecache()).toBe(true);
    // The precache stores hashed files under their plain URL; ignoreSearch also covers
    // entries with a revision parameter.
    expect(match).toHaveBeenCalledWith(ENTRY, { ignoreSearch: true });

    await reloadIfOutdated();
    expect(reload).not.toHaveBeenCalled();
  });

  test('a page from an older build reloads', async () => {
    await reloadIfOutdated();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('reloads when it cannot tell: no Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    await reloadIfOutdated();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('reloads when it cannot tell: Cache Storage throws', async () => {
    match.mockRejectedValue(new DOMException('denied', 'SecurityError'));
    await reloadIfOutdated();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('reloads when it cannot tell: no entry script', async () => {
    document.head.querySelectorAll('script').forEach((s) => s.remove());
    match.mockResolvedValue(new Response(''));
    await reloadIfOutdated();
    expect(match).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('registration routes the plugin reload through the build check', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
    try {
      match.mockResolvedValue(new Response(''));
      await registerServiceWorker();
      expect(registerSWMock).toHaveBeenCalledTimes(1);
      const { onNeedReload } = registerSWMock.mock.calls[0][0];
      expect(onNeedReload).toBeTypeOf('function');

      onNeedReload?.();
      await vi.waitFor(() => expect(match).toHaveBeenCalled());
      expect(reload).not.toHaveBeenCalled();

      match.mockResolvedValue(undefined);
      onNeedReload?.();
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    } finally {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });
});
