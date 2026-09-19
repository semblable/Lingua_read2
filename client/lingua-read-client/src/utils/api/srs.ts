import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';
import { enqueueIfOffline } from '../offline/enqueueIfOffline';
import { newClientEventId } from '../offline/clientEventId';
import { removePending } from '../offline/syncQueue';

export type SrsDueCards = ResponseOf<'/api/Srs/due', 'get'>;
export type SrsStats = ResponseOf<'/api/Srs/stats', 'get'>;
export type SrsForecast = ResponseOf<'/api/Srs/forecast', 'get'>;
export type SrsHeatmap = ResponseOf<'/api/Srs/heatmap', 'get'>;
export type SrsAnalytics = ResponseOf<'/api/Srs/analytics', 'get'>;
export type SrsStories = ResponseOf<'/api/Srs/stories', 'get'>;
export type SrsPhrases = ResponseOf<'/api/Srs/phrases/{wordId}', 'get'>;
export type SrsStoryGenerationResult = ResponseOf<'/api/Srs/story-generate', 'post'>;
export type SrsReviewResult = ResponseOf<'/api/Srs/review', 'post'>;

// The server counts SRS days (due dates, daily limits, streaks, heatmap) in the
// user's local day, so every SRS call says which time zone the user is in.
const tzOffset = (): number => -new Date().getTimezoneOffset();

const srsUrl = (path: string, params: URLSearchParams = new URLSearchParams()): string => {
  params.set('timezoneOffsetMinutes', String(tzOffset()));
  return `/srs/${path}?${params.toString()}`;
};

export type SrsDueFilters = {
  status?: Array<number | string>;
  onlyOneTarget?: boolean;
  limit?: number;
};

export const getSrsDueCards = async (
  languageId: number | string | null = null,
  { status, onlyOneTarget = false, limit = 50 }: SrsDueFilters = {}
): Promise<SrsDueCards> => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', String(languageId));
  if (status && status.length > 0) params.append('status', status.join(','));
  if (onlyOneTarget) params.append('onlyOneTarget', 'true');
  params.append('limit', String(limit));
  return await fetchApi<SrsDueCards>(srsUrl('due', params));
};

/** Either the server's result, or a grade that is waiting in the offline queue. */
export type SrsSubmitResult =
  | { queued: false; clientEventId: string; result: SrsReviewResult }
  | { queued: true; clientEventId: string };

export const submitSrsReview = async (
  srsCardReviewId: number | string,
  grade: number | string
): Promise<SrsSubmitResult> => {
  const cardId = parseInt(String(srsCardReviewId), 10);
  const gradeNum = parseInt(String(grade), 10);
  // The id makes a replay idempotent server-side; reviewedAt and the offset let a
  // replay be scheduled from when the card was actually reviewed.
  const clientEventId = newClientEventId();
  const reviewedAt = new Date().toISOString();
  const timezoneOffsetMinutes = tzOffset();
  // Wrapped for offline replay: a network failure enqueues the grade for
  // later submission, lets the UI advance to the next card, and the queue
  // drains on reconnect. Application errors (4xx/5xx) still throw.
  const response = await enqueueIfOffline<SrsReviewResult>(
    { type: 'srsReview', payload: { cardId, grade: gradeNum, clientEventId, reviewedAt, timezoneOffsetMinutes } },
    () => fetchApi<SrsReviewResult>(`/srs/review?timezoneOffsetMinutes=${timezoneOffsetMinutes}`, {
      method: 'POST',
      body: JSON.stringify({ srsCardReviewId: cardId, grade: gradeNum, clientEventId, reviewedAt })
    })
  );
  if (response && typeof response === 'object' && 'offline' in response) {
    return { queued: true, clientEventId };
  }
  return { queued: false, clientEventId, result: response as SrsReviewResult };
};

export const mineSentence = async (
  wordId: number | string,
  sentence: string,
  textId: number | string | null = null,
  textTitle: string | null = null
): Promise<unknown> => {
  return await fetchApi('/srs/mine', {
    method: 'POST',
    body: JSON.stringify({ wordId, sentence, textId, textTitle })
  });
};

export const getSrsPhrases = async (wordId: number | string): Promise<SrsPhrases> => {
  return await fetchApi<SrsPhrases>(`/srs/phrases/${wordId}`);
};

export const deleteSrsPhrase = async (phraseId: number | string): Promise<unknown> => {
  return await fetchApi(`/srs/phrases/${phraseId}`, {
    method: 'DELETE'
  });
};

export const getSrsStats = async (
  languageId: number | string | null = null
): Promise<SrsStats> => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', String(languageId));
  return await fetchApi<SrsStats>(srsUrl('stats', params));
};

/** Reverts one review by its log id (from the review response). */
export const undoSrsReview = async (srsReviewLogId: number): Promise<unknown> => {
  return await fetchApi(srsUrl('undo'), {
    method: 'POST',
    body: JSON.stringify({ srsReviewLogId })
  });
};

/** Drops a grade still waiting in the offline queue. Returns false if it already synced. */
export const cancelQueuedSrsReview = async (clientEventId: string): Promise<boolean> => {
  const removed = await removePending(
    (op) => op.type === 'srsReview' && op.payload.clientEventId === clientEventId
  );
  return removed > 0;
};

export const getSrsForecast = async (
  languageId: number | string | null = null,
  days: number = 14
): Promise<SrsForecast> => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', String(languageId));
  params.append('days', String(days));
  return await fetchApi<SrsForecast>(srsUrl('forecast', params));
};

export const suspendSrsCard = async (cardId: number | string): Promise<unknown> => {
  return await fetchApi(`/srs/suspend/${cardId}`, { method: 'POST' });
};

export const unsuspendSrsCard = async (cardId: number | string): Promise<unknown> => {
  return await fetchApi(`/srs/unsuspend/${cardId}`, { method: 'POST' });
};

export const burySrsCard = async (cardId: number | string): Promise<unknown> => {
  return await fetchApi(srsUrl(`bury/${cardId}`), { method: 'POST' });
};

export type UpdateSrsCardInput = { flag?: number | string | null; tags?: string[] | null };

export const updateSrsCard = async (
  cardId: number | string,
  { flag, tags }: UpdateSrsCardInput = {}
): Promise<unknown> => {
  const body: Record<string, unknown> = {};
  if (flag !== undefined) body.flag = flag;
  if (tags !== undefined) body.tags = tags;
  return await fetchApi(`/srs/cards/${cardId}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
};

export const getSrsHeatmap = async (days: number = 365): Promise<SrsHeatmap> => {
  const params = new URLSearchParams();
  params.append('days', String(days));
  return await fetchApi<SrsHeatmap>(srsUrl('heatmap', params));
};

export const getSrsAnalytics = async (
  languageId: number | string | null = null
): Promise<SrsAnalytics> => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', String(languageId));
  return await fetchApi<SrsAnalytics>(srsUrl('analytics', params));
};

export const getSrsStories = async (
  languageId: number | string | null = null
): Promise<SrsStories> => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', String(languageId));
  const queryString = params.toString();
  return await fetchApi<SrsStories>(`/srs/stories${queryString ? `?${queryString}` : ''}`);
};

export const applySrsReadingCredit = async (wordId: number | string): Promise<unknown> => {
  return await fetchApi(srsUrl(`reading-credit/${wordId}`), { method: 'POST' });
};

// SRS Micro-Context Generation API
export type GenerateSrsStoryOptions = {
  maxWords?: number;
  status?: Array<number | string>;
  cardType?: string;
};

export const generateSrsStory = async (
  languageId: number | string,
  { maxWords, status, cardType }: GenerateSrsStoryOptions = {}
): Promise<SrsStoryGenerationResult> => {
  try {
    const payload = { languageId, maxWords, status: status?.join(','), cardType };
    return await fetchApi<SrsStoryGenerationResult>(srsUrl('story-generate'), {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('SRS micro-context generation failed:', error);
    throw error;
  }
};
