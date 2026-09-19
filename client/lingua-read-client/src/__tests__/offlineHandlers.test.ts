import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the API client the production handlers import. The wordStatusUpdate
// handler must send a status-only PUT (no `translation` key) so an offline
// replay never overwrites the saved translation with an empty string.
vi.mock('../utils/api/client', () => ({
  fetchApi: vi.fn().mockResolvedValue(undefined),
}));

import { fetchApi } from '../utils/api/client';
import { productionSyncHandlers } from '../utils/offline/handlers';

describe('productionSyncHandlers.wordStatusUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sends a status-only PUT without a translation field', async () => {
    await productionSyncHandlers.wordStatusUpdate({
      type: 'wordStatusUpdate',
      payload: { wordId: 5, status: 3 },
    });

    const mockFetch = vi.mocked(fetchApi);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('/words/5');
    expect(options?.method).toBe('PUT');

    const body = JSON.parse(String(options?.body));
    expect(body).toEqual({ status: 3 });
    expect(body).not.toHaveProperty('translation');
  });
});

describe('productionSyncHandlers.srsReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('replays the stored event id, review time and time zone verbatim', async () => {
    await productionSyncHandlers.srsReview({
      type: 'srsReview',
      payload: { cardId: 7, grade: 2, clientEventId: 'evt-1', reviewedAt: '2026-09-19T08:00:00.000Z', timezoneOffsetMinutes: 120 },
    });

    const [url, options] = vi.mocked(fetchApi).mock.calls[0];
    expect(url).toBe('/srs/review?timezoneOffsetMinutes=120');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toEqual({
      srsCardReviewId: 7,
      grade: 2,
      clientEventId: 'evt-1',
      reviewedAt: '2026-09-19T08:00:00.000Z',
    });
  });

  test('still replays grades queued by older builds without those fields', async () => {
    await productionSyncHandlers.srsReview({ type: 'srsReview', payload: { cardId: 7, grade: 0 } });

    const [url, options] = vi.mocked(fetchApi).mock.calls[0];
    expect(url).toBe('/srs/review?timezoneOffsetMinutes=0');
    expect(JSON.parse(String(options?.body))).toEqual({ srsCardReviewId: 7, grade: 0 });
  });
});
