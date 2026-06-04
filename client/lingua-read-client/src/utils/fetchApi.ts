/**
 * Typed plumbing over the backend's OpenAPI/Swagger spec (`api-types.d.ts`).
 *
 * This module is the project's single source of request/response *types*. Domain
 * modules under `utils/api/*` derive their DTOs from these helpers, e.g.:
 *
 *   import type { ResponseOf } from '../fetchApi';
 *   export type Text = ResponseOf<'/api/Texts/{id}', 'get'>;
 *
 * It intentionally exports **types only** — the single runtime HTTP client lives
 * in `utils/api/client.ts` (re-exported from `utils/api`). An earlier typed
 * runtime `fetchApi(path, method, options)` wrapper lived here too, but the
 * migration that would have adopted it never happened and it had no callers, so
 * it was removed to avoid a second `fetchApi` with a conflicting signature.
 */

import type { paths } from './api-types';

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
