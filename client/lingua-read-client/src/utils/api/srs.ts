import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';
import { enqueueIfOffline } from '../offline/enqueueIfOffline';

export type SrsDueCards = ResponseOf<'/api/Srs/due', 'get'>;
export type SrsStats = ResponseOf<'/api/Srs/stats', 'get'>;
export type SrsForecast = ResponseOf<'/api/Srs/forecast', 'get'>;
export type SrsHeatmap = ResponseOf<'/api/Srs/heatmap', 'get'>;
export type SrsAnalytics = ResponseOf<'/api/Srs/analytics', 'get'>;
export type SrsStories = ResponseOf<'/api/Srs/stories', 'get'>;
export type SrsPhrases = ResponseOf<'/api/Srs/phrases/{wordId}', 'get'>;
export type SrsStoryGenerationResult = ResponseOf<'/api/Srs/story-generate', 'post'>;

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
  const queryString = params.toString();
  return await fetchApi<SrsDueCards>(`/srs/due${queryString ? `?${queryString}` : ''}`);
};

export const submitSrsReview = async (
  srsCardReviewId: number | string,
  grade: number | string
): Promise<unknown> => {
  const cardId = parseInt(String(srsCardReviewId), 10);
  const gradeNum = parseInt(String(grade), 10);
  // Wrapped for offline replay: a network failure enqueues the grade for
  // later submission, lets the UI advance to the next card, and the queue
  // drains on reconnect. Application errors (4xx/5xx) still throw.
  return await enqueueIfOffline(
    { type: 'srsReview', payload: { cardId, grade: gradeNum } },
    () => fetchApi('/srs/review', {
      method: 'POST',
      body: JSON.stringify({ srsCardReviewId, grade })
    })
  );
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
  const queryString = params.toString();
  return await fetchApi<SrsStats>(`/srs/stats${queryString ? `?${queryString}` : ''}`);
};

export const undoSrsReview = async (): Promise<unknown> => {
  return await fetchApi('/srs/undo', {
    method: 'POST'
  });
};

export const getSrsForecast = async (
  languageId: number | string | null = null,
  days: number = 14
): Promise<SrsForecast> => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', String(languageId));
  params.append('days', String(days));
  const queryString = params.toString();
  return await fetchApi<SrsForecast>(`/srs/forecast${queryString ? `?${queryString}` : ''}`);
};

export const suspendSrsCard = async (cardId: number | string): Promise<unknown> => {
  return await fetchApi(`/srs/suspend/${cardId}`, { method: 'POST' });
};

export const unsuspendSrsCard = async (cardId: number | string): Promise<unknown> => {
  return await fetchApi(`/srs/unsuspend/${cardId}`, { method: 'POST' });
};

export const burySrsCard = async (cardId: number | string): Promise<unknown> => {
  return await fetchApi(`/srs/bury/${cardId}`, { method: 'POST' });
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
  const queryString = params.toString();
  return await fetchApi<SrsHeatmap>(`/srs/heatmap${queryString ? `?${queryString}` : ''}`);
};

export const getSrsAnalytics = async (
  languageId: number | string | null = null
): Promise<SrsAnalytics> => {
  const params = new URLSearchParams();
  if (languageId) params.append('languageId', String(languageId));
  const queryString = params.toString();
  return await fetchApi<SrsAnalytics>(`/srs/analytics${queryString ? `?${queryString}` : ''}`);
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
  return await fetchApi(`/srs/reading-credit/${wordId}`, { method: 'POST' });
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
    return await fetchApi<SrsStoryGenerationResult>('/srs/story-generate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('SRS micro-context generation failed:', error);
    throw error;
  }
};
