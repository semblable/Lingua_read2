import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';

export type Language = ResponseOf<'/api/Languages/{id}', 'get'>;
export type LanguagesList = ResponseOf<'/api/Languages', 'get'>;
export type LanguageInput = RequestBodyOf<'/api/Languages', 'post'>;

// Note: This might be fetching the translation-specific list.
// Kept for now, but the new functions below target the full config endpoint.
export const getLanguages = (): Promise<unknown> => {
  return fetchApi('/translation/languages');
};

// Gets ALL languages with full configuration details
export const getAllLanguages = (): Promise<LanguagesList> => {
  return fetchApi<LanguagesList>('/languages');
};

// Gets a single language by ID with full configuration
export const getLanguage = (languageId: number | string): Promise<Language> => {
  return fetchApi<Language>(`/languages/${languageId}`);
};

// Creates a new language configuration
export const createLanguage = (languageData: LanguageInput): Promise<Language> => {
  return fetchApi<Language>('/languages', {
    method: 'POST',
    body: JSON.stringify(languageData)
  });
};

// Updates an existing language configuration
export const updateLanguage = (
  languageId: number | string,
  languageData: LanguageInput
): Promise<Language> => {
  return fetchApi<Language>(`/languages/${languageId}`, {
    method: 'PUT',
    body: JSON.stringify(languageData)
  });
};

// Deletes a language configuration
export const deleteLanguage = (languageId: number | string): Promise<unknown> => {
  return fetchApi(`/languages/${languageId}`, {
    method: 'DELETE'
  });
};

// Deletes all user content (texts, books, words, activity, stats) for a language,
// keeping the language configuration itself.
export const resetLanguageContent = (languageId: number | string): Promise<unknown> => {
  return fetchApi(`/languages/${languageId}/reset-content`, {
    method: 'POST'
  });
};
