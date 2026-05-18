import { fetchApi, uploadWithProgress } from './client';
import type { UploadProgressCallback } from './client';
import type { ResponseOf } from '../fetchApi';

export type Book = ResponseOf<'/api/Books/{id}', 'get'>;
export type BooksList = ResponseOf<'/api/Books', 'get'>;
export type NextLesson = ResponseOf<'/api/Books/{id}/next-lesson', 'get'>;

export const getBooks = (): Promise<BooksList> => {
  return fetchApi<BooksList>('/books');
};

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
  tags: string[] = []
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
      tags
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
  console.log('[API] Uploading book file...');

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
  console.log(`[API] Uploading audiobook tracks for book ${bookId}...`);

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
  onProgress: UploadProgressCallback | null = null
): Promise<unknown> => {
  const endpoint = '/texts/audio/batch';
  console.log(`[API] Creating batch audio lessons for language ${languageId} with tag: ${tag || 'none'}`);

  try {
    const formData = new FormData();
    formData.append('languageId', String(languageId));
    if (tag) {
      formData.append('tag', tag);
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
  return fetchApi(`/books/${bookId}/lastread`, {
    method: 'PUT',
    body: JSON.stringify({ textId })
  });
};

export const completeLesson = (
  bookId: number | string | null,
  textId: number | string,
  skipStats: boolean = false
): Promise<unknown> => {
  if (bookId) {
    if (skipStats) {
      throw new Error(
        'completeLesson: skipStats is only supported for standalone texts. Book lessons would silently still record stats.'
      );
    }
    return fetchApi(`/books/${bookId}/complete-lesson`, {
      method: 'PUT',
      body: JSON.stringify({ textId })
    });
  }
  return fetchApi(`/texts/${textId}/complete${skipStats ? '?skipStats=true' : ''}`, {
    method: 'PUT'
  });
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
