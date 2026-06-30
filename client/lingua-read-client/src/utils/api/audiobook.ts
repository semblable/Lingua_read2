// Audiobook / audio-lesson progress and activity-logging endpoints. The
// `progressData` arguments are intentionally permissive so the existing
// AudiobookPlayer call sites compile without refactor.

import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';
import { enqueueIfOffline } from '../offline/enqueueIfOffline';

// A monotonic-ish stamp the server uses for last-write-wins conflict
// resolution on position/last-read so a late-draining offline save can't
// clobber a newer value.
const nowIso = (): string => new Date().toISOString();

// Unique id per listening flush so the additive logListening endpoint can
// dedupe replays (and responses lost on a flaky link) instead of double-counting.
const newClientEventId = (): string =>
  (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// The Swagger spec for these endpoints lacks a body schema (controllers
// return `Ok(object)` without [ProducesResponseType]). Define the shapes
// here based on actual backend behavior so AudiobookPlayer consumers
// don't get `void` from ResponseOf.
export type AudiobookProgress = {
  currentAudiobookTrackId?: number | null;
  currentAudiobookPosition?: number | null;
  updatedAt?: string | null;
} | null;

export type AudioLessonProgress = {
  currentPosition?: number | null;
  updatedAt?: string | null;
} | null;

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
  const clientUpdatedAt = nowIso();
  const payload = {
    bookId,
    currentAudiobookTrackId: progressData.currentAudiobookTrackId,
    currentAudiobookPosition: progressData.currentAudiobookPosition,
    clientUpdatedAt
  };
  return await enqueueIfOffline(
    {
      type: 'audiobookProgress',
      payload: {
        bookId,
        trackId: progressData.currentAudiobookTrackId,
        position: progressData.currentAudiobookPosition,
        clientUpdatedAt
      }
    },
    () => fetchApi('/activity/audiobookprogress', {
      ...options,
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
    `audiobookProgress:book:${bookId}`
  );
};

export const getAudiobookProgress = async (
  bookId: number | string
): Promise<AudiobookProgress> => {
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
  const clientUpdatedAt = nowIso();
  const parsedTextId = parseInt(String(textId), 10);
  const payload = {
    textId: parsedTextId,
    currentPosition: progressData.currentPosition,
    clientUpdatedAt
  };
  return await enqueueIfOffline(
    {
      type: 'audioLessonProgress',
      payload: {
        textId: parsedTextId,
        position: progressData.currentPosition,
        clientUpdatedAt
      }
    },
    () => fetchApi('/activity/audiolessonprogress', {
      ...options,
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
    `audioLessonProgress:lesson:${parsedTextId}`
  );
};

export const getAudioLessonProgress = async (
  textId: number | string
): Promise<AudioLessonProgress> => {
  return await fetchApi<AudioLessonProgress>(`/activity/audiolessonprogress/${textId}`);
};

export const logListeningActivity = async (
  languageId: number | string,
  durationSeconds: number,
  options: ProgressFetchOptions = {}
): Promise<unknown> => {
  const clientEventId = newClientEventId();
  const payload = { languageId, durationSeconds, clientEventId };
  return await enqueueIfOffline(
    { type: 'logListening', payload: { languageId, durationSeconds, clientEventId } },
    () => fetchApi('/activity/logListening', {
      ...options,
      method: 'POST',
      body: JSON.stringify(payload)
    })
  );
};

export const logManualActivity = async (
  payload: LogManualActivityInput
): Promise<unknown> => {
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
  // sentenceRead is appended (not coalesced): the server credits each segment
  // index at most once, so replaying the same segments is a no-op.
  const opSegments = (payload.segments ?? []).map((s) => ({
    segmentIndex: Number(s.segmentIndex),
    segmentText: String(s.segmentText ?? '')
  }));
  return await enqueueIfOffline(
    {
      type: 'sentenceRead',
      payload: {
        textId: Number(payload.textId),
        currentSegmentIndex: payload.currentSegmentIndex ?? undefined,
        segments: opSegments
      }
    },
    () => fetchApi('/activity/logSentenceRead', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  );
};
