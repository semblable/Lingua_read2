/**
 * Typed fetch wrapper over the backend's OpenAPI/Swagger spec.
 *
 * Phase B of the TypeScript migration adds this scaffolding without changing
 * existing call sites. Phase C1 will convert api.js to use it.
 *
 * Usage:
 *   const data = await fetchApi('/api/Auth/login', 'post', {
 *     body: { password: '...' }
 *   });
 *   // `data` is typed as the 200 response shape for POST /api/Auth/login.
 *
 *   const text = await fetchApi('/api/Texts/{textId}', 'get', {
 *     params: { textId: 42 }
 *   });
 */

import type { paths } from './api-types';

// API_URL is exported from api.js (still .js in Phase B). The .ts wrapper
// imports the runtime value with a small type assertion since api.js has
// no types yet — Phase C1 will resolve the cast.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — api.js is plain JS until Phase C1
import { API_URL as RAW_API_URL } from './api';
const API_URL: string = RAW_API_URL;

// ---------- Type plumbing ----------

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

type Operation<P extends keyof paths, M extends HttpMethod> =
  M extends keyof paths[P] ? paths[P][M] : never;

type JsonContent<T> = T extends { content: { 'application/json': infer J } }
  ? J
  : T extends { content: { 'text/plain': infer J } }
    ? J
    : T extends { content: { 'text/json': infer J } }
      ? J
      : never;

export type RequestBodyOf<P extends keyof paths, M extends HttpMethod> =
  Operation<P, M> extends { requestBody?: infer R }
    ? R extends { content: infer C }
      ? C extends { 'application/json': infer J }
        ? J
        : never
      : never
    : never;

export type ResponseOf<P extends keyof paths, M extends HttpMethod> =
  Operation<P, M> extends { responses: infer R }
    ? R extends { 200: infer Ok }
      ? JsonContent<Ok> extends never
        ? void
        : JsonContent<Ok>
      : R extends { 201: infer Ok }
        ? JsonContent<Ok> extends never
          ? void
          : JsonContent<Ok>
        : void
    : void;

export type PathParamsOf<P extends keyof paths, M extends HttpMethod> =
  Operation<P, M> extends { parameters: { path: infer R } } ? R : never;

export type QueryParamsOf<P extends keyof paths, M extends HttpMethod> =
  Operation<P, M> extends { parameters: { query?: infer R } } ? R : never;

// Pick only the methods that actually exist on a path (non-never).
export type MethodsOf<P extends keyof paths> = {
  [M in HttpMethod]: paths[P][M & keyof paths[P]] extends never | undefined ? never : M;
}[HttpMethod];

// ---------- Runtime helpers ----------

function fillPath(template: string, params: Record<string, unknown> | undefined): string {
  if (!params) return template;
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const v = params[key];
    if (v === undefined || v === null) {
      throw new Error(`Missing path param "${key}" for ${template}`);
    }
    return encodeURIComponent(String(v));
  });
}

function buildQuery(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) usp.append(k, String(item));
    } else {
      usp.set(k, String(v));
    }
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// ---------- Public API ----------

export interface FetchApiOptions<P extends keyof paths, M extends MethodsOf<P>> {
  /** Path params for templated routes like `/api/Texts/{textId}`. */
  params?: PathParamsOf<P, M>;
  /** Query string params. */
  query?: QueryParamsOf<P, M>;
  /** JSON request body. */
  body?: RequestBodyOf<P, M>;
  /** Optional abort signal. */
  signal?: AbortSignal;
  /** Extra headers to merge in. */
  headers?: Record<string, string>;
}

export async function fetchApi<P extends keyof paths, M extends MethodsOf<P>>(
  path: P,
  method: M,
  options: FetchApiOptions<P, M> = {} as FetchApiOptions<P, M>
): Promise<ResponseOf<P, M>> {
  const url = API_URL.replace(/\/api$/, '') +
    fillPath(path as string, options.params as Record<string, unknown> | undefined) +
    buildQuery(options.query as Record<string, unknown> | undefined);

  const init: RequestInit = {
    method: (method as string).toUpperCase(),
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: options.signal,
  };

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${method.toUpperCase()} ${path}${text ? `: ${text}` : ''}`);
  }

  // 204 No Content and other empty bodies: return undefined as void
  if (res.status === 204) return undefined as ResponseOf<P, M>;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json') && !contentType.includes('text')) {
    return undefined as ResponseOf<P, M>;
  }
  const isJson = contentType.includes('json');
  return (isJson ? await res.json() : await res.text()) as ResponseOf<P, M>;
}
