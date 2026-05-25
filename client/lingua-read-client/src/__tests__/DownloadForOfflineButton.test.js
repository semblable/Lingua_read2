import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import DownloadForOfflineButton from '../components/offline/DownloadForOfflineButton';

/**
 * Mock the Cache Storage API. happy-dom does not provide one, so we stand up
 * a thin in-memory cache that records put() calls and resolves match() against
 * what's been stored.
 */
const makeCacheMock = () => {
  const store = new Map();
  return {
    open: vi.fn(async () => ({
      match: vi.fn(async (url) => store.get(url) ?? undefined),
      put: vi.fn(async (url, response) => { store.set(url, response); }),
    })),
    _store: store,
  };
};

// Build a Response whose body is a ReadableStream emitting N chunks, so we can
// observe streamed progress updates.
const streamedResponse = (chunks, contentLength) => {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers();
  if (contentLength != null) headers.set('Content-Length', String(contentLength));
  headers.set('Content-Type', 'audio/mpeg');
  return new Response(stream, { status: 200, headers });
};

describe('DownloadForOfflineButton', () => {
  let cachesMock;
  let originalCaches;
  let originalFetch;

  beforeEach(() => {
    cachesMock = makeCacheMock();
    originalCaches = globalThis.caches;
    Object.defineProperty(globalThis, 'caches', {
      configurable: true, writable: true, value: cachesMock,
    });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalCaches === undefined) {
      delete globalThis.caches;
    } else {
      Object.defineProperty(globalThis, 'caches', {
        configurable: true, writable: true, value: originalCaches,
      });
    }
    globalThis.fetch = originalFetch;
  });

  test('renders the download button in idle state', async () => {
    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/api/texts/1/content']} />);
    const btn = await screen.findByTestId('download-offline-button');
    expect(btn).toHaveAttribute('data-download-state', 'idle');
    expect(btn).toHaveTextContent(/Download for offline/);
  });

  test('small download skips the confirm prompt and goes straight to in-flight', async () => {
    // HEAD returns 1 MB total → below the 100 MB default threshold.
    globalThis.fetch = vi.fn(async (url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': String(1024 * 1024) } });
      }
      return streamedResponse([new Uint8Array([1, 2, 3])], 3);
    });

    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/short.mp3']} />);
    fireEvent.click(await screen.findByTestId('download-offline-button'));

    await waitFor(() => {
      expect(cachesMock.open).toHaveBeenCalledWith('lr-test');
    });
    await waitFor(() => {
      expect(screen.getByTestId('download-offline-button')).toHaveAttribute(
        'data-download-state', 'cached'
      );
    });
    // GET happened after the HEAD.
    expect(globalThis.fetch).toHaveBeenCalledWith('/short.mp3', expect.objectContaining({ method: 'HEAD' }));
    expect(globalThis.fetch).toHaveBeenCalledWith('/short.mp3', expect.objectContaining({ credentials: 'include' }));
  });

  test('large download prompts for confirmation before starting', async () => {
    // HEAD reports 200 MB → over the 100 MB default threshold.
    globalThis.fetch = vi.fn(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': String(200 * 1024 * 1024) } });
      }
      return streamedResponse([new Uint8Array(8)], 8);
    });

    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/big.mp3']} />);
    fireEvent.click(await screen.findByTestId('download-offline-button'));

    const confirm = await screen.findByTestId('download-offline-confirm');
    expect(confirm).toHaveTextContent(/200\.0 MB/);

    // Clicking Cancel returns to idle without downloading.
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(await screen.findByTestId('download-offline-button')).toHaveAttribute(
      'data-download-state', 'idle'
    );
    // The GET fetch was never issued — only the HEAD.
    const getCalls = globalThis.fetch.mock.calls.filter(([, init]) => init?.method !== 'HEAD');
    expect(getCalls).toHaveLength(0);
  });

  test('confirming a large download proceeds with the GETs', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': String(150 * 1024 * 1024) } });
      }
      return streamedResponse([new Uint8Array(4)], 4);
    });

    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/big.mp3']} />);
    fireEvent.click(await screen.findByTestId('download-offline-button'));
    await screen.findByTestId('download-offline-confirm');
    fireEvent.click(screen.getByTestId('download-offline-confirm-go'));

    await waitFor(() => {
      expect(screen.getByTestId('download-offline-button')).toHaveAttribute(
        'data-download-state', 'cached'
      );
    });
  });

  test('progress reflects bytes received, not just file count', async () => {
    // Single 100-byte file delivered in two 50-byte chunks — we want to see
    // intermediate progress before the second chunk arrives.
    let controllerRef;
    const stream = new ReadableStream({
      start(controller) { controllerRef = controller; },
    });
    const headers = new Headers({ 'Content-Length': '100', 'Content-Type': 'audio/mpeg' });
    globalThis.fetch = vi.fn(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': '100' } });
      }
      return new Response(stream, { status: 200, headers });
    });

    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/song.mp3']} />);
    fireEvent.click(await screen.findByTestId('download-offline-button'));

    // First chunk → ~50% progress.
    await act(async () => {
      controllerRef.enqueue(new Uint8Array(50));
    });
    const bar = await screen.findByTestId('download-offline-progress-bar');
    await waitFor(() => {
      expect(Number(bar.getAttribute('data-percent'))).toBe(50);
    });

    // Second chunk → 100% and finalize.
    await act(async () => {
      controllerRef.enqueue(new Uint8Array(50));
      controllerRef.close();
    });
    await waitFor(() => {
      expect(screen.getByTestId('download-offline-button')).toHaveAttribute(
        'data-download-state', 'cached'
      );
    });
  });

  test('Cancel during in-flight aborts the fetch and returns to idle', async () => {
    let abortedSignal = null;
    let controllerRef;
    globalThis.fetch = vi.fn(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': '100' } });
      }
      abortedSignal = init?.signal;
      const stream = new ReadableStream({ start(c) { controllerRef = c; } });
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Length': '100', 'Content-Type': 'audio/mpeg' },
      });
    });

    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/song.mp3']} />);
    fireEvent.click(await screen.findByTestId('download-offline-button'));

    // Wait until the download is actually streaming.
    await screen.findByTestId('download-offline-progress');
    expect(abortedSignal).not.toBeNull();

    // Click Cancel — should abort the signal and return to idle.
    fireEvent.click(screen.getByTestId('download-offline-abort'));
    // Push another chunk to give the reader a chance to notice the abort.
    if (controllerRef) {
      try { controllerRef.enqueue(new Uint8Array(10)); } catch { /* may already be cancelled */ }
    }
    expect(abortedSignal.aborted).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId('download-offline-button')).toHaveAttribute(
        'data-download-state', 'idle'
      );
    });
  });

  test('cached response is stored with Accept-Ranges so range requests work', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'Content-Length': '10' } });
      }
      return streamedResponse([new Uint8Array(10)], 10);
    });
    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/song.mp3']} />);
    fireEvent.click(await screen.findByTestId('download-offline-button'));

    await waitFor(() => {
      expect(cachesMock._store.has('/song.mp3')).toBe(true);
    });
    const cached = cachesMock._store.get('/song.mp3');
    expect(cached.headers.get('Accept-Ranges')).toBe('bytes');
    expect(cached.headers.get('Content-Length')).toBe('10');
  });

  test('surfaces fetch errors via the error testid', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Length': '5' } });
      return new Response('nope', { status: 500 });
    });
    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/api/texts/2/content']} />);
    fireEvent.click(await screen.findByTestId('download-offline-button'));

    expect(await screen.findByTestId('download-offline-error')).toHaveTextContent(/responded 500/);
  });

  test('starts in the cached state when all urls are already in the cache', async () => {
    cachesMock._store.set('/api/texts/3/content', new Response('cached', { status: 200 }));
    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/api/texts/3/content']} />);

    await waitFor(() => {
      expect(screen.getByTestId('download-offline-button')).toHaveAttribute(
        'data-download-state', 'cached'
      );
    });
  });

  test('is disabled when given an empty url list', async () => {
    render(<DownloadForOfflineButton cacheName="lr-test" urls={[]} />);
    const btn = await screen.findByTestId('download-offline-button');
    expect(btn).toBeDisabled();
  });

  test('renders nothing when the Cache Storage API is unavailable', async () => {
    Object.defineProperty(globalThis, 'caches', {
      configurable: true, writable: true, value: undefined,
    });
    const { container } = render(
      <DownloadForOfflineButton cacheName="lr-test" urls={['/url1']} />
    );
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  test('explicit sizeWarningBytes override changes the prompt threshold', async () => {
    globalThis.fetch = vi.fn(async (_url, init) => {
      if (init?.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Content-Length': String(10 * 1024 * 1024) } });
      return streamedResponse([new Uint8Array(4)], 4);
    });
    // Threshold lowered to 5 MB — the 10 MB file should trigger the prompt.
    render(<DownloadForOfflineButton cacheName="lr-test" urls={['/mid.mp3']} sizeWarningBytes={5 * 1024 * 1024} />);
    fireEvent.click(await screen.findByTestId('download-offline-button'));
    expect(await screen.findByTestId('download-offline-confirm')).toBeInTheDocument();
  });
});
