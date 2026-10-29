import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getPaginatedWordsByLanguage } from '../utils/api/words';
import { fetchApi } from '../utils/api/client';

vi.mock('../utils/api/client', () => ({ fetchApi: vi.fn(), fetchApiDownload: vi.fn() }));

describe('terms page API requests', () => {
  beforeEach(() => vi.clearAllMocks());

  test.each([undefined, false])('omits sentence loading unless opted in (%s)', async includeSentences => {
    await getPaginatedWordsByLanguage(7, 1, 20, [], 'created_desc', '', includeSentences);
    const url = new URL(vi.mocked(fetchApi).mock.calls[0][0], 'https://example.test');
    expect(url.pathname).toBe('/words/language/7/paginated');
    expect(url.searchParams.has('includeSentences')).toBe(false);
  });

  test('requests sentences alongside the current pagination, filters, and search', async () => {
    const response = { items: [], totalCount: 0, totalPages: 0 };
    vi.mocked(fetchApi).mockResolvedValueOnce(response);
    expect(await getPaginatedWordsByLanguage(7, 3, 20, [1, 2], 'term_asc', '  gato & perro  ', true)).toBe(response);
    const url = new URL(vi.mocked(fetchApi).mock.calls[0][0], 'https://example.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '3', pageSize: '20', status: '1,2', sortBy: 'term_asc', searchTerm: 'gato & perro', includeSentences: 'true'
    });
  });
});
