// Production replay handlers for the offline sync queue. The drain() function
// is kept handler-agnostic so the unit tests can supply mocks; this file is the
// single place where the real API helpers are imported.

import { fetchApi } from '../api/client';
import type { SyncHandlers } from './syncQueue';

export const productionSyncHandlers: SyncHandlers = {
  srsReview: async ({ payload }) => {
    await fetchApi('/srs/review', {
      method: 'POST',
      body: JSON.stringify({ srsCardReviewId: payload.cardId, grade: payload.grade }),
    });
  },
  wordStatusUpdate: async ({ payload }) => {
    await fetchApi(`/words/${payload.wordId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: payload.status, translation: '' }),
    });
  },
  wordCreate: async ({ payload }) => {
    await fetchApi('/words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        textId: payload.textId,
        term: payload.term,
        status: payload.status ?? 1,
        translation: payload.translation ?? '',
      }),
    });
  },
};
