// Verifies the session-expiry cleanup hook on handleUnauthorized.
//
// Regression target: clearOfflineState was wired into useAuthStore.logout but
// NOT into the much more common 401 → /login redirect path. A session cookie
// expiring mid-page meant the next user (or even the same user post-redirect)
// inherited the previous session's Cache Storage and pending sync queue.

import { handleUnauthorized } from '../utils/api/client';
import { clearOfflineState } from '../utils/offline/cleanup';

vi.mock('../utils/offline/cleanup', () => ({
  clearOfflineState: vi.fn(async () => {}),
}));

describe('handleUnauthorized', () => {
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

  test('wipes offline state and redirects to /login when called from a non-login page', () => {
    handleUnauthorized();
    expect(clearOfflineState).toHaveBeenCalledTimes(1);
    expect(hrefSetter).toHaveBeenCalledWith('/login');
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
    expect(clearOfflineState).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  test('does not await clearOfflineState (fire-and-forget so redirect is not delayed)', () => {
    let resolveCleanup;
    clearOfflineState.mockReturnValueOnce(new Promise((resolve) => { resolveCleanup = resolve; }));

    handleUnauthorized();

    // The redirect runs synchronously after the cleanup is *kicked off*, not
    // after it resolves. This keeps the redirect from being held up if the
    // IndexedDB / Cache Storage clear stalls.
    expect(hrefSetter).toHaveBeenCalledWith('/login');
    expect(clearOfflineState).toHaveBeenCalledTimes(1);

    // Tidy up the pending promise so vitest doesn't warn about it.
    resolveCleanup();
  });
});
