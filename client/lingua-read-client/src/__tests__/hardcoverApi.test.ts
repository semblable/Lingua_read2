import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import { ApiError, fetchApi } from '../utils/api/client';
import {
  matchHardcoverBook,
  parsePositiveIntId,
  unlinkHardcoverBook
} from '../utils/api/hardcover';

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    ...init
  });

describe('hardcover API & fetchApi client behavior', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('parsePositiveIntId & matchHardcoverBook validation', () => {
    test('omits null, undefined, empty, and whitespace-only IDs instead of coercing them to 0', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ applied: false, candidates: [] }));

      await matchHardcoverBook(7);
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/hardcover/match/7',
        expect.not.objectContaining({ body: expect.anything() })
      );

      fetchSpy.mockResolvedValue(jsonResponse({ applied: false, candidates: [] }));
      await matchHardcoverBook(7, '   ');
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/hardcover/match/7',
        expect.not.objectContaining({ body: expect.anything() })
      );

      fetchSpy.mockResolvedValue(jsonResponse({ applied: false, candidates: [] }));
      await matchHardcoverBook(7, {
        hardcoverBookId: '   ',
        hardcoverEditionId: '',
        query: '  El Quijote  '
      });
      const lastInit = fetchSpy.mock.calls.at(-1)?.[1] as RequestInit;
      expect(JSON.parse(String(lastInit.body))).toEqual({ query: 'El Quijote' });
    });

    test('accepts valid numeric and trimmed digit-string overloads', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ applied: true, candidates: [] }));
      await matchHardcoverBook(7, 55);
      expect(JSON.parse(String((fetchSpy.mock.calls.at(-1)?.[1] as RequestInit).body))).toEqual({
        hardcoverBookId: 55
      });

      fetchSpy.mockResolvedValue(jsonResponse({ applied: true, candidates: [] }));
      await matchHardcoverBook(7, ' 55 ');
      expect(JSON.parse(String((fetchSpy.mock.calls.at(-1)?.[1] as RequestInit).body))).toEqual({
        hardcoverBookId: 55
      });

      fetchSpy.mockResolvedValue(jsonResponse({ applied: true, candidates: [] }));
      await matchHardcoverBook('7', { hardcoverBookId: '55', hardcoverEditionId: ' 66 ' });
      expect(JSON.parse(String((fetchSpy.mock.calls.at(-1)?.[1] as RequestInit).body))).toEqual({
        hardcoverBookId: 55,
        hardcoverEditionId: 66
      });
    });

    test.each([0, -1, 1.5, NaN, Infinity, 'abc', '0', '-5', '1.5', '1e3'])(
      'rejects invalid hardcoverBookId value %p with RangeError without calling fetch',
      async (badValue) => {
        await expect(matchHardcoverBook(7, badValue)).rejects.toThrow(RangeError);
        await expect(matchHardcoverBook(7, { hardcoverBookId: badValue })).rejects.toThrow(RangeError);
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    );

    test.each([0, -1, 1.5, NaN, Infinity, 'abc'])(
      'rejects invalid hardcoverEditionId value %p with RangeError without calling fetch',
      async (badEditionId) => {
        await expect(
          matchHardcoverBook(7, { hardcoverBookId: 55, hardcoverEditionId: badEditionId })
        ).rejects.toThrow(RangeError);
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    );

    test('parsePositiveIntId returns undefined for nullish/blank and throws RangeError for invalid values', () => {
      expect(parsePositiveIntId(null, 'id')).toBeUndefined();
      expect(parsePositiveIntId(undefined, 'id')).toBeUndefined();
      expect(parsePositiveIntId('  ', 'id')).toBeUndefined();
      expect(parsePositiveIntId(42, 'id')).toBe(42);
      expect(parsePositiveIntId(' 42 ', 'id')).toBe(42);
      expect(() => parsePositiveIntId(0, 'hardcoverBookId')).toThrow(/hardcoverBookId/);
    });
  });

  describe('unlinkHardcoverBook & empty/204 responses', () => {
    test('returns undefined on 204 No Content without Content-Type', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const result = await unlinkHardcoverBook(7);

      expect(result).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/hardcover/link/7',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    test('returns undefined on 204 No Content even when Content-Type is application/json', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(null, {
          status: 204,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      await expect(unlinkHardcoverBook(7)).resolves.toBeUndefined();
    });

    test('returns undefined on Content-Length: 0 success responses', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Length': '0' }
        })
      );

      await expect(fetchApi('/hardcover/link/7', { method: 'DELETE' })).resolves.toBeUndefined();
    });
  });

  describe('fetchApi error extraction', () => {
    test('extracts validation messages from application/problem+json ValidationProblemDetails', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
            title: 'One or more validation errors occurred.',
            status: 400,
            errors: {
              Rating: ['Rating must be between 0.5 and 5.0.']
            }
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/problem+json; charset=utf-8' }
          }
        )
      );

      await expect(fetchApi('/books/7/finish', { method: 'PUT' })).rejects.toMatchObject({
        name: 'ApiError',
        status: 400,
        message: 'Rating must be between 0.5 and 5.0.'
      });
    });

    test('extracts detail and falls back to title from application/problem+json', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            title: 'Bad Gateway',
            detail: 'Hardcover upstream timed out.'
          }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/problem+json' }
          }
        )
      );

      await expect(fetchApi('/hardcover/status')).rejects.toMatchObject({
        status: 502,
        message: 'Hardcover upstream timed out.'
      });

      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            title: 'Not Found'
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/problem+json' }
          }
        )
      );

      await expect(fetchApi('/hardcover/status')).rejects.toMatchObject({
        status: 404,
        message: 'Not Found'
      });
    });

    test('extracts plain JSON string error bodies (e.g. ASP.NET Core BadRequest(string))', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify('Rating must be between 0.5 and 5.0.'), {
          status: 400,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        })
      );

      const err = await fetchApi('/books/7/finish', { method: 'PUT' }).catch(e => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({
        status: 400,
        message: 'Rating must be between 0.5 and 5.0.'
      });
    });

    test('handles malformed or empty JSON error bodies without throwing raw SyntaxError', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('{not-valid-json', {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const malformedErr = await fetchApi('/hardcover/status').catch(e => e);
      expect(malformedErr).toBeInstanceOf(ApiError);
      expect(malformedErr).toMatchObject({
        status: 500,
        message: '{not-valid-json'
      });

      fetchSpy.mockResolvedValueOnce(
        new Response('', {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      );

      const emptyErr = await fetchApi('/hardcover/status').catch(e => e);
      expect(emptyErr).toBeInstanceOf(ApiError);
      expect(emptyErr).toMatchObject({
        status: 503,
        message: 'HTTP error! Status: 503'
      });
    });
  });
});
