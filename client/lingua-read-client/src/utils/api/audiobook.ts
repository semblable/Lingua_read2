// Audiobook / audio-lesson progress and activity-logging endpoints. The
// `progressData` arguments are intentionally permissive so the existing
// AudiobookPlayer call sites compile without refactor.

import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';

export type AudiobookProgress = ResponseOf<
  '/api/activity/audiobookprogress/{bookId}',
  'get'
>;
export type AudioLessonProgress = ResponseOf<
  '/api/activity/audiolessonprogress/{textId}',
  'get'
>;
export type SentenceProgress = ResponseOf<
  '/api/activity/sentenceprogress/{textId}',
  'get'
>;
export type LogManualActivityInput = RequestBodyOf<'/api/activity/logManual', 'post'>;
export type LogSentenceReadInput = RequestBodyOf<'/api/activity/logSentenceRead', 'post'>;

type ProgressFetchOptions = Omit<RequestInit, 'method' | 'body' | 'headers'> & {
  headers?: Record<string, string>;
};

export type AudiobookProgressInput = {
  currentAudiobookTrackId: number | null;
  currentAudiobookPosition: number | null;
};

export const updateAudiobookProgress = async (
  bookId: number | string,
  progressData: AudiobookProgressInput,
  options: ProgressFetchOptions = {}
): Promise<unknown> => {
  const payload = {
    bookId,
    currentAudiobookTrackId: progressData.currentAudiobookTrackId,
    currentAudiobookPosition: progressData.currentAudiobookPosition
  };
  console.log('[API] Updating audiobook progress via UserActivityController:', payload);
  return await fetchApi('/activity/audiobookprogress', {
    ...options,
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

export const getAudiobookProgress = async (
  bookId: number | string
): Promise<AudiobookProgress> => {
  console.log(`[API] Getting audiobook progress for book ${bookId} via UserActivityController`);
  return await fetchApi<AudiobookProgress>(`/activity/audiobookprogress/${bookId}`);
};

export type AudioLessonProgressInput = {
  currentPosition: number | null;
};

export const updateAudioLessonProgress = async (
  textId: number | string,
  progressData: AudioLessonProgressInput,
  options: ProgressFetchOptions = {}
): Promise<unknown> => {
  const payload = {
    textId: parseInt(String(textId), 10),
    currentPosition: progressData.currentPosition
  };
  console.log('[API] Updating audio lesson progress via UserActivityController:', payload);
  return await fetchApi('/activity/audiolessonprogress', {
    ...options,
    method: 'PUT',
    body: JSON.stringify(payload)
  });
};

export const getAudioLessonProgress = async (
  textId: number | string
): Promise<AudioLessonProgress> => {
  console.log(`[API] Getting audio lesson progress for text ${textId} via UserActivityController`);
  return await fetchApi<AudioLessonProgress>(`/activity/audiolessonprogress/${textId}`);
};

export const logListeningActivity = async (
  languageId: number | string,
  durationSeconds: number,
  options: ProgressFetchOptions = {}
): Promise<unknown> => {
  console.log(`[API] Logging listening activity: Lang ${languageId}, Duration ${durationSeconds}s`);
  const payload = { languageId, durationSeconds };
  return await fetchApi('/activity/logListening', {
    ...options,
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const logManualActivity = async (
  payload: LogManualActivityInput
): Promise<unknown> => {
  console.log('[API] Logging manual activity:', payload);
  return await fetchApi('/activity/logManual', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

export const getSentenceProgress = async (
  textId: number | string
): Promise<SentenceProgress> => {
  return await fetchApi<SentenceProgress>(`/activity/sentenceprogress/${textId}`);
};

export const logSentenceReadActivity = async (
  payload: LogSentenceReadInput
): Promise<unknown> => {
  return await fetchApi('/activity/logSentenceRead', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};
