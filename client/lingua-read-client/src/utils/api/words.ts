import { fetchApi, fetchApiDownload } from './client';
import type { ResponseOf } from '../fetchApi';
import { enqueueIfOffline } from '../offline/enqueueIfOffline';

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

    // Offline replay: createWord is one of the three mutations the offline
    // queue knows how to replay. We persist textId in the queued payload so
    // the server can recover languageId at replay time — sending textId=0
    // (the previous default) would fail validation on the server and trap
    // the op in the queue forever.
    return await enqueueIfOffline(
      {
        type: 'wordCreate',
        payload: {
          textId: payload.textId,
          term: payload.term,
          translation: payload.translation,
          status: payload.status,
        },
      },
      () => fetchApi('/words', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(payload)
      })
    );
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

    // Offline replay: queue only the status change (translation edits are
    // rarer and tend to need the network for AI suggestions anyway).
    return await enqueueIfOffline(
      {
        type: 'wordStatusUpdate',
        payload: { wordId: parseInt(String(wordId), 10), status: parseInt(String(status), 10) },
      },
      () => fetchApi(`/words/${wordId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      })
    );
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
// `status` (1-5, Known when left out) is for words not saved yet: new ones, and the status-0 rows
// linking a text leaves.
export type BatchTerm = { term: string; translation: string; status?: number };

export type AddTermsBatchOptions = {
  // Leave the status of saved words alone and only fill in their translation. Otherwise a saved
  // word below Known is raised to Known.
  keepExistingStatus?: boolean;
};

// `words` holds the batch's words as now stored (see mergeSavedWords).
export type AddTermsBatchResult = ResponseOf<'/api/Words/batch', 'post'>;

export const addTermsBatch = async (
  languageId: number | string,
  terms: BatchTerm[],
  options: AddTermsBatchOptions = {}
): Promise<AddTermsBatchResult> => {
  try {
    return await fetchApi<AddTermsBatchResult>('/words/batch', {
      method: 'POST',
      body: JSON.stringify({ languageId, terms, ...options })
    });
  } catch (error) {
    console.error('Batch add terms failed:', error);
    throw error;
  }
};

// A language's word list (GET words/language) with the rows a batch save returned put in place of
// the ones they supersede, matched by id or by term the way the reader looks words up, so the
// reader need not download the whole language again after saving a few words.
export const mergeSavedWords = (words: Word[], saved: Word[]): Word[] => {
  if (saved.length === 0) return words;
  const savedIds = new Set(saved.map((w) => w.wordId));
  const savedTerms = new Set(saved.flatMap((w) => (w.term ? [w.term.toLowerCase()] : [])));
  const kept = words.filter((w) => !savedIds.has(w.wordId) && !(w.term && savedTerms.has(w.term.toLowerCase())));
  return [...kept, ...saved];
};

// A language's word list with the fetched rows it doesn't have yet, matched by id or by term like
// mergeSavedWords. Rows it already has are kept: the fetch may have been read before a save that
// has since been merged in, and the word linker only adds rows, it never changes existing ones.
export const addMissingWords = (words: Word[], fetched: Word[]): Word[] => {
  const ids = new Set(words.map((w) => w.wordId));
  const terms = new Set(words.flatMap((w) => (w.term ? [w.term.toLowerCase()] : [])));
  const missing = fetched.filter((w) => !ids.has(w.wordId) && !(w.term && terms.has(w.term.toLowerCase())));
  return missing.length === 0 ? words : [...words, ...missing];
};
