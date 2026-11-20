// Audiobook / audio-lesson progress and activity-logging endpoints. The
// `progressData` arguments are intentionally permissive so the existing
// AudiobookPlayer call sites compile without refactor.

import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';
import { enqueueIfOffline, isOfflineQueued } from '../offline/enqueueIfOffline';
import { newClientEventId } from '../offline/clientEventId';
import { offlineSessionRevision } from '../offline/events';
import { listPending, removePending } from '../offline/syncQueue';
import { forgetSentenceProgress, queuedSentenceCursorTime, readCachedSentenceProgress, rememberSentenceProgress } from '../sentenceProgress';
import type { LessonListeningCredit } from '../../audio/listeningActivity';
import { notifyStudyChange } from '../studyIntent';

// A monotonic-ish stamp the server uses for last-write-wins conflict
// resolution on position/last-read so a late-draining offline save can't
// clobber a newer value.
const nowIso = (): string => new Date().toISOString();


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
> & {
  // A credit-only offline snapshot cannot tell us where another device stopped.
  cursorUnknown?: boolean;
};
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
      suppressAuthRedirect: true,
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
    `audiobookProgress:book:${bookId}`,
    { queueOnUnauthorized: true }
  );
};

export const getAudiobookProgress = async (
  bookId: number | string
): Promise<AudiobookProgress> => {
  return await fetchApi<AudiobookProgress>(`/activity/audiobookprogress/${bookId}`, { suppressAuthRedirect: true });
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
      suppressAuthRedirect: true,
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
    `audioLessonProgress:lesson:${parsedTextId}`,
    { queueOnUnauthorized: true }
  );
};

export const getAudioLessonProgress = async (
  textId: number | string
): Promise<AudioLessonProgress> => {
  return await fetchApi<AudioLessonProgress>(`/activity/audiolessonprogress/${textId}`, { suppressAuthRedirect: true });
};

export const logListeningActivity = async (
  languageId: number | string,
  durationSeconds: number,
  options: ProgressFetchOptions = {},
  lesson?: LessonListeningCredit
): Promise<unknown> => {
  const clientEventId = newClientEventId();
  const payload = { languageId, durationSeconds, clientEventId,
    ...(lesson ? { lesson: { ...lesson, textId: Number(lesson.textId) } } : {}) };
  const result = await enqueueIfOffline(
    { type: 'logListening', payload },
    () => fetchApi('/activity/logListening', {
      ...options,
      suppressAuthRedirect: true,
      method: 'POST',
      body: JSON.stringify(payload)
    }), undefined, { queueOnUnauthorized: true }
  );
  if (lesson) notifyStudyChange(lesson.textId);
  return result;
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
  const session = offlineSessionRevision();
  const cachedBeforeLoad = readCachedSentenceProgress(textId);
  const [remote, pending] = await Promise.allSettled([
    fetchApi<SentenceProgress>(`/activity/sentenceprogress/${textId}`, { suppressAuthRedirect: true }),
    listPending()
  ]);
  if (offlineSessionRevision() !== session) throw new Error('The session ended before sentence progress loaded.');
  if (remote.status === 'rejected') {
    const status = (remote.reason as { status?: number } | null)?.status;
    if (status === 403 || status === 404) {
      forgetSentenceProgress(textId);
      // A deleted/inaccessible lesson's queued reads would otherwise restore
      // the same position on the next offline visit. Replay also treats these as terminal.
      if (pending.status === 'fulfilled') {
        const invalid = new Set(pending.value.filter(op => op.type === 'sentenceRead'
          && op.payload.textId === Number(textId)).map(op => op.id));
        if (invalid.size) await removePending(op => invalid.has(op.id)).catch(() => undefined);
      }
      throw remote.reason;
    }
  }

  const serverProgress = remote.status === 'fulfilled' ? remote.value : null;
  const cached = readCachedSentenceProgress(textId);
  const cacheChangedDuringLoad = cached && (cached.cursorUpdatedAt !== cachedBeforeLoad?.cursorUpdatedAt
    || cached.lastSegmentIndex !== cachedBeforeLoad.lastSegmentIndex
    || cached.creditedSegmentIndices.length !== cachedBeforeLoad?.creditedSegmentIndices.length);
  // A fresh GET can replace the cache after a restore. Merge only a confirmation
  // received during this GET, e.g. a replay whose queue entry has disappeared.
  const confirmed = serverProgress
    ? rememberSentenceProgress(textId, serverProgress, !cacheChangedDuringLoad) ?? serverProgress
    : cached;
  let lastSegmentIndex = confirmed?.lastSegmentIndex ?? serverProgress?.lastSegmentIndex ?? null;
  let cursorUpdatedAt = confirmed?.cursorUpdatedAt ?? null;
  const credited = new Set(confirmed?.creditedSegmentIndices ?? []);
  for (const op of pending.status === 'fulfilled' ? pending.value : []) {
    if (op.type !== 'sentenceRead' || op.payload.textId !== Number(textId)) continue;
    const queuedAt = queuedSentenceCursorTime(op.payload.clientUpdatedAt, op.enqueuedAt);
    const segmentIndex = op.payload.currentSegmentIndex;
    if (queuedAt && segmentIndex != null && segmentIndex >= 0
        && (!cursorUpdatedAt || Date.parse(queuedAt) >= Date.parse(cursorUpdatedAt))) {
      lastSegmentIndex = segmentIndex;
      cursorUpdatedAt = queuedAt;
    }
    for (const segment of op.payload.segments) {
      if (segment.segmentIndex >= 0 && segment.segmentText.trim()) credited.add(segment.segmentIndex);
    }
  }

  const cursorUnknown = remote.status === 'rejected' && lastSegmentIndex == null;
  if (cursorUnknown && !credited.size) throw remote.reason;
  return {
    ...serverProgress,
    textId: Number(textId),
    lastSegmentIndex,
    cursorUpdatedAt,
    ...(cursorUnknown ? { cursorUnknown: true } : {}),
    creditedSegmentIndices: [...credited].sort((a, b) => a - b)
  };
};

export const logSentenceReadActivity = async (
  payload: LogSentenceReadInput
): Promise<unknown> => {
  const session = offlineSessionRevision();
  const clientUpdatedAt = payload.currentSegmentIndex != null ? nowIso() : undefined;
  // Keep all credits, even when the timestamp of an earlier cursor loses
  // to a more recent navigation.
  const opSegments = (payload.segments ?? []).map((s) => ({
    segmentIndex: Number(s.segmentIndex),
    segmentText: String(s.segmentText ?? '')
  }));
  const result = await enqueueIfOffline<SentenceProgress>(
    {
      type: 'sentenceRead',
      payload: {
        textId: Number(payload.textId),
        currentSegmentIndex: payload.currentSegmentIndex ?? undefined,
        clientUpdatedAt,
        segments: opSegments
      }
    },
    () => fetchApi<SentenceProgress>('/activity/logSentenceRead', {
      suppressAuthRedirect: true,
      method: 'POST',
      body: JSON.stringify({ ...payload, clientUpdatedAt })
    }), undefined, { queueOnUnauthorized: true }
  );
  if (offlineSessionRevision() === session && !isOfflineQueued(result)) rememberSentenceProgress(payload.textId, result);
  return result;
};
