import { fetchApi, uploadWithProgress } from './client';
import type { UploadProgressCallback } from './client';
import type { ResponseOf } from '../fetchApi';
import { enqueueIfOffline } from '../offline/enqueueIfOffline';
import { studyIntent, notifyStudyChange } from '../studyIntent';

export type Book = ResponseOf<'/api/Books/{id}', 'get'>;
export type NextLesson = ResponseOf<'/api/Books/{id}/next-lesson', 'get'>;

export const getBook = (bookId: number | string): Promise<Book> => {
  return fetchApi<Book>(`/books/${bookId}`);
};

export const createBook = (
  title: string,
  description: string,
  languageId: number | string,
  content: string,
  splitMethod: string = 'paragraph',
  maxSegmentSize: number = 3000,
  tags: string[] = [],
  subSplitOversized: boolean = false,
  chapterTitles: string[] = [],
  chapterGroupings: number[][] = [],
  folderId: number | null = null
): Promise<Book> => {
  return fetchApi<Book>('/books', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description,
      languageId,
      content,
      splitMethod,
      maxSegmentSize,
      tags,
      subSplitOversized,
      chapterTitles,
      chapterGroupings,
      folderId
    })
  });
};

// Swagger has no body schema for /books/upload (multipart endpoint), so we
// declare the actual server shape here.
export type UploadBookResult = {
  bookId: number;
  title?: string;
  totalTexts?: number;
  message?: string;
};

export const uploadBook = async (
  formData: FormData,
  onProgress: UploadProgressCallback | null = null
): Promise<UploadBookResult> => {
  const endpoint = '/books/upload';

  try {
    return (await uploadWithProgress(endpoint, formData, onProgress)) as UploadBookResult;
  } catch (error) {
    console.error('[API Error] Failed to upload book:', error);
    throw error;
  }
};

export type UpdateBookInput = { title?: string; description?: string; tags?: string[] };

export const updateBook = (
  bookId: number | string,
  { title, description, tags }: UpdateBookInput
): Promise<Book> => {
  return fetchApi<Book>(`/books/${bookId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, description, tags })
  });
};

export const uploadAudiobookTracks = async (
  bookId: number | string,
  formData: FormData,
  onProgress: UploadProgressCallback | null = null
): Promise<unknown> => {
  const endpoint = `/books/${bookId}/audiobook`;

  try {
    return await uploadWithProgress(endpoint, formData, onProgress);
  } catch (error) {
    console.error('[API Error] Failed to upload audiobook tracks:', error);
    throw error;
  }
};

export const createAudioLessonsBatch = async (
  languageId: number | string,
  tag: string | null,
  files: FileList | File[],
  onProgress: UploadProgressCallback | null = null,
  folderId: number | null = null
): Promise<unknown> => {
  const endpoint = '/texts/audio/batch';

  try {
    const formData = new FormData();
    formData.append('languageId', String(languageId));
    if (tag) {
      formData.append('tag', tag);
    }
    if (folderId) {
      formData.append('folderId', String(folderId));
    }
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    return await uploadWithProgress(endpoint, formData, onProgress);
  } catch (error) {
    console.error('[API Error] Failed to create batch audio lessons:', error);
    throw error;
  }
};

export const deleteBook = (bookId: number | string): Promise<unknown> => {
  return fetchApi(`/books/${bookId}`, {
    method: 'DELETE'
  });
};

export const updateLastRead = (
  bookId: number | string,
  textId: number | string
): Promise<unknown> => {
  const clientUpdatedAt = new Date().toISOString();
  return enqueueIfOffline(
    { type: 'lastRead', payload: { bookId, textId, clientUpdatedAt } },
    () => fetchApi(`/books/${bookId}/lastread`, {
      method: 'PUT',
      body: JSON.stringify({ textId, clientUpdatedAt })
    }),
    `lastRead:book:${bookId}`
  );
};

export const completeLesson = async (
  bookId: number | string | null,
  textId: number | string,
  skipStats: boolean = false,
  study: { repeat?: boolean; sourceRevision?: string } = {}
): Promise<unknown> => {
  if (!navigator.onLine) throw new Error('Connect to record a completed read. Sentence progress still uses the existing offline queue.');
  const intent = skipStats ? null : studyIntent(textId, study.repeat ? 'read-repeat' : 'read-complete', study.sourceRevision);
  let result: unknown;
  if (bookId) {
    if (skipStats) {
      throw new Error(
        'completeLesson: skipStats is only supported for standalone texts. Book lessons would silently still record stats.'
      );
    }
    result = await fetchApi(`/books/${bookId}/complete-lesson`, {
      method: 'PUT',
      body: JSON.stringify({ textId, clientEventId: intent?.id, ...study })
    });
  } else {
    const query = new URLSearchParams();
    if (skipStats) query.set('skipStats', 'true');
    if (intent) query.set('clientEventId', intent.id);
    if (study.repeat) query.set('repeat', 'true');
    if (study.sourceRevision) query.set('sourceRevision', study.sourceRevision);
    const queryString = query.toString();
    result = await fetchApi(`/texts/${textId}/complete${queryString ? `?${queryString}` : ''}`, { method: 'PUT' });
  }
  intent?.done();
  if (!skipStats) notifyStudyChange(textId);
  return result;
};

export const finishBook = (
  bookId: number | string,
  rating: number | null = null
): Promise<unknown> => {
  return fetchApi(`/books/${bookId}/finish`, {
    method: 'PUT',
    body: JSON.stringify({ rating })
  });
};

// Get next lesson from a book
export const getNextLesson = (
  bookId: number | string,
  currentTextId: number | string
): Promise<NextLesson> => {
  return fetchApi<NextLesson>(`/books/${bookId}/next-lesson?currentTextId=${currentTextId}`);
};

export interface ChapterPreview {
  index: number;
  title: string;
  snippet: string;
  characterCount: number;
  estimatedWordCount: number;
}

export interface SplitPreview {
  chapters: ChapterPreview[];
  totalCharacters: number;
  detectionMethod: string;
}

export interface ReSplitRequest {
  splitMethod: string;
  maxSegmentSize: number;
  subSplitOversized: boolean;
  chapterTitles?: string[];
  chapterGroupings?: number[][];
}

export const previewBookSplit = async (
  formData: FormData,
  onProgress: UploadProgressCallback | null = null
): Promise<SplitPreview> => {
  const endpoint = '/books/preview-split';
  try {
    return (await uploadWithProgress(endpoint, formData, onProgress)) as SplitPreview;
  } catch (error) {
    console.error('[API Error] Failed to get book split preview:', error);
    throw error;
  }
};

export const previewManualSplit = (
  title: string,
  content: string,
  splitMethod: string,
  maxSegmentSize: number,
  subSplitOversized: boolean
): Promise<SplitPreview> => {
  return fetchApi<SplitPreview>('/books/preview-split-manual', {
    method: 'POST',
    body: JSON.stringify({
      title,
      content,
      splitMethod,
      maxSegmentSize,
      subSplitOversized
    })
  });
};

export const previewReSplitBook = (
  bookId: number | string,
  request: ReSplitRequest
): Promise<SplitPreview> => {
  return fetchApi<SplitPreview>(`/books/${bookId}/preview-re-split`, {
    method: 'POST',
    body: JSON.stringify(request)
  });
};

export const reSplitBook = (
  bookId: number | string,
  request: ReSplitRequest
): Promise<void> => {
  return fetchApi<void>(`/books/${bookId}/re-split`, {
    method: 'POST',
    body: JSON.stringify(request)
  });
};
