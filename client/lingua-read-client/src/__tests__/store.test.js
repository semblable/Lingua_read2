import { useAuthStore } from '../utils/store';
import { authStatus, authLogin, authLogout, authSetup } from '../utils/api';

vi.mock('../utils/api', () => ({
  authStatus: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn(),
  authSetup: vi.fn()
}));

const initialState = {
  isAuthenticated: false,
  user: null,
  isLoading: true,
  needsSetup: false
};

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.setState(initialState);
    vi.clearAllMocks();
  });

  test('initial state has correct defaults', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(true);
    expect(state.needsSetup).toBe(false);
  });

  // --- checkAuth ---

  test('checkAuth sets authenticated state from API response', async () => {
    authStatus.mockResolvedValue({
      authenticated: true,
      needsSetup: false,
      user: { id: 'u1', email: 'u@test.com' }
    });

    await useAuthStore.getState().checkAuth();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual({ id: 'u1', email: 'u@test.com' });
    expect(state.isLoading).toBe(false);
    expect(state.needsSetup).toBe(false);
  });

  test('checkAuth sets needsSetup when returned by status', async () => {
    authStatus.mockResolvedValue({
      authenticated: false,
      needsSetup: true,
      user: null
    });

    await useAuthStore.getState().checkAuth();

    const state = useAuthStore.getState();
    expect(state.needsSetup).toBe(true);
    expect(state.isAuthenticated).toBe(false);
  });

  test('checkAuth handles API failure gracefully', async () => {
    authStatus.mockRejectedValue(new Error('Network error'));

    await useAuthStore.getState().checkAuth();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.needsSetup).toBe(false);
  });

  // --- login ---

  test('login calls authLogin then authStatus and sets authenticated', async () => {
    authLogin.mockResolvedValue({ ok: true });
    authStatus.mockResolvedValue({
      authenticated: true,
      needsSetup: false,
      user: { id: 'u1', email: 'u@test.com' }
    });

    await useAuthStore.getState().login('mypassword');

    expect(authLogin).toHaveBeenCalledWith('mypassword');
    expect(authStatus).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual({ id: 'u1', email: 'u@test.com' });
    expect(state.needsSetup).toBe(false);
  });

  test('login throws on failed response', async () => {
    authLogin.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Invalid password.' })
    });

    await expect(useAuthStore.getState().login('wrong'))
      .rejects.toThrow('Invalid password.');
  });

  test('login throws with fallback message when JSON parse fails', async () => {
    authLogin.mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error('parse error'))
    });

    await expect(useAuthStore.getState().login('wrong'))
      .rejects.toThrow('Login failed.');
  });

  // --- logout ---

  test('logout calls authLogout and clears state', async () => {
    useAuthStore.setState({ isAuthenticated: true, user: { id: 'u1' } });
    authLogout.mockResolvedValue({ ok: true });

    await useAuthStore.getState().logout();

    expect(authLogout).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  test('logout clears state even when authLogout throws', async () => {
    useAuthStore.setState({ isAuthenticated: true, user: { id: 'u1' } });
    authLogout.mockRejectedValue(new Error('Network error'));

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  // --- setup ---

  test('setup calls authSetup then authStatus and sets authenticated', async () => {
    authSetup.mockResolvedValue({ ok: true });
    authStatus.mockResolvedValue({
      authenticated: true,
      needsSetup: false,
      user: { id: 'u1', email: 'u@test.com' }
    });

    await useAuthStore.getState().setup('newpassword');

    expect(authSetup).toHaveBeenCalledWith('newpassword');
    expect(authStatus).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.needsSetup).toBe(false);
  });

  test('setup throws on failed response', async () => {
    authSetup.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ message: 'Password is already set.' })
    });

    await expect(useAuthStore.getState().setup('pw'))
      .rejects.toThrow('Password is already set.');
  });

  test('setup sets needsSetup to false on success', async () => {
    useAuthStore.setState({ needsSetup: true });
    authSetup.mockResolvedValue({ ok: true });
    authStatus.mockResolvedValue({
      authenticated: true,
      needsSetup: false,
      user: { id: 'u1' }
    });

    await useAuthStore.getState().setup('newpassword');

    expect(useAuthStore.getState().needsSetup).toBe(false);
  });
});
