import { handleUnauthorized } from '../utils/api/client';
import { clearOfflineCaches } from '../utils/offline/cleanup';
import { loginReturnPath } from '../utils/helpers';

vi.mock('../utils/offline/cleanup', () => ({
  clearOfflineCaches: vi.fn(async () => {}),
}));

describe('handleUnauthorized', () => {
  test.each(['https://example.com', '//example.com', '/\\example.com', '/login', '/login?redirect=/login'])('rejects unsafe login return paths: %s', path => {
    expect(loginReturnPath(`?redirect=${encodeURIComponent(path)}`)).toBe('/');
  });
  test('preserves the reader path, query and fragment after login', () => {
    expect(loginReturnPath('?redirect=%2Ftexts%2F7%3Fmode%3Daudio%23cue-3')).toBe('/texts/7?mode=audio#cue-3');
  });
  let originalLocation;
  let hrefSetter;

  beforeEach(() => {
    vi.clearAllMocks();
    // Replace window.location with a stub we can assert against. happy-dom's
    // default location object actually triggers navigation when href is set,
    // which would tear down the test.
    originalLocation = window.location;
    hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get pathname() { return '/dashboard'; },
        get href() { return 'http://localhost/dashboard'; },
        set href(value) { hrefSetter(value); },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  test('clears caches and redirects to /login when called from a non-login page', () => {
    handleUnauthorized();
    expect(clearOfflineCaches).toHaveBeenCalledTimes(1);
    expect(hrefSetter).toHaveBeenCalledWith('/login?redirect=%2Fdashboard');
  });

  test('does nothing when already on /login (no redirect loop)', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get pathname() { return '/login'; },
        get href() { return 'http://localhost/login'; },
        set href(value) { hrefSetter(value); },
      },
    });
    handleUnauthorized();
    expect(clearOfflineCaches).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  test('does not await clearOfflineCaches (fire-and-forget so redirect is not delayed)', () => {
    let resolveCleanup;
    clearOfflineCaches.mockReturnValueOnce(new Promise((resolve) => { resolveCleanup = resolve; }));

    handleUnauthorized();

    // The redirect runs synchronously after the cleanup is *kicked off*, not
    // after it resolves. This keeps the redirect from being held up if the
    // IndexedDB / Cache Storage clear stalls.
    expect(hrefSetter).toHaveBeenCalledWith('/login?redirect=%2Fdashboard');
    expect(clearOfflineCaches).toHaveBeenCalledTimes(1);

    // Tidy up the pending promise so vitest doesn't warn about it.
    resolveCleanup();
  });
});
