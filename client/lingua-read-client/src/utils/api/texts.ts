import { fetchApi, uploadWithProgress, API_URL, handleUnauthorized } from './client';
import type { UploadProgressCallback } from './client';
import type { ResponseOf } from '../fetchApi';

export type Text = ResponseOf<'/api/Texts/{id}', 'get'>;
export type TextsList = ResponseOf<'/api/Texts', 'get'>;
export type RecentTexts = ResponseOf<'/api/Texts/recent', 'get'>;

// Swagger spec for word-linking-status endpoint has no response body schema
// ({ content?: never }), so ResponseOf<> resolves to void. The endpoint
// actually returns { wordLinkingStatus?: string } at runtime. Same shape as
// the audiobook progress endpoints — see audiobook.ts.
export type WordLinkingStatus = { wordLinkingStatus?: string } | null;

export const getTexts = (): Promise<TextsList> => {
  return fetchApi<TextsList>('/texts');
};

export const getText = (textId: number | string): Promise<Text> => {
  return fetchApi<Text>(`/texts/${textId}`);
};

export const getTextSrt = async (textId: number | string): Promise<string> => {
  const fullUrl = API_URL + `/texts/${textId}/srt`;
  const response = await fetch(fullUrl, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'include',
    mode: 'cors'
  });
  if (response.status === 401) {
    handleUnauthorized();
    throw new Error('Authentication required');
  }
  if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
  return response.text();
};

export const getWordLinkingStatus = (textId: number | string): Promise<WordLinkingStatus> => {
  return fetchApi<WordLinkingStatus>(`/texts/${textId}/word-linking-status`);
};

export const getRecentTexts = (): Promise<RecentTexts> => {
  return fetchApi<RecentTexts>('/texts/recent');
};

export const createText = (
  title: string,
  content: string,
  languageId: number | string,
  tag: string | null = null
): Promise<Text> => {
  const payload: Record<string, unknown> = { title, content, languageId };
  if (tag) {
    payload.tag = tag;
  }
  return fetchApi<Text>('/texts', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

// XHR-based uploader so the caller can show progress
export const createAudioLesson = async (
  title: string,
  languageId: number | string,
  audioFile: File,
  srtFile: File,
  tag: string | null = null,
  onProgress: UploadProgressCallback | null = null
): Promise<unknown> => {
  const endpoint = '/texts/audio';

  try {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('languageId', String(languageId));
    formData.append('audioFile', audioFile);
    formData.append('srtFile', srtFile);
    if (tag) {
      formData.append('tag', tag);
    }

    return await uploadWithProgress(endpoint, formData, onProgress);
  } catch (error) {
    console.error('[API Error] Failed to create audio lesson:', error);
    throw error;
  }
};

export type UpdateTextInput = { title?: string; content?: string; tag?: string | null };

export const updateText = (
  textId: number | string,
  { title, content, tag }: UpdateTextInput
): Promise<Text> => {
  return fetchApi<Text>(`/texts/${textId}`, {
    method: 'PUT',
    body: JSON.stringify({ title, content, tag })
  });
};

export const deleteText = (textId: number | string): Promise<unknown> => {
  return fetchApi(`/texts/${textId}`, {
    method: 'DELETE'
  });
};

// Marks a text as completed and logs activity
export const completeText = (textId: number | string): Promise<unknown> => {
  return fetchApi(`/texts/${textId}/complete`, {
    method: 'PUT'
  });
};
