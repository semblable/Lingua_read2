// Internal HTTP helpers shared by every src/utils/api/* domain module.
// Public surface (API_URL + fetchApi + fetchApiDownload + uploadWithProgress)
// is re-exported from src/utils/api/index.ts so call sites keep using
// `import { ... } from '../utils/api'` unchanged.

// Dynamically set API URL based on platform.
//
// - Web (behind Nginx): default to `/api`
// - Native/mobile: set `VITE_API_BASE_URL_MOBILE` (e.g. `http://<LAN-IP>:5000/api`)
// - Optional override for web too: `VITE_API_BASE_URL` (e.g. `https://yourdomain.com/api`)
const WEB_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
const MOBILE_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL_MOBILE ||
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:5000/api';

const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';
export const API_URL = isWeb ? WEB_API_BASE_URL : MOBILE_API_BASE_URL;

// Redirect to login on 401
export const handleUnauthorized = (): void => {
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
};

export type UploadProgressCallback = (percent: number) => void;

// XHR-based uploader with progress events. The internal fetchApi can't do
// upload progress, so this exists for endpoints that take FormData files
// (book uploads, audio lessons, audiobook tracks, batch audio).
export const uploadWithProgress = (
  endpoint: string,
  formData: FormData,
  onProgress?: UploadProgressCallback | null
): Promise<unknown> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fullUrl = API_URL + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);

    if (onProgress) {
      let lastPercent = 0;
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          // Ensure monotonic progress to prevent jitter or resets during the same request
          if (percentComplete > lastPercent) {
            lastPercent = percentComplete;
            onProgress(percentComplete);
          }
        }
      });
    }

    xhr.open('POST', fullUrl);
    xhr.withCredentials = true; // Send httpOnly auth cookie
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest'); // CSRF protection

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          if (xhr.status === 204 || xhr.getResponseHeader('Content-Length') === '0') {
            resolve({ message: 'Success' });
            return;
          }
          const contentType = xhr.getResponseHeader('Content-Type');
          if (contentType && contentType.includes('application/json')) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            resolve({ message: xhr.responseText || xhr.statusText });
          }
        } catch (e) {
          console.error('JSON Parse Error:', e);
          resolve({ message: xhr.statusText });
        }
      } else {
        if (xhr.status === 401) {
          handleUnauthorized();
          reject(new Error('Authentication required'));
          return;
        }
        try {
          const json = JSON.parse(xhr.responseText);
          const message = json.message || json.title || `Upload failed: ${xhr.status} ${xhr.statusText}`;
          reject(new Error(message));
        } catch {
          reject(new Error(xhr.responseText || `Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => {
      console.error('[API Error] XHR Network Error:', {
        status: xhr.status,
        statusText: xhr.statusText,
        readyState: xhr.readyState,
        responseURL: xhr.responseURL
      });
      reject(new Error(`Network error occurred during upload. Status: ${xhr.status}`));
    };

    xhr.send(formData);
  });
};

export type FetchApiOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Internal fetch helper. JSON-in, JSON-out by default, redirects to /login on 401.
// Returns the parsed response body (object or `{ message }` for plain text).
// Callers that need the raw Response use bare `fetch(API_URL + ...)` instead.
export const fetchApi = async <T = unknown>(
  endpoint: string,
  options: FetchApiOptions = {}
): Promise<T> => {
  if (!endpoint.startsWith('/')) {
    endpoint = '/' + endpoint;
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    };

    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    const requestConfig: RequestInit = {
      ...options,
      headers,
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint;
    const response = await fetch(fullUrl.toString(), requestConfig);

    if (response.status === 401) {
      handleUnauthorized();
      throw new ApiError('Authentication required', 401);
    }

    if (!response.ok) {
      const contentType = response.headers.get('content-type');
      let errorMessage: string;

      if (contentType && contentType.includes('application/json')) {
        const errorData = await response.json();
        errorMessage = errorData.message || `HTTP error! Status: ${response.status}`;
      } else {
        const text = await response.text();
        errorMessage = text || `HTTP error! Status: ${response.status}`;
      }

      console.error('[API Error] Request failed:', {
        status: response.status,
        statusText: response.statusText,
        url: fullUrl.toString(),
        error: errorMessage
      });

      throw new ApiError(errorMessage, response.status);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    const text = await response.text();
    return { message: text || response.statusText } as unknown as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error('[API Error] Request failed:', {
      endpoint,
      error: message,
      stack
    });
    throw error;
  }
};

// Specialized download helper. Returns `{ blob, filename }` so the caller
// can trigger a save (used by db backup, words CSV export).
export const fetchApiDownload = async (
  endpoint: string,
  options: FetchApiOptions = {}
): Promise<{ blob: Blob; filename: string }> => {
  if (!endpoint.startsWith('/')) {
    endpoint = '/' + endpoint;
  }

  try {
    const headers: Record<string, string> = {
      Accept: 'application/octet-stream',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const requestConfig: RequestInit = {
      ...options,
      headers,
      credentials: 'include',
      mode: 'cors'
    };

    const fullUrl = API_URL + endpoint;
    const response = await fetch(fullUrl.toString(), requestConfig);

    if (!response.ok) {
      if (response.status === 401) {
        handleUnauthorized();
        throw new ApiError('Authentication required', 401);
      }
      let errorMessage = `HTTP error! Status: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorMessage;
      } catch {
        try {
          const text = await response.text();
          errorMessage = text || errorMessage;
        } catch {
          /* keep original status error */
        }
      }
      console.error('[API Download Error] Request failed:', errorMessage);
      throw new ApiError(errorMessage, response.status);
    }

    const disposition = response.headers.get('content-disposition');
    let filename = 'linguaread_backup.backup';
    if (disposition && disposition.indexOf('attachment') !== -1) {
      const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
      const matches = filenameRegex.exec(disposition);
      if (matches != null && matches[1]) {
        filename = matches[1].replace(/['"]/g, '');
      }
    }

    const blob = await response.blob();
    return { blob, filename };
  } catch (error) {
    console.error('[API Download Error] Request failed:', error);
    throw error;
  }
};

// Simple test function to check API connectivity (unauthenticated)
export const testApiConnection = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_URL}/Health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      mode: 'cors'
    });
    return response.ok;
  } catch (error) {
    console.error('API connection error:', error);
    return false;
  }
};
