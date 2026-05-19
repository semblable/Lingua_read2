import { fetchApi, fetchApiDownload } from './client';
import type { ResponseOf } from '../fetchApi';

export type Word = ResponseOf<'/api/Words/{id}', 'get'>;
export type WordsByLanguage = ResponseOf<'/api/Words/language/{languageId}', 'get'>;
export type PaginatedWordsByLanguage = ResponseOf<
  '/api/Words/language/{languageId}/paginated',
  'get'
>;

export const createWord = async (
  textId: number | string,
  term: string,
  status: number | string,
  translation: string | null | undefined,
  sentence: string | null = null
): Promise<unknown> => {
  try {
    const payload = {
      textId: parseInt(String(textId), 10),
      term: term.trim(),
      status: parseInt(String(status), 10),
      translation: translation || '',
      sentence
    };

    return await fetchApi('/words', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Error in createWord:', error);
    throw error;
  }
};

export const updateWord = async (
  wordId: number | string,
  status: number | string,
  translation: string | null | undefined
): Promise<unknown> => {
  try {
    if (!wordId) throw new Error('Word ID is required');
    if (!status) throw new Error('Word status is required');

    const payload = {
      status,
      translation: translation ?? ''
    };

    return await fetchApi(`/words/${wordId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Error in updateWord:', error);
    throw error;
  }
};

export const deleteWord = async (wordId: number | string): Promise<unknown> => {
  try {
    if (!wordId) throw new Error('Word ID is required');
    return await fetchApi(`/words/${wordId}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('Error in deleteWord:', error);
    throw error;
  }
};

// Fetches words for a specific language, with optional filtering and sorting
export const getWordsByLanguage = (
  languageId: number | string,
  statusFilter: Array<number | string> = [],
  sortBy: string = 'term_asc',
  searchTerm: string = ''
): Promise<WordsByLanguage> => {
  const params = new URLSearchParams();
  if (statusFilter && statusFilter.length > 0) {
    params.append('status', statusFilter.join(','));
  }
  if (sortBy) {
    params.append('sortBy', sortBy);
  }
  if (searchTerm && searchTerm.trim() !== '') {
    params.append('searchTerm', searchTerm.trim());
  }
  const queryString = params.toString();
  const endpoint = `/words/language/${languageId}${queryString ? `?${queryString}` : ''}`;
  return fetchApi<WordsByLanguage>(endpoint);
};

// Fetches paginated words for a specific language
export const getPaginatedWordsByLanguage = (
  languageId: number | string,
  page: number = 1,
  pageSize: number = 20,
  statusFilter: Array<number | string> = [],
  sortBy: string = 'term_asc',
  searchTerm: string = ''
): Promise<PaginatedWordsByLanguage> => {
  const params = new URLSearchParams();
  params.append('page', String(page));
  params.append('pageSize', String(pageSize));

  if (statusFilter && statusFilter.length > 0) {
    params.append('status', statusFilter.join(','));
  }
  if (sortBy) {
    params.append('sortBy', sortBy);
  }
  if (searchTerm && searchTerm.trim() !== '') {
    params.append('searchTerm', searchTerm.trim());
  }
  const queryString = params.toString();
  const endpoint = `/words/language/${languageId}/paginated${queryString ? `?${queryString}` : ''}`;
  return fetchApi<PaginatedWordsByLanguage>(endpoint);
};

// Triggers CSV export for words, with optional filtering
export const exportWordsCsv = (
  languageId: number | string | null = null,
  statusFilter: Array<number | string> = []
): Promise<{ blob: Blob; filename: string }> => {
  const params = new URLSearchParams();
  if (languageId) {
    params.append('languageId', String(languageId));
  }
  if (statusFilter && statusFilter.length > 0) {
    params.append('status', statusFilter.join(','));
  }
  const queryString = params.toString();
  const endpoint = `/words/export${queryString ? `?${queryString}` : ''}`;
  return fetchApiDownload(endpoint);
};

/**
 * Add a batch of terms and their translations to the database.
 */
export type BatchTerm = { term: string; translation: string };

export const addTermsBatch = async (
  languageId: number | string,
  terms: BatchTerm[]
): Promise<unknown> => {
  try {
    return await fetchApi('/words/batch', {
      method: 'POST',
      body: JSON.stringify({ languageId, terms })
    });
  } catch (error) {
    console.error('Batch add terms failed:', error);
    throw error;
  }
};
