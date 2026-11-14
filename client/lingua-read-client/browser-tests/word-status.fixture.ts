import { test as layoutTest, expect } from './layout.fixture';

type StatusWrite = { wordId: number; status: number; translation?: string };
type StatusNetwork = {
  writes: StatusWrite[];
  hold: Set<number>;
  rejectNext: Set<number>;
  release: (wordId: number) => void;
};

/** Opt-in mutation seam. The ordinary layout fixture retains its complete denylist. */
export const test = layoutTest.extend<{ statusNetwork: StatusNetwork }>({
  statusNetwork: async ({ context, openLayout, baseURL }, runFixture) => {
    void openLayout; // Install the read-only fixture first, then this narrow overlay.
    const pending = new Map<number, () => void>();
    const state: StatusNetwork = {
      writes: [], hold: new Set(), rejectNext: new Set(),
      release: wordId => { state.hold.delete(wordId); pending.get(wordId)?.(); pending.delete(wordId); },
    };
    await context.route('**/api/words/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== baseURL || request.method() !== 'PUT') { await route.fallback(); return; }
      const wordId = Number(url.pathname.split('/').pop());
      const payload = request.postDataJSON() as { status?: unknown; translation?: unknown };
      if (![900, 901, 902, 903, 904, 905].includes(wordId) || !Number.isInteger(payload.status) ||
        Number(payload.status) < 1 || Number(payload.status) > 6 ||
        Object.keys(payload).some(key => key !== 'status' && key !== 'translation') ||
        (payload.translation !== undefined && typeof payload.translation !== 'string')) {
        await route.fallback(); return;
      }
      const write = { wordId, status: Number(payload.status), ...(typeof payload.translation === 'string' ? { translation: payload.translation } : {}) };
      state.writes.push(write);
      if (state.hold.has(wordId)) await new Promise<void>(resolve => pending.set(wordId, resolve));
      if (state.rejectNext.delete(wordId)) {
        await route.fulfill({ status: 503, json: { message: 'Synthetic rejected word save' } });
      } else await route.fulfill({ json: write });
    });
    await runFixture(state);
    for (const release of pending.values()) release();
  },
});

export { expect };
