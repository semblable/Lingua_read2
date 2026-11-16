import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { API_URL, uploadWithProgress } from '../utils/api/client';
import { clearOfflineCaches } from '../utils/offline/cleanup';

vi.mock('../utils/offline/cleanup', () => ({
  clearOfflineCaches: vi.fn(async () => {})
}));

// Keep the real uploader in control of request setup and event handlers. This
// transport only records what was sent and delivers browser-style events.
class ControlledXMLHttpRequest {
  static requests: ControlledXMLHttpRequest[] = [];

  withCredentials = false;
  status = 0;
  statusText = '';
  responseText = '';
  readyState = 0;
  responseURL = '';
  upload = new EventTarget();
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sentRequest?: {
    method: string;
    url: string;
    withCredentials: boolean;
    headers: Headers;
    body: FormData;
  };

  private method = '';
  private url = '';
  private requestHeaders = new Headers();
  private responseHeaders = new Headers();

  constructor() {
    ControlledXMLHttpRequest.requests.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders.set(name, value);
  }

  send(body: FormData) {
    this.sentRequest = {
      method: this.method,
      url: this.url,
      withCredentials: this.withCredentials,
      headers: new Headers(this.requestHeaders),
      body
    };
  }

  getResponseHeader(name: string) {
    return this.responseHeaders.get(name);
  }

  respond(status: number, statusText: string, body = '', headers: Record<string, string> = {}) {
    this.status = status;
    this.statusText = statusText;
    this.responseText = body;
    this.responseHeaders = new Headers(headers);
    this.onload?.();
  }

  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.dispatchEvent(new ProgressEvent('progress', { loaded, total, lengthComputable }));
  }

  failNetwork() {
    this.onerror?.();
  }
}

describe('uploadWithProgress', () => {
  const originalLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
  const redirect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    ControlledXMLHttpRequest.requests = [];
    vi.stubGlobal('XMLHttpRequest', ControlledXMLHttpRequest);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        pathname: '/library/7',
        search: '?view=audio',
        hash: '#upload',
        set href(value: string) { redirect(value); }
      }
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', originalLocation);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test.each(['books/upload', '/books/upload'])(
    'sends %s as a credentialed multipart POST with the CSRF header',
    async endpoint => {
      const formData = new FormData();
      formData.append('file', new File(['A tiny book.'], 'chapter.txt', { type: 'text/plain' }));
      formData.append('languageId', '7');

      const result = uploadWithProgress(endpoint, formData);
      expect(ControlledXMLHttpRequest.requests).toHaveLength(1);
      const request = ControlledXMLHttpRequest.requests[0];

      // Capture credentials and headers at send time so a late assignment
      // cannot make an unauthenticated request look correct to this test.
      expect(request.sentRequest).toMatchObject({
        method: 'POST',
        url: `${API_URL}/books/upload`,
        withCredentials: true
      });
      expect(request.sentRequest?.body).toBe(formData);
      expect(request.sentRequest?.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
      // The browser must supply the multipart boundary for this FormData.
      expect(request.sentRequest?.headers.has('Content-Type')).toBe(false);

      request.respond(201, 'Created', '{"bookId":17}', { 'Content-Type': 'application/json; charset=utf-8' });
      await expect(result).resolves.toEqual({ bookId: 17 });
    }
  );

  test('reports rounded, increasing progress only for computable upload lengths', async () => {
    const onProgress = vi.fn();
    const result = uploadWithProgress('/books/upload', new FormData(), onProgress);
    const request = ControlledXMLHttpRequest.requests[0];

    request.progress(75, 100, false);
    request.progress(0, 200);
    request.progress(1, 200);
    request.progress(2, 200);
    request.progress(80, 200);
    request.progress(40, 200);
    request.progress(200, 200);

    expect(onProgress.mock.calls).toEqual([[1], [40], [100]]);
    request.respond(204, 'No Content');
    await expect(result).resolves.toEqual({ message: 'Success' });
  });

  test.each<{ status: number; headers: Record<string, string> }>([
    { status: 204, headers: {} },
    { status: 200, headers: { 'Content-Length': '0', 'Content-Type': 'application/json' } }
  ])('accepts an empty successful response ($status, $headers)', async ({ status, headers }) => {
    const result = uploadWithProgress('/books/upload', new FormData());
    ControlledXMLHttpRequest.requests[0].respond(status, 'OK', '', headers);
    await expect(result).resolves.toEqual({ message: 'Success' });
  });

  test('returns a plain-text success message', async () => {
    const result = uploadWithProgress('/books/upload', new FormData());
    ControlledXMLHttpRequest.requests[0].respond(200, 'OK', 'Upload complete', { 'Content-Type': 'text/plain' });
    await expect(result).resolves.toEqual({ message: 'Upload complete' });
  });

  test('rejects an expired session and redirects through the real unauthorized handler', async () => {
    const result = uploadWithProgress('/books/upload', new FormData());
    const rejection = expect(result).rejects.toThrow('Authentication required');
    ControlledXMLHttpRequest.requests[0].respond(401, 'Unauthorized', '{"message":"Session expired"}');

    await rejection;
    expect(clearOfflineCaches).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith('/login?redirect=%2Flibrary%2F7%3Fview%3Daudio%23upload');
  });

  test.each([
    { body: '{"message":"File is too large"}', message: 'File is too large' },
    { body: '{"title":"Unsupported file type"}', message: 'Unsupported file type' },
    { body: 'Upload service unavailable', message: 'Upload service unavailable' }
  ])('rejects a server failure with its response message: $message', async ({ body, message }) => {
    const result = uploadWithProgress('/books/upload', new FormData());
    const rejection = expect(result).rejects.toThrow(message);
    ControlledXMLHttpRequest.requests[0].respond(400, 'Bad Request', body);

    await rejection;
    expect(clearOfflineCaches).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  test('rejects a network failure without treating it as an expired session', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = uploadWithProgress('/books/upload', new FormData());
    const rejection = expect(result).rejects.toThrow('Network error occurred during upload. Status: 0');
    ControlledXMLHttpRequest.requests[0].failNetwork();

    await rejection;
    expect(clearOfflineCaches).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
